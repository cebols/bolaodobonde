// Camada de dados unificada: usa Postgres (Supabase) quando DATABASE_URL está
// definida, senão cai para SQLite local (dev). A API exposta é assíncrona.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtures, GROUPS } from '../data/wc2026.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USE_PG = !!process.env.DATABASE_URL;

// ---------- driver ----------
let pgPool = null;
let sqlite = null;

if (USE_PG) {
  const pg = (await import('pg')).default;
  const url = process.env.DATABASE_URL;
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  pgPool = new pg.Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 5),
  });
} else {
  const Database = (await import('better-sqlite3')).default;
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'bolao.db');
  sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
}

// Converte placeholders $1,$2 -> ? para o SQLite.
const toSqlite = (sql) => sql.replace(/\$\d+/g, '?');

export async function all(sql, params = []) {
  if (USE_PG) return (await pgPool.query(sql, params)).rows;
  return sqlite.prepare(toSqlite(sql)).all(...params);
}
export async function get(sql, params = []) {
  if (USE_PG) return (await pgPool.query(sql, params)).rows[0] || null;
  return sqlite.prepare(toSqlite(sql)).get(...params) || null;
}
export async function run(sql, params = []) {
  if (USE_PG) { const r = await pgPool.query(sql, params); return r.rows[0] || {}; }
  const info = sqlite.prepare(toSqlite(sql)).run(...params);
  return { changes: info.changes, lastID: info.lastInsertRowid };
}

// ---------- schema ----------
const SCHEMA_PG = `
  CREATE TABLE IF NOT EXISTS pools (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    admin_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    pts_exact INTEGER NOT NULL DEFAULT 10,
    pts_goaldiff INTEGER NOT NULL DEFAULT 7,
    pts_outcome INTEGER NOT NULL DEFAULT 5,
    pts_advance INTEGER NOT NULL DEFAULT 5,
    lock_at_kickoff INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS participants (
    id SERIAL PRIMARY KEY,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(pool_id, name)
  );
  CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY,
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
    id SERIAL PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    UNIQUE(participant_id, match_id)
  );
  CREATE TABLE IF NOT EXISTS qualifiers (
    id SERIAL PRIMARY KEY,
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
`;

const SCHEMA_SQLITE = SCHEMA_PG
  .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
  .replace(/TIMESTAMPTZ NOT NULL DEFAULT now\(\)/g, "TEXT NOT NULL DEFAULT (datetime('now'))");

let schemaPromise = null;
export function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      if (USE_PG) {
        // Postgres não aceita múltiplos statements com parâmetros, mas aceita sem.
        await pgPool.query(SCHEMA_PG);
      } else {
        sqlite.exec(SCHEMA_SQLITE);
      }
    })().catch((e) => {
      // Não envenena o cache: permite nova tentativa no próximo acesso.
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}
// SQLite pode inicializar de imediato.
if (!USE_PG) ensureSchema();

// ---------- helpers ----------
export function genToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
export function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

export async function slugify(name) {
  const base = String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    .slice(0, 32) || 'bolao';
  let slug = base;
  let n = 1;
  while (await get('SELECT 1 FROM pools WHERE slug = $1', [slug])) slug = `${base}-${++n}`;
  return slug;
}

// Cria um bolão com as 104 partidas semeadas.
export async function createPool(name) {
  const slug = await slugify(name);
  const adminToken = genToken();
  const pool = await get(
    'INSERT INTO pools (slug, name, admin_token) VALUES ($1, $2, $3) RETURNING id',
    [slug, name.trim(), adminToken]
  );
  const poolId = pool.id;

  // Insere as partidas em lotes (seguro para o limite de variáveis do SQLite).
  const fixtures = buildFixtures();
  const cols = ['pool_id', 'ord', 'stage', 'group_label', 'round_label',
    'home_team', 'away_team', 'home_label', 'away_label', 'kickoff'];
  const CHUNK = 40;
  for (let i = 0; i < fixtures.length; i += CHUNK) {
    const slice = fixtures.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    slice.forEach((m, j) => {
      const row = [poolId, m.ord, m.stage, m.group_label, m.round_label,
        m.home_team, m.away_team, m.home_label, m.away_label, m.kickoff];
      const ph = row.map((_, k) => `$${j * cols.length + k + 1}`);
      values.push(`(${ph.join(',')})`);
      params.push(...row);
    });
    await run(`INSERT INTO matches (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
  return { poolId, slug, adminToken };
}

// ---------- pontuação ----------
function scoreMatch(pool, pred, m) {
  if (m.home_score == null || m.away_score == null) return 0;
  const ph = pred.home_score, pa = pred.away_score;
  const rh = m.home_score, ra = m.away_score;
  if (ph === rh && pa === ra) return pool.pts_exact;
  if (Math.sign(ph - pa) !== Math.sign(rh - ra)) return 0;
  if (ph - pa === rh - ra) return pool.pts_goaldiff;
  return pool.pts_outcome;
}

export async function recomputeMatch(matchId) {
  const m = await get('SELECT * FROM matches WHERE id = $1', [matchId]);
  if (!m) return;
  const pool = await get('SELECT * FROM pools WHERE id = $1', [m.pool_id]);
  const preds = await all('SELECT * FROM predictions WHERE match_id = $1', [matchId]);
  for (const p of preds) {
    await run('UPDATE predictions SET points = $1 WHERE id = $2', [scoreMatch(pool, p, m), p.id]);
  }
}

// Classificação real de um grupo (top 2) quando todos os 6 jogos terminaram.
export async function computeGroupTop2(poolId, groupLabel) {
  const matches = await all(
    "SELECT * FROM matches WHERE pool_id = $1 AND stage = 'group' AND group_label = $2",
    [poolId, groupLabel]
  );
  if (matches.length === 0 || !matches.every((m) => m.finished)) return null;

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

export async function recomputeQualifiers(poolId, groupLabel) {
  const pool = await get('SELECT * FROM pools WHERE id = $1', [poolId]);
  const top2 = await computeGroupTop2(poolId, groupLabel);
  const rows = await all(
    'SELECT * FROM qualifiers WHERE pool_id = $1 AND group_label = $2',
    [poolId, groupLabel]
  );
  for (const q of rows) {
    let pts = 0;
    if (top2) {
      if (q.team_first && top2.includes(q.team_first)) pts += pool.pts_advance;
      if (q.team_second && top2.includes(q.team_second)) pts += pool.pts_advance;
    }
    await run('UPDATE qualifiers SET points = $1 WHERE id = $2', [pts, q.id]);
  }
  return top2;
}

export { USE_PG };
