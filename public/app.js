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
  PoolState.me = store.getPart(slug);
  store.addRecent(slug, data.pool.name);

  navActions(`<a href="#/" class="btn-ghost btn-sm" style="text-decoration:none">← Início</a>`);
  drawPoolShell();
}

function drawPoolShell() {
  const { data } = PoolState;
  const isAdmin = data.isAdmin;
  const tabs = [
    ['palpites', '🎯 Meus palpites'],
    ['ranking', '📊 Ranking'],
  ];
  if (isAdmin) tabs.push(['admin', '⚙️ Admin']);

  $('#app').innerHTML = `
    <section class="card hero">
      <h1>${esc(data.pool.name)}</h1>
      <p>${data.participants.length} participante(s) · ${data.matches.length} jogos${data.syncEnabled ? ' · 🔄 resultados automáticos' : ''}</p>
      <div class="scoring-legend">
        <span>🎯 Placar exato: <b>${data.pool.scoring.pts_exact}</b></span>
        <span>↔️ Resultado + saldo: <b>${data.pool.scoring.pts_goaldiff}</b></span>
        <span>✅ Acertou o vencedor/empate: <b>${data.pool.scoring.pts_outcome}</b></span>
        <span>🏆 Quem avança: <b>${data.pool.scoring.pts_advance}</b>/time</span>
      </div>
    </section>
    <div class="tabs" id="tabs">
      ${tabs.map(([k, label]) => `<button data-tab="${k}" class="${PoolState.tab === k ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="tabview"></div>
  `;
  $('#tabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { PoolState.tab = b.dataset.tab; drawPoolShell(); };
  });

  if (PoolState.tab === 'palpites') renderPalpites();
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
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const groupKeys = Object.keys(META.groups);

  let html = `
    <div class="card">
      <div class="row" style="align-items:center">
        <div><b>👤 ${esc(mine.name)}</b> · <span class="pill pts">${mine.total} pts</span></div>
        <div style="text-align:right;flex:0"><button id="btn-logout" class="btn-soft btn-sm">Sair</button></div>
      </div>
    </div>`;

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
      <div class="group-foot"><button class="btn-link-danger" data-clear-group="${g}">🧹 Limpar palpites do grupo ${g}</button></div>
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

  html += `<div class="sticky-save">
    <button id="btn-clear-all" class="btn-link-danger">🧹 Limpar tudo</button>
    <button id="btn-save" class="btn-gold">💾 Salvar palpites</button>
  </div>`;

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

  // limpar por grupo
  view.querySelectorAll('[data-clear-group]').forEach((b) => {
    b.onclick = () => clearPredictions(b.dataset.clearGroup);
  });
  // limpar tudo (com confirmação)
  $('#btn-clear-all').onclick = async () => {
    const ok = await confirmModal('Apagar TODOS os seus palpites?', 'Isso remove todos os placares que você ainda pode editar (jogos não iniciados). Não dá pra desfazer.');
    if (ok) clearPredictions(null);
  };

  $('#btn-save').onclick = savePredictions;
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
  const locked = m.locked || tbdH || tbdA;
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

// ---------- aba: ranking ----------
async function renderRanking() {
  const view = $('#tabview');
  view.innerHTML = `<div class="card center"><p>Carregando ranking…</p></div>`;
  try {
    const { leaderboard } = await api('GET', `/api/pools/${PoolState.slug}/leaderboard`);
    const meName = PoolState.me?.name;
    if (!leaderboard.length) {
      view.innerHTML = `<div class="card center"><h3>Ainda não há participantes 🙃</h3><p class="muted">Compartilhe o link do bolão!</p></div>`;
    } else {
      view.innerHTML = `<div class="card"><h3>📊 Classificação</h3>
        <table class="board"><thead><tr>
          <th class="num">#</th><th>Participante</th>
          <th class="num">Jogos</th><th class="num">Avanço</th><th class="num">Exatos</th><th class="num">Total</th>
        </tr></thead><tbody>
        ${leaderboard.map((r, i) => `<tr class="${r.name === meName ? 'me' : ''}">
          <td class="rank ${i < 3 ? 'top' + (i + 1) : ''}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</td>
          <td>${esc(r.name)}${r.name === meName ? ' <span class="muted">(você)</span>' : ''}</td>
          <td class="num">${r.match_pts}</td><td class="num">${r.qual_pts}</td>
          <td class="num">${r.exatos}</td><td class="num"><b>${r.total}</b></td>
        </tr>`).join('')}
        </tbody></table></div>`;
    }
  } catch (e) { view.innerHTML = `<div class="card center">${esc(e.message)}</div>`; }
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
      <h3>🔄 Resultados automáticos</h3>
      ${PoolState.data.syncEnabled
        ? `<p class="muted">Ligado. Os placares se atualizam sozinhos (a cada acesso, no máx. 1x/min). Force agora se quiser:</p>
           <button id="btn-sync" class="btn-soft">Sincronizar agora</button>`
        : `<p class="muted">Desligado. Para ativar, defina a env var <b>FOOTBALL_DATA_TOKEN</b> (chave grátis de football-data.org) na Vercel e faça redeploy. Sem isso, lance os placares na mão abaixo.</p>`}
    </div>

    <div class="card">
      <h3>⚙️ Pontuação</h3>
      <div class="row">
        <div class="field"><label>🎯 Placar exato</label><input type="number" id="s-exact" value="${s.pts_exact}" min="0" max="100" /></div>
        <div class="field"><label>↔️ Resultado + saldo</label><input type="number" id="s-gd" value="${s.pts_goaldiff}" min="0" max="100" /></div>
      </div>
      <div class="row">
        <div class="field"><label>✅ Acertou vencedor/empate</label><input type="number" id="s-out" value="${s.pts_outcome}" min="0" max="100" /></div>
        <div class="field"><label>🏆 Quem avança (por time)</label><input type="number" id="s-adv" value="${s.pts_advance}" min="0" max="100" /></div>
      </div>
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

  const syncBtn = $('#btn-sync');
  if (syncBtn) syncBtn.onclick = async () => {
    syncBtn.disabled = true; syncBtn.textContent = 'Sincronizando…';
    try {
      const r = await api('POST', `/api/pools/${PoolState.slug}/sync`, {}, { 'x-admin-token': adminToken });
      toast(r.error ? r.error : `✅ ${r.updated || 0} jogo(s) atualizado(s).`, !!r.error);
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

  renderAdminMatches();
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
