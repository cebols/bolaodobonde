import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db, createPool, genToken, hashPin,
  recomputeMatch, recomputeQualifiers, computeGroupTop2,
} from './db.js';
import { GROUPS, FLAGS, STAGE_NAMES } from '../data/wc2026.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------- helpers ----------
const wrap = (fn) => (req, res) => {
  try { fn(req, res); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Erro interno do servidor.' }); }
};

function getPool(req, res) {
  const pool = db.prepare('SELECT * FROM pools WHERE slug = ?').get(req.params.slug);
  if (!pool) { res.status(404).json({ error: 'Bolão não encontrado.' }); return null; }
  return pool;
}

function isAdmin(req, pool) {
  const token = req.get('x-admin-token') || req.query.admin;
  return token && token === pool.admin_token;
}

function getParticipant(req, pool) {
  const token = req.get('x-participant-token');
  if (!token) return null;
  return db.prepare(
    'SELECT * FROM participants WHERE token = ? AND pool_id = ?'
  ).get(token, pool.id);
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

// ---------- static & meta ----------
app.get('/api/meta', (req, res) => {
  res.json({ groups: GROUPS, flags: FLAGS, stageNames: STAGE_NAMES });
});

// ---------- pools ----------
app.post('/api/pools', wrap((req, res) => {
  const name = (req.body?.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Dê um nome ao bolão (mín. 2 caracteres).' });
  if (name.length > 60) return res.status(400).json({ error: 'Nome muito longo.' });
  const { slug, adminToken } = createPool(name);
  res.json({ slug, adminToken });
}));

app.get('/api/pools/:slug', wrap((req, res) => {
  const pool = getPool(req, res); if (!pool) return;
  const matches = db.prepare('SELECT * FROM matches WHERE pool_id = ? ORDER BY ord').all(pool.id);
  const participants = db.prepare(
    'SELECT name FROM participants WHERE pool_id = ? ORDER BY name'
  ).all(pool.id).map((p) => p.name);
  res.json({
    pool: publicPool(pool),
    isAdmin: isAdmin(req, pool),
    matches: matches.map(matchPublic),
    participants,
  });
}));

// ---------- participants: join / login ----------
app.post('/api/pools/:slug/join', wrap((req, res) => {
  const pool = getPool(req, res); if (!pool) return;
  const name = (req.body?.name || '').trim();
  const pin = (req.body?.pin || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome.' });
  if (pin.length < 3) return res.status(400).json({ error: 'Escolha um PIN de pelo menos 3 dígitos.' });

  const existing = db.prepare(
    'SELECT * FROM participants WHERE pool_id = ? AND name = ?'
  ).get(pool.id, name);
  if (existing) return res.status(409).json({ error: 'Já existe alguém com esse nome. Use "Entrar" com seu PIN.' });

  const token = genToken();
  db.prepare(
    'INSERT INTO participants (pool_id, name, pin_hash, token) VALUES (?, ?, ?, ?)'
  ).run(pool.id, name, hashPin(pin), token);
  res.json({ token, name });
}));

app.post('/api/pools/:slug/login', wrap((req, res) => {
  const pool = getPool(req, res); if (!pool) return;
  const name = (req.body?.name || '').trim();
  const pin = (req.body?.pin || '').trim();
  const p = db.prepare(
    'SELECT * FROM participants WHERE pool_id = ? AND name = ?'
  ).get(pool.id, name);
  if (!p || p.pin_hash !== hashPin(pin)) {
    return res.status(401).json({ error: 'Nome ou PIN incorretos.' });
  }
  res.json({ token: p.token, name: p.name });
}));

// ---------- my predictions ----------
app.get('/api/pools/:slug/me', wrap((req, res) => {
  const pool = getPool(req, res); if (!pool) return;
  const me = getParticipant(req, pool);
  if (!me) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
  const preds = db.prepare(
    'SELECT match_id, home_score, away_score, points FROM predictions WHERE participant_id = ?'
  ).all(me.id);
  const quals = db.prepare(
    'SELECT group_label, team_first, team_second, points FROM qualifiers WHERE participant_id = ?'
  ).all(me.id);
  const total = preds.reduce((s, p) => s + p.points, 0) + quals.reduce((s, q) => s + q.points, 0);
  res.json({ name: me.name, predictions: preds, qualifiers: quals, total });
}));

// Salvar palpites (placares + quem avança)
app.put('/api/pools/:slug/predictions', wrap((req, res) => {
  const pool = getPool(req, res); if (!pool) return;
  const me = getParticipant(req, pool);
  if (!me) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });

  const predictions = Array.isArray(req.body?.predictions) ? req.body.predictions : [];
  const qualifiers = Array.isArray(req.body?.qualifiers) ? req.body.qualifiers : [];

  const matchById = new Map(
    db.prepare('SELECT * FROM matches WHERE pool_id = ?').all(pool.id).map((m) => [m.id, m])
  );

  const upsertPred = db.prepare(`
    INSERT INTO predictions (participant_id, match_id, home_score, away_score)
    VALUES (@pid, @mid, @h, @a)
    ON CONFLICT(participant_id, match_id) DO UPDATE SET home_score = @h, away_score = @a
  `);
  const upsertQual = db.prepare(`
    INSERT INTO qualifiers (participant_id, pool_id, group_label, team_first, team_second)
    VALUES (@pid, @poolId, @g, @t1, @t2)
    ON CONFLICT(participant_id, group_label) DO UPDATE SET team_first = @t1, team_second = @t2
  `);

  let saved = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (const p of predictions) {
      const m = matchById.get(Number(p.matchId));
      if (!m || m.home_team == null || m.away_team == null) { skipped++; continue; }
      // Trava: jogo finalizado ou já começou (se lock_at_kickoff).
      const locked = m.finished || (pool.lock_at_kickoff && new Date(m.kickoff).getTime() <= Date.now());
      if (locked) { skipped++; continue; }
      const h = Math.max(0, Math.min(99, parseInt(p.home, 10)));
      const a = Math.max(0, Math.min(99, parseInt(p.away, 10)));
      if (Number.isNaN(h) || Number.isNaN(a)) { skipped++; continue; }
      upsertPred.run({ pid: me.id, mid: m.id, h, a });
      saved++;
    }
    for (const q of qualifiers) {
      if (!GROUPS[q.group]) continue;
      // Trava palpites de avanço quando o grupo já começou a ser disputado.
      const top2 = computeGroupTop2(pool.id, q.group);
      if (top2) continue; // grupo encerrado
      const valid = (t) => t == null || GROUPS[q.group].includes(t);
      if (!valid(q.first) || !valid(q.second)) continue;
      upsertQual.run({ pid: me.id, poolId: pool.id, g: q.group, t1: q.first || null, t2: q.second || null });
      saved++;
    }
  });
  tx();

  // Recalcula pontos das previsões salvas (caso algum jogo já tenha resultado).
  res.json({ saved, skipped });
}));

