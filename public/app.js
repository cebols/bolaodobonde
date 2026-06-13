'use strict';

// ---------------- estado & util ----------------
const App = (location.hostname && location.host) ? location.origin : '';
let META = { groups: {}, flags: {}, codes: {}, stageNames: {}, stageOrder: [], syncEnabled: false };

const store = {
  getAdmin: (slug) => JSON.parse(localStorage.getItem('bolao_admin') || '{}')[slug] || null,
  setAdmin: (slug, token) => {
    const m = JSON.parse(localStorage.getItem('bolao_admin') || '{}');
    m[slug] = token; localStorage.setItem('bolao_admin', JSON.stringify(m));
  },
  getPart: (slug) => JSON.parse(localStorage.getItem('bolao_part') || '{}')[slug] || null,
  setPart: (slug, data) => {
    const m = JSON.parse(localStorage.getItem('bolao_part') || '{}');
    m[slug] = data; localStorage.setItem('bolao_part', JSON.stringify(m));
  },
  clearPart: (slug) => {
    const m = JSON.parse(localStorage.getItem('bolao_part') || '{}');
    delete m[slug]; localStorage.setItem('bolao_part', JSON.stringify(m));
  },
  // "casa" do dispositivo: último bolão em que o usuário entrou (login persistente).
  getHome: () => localStorage.getItem('bolao_home') || null,
  setHome: (slug) => localStorage.setItem('bolao_home', slug),
  clearHome: () => localStorage.removeItem('bolao_home'),
  recent: () => JSON.parse(localStorage.getItem('bolao_recent') || '[]'),
  addRecent: (slug, name) => {
    let r = store.recent().filter((x) => x.slug !== slug);
    r.unshift({ slug, name }); r = r.slice(0, 8);
    localStorage.setItem('bolao_recent', JSON.stringify(r));
  },
};

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Bandeira como IMAGEM (emoji de bandeira não renderiza no Windows).
function flag(t) {
  const code = t && META.codes && META.codes[t];
  if (!code) return '<span class="flag flag-ph" aria-hidden="true"></span>';
  return `<img class="flag" loading="lazy" alt="" src="https://flagcdn.com/${code}.svg" />`;
}
// Emoji (usado só dentro de <option>, onde imagem não vale).
const flagEmoji = (t) => (t && META.flags[t]) ? META.flags[t] : '⚪';

// Normaliza texto para busca (sem acento, minúsculo).
const normStr = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

// Cor estável a partir do nome (para o placeholder de avatar).
function avColor(name) {
  let h = 0; const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 42% 34%)`;
}
// Foto do participante (ou iniciais coloridas se não tiver).
function avatarImg(url, name, cls = 'av') {
  if (url) return `<img class="${cls}" loading="lazy" alt="" src="${esc(url)}" />`;
  const initials = String(name || '?').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
  return `<span class="${cls} av-ph" style="background:${avColor(name)}">${esc(initials)}</span>`;
}

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, 2800);
}

async function api(method, pathname, body, headers = {}) {
  const res = await fetch(App + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function dayKey(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

// ---------------- classificação (espelho do servidor, com desempate FIFA 2026) ----------------
const fifaRk = (t) => (META.fifaRank && META.fifaRank[t]) || 999;

function baseStatsJS(teams, games) {
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

// Desempate entre times com a MESMA pontuação: confronto direto (pts > saldo > gols),
// depois critérios gerais (saldo > gols) e, por fim, ranking FIFA.
function resolveTieJS(tied, games, base) {
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
  return [...tied].sort((x, y) =>
    h[y].pts - h[x].pts || h[y].gd - h[x].gd || h[y].gf - h[x].gf ||
    base[y].gd - base[x].gd || base[y].gf - base[x].gf ||
    fifaRk(x) - fifaRk(y) || x.localeCompare(y));
}

function groupTableJS(teams, games) {
  const base = baseStatsJS(teams, games);
  const order = [...teams].sort((a, b) => base[b].pts - base[a].pts);
  const result = [];
  let i = 0;
  while (i < order.length) {
    let j = i + 1;
    while (j < order.length && base[order[j]].pts === base[order[i]].pts) j++;
    const tied = order.slice(i, j);
    if (tied.length === 1) result.push(tied[0]);
    else result.push(...resolveTieJS(tied, games, base));
    i = j;
  }
  return result.map((t) => base[t]);
}

// ---------------- router ----------------
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { META = await api('GET', '/api/meta'); } catch (_) {}
  // Login persistente: sem rota explícita, volta direto pro bolão "casa" se ainda logado.
  if (!location.hash) {
    const home = store.getHome();
    if (home && store.getPart(home)) { location.hash = `#/p/${encodeURIComponent(home)}`; return; }
  }
  route();
});

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/');
  if (parts[0] === 'p' && parts[1]) return renderPool(decodeURIComponent(parts[1]));
  return renderHome();
}

function navActions(html = '') { $('#nav-actions').innerHTML = html; }

// ---------------- HOME ----------------
function renderHome() {
  stopPolling();
  navActions('');
  const recent = store.recent();
  $('#app').innerHTML = `
    <section class="card hero">
      <h1>Seu <span class="gold">bolão</span> da Copa 2026 ⚽</h1>
      <p>Crie um bolão, mande o link pra galera e dispute palpite a palpite até a final.</p>
      <div class="feats">
        <span>🎯 Placar exato</span><span>📊 Ranking ao vivo</span>
        <span>🏆 Quem avança</span><span>🔄 Resultados automáticos</span>
      </div>
    </section>

    <section class="card">
      <h2>Criar um novo bolão</h2>
      <p class="muted">Você vira o admin: define a pontuação e acompanha os resultados.</p>
      <div class="spacer"></div>
      <div class="field">
        <label for="pool-name">Nome do bolão</label>
        <input id="pool-name" type="text" maxlength="60" placeholder="Ex.: Bolão da Firma, Galera do Futebol..." />
      </div>
      <button id="btn-create" class="btn-primary btn-block">Criar bolão 🚀</button>
    </section>

    <section class="card">
      <h3>Já tem um link?</h3>
      <p class="muted">Cole o código (slug) do bolão para entrar.</p>
      <div class="sharebox">
        <input id="join-slug" type="text" placeholder="ex.: bolao-da-firma" />
        <button id="btn-go" class="btn-soft">Ir</button>
      </div>
    </section>

    ${recent.length ? `
    <section class="card">
      <h3>Bolões recentes neste dispositivo</h3>
      ${recent.map((r) => `<div class="row" style="align-items:center;margin-bottom:.4rem">
        <a class="btn-soft btn-sm" style="text-decoration:none;display:inline-block" href="#/p/${encodeURIComponent(r.slug)}">⚽ ${esc(r.name)}</a>
      </div>`).join('')}
    </section>` : ''}
  `;

  $('#btn-create').onclick = async () => {
    const name = $('#pool-name').value.trim();
    if (name.length < 2) return toast('Dê um nome ao bolão.', true);
    try {
      const { slug, adminToken } = await api('POST', '/api/pools', { name });
      store.setAdmin(slug, adminToken);
      store.addRecent(slug, name);
      toast('Bolão criado! 🎉');
      location.hash = `#/p/${encodeURIComponent(slug)}`;
    } catch (e) { toast(e.message, true); }
  };
  const go = () => {
    const s = $('#join-slug').value.trim().toLowerCase().replace(/\s+/g, '-');
    if (s) location.hash = `#/p/${encodeURIComponent(s)}`;
  };
  $('#btn-go').onclick = go;
  $('#join-slug').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('#pool-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-create').click(); });
}

// ---------------- POOL ----------------
const PoolState = { slug: null, data: null, me: null, tab: 'palpites', draft: {}, qsaved: {}, admin: null };

async function renderPool(slug) {
  PoolState.slug = slug;
  const adminToken = store.getAdmin(slug);
  $('#app').innerHTML = `<div class="card center"><p>Carregando bolão…</p></div>`;
  let data;
  try {
    data = await api('GET', `/api/pools/${slug}`, null, adminToken ? { 'x-admin-token': adminToken } : {});
  } catch (e) {
    $('#app').innerHTML = `<div class="card center"><h2>😕 ${esc(e.message)}</h2>
      <p class="muted">Verifique o link/código do bolão.</p>
      <a href="#/" class="btn-soft" style="text-decoration:none;display:inline-block;margin-top:.5rem">← Voltar ao início</a></div>`;
    return;
  }
  PoolState.data = data;
  PoolState.dataFp = dataFingerprint(data);
  PoolState.me = store.getPart(slug);
  store.addRecent(slug, data.pool.name);

  navActions(`<a href="#/" class="btn-ghost btn-sm" style="text-decoration:none">← Início</a>`);
  drawPoolShell();
  startPolling();
}

// Atualização "minuto a minuto": refaz o GET do bolão (que dispara o sync no servidor)
// e re-renderiza as abas só-leitura (Chave/Ranking) sem atrapalhar quem digita palpites.
let POLL_HANDLE = null;
function stopPolling() { if (POLL_HANDLE) { clearInterval(POLL_HANDLE); POLL_HANDLE = null; } }
// Resumo do que importa pra tela: se nada disso mudou, não re-renderiza nada.
function dataFingerprint(d) {
  return JSON.stringify({
    m: (d.matches || []).map((m) => [m.id, m.home_team, m.away_team, m.home_score, m.away_score, m.finished ? 1 : 0]),
    p: d.participants,
    lk: d.lock ? [d.lock.mode, d.lock.locked] : null,
  });
}

function startPolling() {
  stopPolling();
  remindersTick();
  POLL_HANDLE = setInterval(async () => {
    remindersTick(); // roda mesmo com a aba em segundo plano
    if (document.hidden || !PoolState.slug) return;
    try {
      const adminToken = store.getAdmin(PoolState.slug);
      const fresh = await api('GET', `/api/pools/${PoolState.slug}`, null, adminToken ? { 'x-admin-token': adminToken } : {});
      const fp = dataFingerprint(fresh);
      const changed = fp !== PoolState.dataFp;
      PoolState.data = fresh;
      PoolState.dataFp = fp;
      // o banner ao vivo (fixo embaixo do hero, em toda aba) é barato e sensível ao
      // relógio, então atualiza sempre; o resto só se os DADOS mudaram (sem reload à toa).
      refreshLiveBanner();
      if (!changed || PoolState.tab === 'palpites') return;
      if (PoolState.tab === 'chave') renderBracket();
      else if (PoolState.tab === 'ranking') renderRanking();
      else if (PoolState.tab === 'desempenho') renderDesempenho();
    } catch (_) { /* silencioso */ }
  }, 30000);
}

// ---------- lembretes de jogos (notificação local, ~10 min antes) ----------
const REMIND_LEAD_MS = 10 * 60 * 1000;
const remindOn = () => localStorage.getItem('bolao_remind') === '1';
function notifiedSet() { try { return new Set(JSON.parse(localStorage.getItem('bolao_notified') || '[]')); } catch (_) { return new Set(); } }
function markNotified(id) { const s = notifiedSet(); s.add(id); localStorage.setItem('bolao_notified', JSON.stringify([...s].slice(-300))); }

function refreshRemindBtn() {
  const b = $('#btn-remind'); if (!b) return;
  const on = remindOn() && (typeof Notification !== 'undefined') && Notification.permission === 'granted';
  b.textContent = on ? '🔔 Lembretes ligados' : '🔕 Lembretes de jogos';
  b.classList.toggle('active', on);
}

async function toggleReminders() {
  if (typeof Notification === 'undefined') return toast('Seu navegador não suporta notificações.', true);
  if (remindOn() && Notification.permission === 'granted') {
    localStorage.setItem('bolao_remind', '0');
    toast('🔕 Lembretes desligados.');
    refreshRemindBtn();
    return;
  }
  let perm = Notification.permission;
  if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch (_) {} }
  if (perm !== 'granted') {
    toast('Permissão de notificação negada. Ative nas configurações do navegador.', true);
    return;
  }
  localStorage.setItem('bolao_remind', '1');
  toast('🔔 Pronto! Vou te avisar ~10 min antes de cada jogo (com o app aberto/instalado).');
  refreshRemindBtn();
  remindersTick();
}

async function showLocalNotification(title, body) {
  const opts = { body, icon: '/icon.svg', badge: '/icon.svg', tag: title, data: { url: location.href } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return; }
  } catch (_) {}
  try { new Notification(title, opts); } catch (_) {}
}

