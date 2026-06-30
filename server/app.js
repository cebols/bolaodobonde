import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  all, get, run, ensureSchema, USE_PG,
  createPool, genToken, hashPin,
  recomputeMatch, recomputeAdvanceAll, recomputeAdvanceForParticipant, resolveKnockout,
  phaseMult, advMult, advanceSide, KO_STAGES, DEFAULT_MULT, DEFAULT_KO_ADVANCE,
} from './store.js';
import { syncPool, maybeSync, SYNC_ENABLED, diagnose, matchGoals } from './sync.js';
import { GROUPS, FLAGS, CODES, STAGE_NAMES, FIFA_RANK } from '../data/wc2026.js';

// Ordem das fases e regra de liberação: uma fase só abre para palpites quando a
// anterior terminou por completo (16-avos só após a fase de grupos, etc.).
const STAGE_ORDER = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];
function stageLocks(matches) {
  const allFinished = (stage) => {
    const list = matches.filter((m) => m.stage === stage);
    return list.length > 0 && list.every((m) => m.finished);
  };
  // Pré-requisito de cada fase (a anterior precisa estar encerrada).
  const prereq = { r32: 'group', r16: 'r32', qf: 'r16', sf: 'qf', third: 'sf', final: 'sf' };
  const locks = {};
  for (const [stage, dep] of Object.entries(prereq)) locks[stage] = !allFinished(dep);
  return locks;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Garante o schema (cria as tabelas no 1º acesso — importante no serverless).
// Não bloqueia a requisição: se falhar, guarda o erro para o /api/_health relatar
// e deixa o handler seguir (a query real vai expor o erro de verdade).
app.use(async (req, res, next) => {
  try { await ensureSchema(); } catch (e) { req._dbError = e; }
  next();
});

// Mostra o detalhe do erro quando DEBUG_ERRORS=1 (útil para diagnosticar em produção).
const SHOW_ERR = process.env.DEBUG_ERRORS === '1' || process.env.DEBUG_ERRORS === 'true';
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  const body = { error: 'Erro interno do servidor.' };
  if (SHOW_ERR) { body.detail = String(err && err.message || err); body.code = err && err.code; }
  res.status(500).json(body);
});

// Diagnóstico: modo do banco e teste de conexão (não vaza a connection string).
app.get('/api/_health', (req, res) => {
  const info = {
    ok: true,
    db: USE_PG ? 'postgres' : 'sqlite',
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    node: process.version,
  };
  Promise.resolve()
    .then(() => ensureSchema())
    .then(() => get('SELECT 1 AS ok'))
    .then((r) => { info.connect = 'ok'; info.select = r; res.json(info); })
    .catch((e) => {
      info.ok = false; info.connect = 'fail';
      info.error = String(e && e.message || e); info.code = e && e.code;
      res.status(500).json(info);
    });
});

// Diagnóstico do auto-update (football-data.org). Abra no navegador para validar.
app.get('/api/_football_check', wrap(async (req, res) => {
  res.json(await diagnose());
}));

async function getPool(req, res) {
  const pool = await get('SELECT * FROM pools WHERE slug = $1', [req.params.slug]);
  if (!pool) { res.status(404).json({ error: 'Bolão não encontrado.' }); return null; }
  return pool;
}
function isAdmin(req, pool) {
  const token = req.get('x-admin-token') || req.query.admin;
  return !!token && token === pool.admin_token;
}
async function getParticipant(req, pool) {
  const token = req.get('x-participant-token');
  if (!token) return null;
  return get('SELECT * FROM participants WHERE token = $1 AND pool_id = $2', [token, pool.id]);
}
function publicPool(pool) {
  const scoring = {
    pts_exact: pool.pts_exact, pts_goaldiff: pool.pts_goaldiff,
    pts_outcome: pool.pts_outcome, pts_advance: pool.pts_advance,
    pts_ko_advance: pool.pts_ko_advance ?? DEFAULT_KO_ADVANCE, // "quem avança" no mata-mata
  };
  for (const s of KO_STAGES) scoring['mult_' + s] = phaseMult(pool, s); // multiplicadores do placar no mata-mata
  for (const s of KO_STAGES) scoring['adv_mult_' + s] = advMult(pool, s); // multiplicadores do bônus "quem avança"
  return {
    slug: pool.slug, name: pool.name, scoring,
    lock_at_kickoff: !!pool.lock_at_kickoff,
    lock_mode: pool.lock_mode || 'auto',
  };
}

