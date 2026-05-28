'use strict';
/* =====================================================
   FC26 Pack Opener — app.js  (v2)
   ===================================================== */

// ---- Costanti ----
const OUTFIELD_STATS  = ['PAC','SHO','PAS','DRI','DEF','PHY'];
const GK_STATS        = ['DIV','HAN','KIC','POS','REF','SPD'];
const SQUAD_KEY       = 'fc26_squad_v2';   // localStorage key
const APP_URL         = window.location.origin;

// ---- Stato in memoria ----
const state = {
  pack: [],           // giocatori pack corrente
  packMap: {},        // id -> player, per il pack corrente
  rosters: [],        // [{name, ids}] - rose caricate via JSON
  squad: [],          // [{id, name, position, overall, club}] - estratti e tenuti
  loading: false,
};

// ===========================================================
//  UTILS DOM
// ===========================================================
const $  = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

// ===========================================================
//  COLLECTION (localStorage)
// ===========================================================
function loadSquad() {
  try { return JSON.parse(localStorage.getItem(SQUAD_KEY) || '[]'); }
  catch { return []; }
}
function saveSquad() {
  localStorage.setItem(SQUAD_KEY, JSON.stringify(state.squad));
}
function isInSquad(id) {
  return state.squad.some(p => p.id === id);
}
function addToSquad(player) {
  if (isInSquad(player.id)) return;
  state.squad.push({ id: player.id, name: player.name, position: player.position, overall: player.overall, club: player.club });
  saveSquad();
  refreshSquadUI();
  schedulePool();
}
function removeFromSquad(id) {
  state.squad = state.squad.filter(p => p.id !== id);
  saveSquad();
  refreshSquadUI();
  schedulePool();
  // aggiorna pulsante sulla carta se è ancora visibile
  const btn = document.querySelector(`.card-add-btn[data-id="${id}"]`);
  if (btn) setAddBtnState(btn, false);
}
function clearSquad() {
  if (!state.squad.length) return;
  if (!confirm(`Svuotare la rosa (${state.squad.length} giocatori)?`)) return;
  state.squad = [];
  saveSquad();
  refreshSquadUI();
  schedulePool();
  // resetta tutti i pulsanti visibili
  document.querySelectorAll('.card-add-btn.in-squad').forEach(b => setAddBtnState(b, false));
}

function refreshSquadUI() {
  const list   = $('squad-list');
  const badge  = $('squad-badge');
  const btnClr = $('btn-clear-squad');
  const n      = state.squad.length;

  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
  btnClr.style.display = n ? '' : 'none';

  list.innerHTML = '';
  [...state.squad].reverse().forEach(p => {
    const item = el('div','squad-item');
    item.innerHTML = `
      <span class="squad-ovr">${p.overall}</span>
      <span class="squad-name">${p.name}</span>
      <span class="squad-pos">${p.position}</span>
      <button class="btn-rm" onclick="removeFromSquad(${p.id})" title="Rimuovi">✕</button>`;
    list.appendChild(item);
  });
}

// ===========================================================
//  ROSTER (upload JSON)
// ===========================================================
function parseRosterFile(filename, raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  let ids = [];
  if (Array.isArray(data)) {
    ids = data.map(x => typeof x === 'object' ? (x.id || x.player_id) : x).filter(Boolean).map(Number);
  } else if (data.players) {
    ids = data.players.map(x => typeof x === 'object' ? (x.id || x.player_id) : x).filter(Boolean).map(Number);
  } else if (data.squad) {
    ids = data.squad.map(x => typeof x === 'object' ? (x.id || x.player_id) : x).filter(Boolean).map(Number);
  }
  if (!ids.length) return null;
  return { name: data.team || data.name || data.team_name || filename.replace('.json',''), ids };
}

function refreshRosterUI() {
  const list = $('roster-list');
  list.innerHTML = '';
  state.rosters.forEach((r, i) => {
    const item = el('div','roster-item');
    item.innerHTML = `
      <div class="roster-info">
        <span class="roster-name">${r.name}</span>
        <span class="roster-count">${r.ids.length} giocatori</span>
      </div>
      <button class="btn-rm" onclick="removeRoster(${i})">✕</button>`;
    list.appendChild(item);
  });
  schedulePool();
}

function removeRoster(i) {
  state.rosters.splice(i, 1);
  refreshRosterUI();
}