function remindersTick() {
  if (!remindOn() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!PoolState.data || !PoolState.data.matches) return;
  const now = Date.now();
  const done = notifiedSet();
  for (const m of PoolState.data.matches) {
    if (!m.home_team || !m.away_team || m.finished) continue;
    const ko = new Date(m.kickoff).getTime();
    if (Number.isNaN(ko)) continue;
    const ms = ko - now;
    if (ms > 0 && ms <= REMIND_LEAD_MS && !done.has(m.id)) {
      const mins = Math.max(1, Math.round(ms / 60000));
      showLocalNotification(`⚽ Começa em ~${mins} min`, `${m.home_team} x ${m.away_team} — não esqueça seu palpite!`);
      markNotified(m.id);
    }
  }
}

function drawPoolShell() {
  const { data } = PoolState;
  const isAdmin = data.isAdmin;
  const tabs = [
    ['palpites', '🎯 Palpites'],
    ['desempenho', '📈 Desempenho'],
    ['partidas', '📅 Partidas'],
    ['chave', '🗝️ Chave'],
    ['ranking', '📊 Ranking'],
  ];
  if (isAdmin) tabs.push(['admin', '⚙️ Admin']);

  const prize = (data.participants.length * 50).toLocaleString('pt-BR');
  $('#app').innerHTML = `
    <section class="card hero">
      <h1>${esc(data.pool.name)}</h1>
      <p>👥 ${data.participants.length} participante(s) · 💰 R$ ${prize} em prêmios</p>
      <div class="hero-actions">
        <button id="btn-remind" class="btn-ghost btn-sm">🔔 Lembretes de jogos</button>
        <details class="scoring-info"><summary>ℹ️ Pontuação</summary>
          <div class="scoring-legend">
            <span>🎯 Placar exato: <b>${data.pool.scoring.pts_exact}</b></span>
            <span title="Só em jogos com vencedor — empate não conta saldo">↔️ Vencedor + saldo: <b>${data.pool.scoring.pts_goaldiff}</b></span>
            <span>✅ Vencedor/empate: <b>${data.pool.scoring.pts_outcome}</b></span>
            <span>🏆 Quem avança: <b>${data.pool.scoring.pts_advance}</b>/time</span>
          </div>
        </details>
      </div>
    </section>
    <div id="live-banner">${liveBannerHtml()}</div>
    <div class="tabs" id="tabs">
      ${tabs.map(([k, label]) => `<button data-tab="${k}" class="${PoolState.tab === k ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="tabview"></div>
  `;
  wireLiveCards($('#live-banner'));
  $('#tabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { PoolState.tab = b.dataset.tab; drawPoolShell(); };
  });
  refreshRemindBtn();
  const rb = $('#btn-remind'); if (rb) rb.onclick = toggleReminders;

  if (PoolState.tab === 'palpites') renderPalpites();
  else if (PoolState.tab === 'desempenho') renderDesempenho();
  else if (PoolState.tab === 'partidas') renderPartidas();
  else if (PoolState.tab === 'chave') renderBracket();
  else if (PoolState.tab === 'ranking') renderRanking();
  else if (PoolState.tab === 'admin') renderAdmin();
}

// ---------- aba: palpites ----------
const PREREQ_NAME = { r32: 'Fase de Grupos', r16: '16-avos', qf: 'Oitavas', sf: 'Quartas', third: 'Semifinais', final: 'Semifinais' };

// Jogos de um grupo com os placares atuais do rascunho (para a classificação ao vivo).
function draftGroupGames(g) {
  return PoolState.data.matches
    .filter((m) => m.stage === 'group' && m.group_label === g)
    .map((m) => {
      const d = PoolState.draft[m.id] || {};
      const h = (d.home === '' || d.home == null) ? null : Number(d.home);
      const a = (d.away === '' || d.away == null) ? null : Number(d.away);
      return { home_team: m.home_team, away_team: m.away_team, home_score: h, away_score: a };
    });
}

// Conjunto dos times que estão (na prévia atual) entre os 8 melhores 3ºs.
function qualifiedThirdsSet() {
  return new Set(thirdsRows().slice(0, 8).map((r) => r.team));
}

function standHtml(g, q3) {
  const t = groupTableJS(META.groups[g], draftGroupGames(g));
  q3 = q3 || qualifiedThirdsSet();
  const head = `<tr class="stand-head">
    <td class="pos" title="Posição">#</td><td class="tm">Seleção</td>
    <td class="n" title="Jogos">J</td><td class="n" title="Vitórias">V</td>
    <td class="n" title="Empates">E</td><td class="n" title="Derrotas">D</td>
    <td class="n" title="Gols pró">GP</td><td class="n" title="Gols contra">GC</td>
    <td class="n" title="Saldo de gols">SG</td><td class="n" title="Pontos">P</td>
  </tr>`;
  const body = t.map((r, i) => {
    const cls = i < 2 ? 'q1' : i === 2 ? 'q3' : 'qx';
    return `<tr class="${cls}">
      <td class="pos">${i + 1}</td>
      <td class="tm">${flag(r.team)}<span>${esc(r.team)}</span></td>
      <td class="n">${r.j}</td><td class="n">${r.v}</td><td class="n">${r.e}</td><td class="n">${r.d}</td>
      <td class="n">${r.gf}</td><td class="n">${r.ga}</td>
      <td class="n">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="n"><b>${r.pts}</b></td>
    </tr>`;
  }).join('');
  const third = t[2];
  const inThird = third && q3.has(third.team);
  const note = third ? `<div class="q3note ${inThird ? 'yes' : 'no'}">
    🥉 3º (${esc(third.team)}): <b>${inThird ? '✅ classificado' : '❌ não classificado'}</b></div>` : '';
  return `<table class="stand"><tbody>${head}${body}</tbody></table>${note}`;
}

// ---- prévia dos classificados (1º, 2º e 3º) ----
function posRows(idx) {
  return Object.keys(META.groups).map((g) => {
    const t = groupTableJS(META.groups[g], draftGroupGames(g));
    return { ...t[idx], group: g };
  });
}
function thirdsRows() {
  return posRows(2).sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || fifaRk(x.team) - fifaRk(y.team) || x.team.localeCompare(y.team));
}
function posListHtml(idx) {
  // 1º e 2º: todos classificam (lista por grupo A..L).
  return posRows(idx).map((r) => `<div class="third-row in">
    <span class="pos">${r.group}</span>
    <span class="tm">${flag(r.team)}<span>${esc(r.team)}</span></span>
    <span class="n">${r.pts} pts · ${r.gd > 0 ? '+' : ''}${r.gd}</span>
    <span class="qbadge">✅ passa</span>
  </div>`).join('');
}
function thirdsHtml() {
  return thirdsRows().map((r, i) => `<div class="third-row ${i < 8 ? 'in' : 'out'}">
    <span class="pos">${i + 1}</span>
    <span class="tm">${flag(r.team)}<span>${esc(r.team)}</span> <small>Grupo ${r.group}</small></span>
    <span class="n">${r.pts} pts · ${r.gd > 0 ? '+' : ''}${r.gd}</span>
    <span class="qbadge">${i < 8 ? '✅ passa' : '❌ fora'}</span>
  </div>`).join('');
}

// Recalcula TODAS as tabelas e listas (o corte dos 3ºs é global, muda entre grupos).
function refreshAll() {
  const q3 = qualifiedThirdsSet();
  for (const g of Object.keys(META.groups)) {
    const el = $(`#stand-${g}`);
    if (el) el.innerHTML = standHtml(g, q3);
  }
  const ids = { '#list-1': () => posListHtml(0), '#list-2': () => posListHtml(1), '#thirds-list': thirdsHtml };
  for (const [sel, fn] of Object.entries(ids)) { const el = $(sel); if (el) el.innerHTML = fn(); }
}

// Jogos rolando agora (já começaram e não terminaram) com placar e seu palpite.
function liveMatchesNow() {
  const now = Date.now();
  return (PoolState.data.matches || []).filter((m) => m.home_team && m.away_team && !m.finished && new Date(m.kickoff).getTime() <= now);
}
function liveBannerHtml() {
  const live = liveMatchesNow();
  if (!live.length) return '';
  return `<div class="card live-now-card">
    <h3><span class="live-dot"></span>Ao vivo agora</h3>
    <p class="muted" style="margin:-.2rem 0 .6rem">Toque num jogo pra ver a pontuação parcial da galera.</p>
    ${live.map(partidaCard).join('')}
  </div>`;
}
function wireLiveCards(container) {
  container.querySelectorAll('.pcard-head').forEach((h) => { h.onclick = () => togglePartida(h.closest('.pcard')); });
}
// Atualiza o bloco "ao vivo" sem re-renderizar a aba inteira. Se o conjunto de
// jogos ao vivo mudou, re-renderiza; senão, só atualiza placar e recarrega os
// painéis abertos (pra pontuação parcial acompanhar o placar).
function refreshLiveBanner() {
  const el = $('#live-banner');
  if (!el) return;
  const live = liveMatchesNow();
  const liveIds = live.map((m) => String(m.id));
  const existing = [...el.querySelectorAll('.pcard')].map((c) => c.dataset.matchId);
  const sameSet = liveIds.length === existing.length && liveIds.every((id) => existing.includes(id));
  if (!sameSet) { el.innerHTML = liveBannerHtml(); wireLiveCards(el); return; }
  for (const m of live) {
    const card = el.querySelector(`.pcard[data-match-id="${m.id}"]`);
    if (!card) continue;
    const info = card.querySelector('.pc-info');
    if (info) { info.className = `pc-info ${matchStatus(m).cls}`; info.innerHTML = matchInfoLine(m); }
    const panel = card.querySelector('.pcard-panel');
    if (panel && !panel.hidden) loadMatchPanel(card); // recarrega pontos parciais
  }
}