// Trava GLOBAL dos palpites: por padrão ('auto') trava 5 min antes do 1º jogo do bolão.
// Libera automaticamente quando a fase de grupos termina: a partir daí, as fases do
// mata-mata se regem pelo stageLocks (pré-requisito da fase anterior) e pela trava
// individual de cada partida (lock_at_kickoff). Admin pode forçar 'open' ou 'locked'.
const LOCK_LEAD_MS = 5 * 60 * 1000;
// Janela de revelação dos palpites alheios (anti-trapaça): liberados a partir de
// 2h antes do início de cada jogo (ou quando ele termina).
const REVEAL_LEAD_MS = 2 * 60 * 60 * 1000;
function lockInfo(pool, matches) {
  const kickoffs = matches.map((m) => new Date(m.kickoff).getTime()).filter((n) => !Number.isNaN(n));
  const first = kickoffs.length ? Math.min(...kickoffs) : null;
  const lockAt = first != null ? first - LOCK_LEAD_MS : null;
  const mode = pool.lock_mode || 'auto';
  let locked;
  if (mode === 'locked') locked = true;
  else if (mode === 'open') locked = false;
  else {
    const groupMatches = matches.filter((m) => m.stage === 'group');
    const allGroupsDone = groupMatches.length > 0 && groupMatches.every((m) => m.finished);
    // Trava apenas durante a fase de grupos (antes do kickAt). Quando os grupos encerram,
    // libera globalmente: cada partida KO passa a usar sua própria trava por kickoff.
    locked = !allGroupsDone && lockAt != null && Date.now() >= lockAt;
  }
  return { mode, locked, lockAt, firstKickoff: first };
}
function matchPublic(m) {
  return {
    id: m.id, ord: m.ord, stage: m.stage, group_label: m.group_label,
    round_label: m.round_label, home_team: m.home_team, away_team: m.away_team,
    home_label: m.home_label, away_label: m.away_label, kickoff: m.kickoff,
    home_score: m.home_score, away_score: m.away_score, finished: !!m.finished,
    advanced: m.advanced || null, // mata-mata: 'home'|'away' (quem passou — usado em empate/pênaltis)
    locked: !!m.finished || (new Date(m.kickoff).getTime() - LOCK_LEAD_MS <= Date.now()),
  };
}

// ---------- meta ----------
app.get('/api/meta', (req, res) => {
  res.json({
    groups: GROUPS, flags: FLAGS, codes: CODES, stageNames: STAGE_NAMES,
    stageOrder: STAGE_ORDER, syncEnabled: SYNC_ENABLED, fifaRank: FIFA_RANK,
  });
});

// ---------- pools ----------
app.post('/api/pools', wrap(async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Dê um nome ao bolão (mín. 2 caracteres).' });
  if (name.length > 60) return res.status(400).json({ error: 'Nome muito longo.' });
  const { slug, adminToken } = await createPool(name);
  res.json({ slug, adminToken });
}));

app.get('/api/pools/:slug', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  await maybeSync(pool); // atualiza placares ao vivo (se FOOTBALL_DATA_TOKEN estiver setado)
  const matches = await all('SELECT * FROM matches WHERE pool_id = $1 ORDER BY ord', [pool.id]);
  const parts = await all('SELECT name FROM participants WHERE pool_id = $1 ORDER BY name', [pool.id]);
  res.json({
    pool: publicPool(pool),
    isAdmin: isAdmin(req, pool),
    matches: matches.map(matchPublic),
    participants: parts.map((p) => p.name),
    stageLocks: stageLocks(matches),
    lock: lockInfo(pool, matches),
    syncEnabled: SYNC_ENABLED,
  });
}));

// ---------- join / login ----------
app.post('/api/pools/:slug/join', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const name = (req.body?.name || '').trim();
  const pin = (req.body?.pin || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome.' });
  if (pin.length < 3) return res.status(400).json({ error: 'Escolha um PIN de pelo menos 3 dígitos.' });

  const existing = await get('SELECT id FROM participants WHERE pool_id = $1 AND name = $2', [pool.id, name]);
  if (existing) return res.status(409).json({ error: 'Já existe alguém com esse nome. Use "Entrar" com seu PIN.' });

  const token = genToken();
  await run('INSERT INTO participants (pool_id, name, pin_hash, token) VALUES ($1, $2, $3, $4)',
    [pool.id, name, hashPin(pin), token]);
  res.json({ token, name });
}));

