import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtures, GROUPS } from '../data/wc2026.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'bolao.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    admin_token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    pts_exact INTEGER NOT NULL DEFAULT 10,
    pts_goaldiff INTEGER NOT NULL DEFAULT 7,
    pts_outcome INTEGER NOT NULL DEFAULT 5,
    pts_advance INTEGER NOT NULL DEFAULT 5,
    lock_at_kickoff INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(pool_id, name)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    stage TEXT NOT NULL,
    group_label TEXT,
    round_label TEXT NOT NULL,
    home_team TEXT,
    away_team TEXT,
    home_label TEXT,
    away_label TEXT,
    kickoff TEXT NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    finished INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    UNIQUE(participant_id, match_id)
  );

  CREATE TABLE IF NOT EXISTS qualifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    group_label TEXT NOT NULL,
    team_first TEXT,
    team_second TEXT,
    points INTEGER NOT NULL DEFAULT 0,
    UNIQUE(participant_id, group_label)
  );

  CREATE INDEX IF NOT EXISTS idx_matches_pool ON matches(pool_id);
  CREATE INDEX IF NOT EXISTS idx_pred_part ON predictions(participant_id);
  CREATE INDEX IF NOT EXISTS idx_pred_match ON predictions(match_id);
`);

export function genToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

export function slugify(name) {
  const base = String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    .slice(0, 32) || 'bolao';
  let slug = base;
  let n = 1;
  const exists = db.prepare('SELECT 1 FROM pools WHERE slug = ?');
  while (exists.get(slug)) slug = `${base}-${++n}`;
  return slug;
}

// Cria um novo bolão com todas as 104 partidas semeadas.
export function createPool(name) {
  const slug = slugify(name);
  const adminToken = genToken();
  const insertPool = db.prepare(
    'INSERT INTO pools (slug, name, admin_token) VALUES (?, ?, ?)'
  );
  const insertMatch = db.prepare(`
    INSERT INTO matches (pool_id, ord, stage, group_label, round_label,
      home_team, away_team, home_label, away_label, kickoff)
    VALUES (@pool_id, @ord, @stage, @group_label, @round_label,
      @home_team, @away_team, @home_label, @away_label, @kickoff)
  `);

  const tx = db.transaction(() => {
    const { lastInsertRowid: poolId } = insertPool.run(slug, name.trim(), adminToken);
    for (const m of buildFixtures()) insertMatch.run({ ...m, pool_id: poolId });
    return poolId;
  });
  const poolId = tx();
  return { poolId, slug, adminToken };
}

// ---------- Scoring ----------

function scoreMatch(pool, pred, m) {
  if (m.home_score == null || m.away_score == null) return 0;
  const ph = pred.home_score, pa = pred.away_score;
  const rh = m.home_score, ra = m.away_score;

  if (ph === rh && pa === ra) return pool.pts_exact;

  const predOutcome = Math.sign(ph - pa);
  const realOutcome = Math.sign(rh - ra);
  if (predOutcome !== realOutcome) return 0;

  // Acertou o resultado (vencedor ou empate). Bônus se acertou o saldo de gols.
  if (ph - pa === rh - ra) return pool.pts_goaldiff;
  return pool.pts_outcome;
}

// Recalcula os pontos das previsões de uma partida específica.
export function recomputeMatch(matchId) {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!m) return;
  const pool = db.prepare('SELECT * FROM pools WHERE id = ?').get(m.pool_id);
  const preds = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(matchId);
  const upd = db.prepare('UPDATE predictions SET points = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const p of preds) upd.run(scoreMatch(pool, p, m), p.id);
  });
  tx();
}

// Calcula a classificação real de um grupo a partir dos jogos finalizados.
// Retorna os 2 primeiros (ou null se o grupo não terminou).
export function computeGroupTop2(poolId, groupLabel) {
  const matches = db.prepare(
    "SELECT * FROM matches WHERE pool_id = ? AND stage = 'group' AND group_label = ?"
  ).all(poolId, groupLabel);
  if (matches.length === 0) return null;
  const allDone = matches.every((m) => m.finished);
  if (!allDone) return null;

  const table = {};
  for (const t of GROUPS[groupLabel]) table[t] = { team: t, pts: 0, gf: 0, ga: 0 };
  for (const m of matches) {
    const h = table[m.home_team], a = table[m.away_team];
    if (!h || !a) continue;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) h.pts += 3;
    else if (m.home_score < m.away_score) a.pts += 3;
    else { h.pts += 1; a.pts += 1; }
  }
  const ranked = Object.values(table).sort((x, y) =>
    y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team)
  );
  return [ranked[0].team, ranked[1].team];
}

// Recalcula os pontos de "quem avança" de um grupo (quando o grupo termina).
export function recomputeQualifiers(poolId, groupLabel) {
  const pool = db.prepare('SELECT * FROM pools WHERE id = ?').get(poolId);
  const top2 = computeGroupTop2(poolId, groupLabel);
  const rows = db.prepare(
    'SELECT * FROM qualifiers WHERE pool_id = ? AND group_label = ?'
  ).all(poolId, groupLabel);
  const upd = db.prepare('UPDATE qualifiers SET points = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const q of rows) {
      let pts = 0;
      if (top2) {
        // Ponto por cada seleção prevista que realmente avançou (top 2).
        if (q.team_first && top2.includes(q.team_first)) pts += pool.pts_advance;
        if (q.team_second && top2.includes(q.team_second)) pts += pool.pts_advance;
      }
      upd.run(pts, q.id);
    }
  });
  tx();
  return top2;
}