async function renderPalpites() {
  const view = $('#tabview');
  if (!PoolState.me) return renderAuth(view);

  view.innerHTML = `<div class="card center"><p>Carregando seus palpites…</p></div>`;
  let mine;
  try {
    mine = await api('GET', `/api/pools/${PoolState.slug}/me`, null, { 'x-participant-token': PoolState.me.token });
  } catch (e) {
    store.clearPart(PoolState.slug); PoolState.me = null;
    return renderAuth(view, e.message);
  }

  PoolState.draft = {};
  mine.predictions.forEach((p) => { PoolState.draft[p.match_id] = { home: p.home_score, away: p.away_score, points: p.points }; });
  PoolState.qsaved = {};
  mine.qualifiers.forEach((q) => { PoolState.qsaved[q.group_label] = q; });

  const matches = PoolState.data.matches;
  const locks = PoolState.data.stageLocks || {};
  const lock = PoolState.data.lock || { locked: false };
  PoolState.globalLocked = !!lock.locked;
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const groupKeys = Object.keys(META.groups);

  // jogos ainda abertos para palpite que estão sem placar preenchido
  const isOpenForPick = (m) => m.home_team && m.away_team && !m.finished && !m.locked && !locks[m.stage] && !lock.locked;
  const missing = matches.filter(isOpenForPick).filter((m) => {
    const d = PoolState.draft[m.id];
    return !d || d.home == null || d.home === '' || d.away == null || d.away === '';
  }).length;

  let html = `
    <div class="card">
      <div class="row" style="align-items:center">
        <div><b>👤 ${esc(mine.name)}</b> · <span class="pill pts">${mine.total} pts</span></div>
        <div style="text-align:right;flex:0"><button id="btn-logout" class="btn-soft btn-sm">Sair</button></div>
      </div>
      ${mine.lastSaved ? `<p class="muted save-stamp">💾 Último salvamento: ${esc(fmtDate(new Date(mine.lastSaved).toISOString()))}</p>` : ''}
      ${missing > 0 && !lock.locked ? `<p class="missing-hint">⚠️ Você tem <b>${missing}</b> jogo(s) abertos ainda sem palpite.</p>` : ''}
    </div>`;

  if (lock.locked) {
    html += `<div class="lock-banner">🔒 <b>Palpites travados.</b> O organizador fechou as apostas — não dá mais para editar os placares.</div>`;
  } else if (lock.lockAt) {
    html += `<div class="lock-banner open">⏳ Palpites abertos. Fecham automaticamente em <b>${esc(fmtDate(new Date(lock.lockAt).toISOString()))}</b> (5 min antes do 1º jogo), salvo se o organizador mudar.</div>`;
  }

  // ---- Nav lateral dos grupos (scroll horizontal) ----
  html += `<div class="group-nav" id="group-nav">
    ${groupKeys.map((g) => `<button class="gchip" data-goto="group-${g}">${g}</button>`).join('')}
  </div>`;

  // ---- Fase de grupos: 12 cards com classificação ao vivo + jogos ----
  html += `<h2 class="stage-title">${esc(META.stageNames.group || 'Fase de Grupos')}</h2>
    <p class="muted hint">Coloque os placares: a classificação de cada grupo se atualiza na hora. Os 2 primeiros + os 8 melhores 3ºs vão pro mata-mata. Vale <b>${PoolState.data.pool.scoring.pts_advance} pts</b> por seleção que você acertar.</p>
    <div class="group-grid">`;
  for (const g of groupKeys) {
    const q = PoolState.qsaved[g];
    const badge = q && q.points ? `<span class="pill pts">+${q.points}</span>` : '';
    html += `<div class="card group-card" id="group-${g}">
      <h3>Grupo ${g} ${badge}</h3>
      <div class="stand-wrap" id="stand-${g}">${standHtml(g)}</div>
      <div class="gmatches">
        ${matches.filter((m) => m.stage === 'group' && m.group_label === g).map(matchRow).join('')}
      </div>
    </div>`;
  }
  html += `</div>`;

  // ---- Prévia dos classificados (1º, 2º e 3º) ----
  const q1 = PoolState.qsaved; // tem points por grupo + __3__
  html += `<h2 class="stage-title">🏁 Classificados (prévia dos seus palpites)</h2>
    <div class="qual-cols">
      <div class="card">
        <h3>🥇 1º colocados</h3>
        <div class="thirds" id="list-1">${posListHtml(0)}</div>
      </div>
      <div class="card">
        <h3>🥈 2º colocados</h3>
        <div class="thirds" id="list-2">${posListHtml(1)}</div>
      </div>
      <div class="card">
        <h3>🥉 Melhores 3ºs ${q1['__3__'] && q1['__3__'].points ? `<span class="pill pts">+${q1['__3__'].points}</span>` : ''}</h3>
        <p class="muted">Os <b>8 melhores</b> entre os 12 grupos também passam.</p>
        <div class="thirds" id="thirds-list">${thirdsHtml()}</div>
      </div>
    </div>`;

  // ---- Mata-mata (travado por fase) ----
  for (const stage of ['r32', 'r16', 'qf', 'sf', 'third', 'final']) {
    const list = matches.filter((m) => m.stage === stage);
    if (!list.length) continue;
    html += `<h2 class="stage-title">${esc(META.stageNames[stage] || stage)}</h2>`;
    if (locks[stage]) {
      html += `<div class="card locked-stage">🔒 Libera para palpites quando <b>${PREREQ_NAME[stage] || 'a fase anterior'}</b> terminar.</div>`;
      continue;
    }
    let lastDay = '';
    for (const m of list) {
      const dk = dayKey(m.kickoff);
      if (dk !== lastDay) { html += `<div class="daygroup">📅 ${esc(dk)}</div>`; lastDay = dk; }
      html += matchRow(m);
    }
  }

  if (!lock.locked) {
    html += `<div class="sticky-save">
      <span class="muted" style="font-size:.8rem">Edite e salve seus palpites dos jogos ainda não iniciados.</span>
      <button id="btn-save" class="btn-gold">💾 Salvar palpites</button>
    </div>`;
  }

  view.innerHTML = html;

  $('#btn-logout').onclick = () => {
    store.clearPart(PoolState.slug);
    if (store.getHome() === PoolState.slug) store.clearHome();
    PoolState.me = null; drawPoolShell();
  };

  // nav dos grupos -> rola até o card
  view.querySelectorAll('.gchip').forEach((b) => {
    b.onclick = () => { const el = $('#' + b.dataset.goto); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  });

  // inputs de placar: só dígito, e pula pro próximo automaticamente
  const scoreInputs = [...view.querySelectorAll('input[data-match]')];
  scoreInputs.forEach((inp, idx) => {
    inp.oninput = () => {
      let v = inp.value.replace(/[^0-9]/g, '').slice(0, 1); // 1 dígito só
      inp.value = v;
      const id = inp.dataset.match, side = inp.dataset.side;
      PoolState.draft[id] = PoolState.draft[id] || {};
      PoolState.draft[id][side] = v === '' ? '' : Number(v);
      const m = matchById.get(Number(id));
      if (m && m.stage === 'group') refreshAll();
      if (v !== '' && scoreInputs[idx + 1]) { scoreInputs[idx + 1].focus(); scoreInputs[idx + 1].select(); }
    };
    inp.onfocus = () => inp.select();
  });

  const saveBtn = $('#btn-save');
  if (saveBtn) saveBtn.onclick = savePredictions;
}

// Limpa palpites no servidor (group=null -> tudo) e recarrega a aba.
async function clearPredictions(group) {
  try {
    const r = await api('POST', `/api/pools/${PoolState.slug}/predictions/clear`,
      group ? { group } : {}, { 'x-participant-token': PoolState.me.token });
    toast(`🧹 ${r.cleared || 0} palpite(s) apagado(s).`);
    renderPalpites();
  } catch (e) { toast(e.message, true); }
}

// Modal de confirmação simples (retorna Promise<boolean>).
function confirmModal(title, body) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal">
      <h3>${esc(title)}</h3>
      <p class="muted">${esc(body)}</p>
      <div class="row" style="margin-top:.8rem">
        <button class="btn-soft" data-no>Cancelar</button>
        <button class="btn-primary" data-yes style="background:var(--danger)">Apagar</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const close = (val) => { ov.remove(); resolve(val); };
    ov.querySelector('[data-no]').onclick = () => close(false);
    ov.querySelector('[data-yes]').onclick = () => close(true);
    ov.onclick = (e) => { if (e.target === ov) close(false); };
  });
}

function matchRow(m) {
  const d = PoolState.draft[m.id] || {};
  const tbdH = m.home_team == null, tbdA = m.away_team == null;
  const locked = m.locked || tbdH || tbdA || PoolState.globalLocked;
  const homeName = m.home_team ? `${flag(m.home_team)} <span>${esc(m.home_team)}</span>` : `<span class="tbd-team">${esc(m.home_label || 'A definir')}</span>`;
  const awayName = m.away_team ? `<span>${esc(m.away_team)}</span> ${flag(m.away_team)}` : `<span class="tbd-team">${esc(m.away_label || 'A definir')}</span>`;

  let center;
  if (tbdH || tbdA) {
    center = `<span class="pill tbd">A definir</span>`;
  } else if (locked) {
    const ph = d.home ?? '–', pa = d.away ?? '–';
    center = `<div class="scorebox"><b>${ph}</b><span class="vs">x</span><b>${pa}</b></div>`;
  } else {
    center = `<div class="scorebox">
      <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" enterkeyhint="next" data-match="${m.id}" data-side="home" value="${d.home ?? ''}" />
      <span class="vs">x</span>
      <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" enterkeyhint="next" data-match="${m.id}" data-side="away" value="${d.away ?? ''}" />
    </div>`;
  }

  let chip = '';
  if (m.finished) chip = `<span class="result-chip">Final: ${m.home_score} x ${m.away_score}</span>`;
  else if (m.locked && !tbdH && !tbdA) {
    chip = (m.home_score != null && m.away_score != null)
      ? `<span class="pill live">🔴 ao vivo: ${m.home_score} x ${m.away_score}</span>`
      : `<span class="pill live">⏱ em jogo/encerrado</span>`;
  }
  const ptsPill = (d.points != null && (m.finished || m.home_score != null)) ? `<span class="pill ${d.points ? 'pts' : ''}">${d.points} pts</span>` : '';

  return `<div class="match ${locked ? 'locked' : ''}">
    <div class="team home">${homeName}</div>
    ${center}
    <div class="team away">${awayName}</div>
    <div class="meta"><span>${esc(m.round_label)}</span><span>${chip} ${ptsPill}</span></div>
  </div>`;
}

async function savePredictions() {
  const predictions = Object.entries(PoolState.draft)
    .filter(([, v]) => v.home !== '' && v.away !== '' && v.home != null && v.away != null)
    .map(([matchId, v]) => ({ matchId: Number(matchId), home: v.home, away: v.away }));
  try {
    const r = await api('PUT', `/api/pools/${PoolState.slug}/predictions`,
      { predictions }, { 'x-participant-token': PoolState.me.token });
    toast(`✅ Salvo! ${r.saved} palpite(s).${r.skipped ? ` ${r.skipped} travado(s)/ignorado(s).` : ''}`);
    renderPalpites();
  } catch (e) { toast(e.message, true); }
}

// ---------- auth (join/login) ----------
function renderAuth(view, errMsg = '') {
  view.innerHTML = `
    <div class="card">
      <h3>Entrar no bolão</h3>
      ${errMsg ? `<p class="muted" style="color:var(--danger)">${esc(errMsg)}</p>` : ''}
      <p class="muted">Escolha um nome e um PIN. Use o mesmo PIN para voltar e editar seus palpites. Neste aparelho você fica logado.</p>
      <div class="spacer"></div>
      <div class="field"><label>Seu nome</label><input id="a-name" type="text" maxlength="30" placeholder="Como você aparece no ranking" /></div>
      <div class="field"><label>PIN (mín. 3 dígitos)</label><input id="a-pin" type="password" placeholder="Senha curta só sua" /></div>
      <div class="row">
        <button id="a-join" class="btn-primary">Entrar pela 1ª vez</button>
        <button id="a-login" class="btn-soft">Já participo</button>
      </div>
    </div>`;
  const creds = () => ({ name: $('#a-name').value.trim(), pin: $('#a-pin').value.trim() });
  const handle = async (endpoint) => {
    const { name, pin } = creds();
    try {
      const r = await api('POST', `/api/pools/${PoolState.slug}/${endpoint}`, { name, pin });
      store.setPart(PoolState.slug, { token: r.token, name: r.name });
      store.setHome(PoolState.slug); // login persistente: este vira o bolão "casa"
      PoolState.me = { token: r.token, name: r.name };
      toast(`Bem-vindo(a), ${r.name}! ⚽`);
      renderPalpites();
    } catch (e) { toast(e.message, true); }
  };
  $('#a-join').onclick = () => handle('join');
  $('#a-login').onclick = () => handle('login');
}

// ---------- aba: chave (bracket ampulheta) ----------
function bktTeamRow(team, label, score, win) {
  const flagHtml = team ? flag(team) : '<span class="flag flag-ph" aria-hidden="true"></span>';
  return `<div class="bkt-team ${team ? 'set' : ''} ${win ? 'win' : ''}">
    ${flagHtml}<span class="nm">${team ? esc(team) : esc(label || 'A definir')}</span>
    <span class="sc">${score == null ? '' : score}</span>
  </div>`;
}
function bktMatch(m, extra = '') {
  if (!m) return `<div class="bkt-match ${extra}">${bktTeamRow(null, 'A definir')}${bktTeamRow(null, 'A definir')}</div>`;
  const fin = m.finished && m.home_score != null && m.away_score != null;
  const hw = fin && m.home_score > m.away_score;
  const aw = fin && m.away_score > m.home_score;
  return `<div class="bkt-match ${fin ? 'done' : ''} ${extra}" title="${esc(m.round_label || '')}">
    ${bktTeamRow(m.home_team, m.home_label, m.home_score, hw)}
    ${bktTeamRow(m.away_team, m.away_label, m.away_score, aw)}
  </div>`;
}
function bktColHtml(list, side, header, id) {
  const boxes = list.length ? list.map((m) => bktMatch(m)).join('') : bktMatch(null);
  return `<div class="bkt-col side-${side}" id="${id}"><div class="bkt-col-h">${esc(header)}</div>${boxes}</div>`;
}