app.post('/api/pools/:slug/login', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const name = (req.body?.name || '').trim();
  const pin = (req.body?.pin || '').trim();
  const p = await get('SELECT * FROM participants WHERE pool_id = $1 AND name = $2', [pool.id, name]);
  if (!p || p.pin_hash !== hashPin(pin)) return res.status(401).json({ error: 'Nome ou PIN incorretos.' });
  res.json({ token: p.token, name: p.name });
}));

// ---------- my predictions ----------
app.get('/api/pools/:slug/me', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const me = await getParticipant(req, pool);
  if (!me) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
  const preds = await all(
    'SELECT match_id, home_score, away_score, points, adv_pick, adv_points, updated_at FROM predictions WHERE participant_id = $1', [me.id]);
  const quals = await all(
    'SELECT group_label, team_first, team_second, points FROM qualifiers WHERE participant_id = $1', [me.id]);
  const total = preds.reduce((s, p) => s + p.points + (p.adv_points || 0), 0) + quals.reduce((s, q) => s + q.points, 0);
  const lastSaved = preds.reduce((mx, p) => {
    const t = p.updated_at ? new Date(p.updated_at).getTime() : 0;
    return t > mx ? t : mx;
  }, 0);
  res.json({ name: me.name, predictions: preds, qualifiers: quals, total, lastSaved: lastSaved || null });
}));

app.put('/api/pools/:slug/predictions', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const me = await getParticipant(req, pool);
  if (!me) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });

  const predictions = Array.isArray(req.body?.predictions) ? req.body.predictions : [];

  const matchRows = await all('SELECT * FROM matches WHERE pool_id = $1', [pool.id]);
  if (lockInfo(pool, matchRows).locked) {
    return res.status(403).json({ error: 'Palpites travados pelo organizador. Não dá mais para editar.' });
  }
  const matchById = new Map(matchRows.map((m) => [m.id, m]));
  const locks = stageLocks(matchRows);

  let saved = 0, skipped = 0;
  for (const p of predictions) {
    const m = matchById.get(Number(p.matchId));
    if (!m || m.home_team == null || m.away_team == null) { skipped++; continue; }
    if (locks[m.stage]) { skipped++; continue; } // fase ainda não liberada
    const locked = m.finished || (pool.lock_at_kickoff && new Date(m.kickoff).getTime() - LOCK_LEAD_MS <= Date.now());
    if (locked) { skipped++; continue; }
    const h = Math.max(0, Math.min(99, parseInt(p.home, 10)));
    const a = Math.max(0, Math.min(99, parseInt(p.away, 10)));
    if (Number.isNaN(h) || Number.isNaN(a)) { skipped++; continue; }
    // "quem avança" só faz sentido no mata-mata e quando o palpite é empate (senão é o vencedor).
    const advPick = (m.stage !== 'group' && h === a && (p.adv === 'home' || p.adv === 'away')) ? p.adv : null;
    const pts = scoreFor(pool, h, a, m);
    const advPts = advanceFor(pool, h, a, advPick, m);
    await run(`INSERT INTO predictions (participant_id, match_id, home_score, away_score, points, adv_pick, adv_points, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (participant_id, match_id)
      DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, points = excluded.points, adv_pick = excluded.adv_pick, adv_points = excluded.adv_points, updated_at = excluded.updated_at`,
      [me.id, m.id, h, a, pts, advPick, advPts, new Date().toISOString()]);
    saved++;
  }

  // "Quem avança" é derivado dos placares de grupo do palpiteiro (top 2 + 8 melhores 3ºs).
  await recomputeAdvanceForParticipant(pool, me.id);

  res.json({ saved, skipped });
}));

