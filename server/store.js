// Camada de dados unificada: usa Postgres (Supabase) quando DATABASE_URL está
// definida, senão cai para SQLite local (dev). A API exposta é assíncrona.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtures, GROUPS, FIFA_RANK } from '../data/wc2026.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USE_PG = !!process.env.DATABASE_URL;

// ---------- driver ----------
// A inicialização NUNCA lança no import: se falhar (ex.: SQLite num filesystem
// read-only como o da Vercel), guardamos o erro e as queries retornam uma
// mensagem clara — em vez de derrubar a função inteira (FUNCTION_INVOCATION_FAILED).
let pgPool = null;
let sqlite = null;
let initError = null;

try {
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
} catch (e) {
  initError = e;
}

function assertReady() {
  if (initError) {
    const hint = USE_PG
      ? ''
      : ' — sem DATABASE_URL o app usa SQLite, que não funciona no filesystem read-only da Vercel. Defina a env var DATABASE_URL (Postgres do Supabase).';
    throw new Error(`Falha ao inicializar o banco: ${initError.message}${hint}`);
  }
}

// Converte placeholders $1,$2 -> ? para o SQLite.
const toSqlite = (sql) => sql.replace(/\$\d+/g, '?');

export async function all(sql, params = []) {
  assertReady();
  if (USE_PG) return (await pgPool.query(sql, params)).rows;
  return sqlite.prepare(toSqlite(sql)).all(...params);
}
export async function get(sql, params = []) {
  assertReady();
  if (USE_PG) return (await pgPool.query(sql, params)).rows[0] || null;
  return sqlite.prepare(toSqlite(sql)).get(...params) || null;
}
export async function run(sql, params = []) {
  assertReady();
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
    lock_at_kickoff INTEGER NOT NULL DEFAULT 1,
    synced_at TIMESTAMPTZ
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
      assertReady();
      if (USE_PG) {
        // Roda cada statement separadamente: compatível com o Transaction pooler
        // do Supabase (pgBouncer), que pode falhar com múltiplos statements juntos.
        const stmts = SCHEMA_PG.split(';').map((s) => s.trim()).filter(Boolean);
        for (const stmt of stmts) await pgPool.query(stmt);
        // Colunas adicionadas depois (idempotente p/ bancos já existentes).
        await pgPool.query('ALTER TABLE pools ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ').catch(() => {});
      } else {
        sqlite.exec(SCHEMA_SQLITE);
        try { sqlite.exec('ALTER TABLE pools ADD COLUMN synced_at TEXT'); } catch (_) { /* já existe */ }
      }
    })().catch((e) => {
      // Não envenena o cache: permite nova tentativa no próximo acesso.
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}
// SQLite local pode inicializar de imediato (silenciando erro p/ não derrubar o import).
if (!USE_PG && !initError) ensureSchema().catch(() => {});

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

// ---------- classificação (tabela de grupo, top 2, melhores 3ºs) ----------
// Linha pseudo-grupo onde guardamos a pontuação dos 3ºs colocados de cada palpiteiro.
export const THIRDS_KEY = '__3__';

// Estatística geral por time (pontos, gols pró/contra) a partir de uma lista de jogos.
function baseStats(teams, games) {
  const table = {};
  for (const t of teams) table[t] = { team: t, j: 0, v: 0, e: 0, d: 0, pts: 0, gf: 0, ga: 0 };
  for (const m of games) {
    if (m.home_score == null || m.away_score == null) continue;
    const h = table[m.home_team], a = table[m.away_team];
    if (!h || !a) continue;
    h.j++; a.j++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) { h.pts += 3; h.v++; a.d++; }
    else if (m.home_score < m.away_score) { a.pts += 3; a.v++; h.d++; }
    else { h.pts += 1; a.pts += 1; h.e++; a.e++; }
  }
  for (const t of teams) table[t].gd = table[t].gf - table[t].ga;
  return table;
}

// Desempate entre seleções EMPATADAS EM PONTOS dentro de um grupo, na ordem da FIFA 2026:
// confronto direto (pontos > saldo > gols) e, só então, critérios gerais (saldo > gols >
// ranking FIFA). Fair play não é modelado (não há cartões num palpite).
function resolveTie(tied, games, base) {
  const set = new Set(tied);
  const h = {};
  for (const t of tied) h[t] = { pts: 0, gf: 0, gd: 0 };
  for (const m of games) {
    if (m.home_score == null || m.away_score == null) continue;
    if (!set.has(m.home_team) || !set.has(m.away_team)) continue;
    const H = h[m.home_team], A = h[m.away_team];
    H.gf += m.home_score; A.gf += m.away_score;
    H.gd += m.home_score - m.away_score; A.gd += m.away_score - m.home_score;
    if (m.home_score > m.away_score) H.pts += 3;
    else if (m.home_score < m.away_score) A.pts += 3;
    else { H.pts += 1; A.pts += 1; }
  }
  const rk = (t) => FIFA_RANK[t] || 999;
  return [...tied].sort((x, y) =>
    h[y].pts - h[x].pts || h[y].gd - h[x].gd || h[y].gf - h[x].gf ||   // confronto direto
    base[y].gd - base[x].gd || base[y].gf - base[x].gf ||              // critérios gerais
    rk(x) - rk(y) || x.localeCompare(y));                             // ranking FIFA
}