function renderBracket() {
  const view = $('#tabview');
  const prevWrap = $('#bracket-wrap');
  const prevScroll = prevWrap ? prevWrap.scrollLeft : null; // preserva scroll no auto-refresh
  const M = (PoolState.data && PoolState.data.matches) || [];
  const byStage = (s) => M.filter((m) => m.stage === s).sort((a, b) => a.ord - b.ord);
  const r32 = byStage('r32'), r16 = byStage('r16'), qf = byStage('qf'), sf = byStage('sf');
  const third = byStage('third'), final = byStage('final');
  const half = (a) => { const k = Math.ceil(a.length / 2); return [a.slice(0, k), a.slice(k)]; };
  const [r32L, r32R] = half(r32), [r16L, r16R] = half(r16), [qfL, qfR] = half(qf), [sfL, sfR] = half(sf);

  // campeão (se a final terminou)
  let champ = '';
  const f = final[0];
  if (f && f.finished && f.home_score != null && f.away_score != null && f.home_score !== f.away_score) {
    const c = f.home_score > f.away_score ? f.home_team : f.away_team;
    if (c) champ = `<div class="champion">🏆 Campeão: ${flag(c)} <span>${esc(c)}</span></div>`;
  }

  const koFilled = M.filter((m) => m.stage !== 'group' && m.home_team && m.away_team).length;
  const koTotal = M.filter((m) => m.stage !== 'group').length;

  const center = `<div class="bkt-col bkt-center" id="bkt-c4">
    <div class="bkt-col-h">Final</div>
    ${bktMatch(final[0], 'bkt-final-box')}
    <div class="bkt-label">Disputa do 3º lugar</div>
    ${bktMatch(third[0])}
  </div>`;

  const cols = [
    bktColHtml(r32L, 'l', '16-avos', 'bkt-c0'),
    bktColHtml(r16L, 'l', 'Oitavas', 'bkt-c1'),
    bktColHtml(qfL, 'l', 'Quartas', 'bkt-c2'),
    bktColHtml(sfL, 'l', 'Semi', 'bkt-c3'),
    center,
    bktColHtml(sfR, 'r', 'Semi', 'bkt-c5'),
    bktColHtml(qfR, 'r', 'Quartas', 'bkt-c6'),
    bktColHtml(r16R, 'r', 'Oitavas', 'bkt-c7'),
    bktColHtml(r32R, 'r', '16-avos', 'bkt-c8'),
  ].join('');

  const navLabels = ['16-avos', 'Oitavas', 'Quartas', 'Semi', '🏆 Final', 'Semi', 'Quartas', 'Oitavas', '16-avos'];

  view.innerHTML = `
    <div class="card">
      <h3>🗝️ Chave do mata-mata</h3>
      <p class="muted bracket-intro">Monta-se rodada a rodada conforme os times se classificam (${koFilled}/${koTotal} confrontos definidos). Arraste para os lados para navegar.${PoolState.data.syncEnabled ? ' <span class="live-dot"></span>atualiza sozinho.' : ''}</p>
      ${champ}
      <div class="bracket-nav">
        ${navLabels.map((l, i) => `<button data-bkt="bkt-c${i}">${esc(l)}</button>`).join('')}
      </div>
      <div class="bracket-wrap" id="bracket-wrap">
        <div class="bracket">${cols}</div>
      </div>
    </div>`;

  view.querySelectorAll('[data-bkt]').forEach((b) => {
    b.onclick = () => { const el = $('#' + b.dataset.bkt); if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); };
  });
  // mantém o scroll no auto-refresh; na 1ª vez, centraliza na final
  const wrap = $('#bracket-wrap');
  const c4 = $('#bkt-c4');
  if (wrap && c4) {
    wrap.scrollLeft = prevScroll != null ? prevScroll
      : Math.max(0, c4.offsetLeft - (wrap.clientWidth - c4.clientWidth) / 2);
  }
}

// ---------- aba: ranking ----------
function moveBadge(delta) {
  if (delta > 0) return `<span class="move up">▲${delta}</span>`;
  if (delta < 0) return `<span class="move down">▼${-delta}</span>`;
  return `<span class="move flat">–</span>`;
}

// Pódio animado dos 3 primeiros (ordem visual: 2º, 1º, 3º).
function podiumHtml(board, meName) {
  if (!board.length) return '';
  const top = board.slice(0, 3);
  while (top.length < 3) top.push(null); // preenche pra manter o layout
  const order = [{ r: 2, h: 'pod-2' }, { r: 1, h: 'pod-1' }, { r: 3, h: 'pod-3' }];
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const cols = order.map(({ r, h }) => {
    const p = top[r - 1];
    if (!p) return `<div class="pod-col ${h} empty"><div class="pod-bar"><span class="pod-pos">${r}º</span></div></div>`;
    return `<div class="pod-col ${h}" data-name="${esc(p.name)}">
      <div class="pod-person">
        ${avatarImg(p.avatar, p.name, 'av pod-av')}
        <div class="pod-name ${p.name === meName ? 'me' : ''}">${esc(p.name)}</div>
        <div class="pod-pts">${p.total} pts</div>
      </div>
      <div class="pod-bar"><span class="pod-medal">${medal[r]}</span><span class="pod-pos">${r}º</span></div>
    </div>`;
  }).join('');
  return `<div class="card podium-card"><h3>🏆 Pódio</h3><div class="podium">${cols}</div></div>`;
}

// Cor (matiz) estável por nome, pra cada cavalo ter sua cor.
function horseHue(name) {
  let h = 0; const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
// Cavalo cartunizado (SVG inline) com a foto do participante como jóquei.
function horseSvg(r) {
  const h = horseHue(r.name);
  return `<div class="horse" style="--c:hsl(${h} 55% 50%);--cd:hsl(${h} 48% 34%)">
    <svg class="horse-svg" viewBox="0 0 96 64" aria-hidden="true">
      <path class="tail" d="M16 26 Q3 30 6 48 Q11 38 17 40 Q12 31 22 31 Z" fill="var(--cd)"/>
      <rect class="leg leg-b" x="24" y="38" width="6" height="20" rx="3" fill="var(--cd)"/>
      <rect class="leg leg-a" x="56" y="38" width="6" height="20" rx="3" fill="var(--cd)"/>
      <ellipse class="body" cx="44" cy="30" rx="26" ry="14" fill="var(--c)"/>
      <rect class="leg leg-a" x="32" y="38" width="6" height="20" rx="3" fill="var(--c)"/>
      <rect class="leg leg-b" x="62" y="38" width="6" height="20" rx="3" fill="var(--c)"/>
      <path class="neck" d="M60 24 Q70 18 75 8 L84 12 Q80 24 70 32 Z" fill="var(--c)"/>
      <path class="head" d="M74 6 Q89 7 91 19 Q91 25 83 24 L74 19 Q71 10 74 6 Z" fill="var(--c)"/>
      <path class="ear" d="M76 6 L77 -1 L81 6 Z" fill="var(--cd)"/>
      <path class="mane" d="M60 24 Q69 14 75 7 L71 6 Q62 15 56 25 Z" fill="var(--cd)"/>
      <circle cx="84" cy="14" r="1.5" fill="#15110c"/>
      <ellipse cx="90" cy="21" rx="2.4" ry="2" fill="var(--cd)"/>
    </svg>
    <span class="jockey">${avatarImg(r.avatar, r.name, 'av')}</span>
  </div>`;
}

// Bandeira do Vasco (SVG inline, baseada na oficial: faixa diagonal, cruz de
// malta e as 8 estrelas douradas) — vai pro lanterna da corrida. 😂
function vascoSvg() {
  const star = (x, y) => `<text x="${x}" y="${y}" font-size="4.6" fill="#f5c542" text-anchor="middle">★</text>`;
  const stars = [25.5, 29.5, 33.5, 37.5].map((x) => star(x, 6.2) + star(x, 11.4)).join('');
  return `<svg viewBox="0 0 42 27" class="vasco-svg">
    <rect width="42" height="27" fill="#000"/>
    <polygon points="0,27 10,27 42,1.5 32,1.5" fill="#fff"/>
    <g fill="#d22730">
      <path d="M21 13.5 L16.2 7.6 L25.8 7.6 Z"/>
      <path d="M21 13.5 L16.2 19.4 L25.8 19.4 Z"/>
      <path d="M21 13.5 L14.6 8.7 L14.6 18.3 Z"/>
      <path d="M21 13.5 L27.4 8.7 L27.4 18.3 Z"/>
    </g>
    ${stars}
  </svg>`;
}

// Frames da corrida: posição na pista (x = pts/líder), colocação (raia) e pontos
// de cada participante a cada rodada do histórico.
function buildRaceFrames(rounds, board) {
  const names = board.map((b) => b.name);
  const dateLabel = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); } catch (_) { return d; } };
  const xOf = (total, max) => Math.min(0.92, Math.max(0.04, total / Math.max(1, max)));
  const frames = [{ label: 'Largada', pos: Object.fromEntries(names.map((n, i) => [n, { x: 0.04, rank: i + 1, pts: 0 }])) }];
  for (const rd of (rounds || [])) {
    const max = Math.max(1, ...rd.board.map((b) => b.total));
    const pos = {};
    for (const b of rd.board) if (names.includes(b.name)) pos[b.name] = { x: xOf(b.total, max), rank: b.rank, pts: b.total };
    for (const n of names) if (!pos[n]) pos[n] = frames[frames.length - 1].pos[n]; // entrou depois: mantém
    frames.push({ label: dateLabel(rd.date), pos });
  }
  if (frames.length === 1) { // sem histórico ainda: largada -> posição atual
    const max = Math.max(1, board[0].total);
    frames.push({ label: 'Agora', pos: Object.fromEntries(board.map((b, i) => [b.name, { x: xOf(b.total, max), rank: i + 1, pts: b.total }])) });
  }
  return frames;
}

// "Corrida pelo título": refaz a disputa rodada a rodada. Cada participante num
// cavalo; raia = colocação (ultrapassagem troca de raia), avanço = pontos.
const RACE_LANE_H = 56;
const RACE_STEP_MS = 1900;
function raceChartHtml(rounds, board, meName) {
  if (!board || board.length < 2) return '';
  PoolState.race = { frames: buildRaceFrames(rounds, board), meName };
  const H = board.length * RACE_LANE_H + 4;
  return `<div class="card race-card">
    <h3>🏇 Corrida pelo título</h3>
    <p class="muted">A corrida refaz a disputa rodada a rodada — cada troca de raia é uma ultrapassagem no ranking. O lanterna carrega a bandeira do Vasco. 😜</p>
    <div class="race-head">
      <span class="muted" id="race-day"></span>
      <div class="race-controls">
        <input type="range" id="race-slider" min="0" max="${PoolState.race.frames.length - 1}" step="1" value="0" aria-label="Rodada" />
        <button class="btn-soft btn-sm" id="race-replay">▶ Replay</button>
      </div>
    </div>
    <div class="track" id="race-track" style="height:${H}px">
      <span class="track-flag">🏁</span>
      ${board.map((_, i) => `<div class="lane-bg" style="top:${i * RACE_LANE_H + 4}px;height:${RACE_LANE_H - 8}px"></div>`).join('')}
      ${board.map((r, i) => `<div class="runner ${r.name === meName ? 'me' : ''}" data-name="${esc(r.name)}" style="top:${i * RACE_LANE_H}px">
        ${horseSvg(r)}
        <span class="vasco" hidden title="Lanterna 🤣">${vascoSvg()}</span>
        <span class="runner-tag rt"></span>
      </div>`).join('')}
    </div>
  </div>`;
}

let RACE_TIMER = null;
function raceApplyFrame(fi, animate = true) {
  const race = PoolState.race; const track = $('#race-track');
  if (!race || !track) return;
  const f = race.frames[fi], prev = race.frames[fi - 1];
  const day = $('#race-day');
  if (day) day.textContent = fi === 0 ? '🚩 Largada' : `📅 ${f.label} · rodada ${fi}/${race.frames.length - 1}`;
  const slider = $('#race-slider'); if (slider) slider.value = fi;
  // lanterna deste frame (leva a bandeira do Vasco)
  let worst = null;
  for (const n of Object.keys(f.pos)) if (!worst || f.pos[n].rank > f.pos[worst].rank) worst = n;
  if (!animate) track.classList.add('notrans');
  track.querySelectorAll('.runner').forEach((el) => {
    const name = el.dataset.name, e = f.pos[name];
    if (!e) return;
    el.style.top = ((e.rank - 1) * RACE_LANE_H) + 'px';
    el.style.left = `calc(${e.x.toFixed(3)} * (100% - 96px))`;
    const overtook = animate && prev && prev.pos[name] && prev.pos[name].rank > e.rank;
    el.classList.toggle('overtake', !!overtook);
    const v = el.querySelector('.vasco'); if (v) v.hidden = name !== worst;
    const tag = el.querySelector('.rt');
    if (tag) tag.textContent = `${e.rank}º ${name}${name === race.meName ? ' (você)' : ''} · ${e.pts}`;
  });
  if (!animate) { void track.offsetWidth; track.classList.remove('notrans'); }
}
function playRace() {
  const race = PoolState.race; const track = $('#race-track');
  if (!race || !track) return;
  clearTimeout(RACE_TIMER);
  track.classList.remove('scrub');
  raceApplyFrame(0, false);
  const step = (fi) => {
    raceApplyFrame(fi, true);
    if (fi < race.frames.length - 1) RACE_TIMER = setTimeout(() => step(fi + 1), RACE_STEP_MS);
    else PoolState.racePlayed = true;
  };
  RACE_TIMER = setTimeout(() => step(1), 700);
}

