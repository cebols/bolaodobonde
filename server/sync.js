// Sincronização automática de resultados via football-data.org.
// Requer a env var FOOTBALL_DATA_TOKEN (chave gratuita de https://football-data.org).
// É best-effort: se a API falhar ou um jogo não casar, o app segue normal e o
// admin pode lançar/ajustar o placar na mão.
import { all, get, run, recomputeMatch, recomputeAdvanceAll, resolveKnockout } from './store.js';
import { EN_TO_PT, STAGE_NAMES } from '../data/wc2026.js';

const TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
const COMP = process.env.FOOTBALL_DATA_COMP || 'WC'; // código da competição (Copa)
const UPSTREAM_TTL = 20 * 1000;  // cache do upstream (<=3 req/min, dentro do free tier)
const POOL_TTL = 20 * 1000;      // reaplica num bolão no máx. a cada 20s
const FETCH_TIMEOUT = 7000;      // teto pra chamada ao football-data (não pendura a request)

export const SYNC_ENABLED = !!TOKEN;

const FD_STAGE = {
  GROUP_STAGE: 'group', LAST_32: 'r32', ROUND_OF_32: 'r32',
  LAST_16: 'r16', ROUND_OF_16: 'r16', QUARTER_FINALS: 'qf', QUARTER_FINAL: 'qf',
  SEMI_FINALS: 'sf', SEMI_FINAL: 'sf', THIRD_PLACE: 'third', FINAL: 'final',
};

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z ]/g, '').trim();

function toPt(name) {
  if (!name) return null;
  const n = norm(name);
  if (EN_TO_PT[n]) return EN_TO_PT[n];
  // tenta sem sufixos comuns ("korea republic" -> "korea")
  return EN_TO_PT[n] || null;
}

