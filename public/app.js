'use strict';

// ---------------- estado & util ----------------
const App = (location.hostname && location.host) ? location.origin : '';
let META = { groups: {}, flags: {}, stageNames: {} };

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
const flag = (t) => (t && META.flags[t]) ? META.flags[t] : '⚪';

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

// ---------------- router ----------------
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  try { META = await api('GET', '/api/meta'); } catch (_) {}
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
        <span>🏆 Quem avança</span><span>🔗 Link pra compartilhar</span>
      </div>
    </section>

    <section class="card">
      <h2>Criar um novo bolão</h2>
      <p class="muted">Você vira o admin: define a pontuação e lança os resultados.</p>
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
const PoolState = { slug: null, data: null, me: null, tab: 'palpites', draft: {}, qdraft: {}, admin: null };

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
      <p>${data.participants.length} participante(s) · ${data.matches.length} jogos</p>
      <div class="scoring-legend">
        <span>🎯 Placar exato: <b>${data.pool.scoring.pts_exact}</b></span>
        <span>↔️ Resultado + saldo: <b>${data.pool.scoring.pts_goaldiff}</b></span>
        <span>✅ Acertou o vencedor: <b>${data.pool.scoring.pts_outcome}</b></span>
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

  // monta drafts a partir do salvo
  PoolState.draft = {};
  mine.predictions.forEach((p) => { PoolState.draft[p.match_id] = { home: p.home_score, away: p.away_score, points: p.points }; });
  PoolState.qdraft = {};
  mine.qualifiers.forEach((q) => { PoolState.qdraft[q.group_label] = { first: q.team_first, second: q.team_second, points: q.points }; });

  const matches = PoolState.data.matches;
  const stages = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];

  let html = `
    <div class="card">
      <div class="row" style="align-items:center">
        <div><b>👤 ${esc(mine.name)}</b> · <span class="pill pts">${mine.total} pts</span></div>
        <div style="text-align:right;flex:0"><button id="btn-logout" class="btn-soft btn-sm">Sair</button></div>
      </div>
    </div>`;

  // Quem avança (palpite por grupo)
  html += `<div class="card"><h3>🏆 Quem avança (top 2 de cada grupo)</h3>
    <p class="muted">Vale <b>${PoolState.data.pool.scoring.pts_advance} pts</b> por seleção que realmente passar. Trava quando o grupo termina.</p>
    <div class="spacer"></div><div class="qual-grid">`;
  for (const g of Object.keys(META.groups)) {
    const teams = META.groups[g];
    const q = PoolState.qdraft[g] || {};
    const groupDone = teams.length && matches.filter((m) => m.group_label === g).every((m) => m.finished) && matches.some((m) => m.group_label === g);
    const opt = (sel) => ['<option value="">—</option>'].concat(
      teams.map((t) => `<option value="${esc(t)}" ${sel === t ? 'selected' : ''}>${flag(t)} ${esc(t)}</option>`)).join('');
    html += `<div class="qual-card">
      <h4>Grupo ${g} ${q.points ? `<span class="pill pts">+${q.points}</span>` : ''}</h4>
      <select data-qual="${g}" data-pos="first" ${groupDone ? 'disabled' : ''}>${opt(q.first)}</select>
      <select data-qual="${g}" data-pos="second" ${groupDone ? 'disabled' : ''}>${opt(q.second)}</select>
    </div>`;
  }
  html += `</div></div>`;

  // Jogos por fase
  for (const stage of stages) {
    const list = matches.filter((m) => m.stage === stage);
    if (!list.length) continue;
    html += `<h2 class="stage-title">${esc(META.stageNames[stage] || stage)}</h2>`;
    let lastDay = '';
    for (const m of list) {
      const dk = dayKey(m.kickoff);
      if (dk !== lastDay) { html += `<div class="daygroup">📅 ${esc(dk)}</div>`; lastDay = dk; }
      html += matchRow(m);
    }
  }

  html += `<div class="sticky-save">
    <span class="muted" id="save-hint">Palpites travam no início de cada jogo.</span>
    <button id="btn-save" class="btn-gold">💾 Salvar palpites</button>
  </div>`;

  view.innerHTML = html;

  $('#btn-logout').onclick = () => { store.clearPart(PoolState.slug); PoolState.me = null; drawPoolShell(); };

  view.querySelectorAll('select[data-qual]').forEach((sel) => {
    sel.onchange = () => {
      const g = sel.dataset.qual, pos = sel.dataset.pos;
      PoolState.qdraft[g] = PoolState.qdraft[g] || {};
      PoolState.qdraft[g][pos] = sel.value || null;
    };
  });
  view.querySelectorAll('input[data-match]').forEach((inp) => {
    inp.oninput = () => {
      const id = inp.dataset.match, side = inp.dataset.side;
      PoolState.draft[id] = PoolState.draft[id] || {};
      PoolState.draft[id][side] = inp.value === '' ? '' : Math.max(0, Math.min(99, parseInt(inp.value, 10) || 0));
    };
  });

  $('#btn-save').onclick = savePredictions;
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
      <input type="number" min="0" max="99" inputmode="numeric" data-match="${m.id}" data-side="home" value="${d.home ?? ''}" />
      <span class="vs">x</span>
      <input type="number" min="0" max="99" inputmode="numeric" data-match="${m.id}" data-side="away" value="${d.away ?? ''}" />
    </div>`;
  }

  let chip = '';
  if (m.finished) chip = `<span class="result-chip">Final: ${m.home_score} x ${m.away_score}</span>`;
  else if (m.locked && !tbdH && !tbdA) chip = `<span class="pill live">⏱ em jogo/encerrado</span>`;
  const ptsPill = (m.finished && d.points != null) ? `<span class="pill ${d.points ? 'pts' : ''}">${d.points} pts</span>` : '';

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
  const qualifiers = Object.entries(PoolState.qdraft)
    .map(([group, v]) => ({ group, first: v.first || null, second: v.second || null }));
  try {
    const r = await api('PUT', `/api/pools/${PoolState.slug}/predictions`,
      { predictions, qualifiers }, { 'x-participant-token': PoolState.me.token });
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
      <p class="muted">Escolha um nome e um PIN. Use o mesmo PIN para voltar e editar seus palpites.</p>
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
      <h3>⚙️ Pontuação</h3>
      <div class="row">
        <div class="field"><label>🎯 Placar exato</label><input type="number" id="s-exact" value="${s.pts_exact}" min="0" max="100" /></div>
        <div class="field"><label>↔️ Resultado + saldo</label><input type="number" id="s-gd" value="${s.pts_goaldiff}" min="0" max="100" /></div>
      </div>
      <div class="row">
        <div class="field"><label>✅ Acertou vencedor</label><input type="number" id="s-out" value="${s.pts_outcome}" min="0" max="100" /></div>
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
          ${allTeams.map((t) => `<option value="${esc(t)}" ${val === t ? 'selected' : ''}>${flag(t)} ${esc(t)}</option>`).join('')}
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