// Limpa palpites do participante: { group: 'A' } limpa só o grupo; sem group, limpa tudo.
// Só remove palpites de jogos ainda não travados (não mexe em resultado já lançado).
app.post('/api/pools/:slug/predictions/clear', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const me = await getParticipant(req, pool);
  if (!me) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });

  const group = req.body?.group || null;
  const matchRows = await all('SELECT * FROM matches WHERE pool_id = $1', [pool.id]);
  if (lockInfo(pool, matchRows).locked) {
    return res.status(403).json({ error: 'Palpites travados pelo organizador.' });
  }
  const isLocked = (m) => m.finished || (pool.lock_at_kickoff && new Date(m.kickoff).getTime() - LOCK_LEAD_MS <= Date.now());
  const ids = matchRows
    .filter((m) => !isLocked(m) && (!group || (m.stage === 'group' && m.group_label === group)))
    .map((m) => m.id);

  let cleared = 0;
  if (ids.length) {
    const ph = ids.map((_, i) => `$${i + 2}`).join(',');
    const existing = await all(`SELECT match_id FROM predictions WHERE participant_id = $1 AND match_id IN (${ph})`, [me.id, ...ids]);
    cleared = existing.length;
    await run(`DELETE FROM predictions WHERE participant_id = $1 AND match_id IN (${ph})`, [me.id, ...ids]);
  }
  await recomputeAdvanceForParticipant(pool, me.id);
  res.json({ cleared });
}));

// pontos de um palpite contra um resultado já lançado (× multiplicador da fase)
function scoreFor(pool, ph, pa, m) {
  if (m.home_score == null || m.away_score == null) return 0;
  const rh = m.home_score, ra = m.away_score;
  let base;
  if (ph === rh && pa === ra) base = pool.pts_exact;
  else if (Math.sign(ph - pa) !== Math.sign(rh - ra)) base = 0;
  // saldo só conta em jogos com vencedor (empate não-exato = só acerto do resultado).
  else if (rh !== ra && ph - pa === rh - ra) base = pool.pts_goaldiff;
  else base = pool.pts_outcome;
  if (!base) return 0;
  return Math.round(base * phaseMult(pool, m.stage));
}
// Bônus "quem avança" para um palpite recém-salvo (0 enquanto o jogo não tem resultado).
function advanceFor(pool, ph, pa, advPick, m) {
  if (!KO_STAGES.includes(m.stage)) return 0;
  const real = advanceSide(m.home_score, m.away_score, m.advanced);
  if (!real) return 0;
  const mine = advanceSide(ph, pa, advPick);
  if (!mine || mine !== real) return 0;
  return Math.round((pool.pts_ko_advance ?? DEFAULT_KO_ADVANCE) * advMult(pool, m.stage));
}

// ---------- leaderboard ----------
app.get('/api/pools/:slug/leaderboard', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  await maybeSync(pool);
  const rows = await all(`
    SELECT pa.name, pa.avatar,
      COALESCE((SELECT SUM(points) FROM predictions WHERE participant_id = pa.id), 0) AS match_pts,
      COALESCE((SELECT SUM(points) FROM qualifiers WHERE participant_id = pa.id), 0)
        + COALESCE((SELECT SUM(adv_points) FROM predictions WHERE participant_id = pa.id), 0) AS qual_pts,
      COALESCE((SELECT SUM(points) FROM qualifiers WHERE participant_id = pa.id) / NULLIF($2, 0), 0) AS grp_adv,
      (SELECT COUNT(*) FROM predictions pr JOIN matches m ON m.id = pr.match_id
         WHERE pr.participant_id = pa.id AND m.finished = 1
           AND pr.home_score = m.home_score AND pr.away_score = m.away_score) AS exatos
    FROM participants pa WHERE pa.pool_id = $1`, [pool.id, pool.pts_advance]);
  const board = rows.map((r) => ({
    name: r.name, avatar: r.avatar || null,
    total: Number(r.match_pts) + Number(r.qual_pts),
    match_pts: Number(r.match_pts), qual_pts: Number(r.qual_pts),
    grp_adv: Math.round(Number(r.grp_adv || 0)),
    exatos: Number(r.exatos),
  })).sort((a, b) => b.total - a.total || b.exatos - a.exatos || a.name.localeCompare(b.name));
  res.json({ leaderboard: board });
}));

