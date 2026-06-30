// Sincronização automática de resultados via football-data.org.
// Requer a env var FOOTBALL_DATA_TOKEN (chave gratuita de https://football-data.org).
// É best-effort: se a API falhar ou um jogo não casar, o app segue normal e o
// admin pode lançar/ajustar o placar na mão.
import { all, get, run, recomputeMatch, recomputeAdvanceAll, resolveKnockout, KO_STAGES } from './store.js';
import { EN_TO_PT, STAGE_NAMES } from '../data/wc2026.js';

const TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
const COMP = process.env.FOOTBALL_DATA_COMP || 'WC'; // código da competição (Copa)
const UPSTREAM_TTL = 20 * 1000;  // cache do football-data (fixtures/datas; <=3 req/min)
const POOL_TTL = 12 * 1000;      // reaplica num bolão no máx. a cada 12s (ao vivo via ESPN)
const FETCH_TIMEOUT = 7000;      // teto pra chamadas externas (não pendura a request)

// Placar ao vivo via API pública da ESPN (grátis, sem chave, mais rápida que o free
// tier do football-data). Usada como fonte primária de placar; football-data segue
// como base de fixtures/datas e fallback de placar.
const ESPN_LEAGUE = process.env.ESPN_LEAGUE || 'fifa.world';
const ESPN_TTL = 12 * 1000;

export const SYNC_ENABLED = !!TOKEN;

// Variantes de nomes da ESPN que diferem do football-data → nome PT do bolão.
const ESPN_ALIAS = {
  'south korea': 'Coreia do Sul', 'korea republic': 'Coreia do Sul',
  'ivory coast': 'Costa do Marfim',
  'usa': 'Estados Unidos', 'united states': 'Estados Unidos',
  'czechia': 'Tchéquia', 'czech republic': 'Tchéquia',
  'cape verde': 'Cabo Verde', 'cape verde islands': 'Cabo Verde',
  'bosnia and herzegovina': 'Bósnia e Herzegovina', 'bosnia herzegovina': 'Bósnia e Herzegovina',
  'iran': 'Irã', 'ir iran': 'Irã',
  'turkiye': 'Turquia', 'turkey': 'Turquia',
  'curacao': 'Curaçao',
};

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

function espnToPt(name) {
  if (!name) return null;
  return ESPN_ALIAS[norm(name)] || toPt(name);
}

// ---- cache do placar ao vivo da ESPN ----
let espnCache = { at: 0, data: null };

// Converte a resposta da ESPN num formato simples (incl. autores dos gols).
function parseEspn(json) {
  const events = Array.isArray(json.events) ? json.events : [];
  const out = [];
  for (const ev of events) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) continue;
    const cs = comp.competitors || [];
    const home = cs.find((c) => c.homeAway === 'home');
    const away = cs.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    const hp = espnToPt(home.team?.displayName || home.team?.name || home.team?.shortDisplayName);
    const ap = espnToPt(away.team?.displayName || away.team?.name || away.team?.shortDisplayName);
    if (!hp || !ap) continue;
    const state = ev.status?.type?.state || comp.status?.type?.state || 'pre'; // pre | in | post
    const hs = home.score != null && home.score !== '' ? parseInt(home.score, 10) : null;
    const as = away.score != null && away.score !== '' ? parseInt(away.score, 10) : null;
    // Placar da disputa de pênaltis (separado do placar do jogo). Só decide quem avança.
    const hsh = home.shootoutScore != null && home.shootoutScore !== '' ? parseInt(home.shootoutScore, 10) : null;
    const ash = away.shootoutScore != null && away.shootoutScore !== '' ? parseInt(away.shootoutScore, 10) : null;
    // gols (scoring plays): jogador, minuto, pênalti, gol contra, lado
    const goals = [];
    for (const d of (comp.details || [])) {
      if (!d.scoringPlay) continue;
      const who = (d.athletesInvolved && d.athletesInvolved[0] && (d.athletesInvolved[0].displayName || d.athletesInvolved[0].shortName)) || null;
      const side = d.team && String(d.team.id) === String(home.team?.id) ? 'home' : 'away';
      goals.push({ side, who, minute: (d.clock && d.clock.displayValue) || '', pen: !!d.penaltyKick, og: !!d.ownGoal });
    }
    out.push({ home: hp, away: ap, hs, as, hsh, ash, state, completed: !!(ev.status?.type?.completed), goals });
  }
  return out;
}

async function fetchEspnRaw(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  let res;
  try { res = await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`espn ${res.status}`);
  return parseEspn(await res.json());
}

async function fetchEspn({ force = false } = {}) {
  if (!force && Date.now() - espnCache.at < ESPN_TTL && espnCache.data) return espnCache.data;
  const out = await fetchEspnRaw(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/scoreboard`);
  espnCache = { at: Date.now(), data: out };
  return out;
}

// Scoreboard de uma data específica (YYYYMMDD) — usado p/ buscar gols de qualquer jogo.
const espnDateCache = new Map();
async function fetchEspnForDate(ymd) {
  const c = espnDateCache.get(ymd);
  if (c && Date.now() - c.at < ESPN_TTL) return c.data;
  const out = await fetchEspnRaw(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/scoreboard?dates=${ymd}`);
  espnDateCache.set(ymd, { at: Date.now(), data: out });
  return out;
}