$('roster-input').addEventListener('change', async e => {
  for (const file of e.target.files) {
    const roster = parseRosterFile(file.name, await file.text());
    if (roster && !state.rosters.find(r => r.name === roster.name)) {
      state.rosters.push(roster);
    } else if (!roster) {
      alert(`File "${file.name}" non riconosciuto.`);
    }
  }
  e.target.value = '';
  refreshRosterUI();
});

// ===========================================================
//  CONFIG
// ===========================================================
function getExcludedIds() {
  const ids = new Set();
  // Rose caricate
  state.rosters.forEach(r => r.ids.forEach(id => ids.add(id)));
  // Squadra (se toggle attivo)
  if ($('tog-excl').checked) {
    state.squad.forEach(p => ids.add(p.id));
  }
  return [...ids];
}

function getConfig() {
  return {
    ovr_min:          parseInt($('ovr-min').value),
    ovr_max:          parseInt($('ovr-max').value),
    num_cards:        parseInt($('num-cards').value),
    include_gk:       $('tog-gk').checked,
    position_filter:  $('sel-pos').value,
    min_stats:        getMinStats(),
    excluded_ids:     getExcludedIds(),
  };
}

function getMinStats() {
  const stats = {};
  document.querySelectorAll('[data-stat]').forEach(inp => {
    const v = parseInt(inp.value) || 0;
    if (v > 0) stats[inp.dataset.stat] = v;
  });
  return stats;
}

// ===========================================================
//  STAT GRID (filtri avanzati)
// ===========================================================
function buildStatGrid() {
  const isGK = $('sel-pos').value === 'GK';
  const keys = isGK ? GK_STATS : OUTFIELD_STATS;
  $('stat-type').textContent = isGK ? '(portiere)' : '(outfield)';
  const grid = $('stat-grid');
  grid.innerHTML = keys.map(k => `
    <div class="stat-cell">
      <label>${k}</label>
      <input type="number" data-stat="${k}" value="0" min="0" max="99"
        oninput="this.classList.toggle('active',parseInt(this.value)>0); schedulePool()">
    </div>`).join('');
}

// ===========================================================
//  POOL COUNT
// ===========================================================
let poolTimer = null;
function schedulePool() {
  clearTimeout(poolTimer);
  poolTimer = setTimeout(fetchPool, 420);
}

async function fetchPool() {
  const cfg = getConfig();
  if (isNaN(cfg.ovr_min) || isNaN(cfg.ovr_max) || cfg.ovr_min > cfg.ovr_max) {
    $('pool-box').innerHTML = '<span style="color:var(--red)">Range non valido</span>';
    return;
  }
  try {
    const r = await fetch('/api/pack/pool', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(cfg),
    });
    const d = await r.json();
    $('pool-box').innerHTML = d.pool_size !== undefined
      ? `<strong>${d.pool_size.toLocaleString()}</strong> giocatori disponibili`
      : `<span style="color:var(--red)">${d.error}</span>`;
  } catch { $('pool-box').textContent = '—'; }
}

// ===========================================================
//  CARD RENDERING
// ===========================================================
function tier(ovr) {
  if (ovr >= 87) return 't-elite';
  if (ovr >= 82) return 't-high';
  if (ovr >= 75) return 't-mid';
  return 't-low';
}

function statColor(v) {
  if (v >= 85) return '#f0d080';
  if (v >= 75) return '#48bb78';
  if (v >= 65) return '#7abcf5';
  return '#8888a8';
}