// ---- cache da resposta do upstream (compartilhado entre todos os bolões) ----
let upstreamCache = { at: 0, data: null };
async function fetchUpstream({ force = false } = {}) {
  if (!force && Date.now() - upstreamCache.at < UPSTREAM_TTL && upstreamCache.data) return upstreamCache.data;
  // Timeout pra não pendurar a request se o football-data demorar.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  let res;
  try {
    res = await fetch(`https://api.football-data.org/v4/competitions/${COMP}/matches`, {
      headers: { 'X-Auth-Token': TOKEN }, signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`football-data ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json.matches) ? json.matches : [];
  upstreamCache = { at: Date.now(), data: list };
  return list;
}

// Casa um jogo do upstream com um jogo do bolão (por grupo+par de times, ou par de times no mata-mata).
function findMatch(rows, fd) {
  const stage = FD_STAGE[fd.stage] || null;
  const home = toPt(fd.homeTeam?.name || fd.homeTeam?.shortName);
  const away = toPt(fd.awayTeam?.name || fd.awayTeam?.shortName);
  if (!home || !away) return null;
  const pair = new Set([home, away]);
  return rows.find((m) => {
    if (stage && m.stage !== stage) return false;
    if (!m.home_team || !m.away_team) return false;
    return pair.has(m.home_team) && pair.has(m.away_team) && m.home_team !== m.away_team;
  }) || null;
}

function scoreOf(fd) {
  const ft = fd.score?.fullTime || {};
  const h = ft.home, a = ft.away;
  if (h == null || a == null) return null;
  return { h, a, finished: fd.status === 'FINISHED' || fd.status === 'AWARDED' };
}

// Sincroniza UM bolão. Atualiza placares, recalcula pontos e "quem avança".
// Retorna o nº de jogos atualizados. Nunca lança (engole erros de rede/parse).
export async function syncPool(pool, { force = false } = {}) {
  if (!SYNC_ENABLED) return { updated: 0, skipped: 'sem token' };
  if (!force && pool.synced_at && Date.now() - new Date(pool.synced_at).getTime() < POOL_TTL) {
    return { updated: 0, skipped: 'recente' };
  }
  let list;
  try { list = await fetchUpstream(); }
  catch (e) { return { updated: 0, error: String(e.message || e) }; }

  const rows = await all('SELECT * FROM matches WHERE pool_id = $1', [pool.id]);
  const touchedGroups = new Set();
  let updated = 0, redated = 0;

  for (const fd of list) {
    const m = findMatch(rows, fd);
    if (!m) continue;
    // Data/hora oficial da partida (corrige os horários aproximados semeados).
    if (fd.utcDate && !Number.isNaN(Date.parse(fd.utcDate))) {
      const iso = new Date(fd.utcDate).toISOString();
      if (m.kickoff !== iso) {
        await run('UPDATE matches SET kickoff = $1 WHERE id = $2', [iso, m.id]);
        m.kickoff = iso; redated++;
      }
    }
    const sc = scoreOf(fd);
    if (!sc) continue;
    const fin = sc.finished ? 1 : 0;
    if (m.home_score === sc.h && m.away_score === sc.a && (m.finished ? 1 : 0) === fin) continue;
    await run('UPDATE matches SET home_score = $1, away_score = $2, finished = $3 WHERE id = $4',
      [sc.h, sc.a, fin, m.id]);
    await recomputeMatch(m.id);
    if (m.group_label) touchedGroups.add(m.group_label);
    updated++;
  }

  if (touchedGroups.size) await recomputeAdvanceAll(pool.id);
  if (updated) await resolveKnockout(pool.id); // preenche o chaveamento
  await run('UPDATE pools SET synced_at = $1 WHERE id = $2', [new Date().toISOString(), pool.id]);
  return { updated, redated };
}

// Atalho usado nos GETs. AGUARDA o sync terminar — no serverless (Vercel) a função
// congela após enviar a resposta, então abandonar o sync em background fazia o
// placar não atualizar. O POOL_TTL garante que isso só roda esporadicamente (a
// maioria dos GETs nem chega a buscar o upstream) e o fetch tem timeout próprio.
export async function maybeSync(pool) {
  if (!SYNC_ENABLED) return;
  try { await syncPool(pool); } catch (_) { /* best-effort */ }
}

// Diagnóstico (não vaza o token): testa a conexão e mostra quantos jogos vieram e
// quantas seleções casaram com os nomes do bolão. Útil para validar antes dos jogos.
export async function diagnose() {
  const out = { enabled: SYNC_ENABLED, comp: COMP, tokenLen: TOKEN.length, serverTime: new Date().toISOString() };
  if (!SYNC_ENABLED) { out.error = 'FOOTBALL_DATA_TOKEN não definido na Vercel.'; return out; }
  let list;
  // Força busca fresca (sem cache) pra refletir o estado REAL da API agora.
  try { list = await fetchUpstream({ force: true }); }
  catch (e) { out.ok = false; out.error = String(e.message || e); return out; }

  out.ok = true;
  out.totalMatches = list.length;
  out.upstreamAgeSec = Math.round((Date.now() - upstreamCache.at) / 1000);
  out.byStatus = {};
  out.byStage = {};
  const matched = new Set();
  const unmatched = new Set();
  for (const fd of list) {
    out.byStatus[fd.status] = (out.byStatus[fd.status] || 0) + 1;
    out.byStage[fd.stage] = (out.byStage[fd.stage] || 0) + 1;
    for (const side of ['homeTeam', 'awayTeam']) {
      const name = fd[side]?.name;
      if (!name) continue;
      (toPt(name) ? matched : unmatched).add(name);
    }
  }
  out.teamsMatched = matched.size;
  out.teamsUnmatched = [...unmatched].sort();

  // Jogos ao vivo/em andamento segundo a API — mostra placar, status e quando a
  // API atualizou (lastUpdated). Se o gol não aparecer aqui, o atraso é do plano free.
  const LIVE = ['IN_PLAY', 'PAUSED', 'SUSPENDED', 'LIVE'];
  out.live = list.filter((m) => LIVE.includes(m.status)).map((m) => ({
    status: m.status,
    home: m.homeTeam?.name, away: m.awayTeam?.name,
    score: `${m.score?.fullTime?.home ?? '-'}x${m.score?.fullTime?.away ?? '-'}`,
    lastUpdated: m.lastUpdated,
    matched: !!(toPt(m.homeTeam?.name) && toPt(m.awayTeam?.name)),
  }));
  out.sample = list.slice(0, 5).map((m) => ({
    stage: m.stage, group: m.group, status: m.status,
    home: m.homeTeam?.name, away: m.awayTeam?.name,
    score: `${m.score?.fullTime?.home ?? '-'}x${m.score?.fullTime?.away ?? '-'}`,
    pt: `${toPt(m.homeTeam?.name) || '?'} x ${toPt(m.awayTeam?.name) || '?'}`,
  }));
  return out;
}

export { STAGE_NAMES };
