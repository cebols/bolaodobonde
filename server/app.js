import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  all, get, run, ensureSchema, USE_PG,
  createPool, genToken, hashPin,
  recomputeMatch, recomputeAdvanceAll, recomputeAdvanceForParticipant,
} from './store.js';
import { syncPool, maybeSync, SYNC_ENABLED } from './sync.js';
import { GROUPS, FLAGS, CODES, STAGE_NAMES } from '../data/wc2026.js';

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
  return {
    slug: pool.slug, name: pool.name,
    scoring: {
      pts_exact: pool.pts_exact, pts_goaldiff: pool.pts_goaldiff,
      pts_outcome: pool.pts_outcome, pts_advance: pool.pts_advance,
    },
    lock_at_kickoff: !!pool.lock_at_kickoff,
  };
}
function matchPublic(m) {
  return {
    id: m.id, ord: m.ord, stage: m.stage, group_label: m.group_label,
    round_label: m.round_label, home_team: m.home_team, away_team: m.away_team,
    home_label: m.home_label, away_label: m.away_label, kickoff: m.kickoff,
    home_score: m.home_score, away_score: m.away_score, finished: !!m.finished,
    locked: !!m.finished || (new Date(m.kickoff).getTime() <= Date.now()),
  };
}

// ---------- meta ----------
app.get('/api/meta', (req, res) => {
  res.json({
    groups: GROUPS, flags: FLAGS, codes: CODES, stageNames: STAGE_NAMES,
    stageOrder: STAGE_ORDER, syncEnabled: SYNC_ENABLED,
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
    'SELECT match_id, home_score, away_score, points FROM predictions WHERE participant_id = $1', [me.id]);
  const quals = await all(
    'SELECT group_label, team_first, team_second, points FROM qualifiers WHERE participant_id = $1', [me.id]);
  const total = preds.reduce((s, p) => s + p.points, 0) + quals.reduce((s, q) => s + q.points, 0);
  res.json({ name: me.name, predictions: preds, qualifiers: quals, total });
}));

app.put('/api/pools/:slug/predictions', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  const me = await getParticipant(req, pool);
  if (!me) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });

  const predictions = Array.isArray(req.body?.predictions) ? req.body.predictions : [];

  const matchRows = await all('SELECT * FROM matches WHERE pool_id = $1', [pool.id]);
  const matchById = new Map(matchRows.map((m) => [m.id, m]));
  const locks = stageLocks(matchRows);

  let saved = 0, skipped = 0;
  for (const p of predictions) {
    const m = matchById.get(Number(p.matchId));
    if (!m || m.home_team == null || m.away_team == null) { skipped++; continue; }
    if (locks[m.stage]) { skipped++; continue; } // fase ainda não liberada
    const locked = m.finished || (pool.lock_at_kickoff && new Date(m.kickoff).getTime() <= Date.now());
    if (locked) { skipped++; continue; }
    const h = Math.max(0, Math.min(99, parseInt(p.home, 10)));
    const a = Math.max(0, Math.min(99, parseInt(p.away, 10)));
    if (Number.isNaN(h) || Number.isNaN(a)) { skipped++; continue; }
    const pts = scoreFor(pool, h, a, m);
    await run(`INSERT INTO predictions (participant_id, match_id, home_score, away_score, points)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (participant_id, match_id)
      DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, points = excluded.points`,
      [me.id, m.id, h, a, pts]);
    saved++;
  }

  // "Quem avança" é derivado dos placares de grupo do palpiteiro (top 2 + 8 melhores 3ºs).
  await recomputeAdvanceForParticipant(pool, me.id);

  res.json({ saved, skipped });
}));

// pontos de um palpite contra um resultado já lançado
function scoreFor(pool, ph, pa, m) {
  if (m.home_score == null || m.away_score == null) return 0;
  const rh = m.home_score, ra = m.away_score;
  if (ph === rh && pa === ra) return pool.pts_exact;
  if (Math.sign(ph - pa) !== Math.sign(rh - ra)) return 0;
  if (ph - pa === rh - ra) return pool.pts_goaldiff;
  return pool.pts_outcome;
}