async function renderRanking() {
  const view = $('#tabview');
  view.innerHTML = `<div class="card center"><p>Carregando ranking…</p></div>`;
  try {
    const [{ leaderboard }, hist] = await Promise.all([
      api('GET', `/api/pools/${PoolState.slug}/leaderboard`),
      api('GET', `/api/pools/${PoolState.slug}/history`).catch(() => ({ rounds: [] })),
    ]);
    const meName = PoolState.me?.name;
    if (!leaderboard.length) {
      view.innerHTML = `<div class="card center"><h3>Ainda não há participantes 🙃</h3><p class="muted">Compartilhe o link do bolão!</p></div>`;
      return;
    }

    // mapa de movimento (do último "matchday" do histórico)
    const rounds = hist.rounds || [];
    const last = rounds[rounds.length - 1];
    const deltaByName = new Map((last?.board || []).map((r) => [r.name, r.delta]));
    const hasMoves = rounds.length >= 2;

    // aproveitamento: pontos de jogos ÷ máximo possível nos jogos já encerrados
    const finishedCount = (PoolState.data.matches || []).filter((m) => m.finished).length;
    const maxSoFar = finishedCount * (PoolState.data.pool.scoring.pts_exact || 10);
    const aprov = (r) => maxSoFar ? Math.round((r.match_pts / maxSoFar) * 100) + '%' : '—';

    const table = `<div class="card"><h3>📊 Classificação</h3>
      <p class="muted tiebreak-note">Empate em pontos? Desempata por <b>mais placares exatos</b>. Toque num nome para comparar com você.</p>
      <div class="board-wrap"><table class="board"><thead><tr>
        <th class="num">#</th>${hasMoves ? '<th class="num" title="Variação na última rodada">↕</th>' : ''}<th>Participante</th>
        <th class="num">Jogos</th><th class="num" title="Pontos conquistados ÷ máximo possível nos jogos encerrados">Aproveit.</th><th class="num">Exatos</th><th class="num">Total</th>
      </tr></thead><tbody>
      ${leaderboard.map((r, i) => `<tr class="${r.name === meName ? 'me' : ''} board-row" data-name="${esc(r.name)}">
        <td class="rank ${i < 3 ? 'top' + (i + 1) : ''}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</td>
        ${hasMoves ? `<td class="num">${moveBadge(deltaByName.get(r.name) ?? 0)}</td>` : ''}
        <td><span class="name-cell">${avatarImg(r.avatar, r.name, 'av rk')}<span class="nm">${esc(r.name)}${r.name === meName ? ' <span class="muted">(você)</span>' : ''}</span></span></td>
        <td class="num">${r.match_pts}</td><td class="num">${aprov(r)}</td>
        <td class="num">${r.exatos}</td><td class="num"><b>${r.total}</b></td>
      </tr>`).join('')}
      </tbody></table></div></div>`;

    view.innerHTML = podiumHtml(leaderboard, meName) + table + historyFeedHtml(rounds)
      + raceChartHtml(rounds, leaderboard, meName) + tiebreakHtml();

    view.querySelectorAll('.board-row').forEach((tr) => {
      tr.onclick = () => openCompare(tr.dataset.name);
    });
    // dispara a animação do pódio no próximo frame
    requestAnimationFrame(() => view.querySelectorAll('.pod-col').forEach((c) => c.classList.add('rise')));
    // corrida: roda 1x por visita; depois (e nos refreshes do polling) fica no
    // estado final pra não reiniciar sozinha — replay manual no botão.
    const rp = $('#race-replay');
    if (rp) rp.onclick = playRace;
    // slider: controla a corrida manualmente, rodada a rodada (pausa o autoplay)
    const rs = $('#race-slider');
    if (rs) rs.oninput = () => {
      clearTimeout(RACE_TIMER);
      PoolState.racePlayed = true;
      const tk = $('#race-track'); if (tk) tk.classList.add('scrub'); // transição curta no arrasto
      raceApplyFrame(Number(rs.value), true);
    };
    if ($('#race-track')) {
      if (PoolState.racePlayed) raceApplyFrame(PoolState.race.frames.length - 1, false);
      else requestAnimationFrame(() => playRace());
    }
  } catch (e) { view.innerHTML = `<div class="card center">${esc(e.message)}</div>`; }
}

// Feed "como o ranking mexeu" — usa as 2 últimas rodadas do histórico.
function historyFeedHtml(rounds) {
  if (!rounds || rounds.length < 2) {
    return `<div class="card"><h3>📜 Histórico</h3><p class="muted">O histórico de subidas e quedas aparece aqui depois de pelo menos dois dias de jogos encerrados.</p></div>`;
  }
  const last = rounds[rounds.length - 1];
  const movers = [...last.board].filter((r) => r.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8);
  const dateLabel = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); } catch (_) { return d; } };
  let feed;
  if (!movers.length) {
    feed = `<p class="muted">Ninguém mudou de posição na última rodada (${esc(dateLabel(last.date))}).</p>`;
  } else {
    feed = `<div class="move-feed">${movers.map((r) => `
      <div class="move-item ${r.delta > 0 ? 'up' : 'down'}">
        ${moveBadge(r.delta)} <b>${esc(r.name)}</b>
        <span class="muted">${r.delta > 0 ? 'subiu' : 'caiu'} para ${r.rank}º · ${r.total} pts</span>
      </div>`).join('')}</div>`;
  }
  // mini-trajetória: posição de cada um ao longo dos dias (texto compacto)
  return `<div class="card"><h3>📜 Histórico — última rodada (${esc(dateLabel(last.date))})</h3>${feed}</div>`;
}

// Card explicando os critérios de desempate (ranking geral + classificação dos grupos).
function tiebreakHtml() {
  return `<div class="card tiebreak-card">
    <h3>⚖️ Critérios de desempate</h3>
    <div class="tb-block">
      <h4>🏅 No ranking geral (entre participantes)</h4>
      <ol class="tb-list">
        <li><b>Pontos totais</b> (palpites + quem avança).</li>
        <li><b>Mais placares exatos</b> 🎯 — quem cravou mais resultados na mosca sobe.</li>
        <li>Ordem alfabética (só pra não ficar indefinido).</li>
      </ol>
    </div>
    <div class="tb-block">
      <h4>🥇 Na classificação dos grupos (define quem avança)</h4>
      <p class="muted">Seguimos as regras oficiais da FIFA para a Copa de 2026:</p>
      <ol class="tb-list">
        <li><b>Pontos</b> na fase de grupos.</li>
        <li><b>Confronto direto</b> entre os empatados: pontos → saldo de gols → gols marcados <i>só nos jogos entre eles</i>.</li>
        <li>Persistindo o empate, critérios gerais: <b>saldo de gols</b> → <b>gols marcados</b> no grupo todo.</li>
        <li>Por fim, <b>ranking mundial da FIFA</b> como desempate final.</li>
      </ol>
      <p class="muted tb-foot">Os <b>8 melhores 3ºs colocados</b> entre os 12 grupos são ordenados por pontos → saldo → gols → ranking FIFA.</p>
    </div>
  </div>`;
}

// Modal de comparação: seus palpites vs. os de outro participante (só jogos já iniciados).
async function openCompare(name) {
  const meName = PoolState.me?.name;
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal cmp-modal"><p class="center muted">Carregando comparação…</p></div>`;
  document.body.appendChild(ov);
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };

  try {
    const reqs = [api('GET', `/api/pools/${PoolState.slug}/participants/${encodeURIComponent(name)}`)];
    if (meName && meName !== name) reqs.push(api('GET', `/api/pools/${PoolState.slug}/participants/${encodeURIComponent(meName)}`));
    const [them, me] = await Promise.all(reqs);

    const matchById = new Map((PoolState.data.matches || []).map((m) => [m.id, m]));
    const theirs = new Map(them.predictions.map((p) => [p.match_id, p]));
    const mine = me ? new Map(me.predictions.map((p) => [p.match_id, p])) : null;

    // jogos a mostrar: união dos palpites já iniciados, ordenados por kickoff desc
    const ids = new Set([...theirs.keys(), ...(mine ? mine.keys() : [])]);
    const rows = [...ids]
      .map((id) => matchById.get(id)).filter(Boolean)
      .filter((m) => m.home_team && m.away_team)
      .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

    let myPts = 0, theirPts = 0;
    const body = rows.map((m) => {
      const tp = theirs.get(m.id), mp = mine ? mine.get(m.id) : null;
      if (tp) theirPts += tp.points || 0;
      if (mp) myPts += mp.points || 0;
      const real = m.finished && m.home_score != null ? `${m.home_score}–${m.away_score}` : (m.home_score != null ? `${m.home_score}–${m.away_score}` : '—');
      const pick = (p) => p ? `${p.home_score}–${p.away_score}${(m.finished && p.points != null) ? ` <span class="cmp-pts ${p.points ? 'pos' : ''}">+${p.points}</span>` : ''}` : '<span class="muted">—</span>';
      return `<tr>
        <td class="cmp-game">${flag(m.home_team)}<span class="cmp-x">×</span>${flag(m.away_team)}<div class="cmp-real">${esc(real)}</div></td>
        ${mine ? `<td class="num">${pick(mp)}</td>` : ''}
        <td class="num">${pick(tp)}</td>
      </tr>`;
    }).join('');

    ov.querySelector('.cmp-modal').innerHTML = `
      <div class="row" style="align-items:center;justify-content:space-between">
        <h3 style="margin:0">⚔️ Comparação</h3>
        <button class="btn-soft btn-sm" data-close>Fechar</button>
      </div>
      ${mine ? `<p class="cmp-tally">Nos jogos já liberados: <b>${meName}</b> ${myPts} × ${theirPts} <b>${esc(name)}</b> ${myPts > theirPts ? '🟢' : myPts < theirPts ? '🔴' : '🤝'}</p>` : `<p class="muted">Entre no bolão para comparar com seus palpites.</p>`}
      ${rows.length ? `<div class="board-wrap"><table class="board cmp-table"><thead><tr>
        <th>Jogo / resultado</th>${mine ? `<th class="num">${esc(meName)}</th>` : ''}<th class="num">${esc(name)}</th>
      </tr></thead><tbody>${body}</tbody></table></div>`
        : `<p class="muted">Ainda não há jogos liberados para comparar (liberam 2h antes do início).</p>`}`;
    ov.querySelector('[data-close]').onclick = () => ov.remove();
  } catch (e) {
    ov.querySelector('.cmp-modal').innerHTML = `<p class="center">${esc(e.message)}</p>
      <div class="center" style="margin-top:.6rem"><button class="btn-soft" data-close>Fechar</button></div>`;
    ov.querySelector('[data-close]').onclick = () => ov.remove();
  }
}

// ---------- aba: desempenho (palpites vs resultado) ----------
function pickReason(pred, m, scoring) {
  if (!pred) return { label: 'sem palpite', cls: 'miss', icon: '➖' };
  const ph = pred.home_score, pa = pred.away_score, rh = m.home_score, ra = m.away_score;
  if (ph === rh && pa === ra) return { label: `placar exato +${scoring.pts_exact}`, cls: 'exact', icon: '🎯' };
  if (Math.sign(ph - pa) !== Math.sign(rh - ra)) return { label: 'errou', cls: 'wrong', icon: '❌' };
  if (rh === ra) return { label: `acertou o empate +${scoring.pts_outcome}`, cls: 'out', icon: '🤝' };
  if (ph - pa === rh - ra) return { label: `vencedor + saldo +${scoring.pts_goaldiff}`, cls: 'gd', icon: '↔️' };
  return { label: `vencedor +${scoring.pts_outcome}`, cls: 'out', icon: '✅' };
}