// ---------- leaderboard ----------
app.get('/api/pools/:slug/leaderboard', wrap((req, res) => {
  const pool = getPool(req, res); if (!pool) return;
  const rows = db.prepare(`
    SELECT pa.name,
      COALESCE((SELECT SUM(points) FROM predictions WHERE participant_id = pa.id), 0) AS match_pts,
      COALESCE((SELECT SUM(points) FROM qualifiers WHERE participant_id = pa.id), 0) AS qual_pts,
      (SELECT COUNT(*) FROM predictions pr JOIN matches m ON m.id = pr.match_id
         WHERE pr.participant_id = pa.id AND m.finished = 1
           AND pr.home_score = m.home_score AND pr.away_score = m.away_score) AS exatos
    FROM participants pa
    WHERE pa.pool_id = ?
  `).all(pool.id);
  const board = rows.map((r) => ({
    name: r.name, total: r.match_pts + r.qual_pts,
    match_pts: r.match_pts, qual_pts: r.qual_pts, exatos: r.exatos,
  })).sort((a, b) => b.total - a.total || b.exatos - a.exatos || a.name.localeCompare(b.name));
  res.json({ leaderboard: board });
}));

// ---------- admin ----------
function requireAdmin(req, res) {
  const pool = getPool(req, res); if (!pool) return null;
  if (!isAdmin(req, pool)) { res.status(403).json({ error: 'Acesso de administrador necessário.' }); return null; }
  return pool;
}