// Autores dos gols de um jogo do bolão (orientados pelos times do jogo). Best-effort.
export async function matchGoals(m) {
  if (!m || !m.home_team || !m.away_team) return [];
  try {
    const d = new Date(m.kickoff);
    if (Number.isNaN(d.getTime())) return [];
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const list = await fetchEspnForDate(ymd);
    for (const e of list) {
      if (!e.goals || !e.goals.length) continue;
      if (e.home === m.home_team && e.away === m.away_team) return e.goals;
      if (e.home === m.away_team && e.away === m.home_team) return e.goals.map((g) => ({ ...g, side: g.side === 'home' ? 'away' : 'home' }));
    }
  } catch (_) { /* best-effort */ }
  return [];
}

// Placar de um jogo do bolão a partir da ESPN (orienta home/away pelos times do jogo).
// `sh` = placar dos pênaltis (orientado igual ao jogo), ou null se não houve disputa.
function scoreFromEspn(m, list) {
  if (!m.home_team || !m.away_team) return null;
  for (const e of list) {
    if (e.state === 'pre' || e.hs == null || e.as == null) continue; // ainda não começou
    const sh = (e.hsh != null && e.ash != null) ? { h: e.hsh, a: e.ash } : null;
    if (e.home === m.home_team && e.away === m.away_team) return { h: e.hs, a: e.as, finished: e.completed, sh };
    if (e.home === m.away_team && e.away === m.home_team) {
      return { h: e.as, a: e.hs, finished: e.completed, sh: sh ? { h: sh.a, a: sh.h } : null };
    }
  }
  return null;
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

  // Placar ao vivo da ESPN (best-effort: se cair, segue só com o football-data).
  let espn = [];
  try { espn = await fetchEspn(); } catch (_) { espn = []; }

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
    // Placar: ESPN primeiro (mais rápido), football-data como fallback.
    const espnSc = scoreFromEspn(m, espn);
    const fdSc = scoreOf(fd);
    const primary = espnSc || fdSc;
    if (!primary) continue;
    const fin = primary.finished ? 1 : 0;
    const isKO = m.stage && KO_STAGES.includes(m.stage);

    // Quem venceu a eventual disputa de pênaltis (de qualquer fonte disponível).
    const fdPen = fd.score?.penalties;
    const penWinner = (() => {
      const sh = espnSc?.sh;
      if (sh && sh.h !== sh.a) return sh.h > sh.a ? 'home' : 'away';
      if (fdPen && fdPen.home != null && fdPen.away != null && fdPen.home !== fdPen.away) {
        return fdPen.home > fdPen.away ? 'home' : 'away';
      }
      return null;
    })();
    // O jogo foi decidido nos pênaltis? Detecta por qualquer sinal: placar de pênaltis,
    // duração da partida, ou o admin já ter marcado quem avançou (empate decidido nos pênaltis).
    const penShootout = !!(isKO && fin && (
      penWinner != null ||
      fd.score?.duration === 'PENALTY_SHOOTOUT' ||
      m.advanced
    ));

    // O placar do JOGO é SEMPRE o tempo regulamentar (um empate, quando há pênaltis).
    // Os pênaltis só definem quem avança e NUNCA viram o placar da partida.
    let sc, detectedAdv = m.advanced || null;
    if (penShootout) {
      detectedAdv = penWinner || m.advanced || null;
      // 1) usa a fonte que reporta o empate; 2) preserva o empate já gravado (admin);
      // 3) se não há empate confiável, NÃO sobrescreve o placar (evita gravar os pênaltis).
      const drawCand = [espnSc, fdSc].find((s) => s && s.h === s.a);
      if (drawCand) sc = { h: drawCand.h, a: drawCand.a };
      else if (m.home_score != null && m.home_score === m.away_score) sc = { h: m.home_score, a: m.away_score };
      else sc = null;
    } else {
      sc = { h: primary.h, a: primary.a };
    }

    const newH = sc ? sc.h : m.home_score;
    const newA = sc ? sc.a : m.away_score;
    const unchanged = m.home_score === newH && m.away_score === newA
      && (m.finished ? 1 : 0) === fin && (m.advanced || null) === detectedAdv;
    if (unchanged) continue;
    await run('UPDATE matches SET home_score = $1, away_score = $2, finished = $3, advanced = $4 WHERE id = $5',
      [newH, newA, fin, detectedAdv, m.id]);
    await recomputeMatch(m.id);
    if (m.group_label) touchedGroups.add(m.group_label);
    updated++;
  }

  if (touchedGroups.size) await recomputeAdvanceAll(pool.id);
  await resolveKnockout(pool.id); // preenche o chaveamento (sempre, para aplicar correções de algoritmo)
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

  // Fonte primária de placar ao vivo: ESPN.
  out.espn = { league: ESPN_LEAGUE };
  try {
    const ev = await fetchEspn({ force: true });
    out.espn.ok = true;
    out.espn.events = ev.length;
    out.espn.live = ev.filter((e) => e.state === 'in').map((e) => ({ home: e.home, away: e.away, score: `${e.hs ?? '-'}x${e.as ?? '-'}`, goals: (e.goals || []).map((g) => `${g.minute} ${g.who}${g.pen ? ' (P)' : ''}${g.og ? ' (GC)' : ''}`) }));
    out.espn.sample = ev.slice(0, 6).map((e) => ({ home: e.home, away: e.away, score: `${e.hs ?? '-'}x${e.as ?? '-'}`, state: e.state, goals: (e.goals || []).length }));
  } catch (e) { out.espn.ok = false; out.espn.error = String(e.message || e); }
  return out;
}

export { STAGE_NAMES };