async function renderDesempenho() {
  const view = $('#tabview');
  if (!PoolState.me) {
    view.innerHTML = `<div class="card center"><h3>📈 Desempenho</h3>
      <p class="muted">Entre no bolão para acompanhar seus acertos jogo a jogo.</p>
      <button class="btn-primary" id="go-palpites">Ir para Meus palpites</button></div>`;
    const b = $('#go-palpites'); if (b) b.onclick = () => { PoolState.tab = 'palpites'; drawPoolShell(); };
    return;
  }

  view.innerHTML = `<div class="card center"><p>Carregando seu desempenho…</p></div>`;
  let mine;
  try {
    mine = await api('GET', `/api/pools/${PoolState.slug}/me`, null, { 'x-participant-token': PoolState.me.token });
  } catch (e) {
    store.clearPart(PoolState.slug); PoolState.me = null;
    view.innerHTML = `<div class="card center">${esc(e.message)}</div>`;
    return;
  }

  const scoring = PoolState.data.pool.scoring;
  const matches = PoolState.data.matches || [];
  const locks = PoolState.data.stageLocks || {};
  const globalLocked = !!(PoolState.data.lock && PoolState.data.lock.locked);
  const preds = new Map(mine.predictions.map((p) => [p.match_id, p]));
  const now = Date.now();

  const finished = matches.filter((m) => m.finished && m.home_score != null).sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));
  const live = matches.filter((m) => !m.finished && new Date(m.kickoff).getTime() <= now && m.home_team && m.away_team);
  const isOpenForPick = (m) => m.home_team && m.away_team && !m.finished && new Date(m.kickoff).getTime() > now && !locks[m.stage] && !globalLocked;
  const missing = matches.filter(isOpenForPick).filter((m) => !preds.has(m.id));

  // métricas
  let exatos = 0, ptsGames = 0, maxGames = 0, acertos = 0;
  for (const m of finished) {
    const p = preds.get(m.id);
    maxGames += scoring.pts_exact;
    if (p) {
      ptsGames += p.points || 0;
      if (p.points > 0) acertos++;
      if (p.home_score === m.home_score && p.away_score === m.away_score) exatos++;
    }
  }
  const qualPts = mine.qualifiers.reduce((s, q) => s + q.points, 0);
  const aprov = maxGames ? Math.round((ptsGames / maxGames) * 100) : 0;
  const withPick = finished.filter((m) => preds.has(m.id)).length;

  let html = `
    <div class="card">
      <div class="row" style="align-items:center">
        <div><b>📈 ${esc(mine.name)}</b></div>
        <div style="text-align:right;flex:0"><button class="btn-soft btn-sm" id="btn-share">📸 Compartilhar</button></div>
      </div>
      <div class="perf-grid">
        <div class="perf-stat"><span class="pv">${mine.total}</span><span class="pl">Pontos</span></div>
        <div class="perf-stat"><span class="pv">🎯 ${exatos}</span><span class="pl">Placares exatos</span></div>
        <div class="perf-stat"><span class="pv">${acertos}/${withPick}</span><span class="pl">Jogos pontuados</span></div>
        <div class="perf-stat"><span class="pv">${aprov}%</span><span class="pl">Aproveitamento</span></div>
        <div class="perf-stat"><span class="pv">🏆 ${qualPts}</span><span class="pl">Quem avança</span></div>
      </div>
    </div>`;

  if (live.length) {
    html += `<div class="card live-card"><h3><span class="live-dot"></span>Ao vivo / em jogo agora</h3>
      ${live.map((m) => {
        const p = preds.get(m.id);
        const real = m.home_score != null ? `${m.home_score} x ${m.away_score}` : '—';
        return `<div class="perf-row live">
          <div class="pr-game">${flag(m.home_team)} ${esc(m.home_team)} <span class="cmp-x">×</span> ${esc(m.away_team)} ${flag(m.away_team)}</div>
          <div class="pr-mid"><span class="pill live">${real}</span></div>
          <div class="pr-pick">${p ? `seu: <b>${p.home_score} x ${p.away_score}</b>` : '<span class="muted">sem palpite</span>'}</div>
        </div>`;
      }).join('')}</div>`;
  }

  if (missing.length && !globalLocked) {
    html += `<div class="card missing-card"><h3>⚠️ Palpites faltando (${missing.length})</h3>
      <p class="muted">Jogos abertos que você ainda não palpitou:</p>
      <div class="miss-list">${missing.slice(0, 12).map((m) => `<span class="miss-chip">${flag(m.home_team)} ${esc(m.home_team)} × ${esc(m.away_team)} ${flag(m.away_team)}</span>`).join('')}</div>
      ${missing.length > 12 ? `<p class="muted">…e mais ${missing.length - 12}.</p>` : ''}
      <button class="btn-soft btn-sm" id="go-fill">Ir palpitar</button></div>`;
  }

  if (finished.length) {
    html += `<div class="card"><h3>🧾 Palpites × Resultado</h3>
      <div class="perf-list">${finished.map((m) => {
        const p = preds.get(m.id);
        const r = pickReason(p, m, scoring);
        return `<div class="perf-row">
          <div class="pr-game">${flag(m.home_team)} ${esc(m.home_team)} <span class="cmp-x">×</span> ${esc(m.away_team)} ${flag(m.away_team)}
            <div class="muted pr-date">${esc(m.round_label || '')}</div></div>
          <div class="pr-mid">
            <span class="pr-real">${m.home_score} x ${m.away_score}</span>
            <span class="pr-yours">${p ? `${p.home_score} x ${p.away_score}` : '—'}</span>
          </div>
          <div class="pr-pick"><span class="reason ${r.cls}">${r.icon} ${esc(r.label)}</span></div>
        </div>`;
      }).join('')}</div></div>`;
  } else {
    html += `<div class="card center"><p class="muted">Nenhum jogo encerrado ainda. Seu placar exato e aproveitamento aparecem aqui conforme a Copa rola.</p></div>`;
  }

  view.innerHTML = html;
  const sh = $('#btn-share'); if (sh) sh.onclick = () => shareCard({ name: mine.name, total: mine.total, exatos, aprov, qualPts, poolName: PoolState.data.pool.name });
  const gf = $('#go-fill'); if (gf) gf.onclick = () => { PoolState.tab = 'palpites'; drawPoolShell(); };
}

// Gera um card (imagem) com o resumo do participante para mandar no grupo.
async function shareCard(s) {
  const W = 1080, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0c6e38'); grad.addColorStop(0.55, '#075c2c'); grad.addColorStop(1, '#043d1d');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(60, 60, W - 120, H - 120);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffcb05'; ctx.font = 'bold 54px Segoe UI, system-ui, sans-serif';
  ctx.fillText('⚽ BOLÃO DA COPA 2026', W / 2, 170);
  ctx.fillStyle = '#e9f1ec'; ctx.font = '34px Segoe UI, system-ui, sans-serif';
  ctx.fillText(s.poolName.slice(0, 38), W / 2, 230);

  ctx.fillStyle = '#fff'; ctx.font = 'bold 76px Segoe UI, system-ui, sans-serif';
  ctx.fillText(s.name.slice(0, 22), W / 2, 380);

  ctx.fillStyle = '#ffcb05'; ctx.font = 'bold 200px Segoe UI, system-ui, sans-serif';
  ctx.fillText(String(s.total), W / 2, 640);
  ctx.fillStyle = '#cfe9d9'; ctx.font = '40px Segoe UI, system-ui, sans-serif';
  ctx.fillText('PONTOS', W / 2, 710);

  const stats = [['🎯 Exatos', s.exatos], ['📈 Aproveit.', s.aprov + '%'], ['🏆 Avanço', s.qualPts]];
  const bw = 280, gap = 30, totalW = bw * 3 + gap * 2, x0 = (W - totalW) / 2, y = 800;
  stats.forEach(([label, val], i) => {
    const x = x0 + i * (bw + gap);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(ctx, x, y, bw, 180, 22); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 64px Segoe UI, system-ui, sans-serif';
    ctx.fillText(String(val), x + bw / 2, y + 90);
    ctx.fillStyle = '#cfe9d9'; ctx.font = '30px Segoe UI, system-ui, sans-serif';
    ctx.fillText(label, x + bw / 2, y + 140);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '28px Segoe UI, system-ui, sans-serif';
  ctx.fillText('bolaodobonde.vercel.app', W / 2, 1030);

  cv.toBlob(async (blob) => {
    if (!blob) return toast('Não consegui gerar a imagem.', true);
    const file = new File([blob], 'meu-bolao.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Meu bolão da Copa 2026' }); return; } catch (_) { /* cancelou */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'meu-bolao.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('📸 Card salvo! Mande no grupo.');
  }, 'image/png');
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- aba: partidas (lista + palpites por jogo) ----------
const STAGE_ICON = { group: '⚽', r32: '🏟️', r16: '🔥', qf: '⭐', sf: '🌟', third: '🥉', final: '🏆' };

function matchStatus(m) {
  const started = m.finished || m.locked || new Date(m.kickoff).getTime() <= Date.now();
  if (m.finished) return { cls: 'done', pill: `<span class="pill done">✅ ${m.home_score} x ${m.away_score}</span>` };
  if (started && m.home_score != null) return { cls: 'live', pill: `<span class="pill live"><span class="live-dot"></span>${m.home_score} x ${m.away_score}</span>` };
  if (started) return { cls: 'live', pill: `<span class="pill live"><span class="live-dot"></span>em jogo</span>` };
  return { cls: 'sched', pill: `<span class="pill tbd">${esc(fmtDate(m.kickoff))}</span>` };
}

const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// Linha de info do card: data "Quinta-feira, 11/06 · 13h" ou estado (ao vivo/encerrado).
function matchInfoLine(m) {
  const d = new Date(m.kickoff);
  if (m.finished) return `✅ Encerrado · ${m.home_score} x ${m.away_score}`;
  const started = d.getTime() <= Date.now();
  if (started && m.home_score != null) return `<span class="live-dot"></span>Ao vivo · ${m.home_score} x ${m.away_score}`;
  if (started) return `<span class="live-dot"></span>Em jogo`;
  const wd = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  const dm = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const mm = d.getMinutes();
  const hr = mm ? `${d.getHours()}h${String(mm).padStart(2, '0')}` : `${d.getHours()}h`;
  return `${cap(wd)}, ${dm} · ${hr}`;
}

function partidaCard(m) {
  const home = m.home_team ? `${flag(m.home_team)} <span>${esc(m.home_team)}</span>` : `<span class="tbd-team">${esc(m.home_label || 'A definir')}</span>`;
  const away = m.away_team ? `${flag(m.away_team)} <span>${esc(m.away_team)}</span>` : `<span class="tbd-team">${esc(m.away_label || 'A definir')}</span>`;
  const st = matchStatus(m);
  const searchText = normStr([m.home_team, m.away_team, m.home_label, m.away_label, m.group_label, m.round_label].filter(Boolean).join(' '));
  return `<div class="pcard ${st.cls}" data-match-id="${m.id}" data-search="${esc(searchText)}">
    <button class="pcard-head">
      <span class="pc-caret" aria-hidden="true">▾</span>
      <div class="pc-row">
        <span class="pc-t">${home}</span>
        <span class="pc-x">×</span>
        <span class="pc-t">${away}</span>
      </div>
      <div class="pc-info ${st.cls}">${matchInfoLine(m)}</div>
    </button>
    <div class="pcard-panel" hidden></div>
  </div>`;
}

const localDay = (d) => new Date(d).toLocaleDateString('en-CA'); // YYYY-MM-DD local
const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Barra "Próximos jogos": jogos de hoje e amanhã ainda não encerrados.
function upcomingBarHtml(list, todayStr) {
  if (!list.length) return `<div class="upcoming-wrap"><div class="upcoming empty muted">Sem jogos hoje ou amanhã. 😴</div></div>`;
  return `<div class="upcoming-wrap">
    <div class="upcoming">${list.map((m) => {
      const d = new Date(m.kickoff);
      const tag = localDay(m.kickoff) === todayStr ? 'Hoje' : 'Amanhã';
      const ds = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      const t = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const liveNow = !m.finished && d.getTime() <= Date.now();
      return `<button class="up-chip" data-goto="${m.id}">
        <span class="up-when">${liveNow ? '<span class="live-dot"></span>AO VIVO' : `${tag} · ${esc(ds)} · ${esc(t)}`}</span>
        <span class="up-teams">${flag(m.home_team)} ${esc(m.home_team)} <span class="cmp-x">×</span> ${esc(m.away_team)} ${flag(m.away_team)}</span>
      </button>`;
    }).join('')}</div>
  </div>`;
}

function renderPartidas() {
  const view = $('#tabview');
  const matches = (PoolState.data.matches || []).slice().sort((a, b) => a.ord - b.ord);
  if (!PoolState.partidasView) PoolState.partidasView = 'list';
  const cal = PoolState.partidasView === 'cal';

  // próximos: hoje + amanhã, ainda não encerrados
  const now = new Date();
  const todayStr = localDay(now);
  const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
  const tmrStr = localDay(tmr);
  const upcoming = matches
    .filter((m) => m.home_team && m.away_team && !m.finished)
    .filter((m) => { const s = localDay(m.kickoff); return s === todayStr || s === tmrStr; })
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  let html = `<div class="card"><h3>📅 Todas as partidas</h3>
    <p class="muted">Toque num jogo para ver os palpites da galera (revelados a partir de 2h antes do jogo). Veja em lista ou no calendário.</p></div>`;

  html += `<div class="partidas-bar ${cal ? 'cal-mode' : ''}">
    <div class="pview-toggle">
      <button data-pv="list" class="${cal ? '' : 'active'}">📋 Lista</button>
      <button data-pv="cal" class="${cal ? 'active' : ''}">📅 Calendário</button>
    </div>
    <div class="search-row"><input id="match-search" type="search" inputmode="search" autocomplete="off" placeholder="🔎 Buscar seleção (ex.: Brasil, França…)" /></div>
    <div class="upcoming-h muted">⏭️ Próximos jogos</div>
    ${upcomingBarHtml(upcoming, todayStr)}
  </div>`;

  html += `<div id="partidas-content"></div>`;
  view.innerHTML = html;

  const content = $('#partidas-content');
  if (cal) renderCalendar(matches, content);
  else renderPartidasList(matches, content);

  // alternar lista/calendário
  view.querySelectorAll('[data-pv]').forEach((b) => { b.onclick = () => { PoolState.partidasView = b.dataset.pv; renderPartidas(); }; });

  // busca (só na lista)
  const search = $('#match-search');
  const applyFilter = () => {
    const q = normStr(search.value);
    content.querySelectorAll('.pcard').forEach((c) => { c.hidden = !!q && !(c.dataset.search || '').includes(q); });
    content.querySelectorAll('.pmatch-block').forEach((b) => { b.hidden = ![...b.querySelectorAll('.pcard')].some((c) => !c.hidden); });
    content.querySelectorAll('.pstage').forEach((s) => { s.hidden = ![...s.querySelectorAll('.pmatch-block')].some((b) => !b.hidden); });
  };
  if (search) search.oninput = applyFilter;

  // chips "próximos jogos" -> vai pro card (na lista) e abre
  view.querySelectorAll('.up-chip').forEach((b) => {
    b.onclick = () => {
      if (PoolState.partidasView !== 'list') { PoolState.partidasView = 'list'; renderPartidas(); }
      const cont = $('#partidas-content');
      const s = $('#match-search'); if (s && s.value) s.value = '';
      const card = cont.querySelector(`.pcard[data-match-id="${b.dataset.goto}"]`);
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (!card.classList.contains('open')) togglePartida(card); }
    };
  });
}

// Lista de jogos agrupada por fase/grupo/dia (com cards expansíveis).
function renderPartidasList(matches, content) {
  const stages = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];
  let html = '';
  for (const stage of stages) {
    const list = matches.filter((m) => m.stage === stage);
    if (!list.length) continue;
    html += `<div class="pstage"><h2 class="stage-title">${STAGE_ICON[stage] || ''} ${esc(META.stageNames[stage] || stage)}</h2>`;
    if (stage === 'group') {
      for (const g of Object.keys(META.groups)) {
        const gl = list.filter((m) => m.group_label === g);
        if (!gl.length) continue;
        html += `<div class="pmatch-block"><div class="pgroup-h">Grupo ${g}</div>${gl.map(partidaCard).join('')}</div>`;
      }
    } else {
      let lastDay = '', block = '';
      const flush = () => { if (block) { html += `<div class="pmatch-block">${block}</div>`; block = ''; } };
      for (const m of list) {
        const dk = dayKey(m.kickoff);
        if (dk !== lastDay) { flush(); block = `<div class="pgroup-h">📅 ${esc(dk)}</div>`; lastDay = dk; }
        block += partidaCard(m);
      }
      flush();
    }
    html += `</div>`;
  }
  content.innerHTML = html;
  content.querySelectorAll('.pcard-head').forEach((h) => { h.onclick = () => togglePartida(h.closest('.pcard')); });
}