// ---------- chat (2 canais por faixa do ranking) ----------
// Classificação com ids, na MESMA ordem do leaderboard, para saber o rank de cada um.
async function rankedParticipants(poolId) {
  const rows = await all(`
    SELECT pa.id, pa.name,
      COALESCE((SELECT SUM(points) FROM predictions WHERE participant_id = pa.id), 0)
      + COALESCE((SELECT SUM(adv_points) FROM predictions WHERE participant_id = pa.id), 0)
      + COALESCE((SELECT SUM(points) FROM qualifiers WHERE participant_id = pa.id), 0) AS total,
      (SELECT COUNT(*) FROM predictions pr JOIN matches m ON m.id = pr.match_id
         WHERE pr.participant_id = pa.id AND m.finished = 1
           AND pr.home_score = m.home_score AND pr.away_score = m.away_score) AS exatos
    FROM participants pa WHERE pa.pool_id = $1`, [poolId]);
  return rows
    .map((r) => ({ id: r.id, name: r.name, total: Number(r.total), exatos: Number(r.exatos) }))
    .sort((a, b) => b.total - a.total || b.exatos - a.exatos || a.name.localeCompare(b.name));
}
// Canal a que o participante tem acesso AGORA: top3 (rank<=3) ou resto.
async function channelOf(poolId, participantId) {
  const ranked = await rankedParticipants(poolId);
  const idx = ranked.findIndex((r) => r.id === participantId);
  if (idx < 0) return null;
  return { channel: idx < 3 ? 'top3' : 'rest', rank: idx + 1, total: ranked.length };
}
const CHANNEL_LABEL = { top3: '🏆 Pódio (Top 3)', rest: '😤 Pelotão' };

app.get('/api/pools/:slug/chat', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const me = await getParticipant(req, pool);
  if (!me) return res.status(401).json({ error: 'Entre no bolão para usar o chat.' });
  const info = await channelOf(pool.id, me.id);
  if (!info) return res.status(403).json({ error: 'Sem acesso.' });
  const after = parseInt(req.query.after, 10) || 0;
  const rows = await all(
    `SELECT m.id, m.name, m.body, m.created_at, m.participant_id
       FROM messages m WHERE m.pool_id = $1 AND m.channel = $2 AND m.id > $3
       ORDER BY m.id DESC LIMIT 80`, [pool.id, info.channel, after]);
  const messages = rows.reverse().map((r) => ({
    id: r.id, name: r.name, body: r.body, created_at: r.created_at, mine: r.participant_id === me.id,
  }));
  res.json({ channel: info.channel, label: CHANNEL_LABEL[info.channel], rank: info.rank, total: info.total, messages });
}));

app.post('/api/pools/:slug/chat', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const me = await getParticipant(req, pool);
  if (!me) return res.status(401).json({ error: 'Entre no bolão para usar o chat.' });
  const info = await channelOf(pool.id, me.id);
  if (!info) return res.status(403).json({ error: 'Sem acesso.' });
  const body = String(req.body?.body || '').trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: 'Mensagem vazia.' });
  // anti-flood simples: no máx. 1 msg a cada 1,5s por participante
  const last = await get('SELECT created_at FROM messages WHERE participant_id = $1 ORDER BY id DESC LIMIT 1', [me.id]);
  if (last && Date.now() - new Date(last.created_at).getTime() < 1500) {
    return res.status(429).json({ error: 'Calma! Espere um segundo.' });
  }
  await run('INSERT INTO messages (pool_id, channel, participant_id, name, body) VALUES ($1, $2, $3, $4, $5)',
    [pool.id, info.channel, me.id, me.name, body]);
  res.json({ ok: true, channel: info.channel });
}));