// ---------- leaderboard ----------
app.get('/api/pools/:slug/leaderboard', wrap(async (req, res) => {
  const pool = await getPool(req, res); if (!pool) return;
  await maybeSync(pool);
  const rows = await all(`
    SELECT pa.name,
      COALESCE((SELECT SUM(points) FROM predictions WHERE participant_id = pa.id), 0) AS match_pts,
      COALESCE((SELECT SUM(points) FROM qualifiers WHERE participant_id = pa.id), 0) AS qual_pts,
      (SELECT COUNT(*) FROM predictions pr JOIN matches m ON m.id = pr.match_id
         WHERE pr.participant_id = pa.id AND m.finished = 1
           AND pr.home_score = m.home_score AND pr.away_score = m.away_score) AS exatos
    FROM participants pa WHERE pa.pool_id = $1`, [pool.id]);
  const board = rows.map((r) => ({
    name: r.name,
    total: Number(r.match_pts) + Number(r.qual_pts),
    match_pts: Number(r.match_pts), qual_pts: Number(r.qual_pts), exatos: Number(r.exatos),
  })).sort((a, b) => b.total - a.total || b.exatos - a.exatos || a.name.localeCompare(b.name));
  res.json({ leaderboard: board });
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
  const participants = await all('SELECT id, name FROM participants WHERE pool_id = $1 ORDER BY name', [pool.id]);
  res.json({ pool: publicPool(pool), matches: matches.map(matchPublic), participants });
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
    if (clear) { push('home_score', null); push('away_score', null); push('finished', 0); }
    else {
      const h = Math.max(0, Math.min(99, parseInt(b.home_score, 10)));
      const a = Math.max(0, Math.min(99, parseInt(b.away_score, 10)));
      if (Number.isNaN(h) || Number.isNaN(a)) return res.status(400).json({ error: 'Placar inválido.' });
      push('home_score', h); push('away_score', a); push('finished', 1);
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
  }
  const updated = await get('SELECT * FROM matches WHERE id = $1', [m.id]);
  res.json({ match: matchPublic(updated) });
}));

app.put('/api/pools/:slug/settings', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  const b = req.body || {};
  const clamp = (v, def) => { const n = parseInt(v, 10); return Number.isNaN(n) ? def : Math.max(0, Math.min(100, n)); };
  const f = {
    pts_exact: clamp(b.pts_exact, pool.pts_exact),
    pts_goaldiff: clamp(b.pts_goaldiff, pool.pts_goaldiff),
    pts_outcome: clamp(b.pts_outcome, pool.pts_outcome),
    pts_advance: clamp(b.pts_advance, pool.pts_advance),
    lock_at_kickoff: b.lock_at_kickoff ? 1 : 0,
  };
  await run(`UPDATE pools SET pts_exact=$1, pts_goaldiff=$2, pts_outcome=$3, pts_advance=$4, lock_at_kickoff=$5 WHERE id=$6`,
    [f.pts_exact, f.pts_goaldiff, f.pts_outcome, f.pts_advance, f.lock_at_kickoff, pool.id]);

  const finished = await all('SELECT id FROM matches WHERE pool_id = $1 AND finished = 1', [pool.id]);
  for (const m of finished) await recomputeMatch(m.id);
  await recomputeAdvanceAll(pool.id);

  res.json({ ok: true });
}));

// Sincroniza placares reais agora (admin). Funciona se FOOTBALL_DATA_TOKEN estiver setado.
app.post('/api/pools/:slug/sync', wrap(async (req, res) => {
  const pool = await requireAdmin(req, res); if (!pool) return;
  if (!SYNC_ENABLED) return res.status(400).json({ error: 'Auto-update desligado: defina FOOTBALL_DATA_TOKEN na Vercel.' });
  const r = await syncPool(pool, { force: true });
  res.json(r);
}));

// ---------- static + SPA fallback ----------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

export default app;