function buildCard(player, delay) {
  const wrap  = el('div', `card-wrap`);
  wrap.style.animationDelay = `${delay}s`;
  wrap.dataset.id = player.id;

  const inner = el('div', 'card-inner');
  const back  = el('div', 'card-face card-back', '⚽');
  const front = el('div', `card-face card-front ${tier(player.overall)}`);

  const statsHTML = Object.entries(player.stats)
    .map(([k,v]) => `<div class="sitem"><span class="sval" style="color:${statColor(v)}">${v}</span><span class="slbl">${k}</span></div>`)
    .join('');

  const imgHTML = player.face_url
    ? `<img src="${player.face_url}" alt="${player.name}" crossorigin="anonymous" onerror="this.outerHTML='<span class=no-img>⚽</span>'">`
    : '<span class="no-img">⚽</span>';

  front.innerHTML = `
    <div class="card-hdr">
      <div class="card-ovr">${player.overall}</div>
      <div class="card-pos">${player.position}</div>
    </div>
    <div class="card-img">${imgHTML}</div>
    <div class="card-name">${player.name}</div>
    <div class="card-club">${player.club}</div>
    <div class="card-div"></div>
    <div class="card-stats">${statsHTML}</div>`;

  // Aggiungi pulsante "Aggiungi alla Rosa"
  const addBtn = el('button', `card-add-btn${isInSquad(player.id) ? ' in-squad' : ''}`);
  addBtn.dataset.id = player.id;
  addBtn.textContent = isInSquad(player.id) ? '✓ In Rosa' : '➕ Aggiungi alla Rosa';
  addBtn.onclick = e => { e.stopPropagation(); handleAddBtn(addBtn, player); };
  front.appendChild(addBtn);

  // Shine
  const shine = el('div', 'card-shine');
  front.appendChild(shine);
  setTimeout(() => shine.remove(), 900);

  inner.appendChild(back);
  inner.appendChild(front);
  wrap.appendChild(inner);

  // Click su carta → flip
  wrap.addEventListener('click', () => flipCard(wrap));
  return wrap;
}

function setAddBtnState(btn, inSquad) {
  btn.classList.toggle('in-squad', inSquad);
  btn.textContent = inSquad ? '✓ In Rosa' : '➕ Aggiungi alla Rosa';
}

function handleAddBtn(btn, player) {
  if (isInSquad(player.id)) {
    removeFromSquad(player.id);
    setAddBtnState(btn, false);
  } else {
    addToSquad(player);
    setAddBtnState(btn, true);
  }
}

// ===========================================================
//  FLIP / REVEAL
// ===========================================================
let revealedCount = 0;

function flipCard(wrap) {
  if (wrap.classList.contains('flipped')) return;
  wrap.classList.add('flipped');
  revealedCount++;
  if (revealedCount >= state.pack.length) {
    const btn = $('btn-reveal');
    if (btn) btn.classList.add('hidden');
  }
}

function revealAll() {
  const cards = document.querySelectorAll('.card-wrap:not(.flipped)');
  cards.forEach((w, i) => setTimeout(() => flipCard(w), i * 150));
  const btn = $('btn-reveal');
  if (btn) btn.classList.add('hidden');
}