// ---------- histórico do ranking ----------
// Reconstrói a classificação "dia a dia" (matchday) só a partir dos dados que já
// existem — não precisa de snapshots no banco. Cada rodada é um dia em que terminou
// pelo menos um jogo; o total de cada um é cumulativo até aquele dia.
app.get('/api/pools/:slug/history', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const parts = await all('SELECT id, name FROM participants WHERE pool_id = $1', [pool.id]);
  if (!parts.length) return res.json({ rounds: [] });

  const preds = await all(
    `SELECT pr.participant_id AS pid, (pr.points + COALESCE(pr.adv_points, 0)) AS pts, m.kickoff AS kickoff
       FROM predictions pr JOIN matches m ON m.id = pr.match_id
      WHERE m.pool_id = $1 AND m.finished = 1`, [pool.id]);
  const quals = await all('SELECT participant_id AS pid, group_label, points FROM qualifiers WHERE pool_id = $1', [pool.id]);
  const groupMatches = await all(
    "SELECT group_label, kickoff, finished FROM matches WHERE pool_id = $1 AND stage = 'group'", [pool.id]);

  const day = (iso) => String(iso || '').slice(0, 10); // YYYY-MM-DD

  // Dia em que cada grupo (e o pseudo-grupo dos 3ºs) ficou completo.
  const byGroup = {};
  for (const m of groupMatches) (byGroup[m.group_label] = byGroup[m.group_label] || []).push(m);
  const groupDoneDay = {};
  for (const [g, ms] of Object.entries(byGroup)) {
    if (ms.length && ms.every((x) => x.finished)) groupDoneDay[g] = ms.reduce((mx, x) => day(x.kickoff) > mx ? day(x.kickoff) : mx, '');
  }
  const allGroupsDone = Object.keys(byGroup).length > 0 && Object.keys(byGroup).every((g) => groupDoneDay[g]);
  const thirdsDoneDay = allGroupsDone ? Object.values(groupDoneDay).reduce((mx, d) => d > mx ? d : mx, '') : null;
  const qualDoneDay = (gl) => (gl === '__3__' ? thirdsDoneDay : groupDoneDay[gl]);

  // Conjunto ordenado de "dias com jogo encerrado".
  const days = [...new Set(preds.map((p) => day(p.kickoff)).filter(Boolean))].sort();
  if (!days.length) return res.json({ rounds: [] });

  const nameById = new Map(parts.map((p) => [p.id, p.name]));
  let prevRank = new Map();
  const rounds = days.map((d) => {
    const totals = new Map(parts.map((p) => [p.id, 0]));
    for (const p of preds) if (day(p.kickoff) <= d) totals.set(p.pid, (totals.get(p.pid) || 0) + Number(p.pts));
    for (const q of quals) { const qd = qualDoneDay(q.group_label); if (qd && qd <= d) totals.set(q.pid, (totals.get(q.pid) || 0) + Number(q.points)); }
    const board = [...totals.entries()]
      .map(([pid, total]) => ({ name: nameById.get(pid), total }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    board.forEach((row, i) => {
      row.rank = i + 1;
      const pr = prevRank.get(row.name);
      row.delta = pr == null ? 0 : pr - row.rank; // + subiu, - caiu
    });
    prevRank = new Map(board.map((r) => [r.name, r.rank]));
    return { date: d, board };
  });

  res.json({ rounds });
}));

// Palpites de UM participante — só dos jogos que JÁ COMEÇARAM (kickoff <= agora),
// para não vazar palpites futuros (anti-trapaça). Serve a comparação e a visualização.
app.get('/api/pools/:slug/participants/:name', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const p = await get('SELECT * FROM participants WHERE pool_id = $1 AND name = $2', [pool.id, req.params.name]);
  if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
  const now = Date.now();
  const rows = await all(
    `SELECT pr.match_id, pr.home_score, pr.away_score, pr.points, pr.adv_pick, pr.adv_points, m.kickoff, m.finished
       FROM predictions pr JOIN matches m ON m.id = pr.match_id
      WHERE pr.participant_id = $1`, [p.id]);
  const predictions = rows
    .filter((r) => r.finished || new Date(r.kickoff).getTime() - REVEAL_LEAD_MS <= now) // a partir de 2h antes
    .map((r) => ({ match_id: r.match_id, home_score: r.home_score, away_score: r.away_score, points: r.points, adv_pick: r.adv_pick || null, adv_points: Number(r.adv_points || 0) }));
  const quals = await all('SELECT group_label, points FROM qualifiers WHERE participant_id = $1', [p.id]);
  const total = rows.reduce((s, r) => s + Number(r.points) + Number(r.adv_points || 0), 0) + quals.reduce((s, q) => s + Number(q.points), 0);
  res.json({ name: p.name, predictions, total });
}));