// Monta a tabela de um grupo (ordenada pelos critérios da FIFA 2026, com confronto direto).
// Cada jogo: { home_team, away_team, home_score, away_score }. Jogos sem placar são ignorados.
export function groupTable(teams, games) {
  const base = baseStats(teams, games);
  const order = [...teams].sort((a, b) => base[b].pts - base[a].pts);
  const result = [];
  let i = 0;
  while (i < order.length) {
    let j = i + 1;
    while (j < order.length && base[order[j]].pts === base[order[i]].pts) j++;
    const tied = order.slice(i, j);
    if (tied.length === 1) result.push(tied[0]);
    else result.push(...resolveTie(tied, games, base));
    i = j;
  }
  return result.map((t) => base[t]);
}

// Ordena os 12 terceiros colocados e devolve os 8 melhores (grupos distintos: sem
// confronto direto — pontos > saldo > gols > ranking FIFA).
export function rankThirds(thirdRows) {
  const rk = (t) => FIFA_RANK[t] || 999;
  return [...thirdRows]
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || rk(x.team) - rk(y.team) || x.team.localeCompare(y.team))
    .slice(0, 8)
    .map((r) => r.team);
}

async function groupGames(poolId, groupLabel) {
  return all(
    "SELECT * FROM matches WHERE pool_id = $1 AND stage = 'group' AND group_label = $2 ORDER BY ord",
    [poolId, groupLabel]
  );
}

// Top 2 reais de um grupo — só quando os 6 jogos terminaram.
export async function computeGroupTop2(poolId, groupLabel) {
  const matches = await groupGames(poolId, groupLabel);
  if (matches.length === 0 || !matches.every((m) => m.finished)) return null;
  const ranked = groupTable(GROUPS[groupLabel], matches);
  return [ranked[0].team, ranked[1].team];
}

// Os 8 melhores 3ºs reais — só quando TODOS os 12 grupos terminaram.
export async function computeRealThirds(poolId) {
  const thirds = [];
  for (const g of Object.keys(GROUPS)) {
    const matches = await groupGames(poolId, g);
    if (matches.length === 0 || !matches.every((m) => m.finished)) return null;
    thirds.push(groupTable(GROUPS[g], matches)[2]);
  }
  return rankThirds(thirds);
}

// Classificação prevista por um palpiteiro (a partir dos placares que ele chutou).
async function participantGroupTables(poolId, participantId) {
  const matches = await all(
    "SELECT m.*, p.home_score AS p_home, p.away_score AS p_away FROM matches m " +
    "LEFT JOIN predictions p ON p.match_id = m.id AND p.participant_id = $2 " +
    "WHERE m.pool_id = $1 AND m.stage = 'group'",
    [poolId, participantId]
  );
  const byGroup = {};
  for (const m of matches) {
    (byGroup[m.group_label] = byGroup[m.group_label] || []).push({
      home_team: m.home_team, away_team: m.away_team,
      home_score: m.p_home, away_score: m.p_away,
    });
  }
  const tables = {};
  const thirds = [];
  for (const g of Object.keys(GROUPS)) {
    const t = groupTable(GROUPS[g], byGroup[g] || []);
    tables[g] = t;
    thirds.push(t[2]);
  }
  return { tables, predThirds: rankThirds(thirds) };
}

// Recalcula a pontuação de "quem avança" de um palpiteiro (top 2 de cada grupo
// + os 8 melhores 3ºs), comparando o previsto (placares dele) com o real.
export async function recomputeAdvanceForParticipant(pool, participantId) {
  const { tables, predThirds } = await participantGroupTables(pool.id, participantId);
  const realThirds = await computeRealThirds(pool.id);

  for (const g of Object.keys(GROUPS)) {
    const predTop2 = [tables[g][0].team, tables[g][1].team];
    const realTop2 = await computeGroupTop2(pool.id, g);
    let pts = 0;
    if (realTop2) for (const t of predTop2) if (realTop2.includes(t)) pts += pool.pts_advance;
    await run(`INSERT INTO qualifiers (participant_id, pool_id, group_label, team_first, team_second, points)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (participant_id, group_label)
      DO UPDATE SET team_first = excluded.team_first, team_second = excluded.team_second, points = excluded.points`,
      [participantId, pool.id, g, predTop2[0] || null, predTop2[1] || null, pts]);
  }

  let thirdPts = 0;
  if (realThirds) for (const t of predThirds) if (realThirds.includes(t)) thirdPts += pool.pts_advance;
  await run(`INSERT INTO qualifiers (participant_id, pool_id, group_label, team_first, team_second, points)
    VALUES ($1, $2, $3, NULL, NULL, $4)
    ON CONFLICT (participant_id, group_label)
    DO UPDATE SET points = excluded.points`,
    [participantId, pool.id, THIRDS_KEY, thirdPts]);
}

// Recalcula "quem avança" para todos os palpiteiros do bolão (ao lançar resultado).
export async function recomputeAdvanceAll(poolId) {
  const pool = await get('SELECT * FROM pools WHERE id = $1', [poolId]);
  const parts = await all('SELECT id FROM participants WHERE pool_id = $1', [poolId]);
  for (const p of parts) await recomputeAdvanceForParticipant(pool, p.id);
}

export { USE_PG };