// Painel admin: tudo, incluindo palpites de todos.
app.get('/api/pools/:slug/admin', wrap((req, res) => {
  const pool = requireAdmin(req, res); if (!pool) return;
  const matches = db.prepare('SELECT * FROM matches WHERE pool_id = ? ORDER BY ord').all(pool.id);
  const participants = db.prepare('SELECT id, name FROM participants WHERE pool_id = ? ORDER BY name').all(pool.id);
  res.json({ pool: publicPool(pool), matches: matches.map(matchPublic), participants });
}));

// Atualizar resultado / times / horário de uma partida.
app.put('/api/pools/:slug/matches/:id', wrap((req, res) => {
  const pool = requireAdmin(req, res); if (!pool) return;
  const m = db.prepare('SELECT * FROM matches WHERE id = ? AND pool_id = ?').get(req.params.id, pool.id);
  if (!m) return res.status(404).json({ error: 'Partida não encontrada.' });

  const b = req.body || {};
  const fields = {};
  if ('home_team' in b) fields.home_team = b.home_team ? String(b.home_team).trim() : null;
  if ('away_team' in b) fields.away_team = b.away_team ? String(b.away_team).trim() : null;
  if ('kickoff' in b && b.kickoff) {
    const d = new Date(b.kickoff);
    if (!isNaN(d)) fields.kickoff = d.toISOString();
  }

  let touchedResult = false;
  if ('home_score' in b || 'away_score' in b) {
    const clear = b.home_score === null || b.away_score === null || b.home_score === '' || b.away_score === '';
    if (clear) {
      fields.home_score = null; fields.away_score = null; fields.finished = 0;
    } else {
      const h = Math.max(0, Math.min(99, parseInt(b.home_score, 10)));
      const a = Math.max(0, Math.min(99, parseInt(b.away_score, 10)));
      if (Number.isNaN(h) || Number.isNaN(a)) return res.status(400).json({ error: 'Placar inválido.' });
      fields.home_score = h; fields.away_score = a; fields.finished = 1;
    }
    touchedResult = true;
  }

  const keys = Object.keys(fields);
  if (keys.length) {
    const sql = `UPDATE matches SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`;
    db.prepare(sql).run({ ...fields, id: m.id });
  }

  if (touchedResult) {
    recomputeMatch(m.id);
    if (m.group_label) recomputeQualifiers(pool.id, m.group_label);
  }
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id);
  res.json({ match: matchPublic(updated) });
}));

// Atualizar regras de pontuação.
app.put('/api/pools/:slug/settings', wrap((req, res) => {
  const pool = requireAdmin(req, res); if (!pool) return;
  const b = req.body || {};
  const clampPts = (v, def) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? def : Math.max(0, Math.min(100, n));
  };
  const fields = {
    pts_exact: clampPts(b.pts_exact, pool.pts_exact),
    pts_goaldiff: clampPts(b.pts_goaldiff, pool.pts_goaldiff),
    pts_outcome: clampPts(b.pts_outcome, pool.pts_outcome),
    pts_advance: clampPts(b.pts_advance, pool.pts_advance),
    lock_at_kickoff: b.lock_at_kickoff ? 1 : 0,
  };
  db.prepare(`UPDATE pools SET pts_exact=@pts_exact, pts_goaldiff=@pts_goaldiff,
    pts_outcome=@pts_outcome, pts_advance=@pts_advance, lock_at_kickoff=@lock_at_kickoff
    WHERE id=@id`).run({ ...fields, id: pool.id });

  // Recalcula tudo com as novas regras.
  const matches = db.prepare('SELECT id, group_label FROM matches WHERE pool_id = ? AND finished = 1').all(pool.id);
  for (const m of matches) recomputeMatch(m.id);
  const groups = new Set(matches.map((m) => m.group_label).filter(Boolean));
  for (const g of groups) recomputeQualifiers(pool.id, g);

  res.json({ ok: true });
}));

// ---------- SPA fallback ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`⚽ Bolão da Copa 2026 rodando em http://localhost:${PORT}`);
});