// Palpites de TODOS os participantes para UMA partida — revelados só quando o
// jogo já começou ou encerrou (anti-trapaça). Ordenados por pontos (desc).
app.get('/api/pools/:slug/matches/:id/predictions', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const m = await get('SELECT * FROM matches WHERE id = $1 AND pool_id = $2', [req.params.id, pool.id]);
  if (!m) return res.status(404).json({ error: 'Partida não encontrada.' });
  const started = !!m.finished || new Date(m.kickoff).getTime() - REVEAL_LEAD_MS <= Date.now();
  if (!started) return res.json({ match: matchPublic(m), revealed: false, predictions: [] });
  const rows = await all(
    `SELECT pa.name, pa.avatar, pr.home_score, pr.away_score, pr.points, pr.adv_pick, pr.adv_points
       FROM predictions pr JOIN participants pa ON pa.id = pr.participant_id
      WHERE pr.match_id = $1 AND pa.pool_id = $2`, [m.id, pool.id]);
  const total = await get('SELECT COUNT(*) AS c FROM participants WHERE pool_id = $1', [pool.id]);
  const predictions = rows
    .map((r) => ({ name: r.name, avatar: r.avatar || null, home_score: r.home_score, away_score: r.away_score, points: Number(r.points) + Number(r.adv_points || 0), adv_pick: r.adv_pick || null, adv_points: Number(r.adv_points || 0) }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  // autores dos gols (ESPN) — só faz sentido quando o jogo começou
  let goals = [];
  if (m.home_score != null || m.finished) { try { goals = await matchGoals(m); } catch (_) { goals = []; } }
  res.json({ match: matchPublic(m), revealed: true, predictions, participants: Number(total.c), goals });
}));

// ---------- admin ----------
async function requireAdmin(req, res) {
  const pool = await getPool(req, res); if (!pool) return null;
  if (!isAdmin(req, pool)) { res.status(403).json({ error: 'Acesso de administrador necessário.' }); return null; }
  return pool;
}

app.get('/api/pools/:slug/admin', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  const matches = await all('SELECT * FROM matches WHERE pool_id = $1 ORDER BY ord', [pool.id]);
  const participants = await all('SELECT id, name, avatar FROM participants WHERE pool_id = $1 ORDER BY name', [pool.id]);
  res.json({ pool: publicPool(pool), matches: matches.map(matchPublic), participants, lock: lockInfo(pool, matches) });
}));

// Admin define/remove a foto de um participante (data URL pequeno, redimensionado no cliente).
app.put('/api/pools/:slug/participants/:id/avatar', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  const p = await get('SELECT id FROM participants WHERE id = $1 AND pool_id = $2', [req.params.id, pool.id]);
  if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
  let avatar = req.body?.avatar;
  if (avatar === null || avatar === '' || avatar === undefined) {
    await run('UPDATE participants SET avatar = NULL WHERE id = $1', [p.id]);
    return res.json({ ok: true, avatar: null });
  }
  avatar = String(avatar);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(avatar)) {
    return res.status(400).json({ error: 'Imagem inválida.' });
  }
  if (avatar.length > 200000) return res.status(413).json({ error: 'Imagem muito grande (reduza a foto).' });
  await run('UPDATE participants SET avatar = $1 WHERE id = $2', [avatar, p.id]);
  res.json({ ok: true, avatar });
}));

// Admin define o modo de trava global: 'auto' (5 min antes do 1º jogo), 'open' ou 'locked'.
app.put('/api/pools/:slug/lock', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  const mode = String(req.body?.mode || '').trim();
  if (!['auto', 'open', 'locked'].includes(mode)) return res.status(400).json({ error: 'Modo inválido.' });
  await run('UPDATE pools SET lock_mode = $1 WHERE id = $2', [mode, pool.id]);
  const matches = await all('SELECT kickoff FROM matches WHERE pool_id = $1', [pool.id]);
  res.json({ lock: lockInfo({ ...pool, lock_mode: mode }, matches) });
}));