// Calendário mensal: grade dom–sáb com os dias que têm jogos; o dia selecionado
// abre embaixo a lista de partidas daquele dia.
function renderCalendar(matches, content) {
  const byDay = {};
  for (const m of matches) { const k = localDay(m.kickoff); (byDay[k] = byDay[k] || []).push(m); }
  const days = Object.keys(byDay).sort();
  if (!days.length) { content.innerHTML = `<div class="card center muted">Nenhum jogo agendado.</div>`; return; }
  const todayStr = localDay(new Date());
  if (!PoolState.calDay || !byDay[PoolState.calDay]) {
    PoolState.calDay = byDay[todayStr] ? todayStr : (days.find((d) => d >= todayStr) || days[days.length - 1]);
  }

  const months = [...new Set(days.map((d) => d.slice(0, 7)))]; // "2026-06"
  const cellHtml = (cell) => {
    if (!cell) return `<div class="cal-cell empty"></div>`;
    const { d, ds, games } = cell;
    const cls = ['cal-cell', games ? 'has' : '', ds === PoolState.calDay ? 'sel' : '', ds === todayStr ? 'today' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" ${games ? `data-calday="${ds}"` : 'disabled'}>
      <span class="cal-d">${d}</span>${games ? `<span class="cal-dot">${games.length}</span>` : ''}
    </button>`;
  };
  let html = `<div class="card cal-card">`;
  for (const ym of months) {
    const [y, mo] = ym.split('-').map(Number);
    const firstWd = new Date(y, mo - 1, 1).getDay();
    const dim = new Date(y, mo, 0).getDate();
    // monta as células (com brancos no início) e quebra em semanas
    const cells = [];
    for (let i = 0; i < firstWd; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) { const ds = `${ym}-${String(d).padStart(2, '0')}`; cells.push({ d, ds, games: byDay[ds] }); }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    // mantém só da 1ª à última semana que tem jogo (elimina semanas vazias nas pontas)
    const hasGame = (wk) => wk.some((c) => c && c.games);
    const fi = weeks.findIndex(hasGame);
    if (fi < 0) continue;
    let li = weeks.length - 1; while (li > fi && !hasGame(weeks[li])) li--;
    const shown = weeks.slice(fi, li + 1);
    html += `<div class="cal-month"><h3 class="cal-title">${MONTHS_PT[mo - 1]} ${y}</h3>
      <div class="cal-grid">${WEEKDAYS_PT.map((w) => `<div class="cal-wd">${w}</div>`).join('')}
      ${shown.flat().map(cellHtml).join('')}</div></div>`;
  }
  html += `</div>`;

  const sel = byDay[PoolState.calDay] || [];
  const selLabel = new Date(PoolState.calDay + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  html += `<div class="card"><h3>📆 <span style="text-transform:capitalize">${esc(selLabel)}</span> <span class="muted">· ${sel.length} jogo(s)</span></h3>
    <div id="cal-day-list">${sel.map(partidaCard).join('')}</div></div>`;

  content.innerHTML = html;
  content.querySelectorAll('[data-calday]').forEach((b) => {
    b.onclick = () => { PoolState.calDay = b.dataset.calday; renderCalendar(matches, content); };
  });
  content.querySelectorAll('.pcard-head').forEach((h) => { h.onclick = () => togglePartida(h.closest('.pcard')); });
}

function togglePartida(card) {
  const panel = card.querySelector('.pcard-panel');
  if (!panel.hidden) { panel.hidden = true; card.classList.remove('open'); return; }
  card.classList.add('open'); panel.hidden = false;
  if (!panel.dataset.loaded) loadMatchPanel(card);
}

// Carrega (ou recarrega) o painel de palpites de um card de jogo. Usado pelo
// toggle e pela atualização ao vivo (recarrega o painel aberto p/ pontos atualizados).
async function loadMatchPanel(card) {
  const panel = card.querySelector('.pcard-panel');
  if (!panel.dataset.loaded) panel.innerHTML = `<p class="muted center" style="padding:.5rem 0">Carregando palpites…</p>`;
  try {
    const d = await api('GET', `/api/pools/${PoolState.slug}/matches/${card.dataset.matchId}/predictions`);
    panel.dataset.loaded = '1';
    if (!d.revealed) {
      panel.innerHTML = `<div class="ppanel-lock">🔒 Os palpites deste jogo são revelados a partir de 2h antes do início.</div>`;
      return;
    }
    if (!d.predictions.length) {
      panel.innerHTML = `<div class="ppanel-lock">Ninguém palpitou este jogo. 😴</div>`;
      return;
    }
    const meName = PoolState.me?.name;
    const hasResult = d.match.home_score != null;
    panel.innerHTML = `<div class="ppanel">
      <div class="ppanel-head"><span>${d.predictions.length}/${d.participants} palpitaram</span>${hasResult ? `<span>pontos${d.match.finished ? '' : ' (parcial)'}</span>` : ''}</div>
      ${d.predictions.map((p, i) => `<div class="prow ${p.name === meName ? 'me' : ''}">
        <span class="prk">${hasResult && i === 0 && p.points > 0 ? '🥇' : (i + 1)}</span>
        <span class="pnm">${avatarImg(p.avatar, p.name, 'av xs')}<span>${esc(p.name)}${p.name === meName ? ' <span class="muted">(você)</span>' : ''}</span></span>
        <span class="ppick">${p.home_score} x ${p.away_score}</span>
        ${hasResult ? `<span class="pill ${p.points ? 'pts' : ''} ppts">${p.points}</span>` : '<span class="ppts muted">—</span>'}
      </div>`).join('')}
    </div>`;
  } catch (e) {
    panel.innerHTML = `<p class="center" style="padding:.5rem 0">${esc(e.message)}</p>`;
  }
}

// ---------- aba: admin ----------
async function renderAdmin() {
  const view = $('#tabview');
  const adminToken = store.getAdmin(PoolState.slug);
  view.innerHTML = `<div class="card center"><p>Carregando painel…</p></div>`;
  let data;
  try {
    data = await api('GET', `/api/pools/${PoolState.slug}/admin`, null, { 'x-admin-token': adminToken });
  } catch (e) { view.innerHTML = `<div class="card center">${esc(e.message)}</div>`; return; }
  PoolState.admin = data;

  const base = location.origin + location.pathname + '#/p/' + encodeURIComponent(PoolState.slug);
  const s = data.pool.scoring;
  const lk = data.lock || { mode: 'auto', locked: false, lockAt: null };

  let html = `
    <div class="banner">
      🔑 <b>Você é o admin.</b> Este link de admin está salvo só neste navegador.
      Para administrar de outro lugar, guarde o token:
      <div class="sharebox"><input type="text" readonly value="${esc(adminToken)}" id="admtok" />
      <button class="btn-soft btn-sm" id="copy-adm">Copiar</button></div>
    </div>

    <div class="card">
      <h3>🔗 Link para a galera</h3>
      <p class="muted">Mande este link. Cada um entra com nome + PIN.</p>
      <div class="sharebox"><input type="text" readonly value="${esc(base)}" id="sharelink" />
      <button class="btn-primary btn-sm" id="copy-share">Copiar</button></div>
      <div class="spacer"></div>
      <p class="muted">Código (slug): <b>${esc(PoolState.slug)}</b></p>
    </div>

    <div class="card">
      <h3>📸 Fotos dos participantes</h3>
      <p class="muted">Coloque uma foto pra cada um (na zoeira ou não 😄). Aparece no ranking, no pódio e nos palpites de cada jogo. <b>Dica:</b> copie uma imagem (botão direito → copiar imagem), clique em <b>📋 Colar</b> e pronto — ou aperte Ctrl+V.</p>
      ${data.participants.length ? `<div class="ava-list">${data.participants.map((p) => `
        <div class="ava-item">
          ${avatarImg(p.avatar, p.name, 'av lg')}
          <div class="ava-info"><b>${esc(p.name)}</b></div>
          <div class="ava-actions">
            <button class="btn-soft btn-sm" data-ava-paste="${p.id}">📋 Colar</button>
            <label class="btn-soft btn-sm">📷 ${p.avatar ? 'Trocar' : 'Foto'}<input type="file" accept="image/*" data-ava="${p.id}" hidden /></label>
            ${p.avatar ? `<button class="btn-link-danger" data-ava-rm="${p.id}">remover</button>` : ''}
          </div>
        </div>`).join('')}</div>` : `<p class="muted">Ninguém entrou no bolão ainda.</p>`}
    </div>

    <div class="card">
      <h3>🔄 Resultados automáticos</h3>
      ${PoolState.data.syncEnabled
        ? `<p class="muted">Ligado. Os placares se atualizam sozinhos (a cada acesso, no máx. 1x/min). Force agora se quiser:</p>
           <button id="btn-sync" class="btn-soft">Sincronizar agora</button>`
        : `<p class="muted">Desligado. Para ativar, defina a env var <b>FOOTBALL_DATA_TOKEN</b> (chave grátis de football-data.org) na Vercel e faça redeploy. Sem isso, lance os placares na mão abaixo.</p>`}
    </div>

    <div class="card">
      <h3>🔒 Trava de palpites</h3>
      <p class="muted">Status: <b style="color:${lk.locked ? 'var(--danger)' : 'var(--green-bright)'}">${lk.locked ? 'TRAVADO 🔒' : 'ABERTO 🔓'}</b>${lk.lockAt ? ` · no automático, trava em <b>${esc(fmtDate(new Date(lk.lockAt).toISOString()))}</b> (5 min antes do 1º jogo)` : ''}.</p>
      <div class="lock-state">
        <button class="btn-soft ${lk.mode === 'auto' ? 'active' : ''}" data-lock="auto">⏱ Automático</button>
        <button class="btn-soft ${lk.mode === 'open' ? 'active' : ''}" data-lock="open">🔓 Abrir agora</button>
        <button class="btn-soft ${lk.mode === 'locked' ? 'active' : ''}" data-lock="locked">🔒 Travar agora</button>
      </div>
      <p class="muted">No modo <b>Automático</b>, abre até 5 min antes do primeiro jogo e trava sozinho. Use “Abrir” ou “Travar” para forçar quando quiser.</p>
    </div>

    <div class="card">
      <h3>⚙️ Pontuação</h3>
      <div class="row">
        <div class="field"><label>🎯 Placar exato</label><input type="number" id="s-exact" value="${s.pts_exact}" min="0" max="100" /></div>
        <div class="field"><label>↔️ Vencedor + saldo</label><input type="number" id="s-gd" value="${s.pts_goaldiff}" min="0" max="100" /></div>
      </div>
      <div class="row">
        <div class="field"><label>✅ Acertou vencedor/empate</label><input type="number" id="s-out" value="${s.pts_outcome}" min="0" max="100" /></div>
        <div class="field"><label>🏆 Quem avança (por time)</label><input type="number" id="s-adv" value="${s.pts_advance}" min="0" max="100" /></div>
      </div>
      <p class="muted" style="margin:.2rem 0 .6rem">🤝 <b>Empate:</b> o bônus de saldo só vale em jogos com vencedor. Empate certo no placar = exato; empate certo sem o placar = só o acerto do resultado.</p>
      <label style="font-weight:500"><input type="checkbox" id="s-lock" ${data.pool.lock_at_kickoff ? 'checked' : ''} style="width:auto;margin-right:.4rem" />Travar palpites no horário de início do jogo</label>
      <div class="spacer"></div>
      <button id="save-settings" class="btn-primary">Salvar pontuação</button>
    </div>

    <div class="card">
      <h3>📝 Resultados & chaveamento</h3>
      <p class="muted">Lance o placar real dos jogos. No mata-mata, defina os times de cada confronto. O ranking recalcula sozinho.</p>
      <div class="spacer"></div>
      <div id="admin-matches"></div>
    </div>`;

  view.innerHTML = html;

  const copy = (id) => { const el = $('#' + id); el.select(); navigator.clipboard?.writeText(el.value); toast('Copiado! 📋'); };
  $('#copy-share').onclick = () => copy('sharelink');
  $('#copy-adm').onclick = () => copy('admtok');

  view.querySelectorAll('[data-lock]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api('PUT', `/api/pools/${PoolState.slug}/lock`, { mode: b.dataset.lock }, { 'x-admin-token': adminToken });
        toast('Trava atualizada 🔒');
        PoolState.data = await api('GET', `/api/pools/${PoolState.slug}`, null, { 'x-admin-token': adminToken });
        renderAdmin();
      } catch (e) { toast(e.message, true); }
    };
  });

  const syncBtn = $('#btn-sync');
  if (syncBtn) syncBtn.onclick = async () => {
    syncBtn.disabled = true; syncBtn.textContent = 'Sincronizando…';
    try {
      const r = await api('POST', `/api/pools/${PoolState.slug}/sync`, {}, { 'x-admin-token': adminToken });
      const extra = r.redated ? ` · ${r.redated} data(s) corrigida(s)` : '';
      toast(r.error ? r.error : `✅ ${r.updated || 0} placar(es) atualizado(s)${extra}.`, !!r.error);
      PoolState.data = await api('GET', `/api/pools/${PoolState.slug}`, null, { 'x-admin-token': adminToken });
      drawPoolShell();
    } catch (e) { toast(e.message, true); }
    finally { if ($('#btn-sync')) { $('#btn-sync').disabled = false; $('#btn-sync').textContent = 'Sincronizar agora'; } }
  };

  $('#save-settings').onclick = async () => {
    try {
      await api('PUT', `/api/pools/${PoolState.slug}/settings`, {
        pts_exact: $('#s-exact').value, pts_goaldiff: $('#s-gd').value,
        pts_outcome: $('#s-out').value, pts_advance: $('#s-adv').value,
        lock_at_kickoff: $('#s-lock').checked,
      }, { 'x-admin-token': adminToken });
      toast('Pontuação salva e ranking recalculado ✅');
      PoolState.data = await api('GET', `/api/pools/${PoolState.slug}`, null, { 'x-admin-token': adminToken });
      drawPoolShell();
    } catch (e) { toast(e.message, true); }
  };

  // fotos dos participantes
  view.querySelectorAll('[data-ava]').forEach((inp) => {
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) uploadAvatar(inp.dataset.ava, f); };
  });
  view.querySelectorAll('[data-ava-paste]').forEach((b) => {
    b.onclick = () => armAvatarPaste(b.dataset.avaPaste, b);
  });
  view.querySelectorAll('[data-ava-rm]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api('PUT', `/api/pools/${PoolState.slug}/participants/${b.dataset.avaRm}/avatar`, { avatar: null }, { 'x-admin-token': adminToken });
        toast('Foto removida');
        renderAdmin();
      } catch (e) { toast(e.message, true); }
    };
  });

  renderAdminMatches();
}

// Sobe a foto (arquivo OU blob colado) de um participante: redimensiona e salva.
async function uploadAvatar(pid, blob) {
  const adminToken = store.getAdmin(PoolState.slug);
  if (!adminToken) return toast('Você precisa ser admin.', true);
  try {
    const dataUrl = await fileToAvatar(blob);
    await api('PUT', `/api/pools/${PoolState.slug}/participants/${pid}/avatar`, { avatar: dataUrl }, { 'x-admin-token': adminToken });
    toast('Foto atualizada 📸');
    if (PoolState.tab === 'admin') renderAdmin();
  } catch (e) { toast(e.message || 'Não consegui processar a imagem.', true); }
}

// "Colar": tenta ler a imagem direto da área de transferência (1 clique). Se o
// navegador não deixar, arma o modo Ctrl+V (o listener global cuida do paste).
let armedAvatarPid = null;
async function armAvatarPaste(pid, btn) {
  if (navigator.clipboard && navigator.clipboard.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) { const blob = await it.getType(type); await uploadAvatar(pid, blob); return; }
      }
    } catch (_) { /* sem permissão/sem suporte → cai no Ctrl+V */ }
  }
  armedAvatarPid = pid;
  document.querySelectorAll('.ava-item.armed').forEach((el) => el.classList.remove('armed'));
  const item = btn.closest('.ava-item'); if (item) item.classList.add('armed');
  toast('Agora aperte Ctrl+V para colar a foto 📋');
}

// Listener global de colar: usa o participante "armado" pelo botão Colar.
document.addEventListener('paste', (e) => {
  if (!armedAvatarPid) return;
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const blob = it.getAsFile();
      const pid = armedAvatarPid; armedAvatarPid = null;
      if (blob) { e.preventDefault(); uploadAvatar(pid, blob); }
      return;
    }
  }
  toast('Não achei imagem copiada. Copie uma imagem e tente de novo.', true);
});

// Redimensiona a imagem escolhida para um quadrado pequeno (corta no centro) e
// devolve um data URL JPEG levinho — guardado direto no banco, sem storage externo.
function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('Arquivo não é uma imagem.'));
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
      const ctx = cv.getContext('2d');
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      resolve(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Imagem inválida.'));
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    fr.readAsDataURL(file);
  });
}

function renderAdminMatches() {
  const cont = $('#admin-matches');
  const matches = PoolState.admin.matches;
  const stages = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];
  const allTeams = Object.values(META.groups).flat().sort((a, b) => a.localeCompare(b));
  let html = '';
  for (const stage of stages) {
    const list = matches.filter((m) => m.stage === stage);
    if (!list.length) continue;
    html += `<h4 class="stage-title">${esc(META.stageNames[stage])}</h4>`;
    for (const m of list) {
      const ko = m.stage !== 'group';
      const teamSel = (side, val) => {
        if (!ko) return `<b>${flag(val)} ${esc(val)}</b>`;
        return `<select data-am="${m.id}" data-team="${side}">
          <option value="">— a definir —</option>
          ${allTeams.map((t) => `<option value="${esc(t)}" ${val === t ? 'selected' : ''}>${flagEmoji(t)} ${esc(t)}</option>`).join('')}
        </select>`;
      };
      html += `<div class="match" style="grid-template-columns:1fr;gap:.4rem">
        <div class="muted" style="display:flex;justify-content:space-between">
          <span>${esc(m.round_label)}</span><span>${esc(fmtDate(m.kickoff))} ${m.finished ? '<span class="pill done">final</span>' : ''}</span>
        </div>
        <div class="row" style="align-items:center">
          <div>${teamSel('home', m.home_team)}</div>
          <div class="scorebox" style="flex:0;justify-content:center">
            <input type="number" min="0" max="99" data-am="${m.id}" data-side="home" value="${m.home_score ?? ''}" placeholder="-" />
            <span class="vs">x</span>
            <input type="number" min="0" max="99" data-am="${m.id}" data-side="away" value="${m.away_score ?? ''}" placeholder="-" />
          </div>
          <div style="text-align:right">${teamSel('away', m.away_team)}</div>
        </div>
        <div class="row">
          <button class="btn-primary btn-sm" data-save-match="${m.id}">Salvar</button>
          ${m.finished ? `<button class="btn-soft btn-sm" data-clear-match="${m.id}" style="flex:0">Limpar placar</button>` : ''}
        </div>
      </div>`;
    }
  }
  cont.innerHTML = html;

  cont.querySelectorAll('[data-save-match]').forEach((btn) => {
    btn.onclick = () => saveMatch(btn.dataset.saveMatch, false);
  });
  cont.querySelectorAll('[data-clear-match]').forEach((btn) => {
    btn.onclick = () => saveMatch(btn.dataset.clearMatch, true);
  });
}

async function saveMatch(id, clear) {
  const adminToken = store.getAdmin(PoolState.slug);
  const cont = $('#admin-matches');
  const body = {};
  const hSel = cont.querySelector(`select[data-am="${id}"][data-team="home"]`);
  const aSel = cont.querySelector(`select[data-am="${id}"][data-team="away"]`);
  if (hSel) body.home_team = hSel.value || null;
  if (aSel) body.away_team = aSel.value || null;
  if (clear) {
    body.home_score = null; body.away_score = null;
  } else {
    const hi = cont.querySelector(`input[data-am="${id}"][data-side="home"]`).value;
    const ai = cont.querySelector(`input[data-am="${id}"][data-side="away"]`).value;
    if (hi !== '' && ai !== '') { body.home_score = hi; body.away_score = ai; }
  }
  try {
    await api('PUT', `/api/pools/${PoolState.slug}/matches/${id}`, body, { 'x-admin-token': adminToken });
    toast('Partida atualizada ✅');
    PoolState.admin = await api('GET', `/api/pools/${PoolState.slug}/admin`, null, { 'x-admin-token': adminToken });
    PoolState.data = await api('GET', `/api/pools/${PoolState.slug}`, null, { 'x-admin-token': adminToken });
    renderAdminMatches();
  } catch (e) { toast(e.message, true); }
}