// ===========================================================
//  PACK OPENING
// ===========================================================
async function openPack() {
  if (state.loading) return;
  state.loading = true;
  revealedCount = 0;
  $('btn-open').disabled = true;

  $('play-area').innerHTML = `
    <div class="loader"><div class="spinner"></div><span>Generazione pacchetto...</span></div>`;

  try {
    const cfg = getConfig();
    const res = await fetch('/api/pack/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);

    state.pack = data.players;
    state.packMap = {};
    data.players.forEach(p => { state.packMap[p.id] = p; });

    renderPack(data.players);
  } catch (err) {
    $('play-area').innerHTML = `<div class="error-box">⚠️ ${err.message}</div>`;
  } finally {
    state.loading = false;
    $('btn-open').disabled = false;
  }
}

function renderPack(players) {
  const area = $('play-area');
  area.innerHTML = '';

  // Action bar
  const bar = el('div', 'action-bar');
  bar.innerHTML = `
    <button id="btn-reveal" class="abtn gold" onclick="revealAll()">⚡ Rivela tutte</button>
    <button class="abtn gold" onclick="addAllToSquad()">➕ Aggiungi tutte</button>
    <button class="abtn blue"   onclick="shareDownload()">📥 Salva immagine</button>
    <button class="abtn green"  onclick="shareWhatsApp()">💬 WhatsApp</button>
    <button class="abtn orange" onclick="shareEmail()">📧 Email</button>`;
  area.appendChild(bar);

  // Grid
  const grid = el('div', 'cards-grid');
  grid.id = 'cards-grid';
  players.forEach((p, i) => grid.appendChild(buildCard(p, i * 0.1)));
  area.appendChild(grid);
}

function addAllToSquad() {
  state.pack.forEach(p => {
    if (!isInSquad(p.id)) {
      addToSquad(p);
      const btn = document.querySelector(`.card-add-btn[data-id="${p.id}"]`);
      if (btn) setAddBtnState(btn, true);
    }
  });
}

// ===========================================================
//  SHARE
// ===========================================================
async function captureImage() {
  // Rivela tutte prima
  document.querySelectorAll('.card-wrap:not(.flipped)').forEach(w => w.classList.add('flipped'));

  const overlay = el('div','cap-overlay','<div class="spinner"></div><span>Generazione immagine...</span>');
  document.body.appendChild(overlay);

  // Container off-screen per la cattura
  const wrap = el('div');
  wrap.style.cssText = 'position:fixed;left:-9999px;top:0;background:#0a0a14;padding:22px 18px 16px;border-radius:14px;';

  const hdr = el('div');
  hdr.style.cssText = 'text-align:center;margin-bottom:16px;font-family:Segoe UI,sans-serif;';
  hdr.innerHTML = `<span style="color:#f0d080;font-size:1.1rem;font-weight:800;letter-spacing:2px">⚽ FC26 PACK OPENER</span>`;
  wrap.appendChild(hdr);

  const gridClone = $('cards-grid').cloneNode(true);
  gridClone.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:960px;';
  gridClone.querySelectorAll('.card-wrap').forEach(w => {
    w.style.animation = 'none'; w.style.perspective = 'none';
  });
  gridClone.querySelectorAll('.card-inner').forEach(e => {
    e.style.cssText = 'transform:none;transform-style:flat;';
  });
  gridClone.querySelectorAll('.card-face.card-back').forEach(e => e.remove());
  gridClone.querySelectorAll('.card-face.card-front').forEach(e => {
    e.style.cssText = 'position:relative;backface-visibility:visible;';
  });
  gridClone.querySelectorAll('.card-shine,.card-add-btn').forEach(e => e.remove());
  wrap.appendChild(gridClone);

  const ftr = el('div');
  ftr.style.cssText = 'text-align:center;margin-top:12px;color:#8888a8;font-size:.65rem;font-family:Segoe UI,sans-serif;';
  ftr.textContent = APP_URL;
  wrap.appendChild(ftr);

  document.body.appendChild(wrap);
  await new Promise(r => setTimeout(r, 500));

  try {
    const canvas = await html2canvas(wrap, {
      backgroundColor: '#0a0a14',
      useCORS: true,
      allowTaint: true,
      scale: 2,
      logging: false,
    });
    return canvas;
  } finally {
    document.body.removeChild(wrap);
    document.body.removeChild(overlay);
  }
}

async function shareDownload() {
  try {
    const canvas = await captureImage();
    const a = document.createElement('a');
    a.download = 'fc26-pack.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (e) { alert('Errore generazione immagine: ' + e.message); }
}

function shareWhatsApp() {
  const txt = `🎮 Ho aperto un pacchetto FC26! 🎁 Prova anche tu: ${APP_URL}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
}

function shareEmail() {
  const sub = 'Il mio pacchetto FC26!';
  const body = `Ho aperto un pacchetto su FC26 Pack Opener!\n🎁 Prova anche tu: ${APP_URL}`;
  window.location.href = `mailto:?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(body)}`;
}

// ===========================================================
//  COLLAPSIBLE SECTIONS
// ===========================================================
function toggleSection(sId, aId) {
  const s = $(sId), a = $(aId);
  const open = s.classList.toggle('open');
  a.classList.toggle('open', open);
}

// ===========================================================
//  MODAL ROSA COMPLETA (opzionale - apri da badge squadra)
// ===========================================================
function closeModal() { $('modal-overlay').classList.add('hidden'); }

// ===========================================================
//  INIT
// ===========================================================
function init() {
  // Carica squadra da localStorage
  state.squad = loadSquad();
  refreshSquadUI();

  // Stat grid iniziale
  buildStatGrid();

  // Event listeners
  $('sel-pos').addEventListener('change', () => { buildStatGrid(); schedulePool(); });
  $('tog-gk').addEventListener('change', schedulePool);
  $('tog-excl').addEventListener('change', schedulePool);
  $('num-cards').addEventListener('input', schedulePool);

  $('ovr-min').addEventListener('change', () => {
    const mn = parseInt($('ovr-min').value), mx = parseInt($('ovr-max').value);
    if (mn > mx) $('ovr-max').value = mn;
    schedulePool();
  });
  $('ovr-max').addEventListener('change', () => {
    const mn = parseInt($('ovr-min').value), mx = parseInt($('ovr-max').value);
    if (mx < mn) $('ovr-min').value = mx;
    schedulePool();
  });

  // Pool iniziale
  fetchPool();
}

document.addEventListener('DOMContentLoaded', init);