app.put('/api/pools/:slug/matches/:id', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  const m = await get('SELECT * FROM matches WHERE id = $1 AND pool_id = $2', [req.params.id, pool.id]);
  if (!m) return res.status(404).json({ error: 'Partida não encontrada.' });

  const b = req.body || {};
  const sets = [];
  const params = [];
  const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if ('home_team' in b) push('home_team', b.home_team ? String(b.home_team).trim() : null);
  if ('away_team' in b) push('away_team', b.away_team ? String(b.away_team).trim() : null);
  if ('kickoff' in b && b.kickoff) {
    const d = new Date(b.kickoff);
    if (!isNaN(d)) push('kickoff', d.toISOString());
  }
  let touchedResult = false;
  if ('home_score' in b || 'away_score' in b) {
    const clear = b.home_score === null || b.away_score === null || b.home_score === '' || b.away_score === '';
    if (clear) { push('home_score', null); push('away_score', null); push('finished', 0); push('advanced', null); }
    else {
      const h = Math.max(0, Math.min(99, parseInt(b.home_score, 10)));
      const a = Math.max(0, Math.min(99, parseInt(b.away_score, 10)));
      if (Number.isNaN(h) || Number.isNaN(a)) return res.status(400).json({ error: 'Placar inválido.' });
      push('home_score', h); push('away_score', a); push('finished', 1);
      // Quem avança: no mata-mata, vitória já define o vencedor (derivado do placar);
      // só no EMPATE (pênaltis) o admin precisa dizer quem passou.
      const advanced = (m.stage !== 'group' && h === a && (b.advanced === 'home' || b.advanced === 'away')) ? b.advanced : null;
      push('advanced', advanced);
    }
    touchedResult = true;
  }

  if (sets.length) {
    params.push(m.id);
    await run(`UPDATE matches SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  }
  if (touchedResult) {
    await recomputeMatch(m.id);
    if (m.group_label) await recomputeAdvanceAll(pool.id);
    await resolveKnockout(pool.id); // preenche o chaveamento conforme as fases terminam
  }
  const updated = await get('SELECT * FROM matches WHERE id = $1', [m.id]);
  res.json({ match: matchPublic(updated) });
}));

app.put('/api/pools/:slug/settings', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  const b = req.body || {};
  const clamp = (v, def) => { const n = parseInt(v, 10); return Number.isNaN(n) ? def : Math.max(0, Math.min(100, n)); };
  // multiplicador: 1 casa decimal, 0–10
  const clampMult = (v, def) => { const n = parseFloat(v); return Number.isNaN(n) ? def : Math.max(0, Math.min(10, Math.round(n * 10) / 10)); };
  const f = {
    pts_exact: clamp(b.pts_exact, pool.pts_exact),
    pts_goaldiff: clamp(b.pts_goaldiff, pool.pts_goaldiff),
    pts_outcome: clamp(b.pts_outcome, pool.pts_outcome),
    pts_advance: clamp(b.pts_advance, pool.pts_advance),
    pts_ko_advance: clamp(b.pts_ko_advance, pool.pts_ko_advance ?? DEFAULT_KO_ADVANCE),
    lock_at_kickoff: b.lock_at_kickoff ? 1 : 0,
  };
  await run(`UPDATE pools SET pts_exact=$1, pts_goaldiff=$2, pts_outcome=$3, pts_advance=$4, pts_ko_advance=$5, lock_at_kickoff=$6 WHERE id=$7`,
    [f.pts_exact, f.pts_goaldiff, f.pts_outcome, f.pts_advance, f.pts_ko_advance, f.lock_at_kickoff, pool.id]);
  // multiplicadores do placar no mata-mata + multiplicadores do bônus "quem avança"
  for (const s of KO_STAGES) {
    const val = clampMult((b.mult || {})[s], phaseMult(pool, s));
    await run(`UPDATE pools SET mult_${s} = $1 WHERE id = $2`, [val, pool.id]);
    const adv = clampMult((b.adv_mult || {})[s], advMult(pool, s));
    await run(`UPDATE pools SET adv_mult_${s} = $1 WHERE id = $2`, [adv, pool.id]);
  }

  const finished = await all('SELECT id FROM matches WHERE pool_id = $1 AND finished = 1', [pool.id]);
  for (const m of finished) await recomputeMatch(m.id);
  await recomputeAdvanceAll(pool.id);
  await resolveKnockout(pool.id);

  res.json({ ok: true });
}));

// Sincroniza placares reais agora (admin). Funciona se FOOTBALL_DATA_TOKEN estiver setado.
app.post('/api/pools/:slug/sync', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  if (!SYNC_ENABLED) return res.status(400).json({ error: 'Auto-update desligado: defina FOOTBALL_DATA_TOKEN na Vercel.' });
  const r = await syncPool(pool, { force: true });
  res.json(r);
}));

// Recomputa todos os pontos de todas as partidas encerradas (admin).
app.post('/api/pools/:slug/recompute', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  const finished = await all('SELECT id FROM matches WHERE pool_id = $1 AND finished = 1', [pool.id]);
  for (const m of finished) await recomputeMatch(m.id);
  await recomputeAdvanceAll(pool.id);
  res.json({ ok: true, recomputed: finished.length });
}));

// ---------- static + SPA fallback ----------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

export default app;
