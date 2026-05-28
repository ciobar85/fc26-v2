'use strict';
/* =====================================================
   FC26 Pack Opener v3 — Real-time multiplayer
   ===================================================== */

const OUTFIELD_STATS = ['PAC','SHO','PAS','DRI','DEF','PHY'];
const GK_STATS       = ['DIV','HAN','KIC','POS','REF','SPD'];
const SQUAD_KEY      = 'fc26_squad_v2';
const APP_URL        = window.location.origin;

// ---- Stato ----
const state = {
  roomCode:  null,
  isHost:    false,
  members:   1,
  pack:      [],
  packMap:   {},
  rosters:   [],
  squad:     [],
};

// ---- Socket ----
const socket = io();

// ================================================================
//  SOCKET EVENTS
// ================================================================
socket.on('connect', () => {
  // Se URL ha ?room=CODE, auto-join
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  if (code) joinRoom(code);
});

socket.on('room_created', data => {
  enterRoom(data.code, true, data.members);
});

socket.on('room_joined', data => {
  enterRoom(data.code, data.is_host, data.members);
});

socket.on('room_error', data => {
  showLobbyError(data.message);
  hideLobbyLoading();
});

socket.on('members_updated', data => {
  state.members = data.count;
  updateMembersUI(data.count);
});

socket.on('host_changed', () => {
  // Se questo client era il secondo, ora è host
  if (!state.isHost) {
    state.isHost = true;
    setHostMode(true);
  }
});

socket.on('pack_opened', data => {
  state.pack = data.players;
  state.packMap = {};
  data.players.forEach(p => { state.packMap[p.id] = p; });
  const alreadyRevealed = new Set(data.revealed || []);
  renderPack(data.players, alreadyRevealed);
});

socket.on('card_revealed', data => {
  flipCardByIndex(data.index, true);
});

socket.on('all_revealed', data => {
  const total = data.total || state.pack.length;
  for (let i = 0; i < total; i++) {
    const delay = i * 150;
    setTimeout(() => flipCardByIndex(i, true), delay);
  }
  hideRevealBtn();
});

// ================================================================
//  LOBBY
// ================================================================
function showLobby() {
  document.getElementById('screen-lobby').classList.remove('hidden');
  document.getElementById('screen-app').classList.add('hidden');
}

function showApp() {
  document.getElementById('screen-lobby').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');
}

function showLobbyError(msg) {
  const el = document.getElementById('lobby-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideLobbyLoading() {
  document.getElementById('lobby-loading').classList.add('hidden');
  document.getElementById('btn-create-ref') && (document.getElementById('btn-create-ref').disabled = false);
}

function createRoom() {
  document.getElementById('lobby-error').classList.add('hidden');
  document.getElementById('lobby-loading').classList.remove('hidden');
  socket.emit('create_room');
}

function joinRoomFromInput() {
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  if (!code) { showLobbyError('Inserisci il codice stanza'); return; }
  joinRoom(code);
}

function joinRoom(code) {
  document.getElementById('lobby-error').classList.add('hidden');
  document.getElementById('lobby-loading').classList.remove('hidden');
  socket.emit('join_room_req', { code });
}

// ================================================================
//  ROOM
// ================================================================
function enterRoom(code, isHost, members) {
  state.roomCode = code;
  state.isHost   = isHost;
  state.members  = members;

  // Aggiorna URL senza ricaricare (per condivisione link)
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  window.history.replaceState({}, '', url.toString());

  // Header
  document.getElementById('hdr-code').textContent = code;
  updateMembersUI(members);

  // Ruolo
  const roleEl = document.getElementById('hdr-role');
  roleEl.textContent = isHost ? '👑 Host' : '👁 Spettatore';
  roleEl.className = isHost ? 'host' : 'viewer';

  // Sidebar visibile solo per host
  setHostMode(isHost);

  // Messaggio idle
  document.getElementById('idle-msg').textContent = isHost
    ? 'Configura il pacchetto e premi APRI PACCHETTO'
    : 'In attesa che l\'host apra un pacchetto...';

  showApp();
  if (isHost) fetchPool();
}

function setHostMode(isHost) {
  const sidebar = document.getElementById('sidebar');
  sidebar.style.display = isHost ? '' : 'none';
}

function updateMembersUI(count) {
  document.getElementById('hdr-members').textContent = `👥 ${count}`;
}

function leaveRoom() {
  state.roomCode = null;
  state.isHost   = false;
  state.pack     = [];
  // Rimuovi ?room dall'URL
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url.toString());
  showLobby();
  document.getElementById('play-area').innerHTML = `
    <div class="idle"><div class="idle-icon">🎁</div><p id="idle-msg">...</p></div>`;
}

function copyLink() {
  const url = `${APP_URL}?room=${state.roomCode}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.btn-copy');
    const orig = btn.textContent;
    btn.textContent = '✓ Copiato!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }).catch(() => prompt('Copia questo link:', `${APP_URL}?room=${state.roomCode}`));
}

// ================================================================
//  PACK OPENING (host → broadcast a tutti)
// ================================================================
function openPackLive() {
  if (!state.isHost || !state.roomCode) return;
  const cfg = getConfig();
  socket.emit('open_pack_live', { room_code: state.roomCode, config: cfg });
}

function revealCardLive(index) {
  if (!state.isHost || !state.roomCode) return;
  socket.emit('reveal_card_live', { room_code: state.roomCode, index });
}

function revealAllLive() {
  if (!state.isHost || !state.roomCode) return;
  socket.emit('reveal_all_live', { room_code: state.roomCode });
  hideRevealBtn();
}

function hideRevealBtn() {
  const btn = document.getElementById('btn-reveal');
  if (btn) btn.classList.add('hidden');
}

// ================================================================
//  CARD RENDERING
// ================================================================
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

function buildCard(player, index, alreadyFlipped) {
  const wrap = document.createElement('div');
  wrap.className = 'card-wrap' + (alreadyFlipped ? ' flipped' : '');
  wrap.style.animationDelay = alreadyFlipped ? '0s' : `${index * 0.1}s`;
  wrap.dataset.index = index;

  const statsHTML = Object.entries(player.stats)
    .map(([k,v]) => `<div class="sitem"><span class="sval" style="color:${statColor(v)}">${v}</span><span class="slbl">${k}</span></div>`)
    .join('');

  const imgHTML = player.face_url
    ? `<img src="${player.face_url}" alt="${player.name}" crossorigin="anonymous" onerror="this.outerHTML='<span class=no-img>⚽</span>'">`
    : '<span class="no-img">⚽</span>';

  const inSquad = isInSquad(player.id);

  wrap.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-back">⚽</div>
      <div class="card-face card-front ${tier(player.overall)}">
        <div class="card-hdr">
          <div class="card-ovr">${player.overall}</div>
          <div class="card-pos">${player.position}</div>
        </div>
        <div class="card-img">${imgHTML}</div>
        <div class="card-name">${player.name}</div>
        <div class="card-club">${player.club}</div>
        <div class="card-div"></div>
        <div class="card-stats">${statsHTML}</div>
        <button class="card-add-btn ${inSquad ? 'in-squad' : ''}" data-id="${player.id}"
          onclick="event.stopPropagation();handleAddBtn(this,${player.id})">
          ${inSquad ? '✓ In Rosa' : '➕ Aggiungi alla Rosa'}
        </button>
        ${alreadyFlipped ? '' : '<div class="card-shine"></div>'}
      </div>
    </div>`;

  if (!alreadyFlipped) {
    // Click: se host → rivela per tutti; se viewer → niente (aspetta host)
    wrap.addEventListener('click', () => {
      if (state.isHost && !wrap.classList.contains('flipped')) {
        revealCardLive(index);
      }
    });
    // Rimuovi shine dopo animazione
    setTimeout(() => { const s = wrap.querySelector('.card-shine'); if (s) s.remove(); }, 900);
  }

  return wrap;
}

function flipCardByIndex(index, animate) {
  const wrap = document.querySelector(`.card-wrap[data-index="${index}"]`);
  if (!wrap || wrap.classList.contains('flipped')) return;
  wrap.classList.add('flipped');
  // Aggiungi shine
  const front = wrap.querySelector('.card-front');
  if (front && animate) {
    const shine = document.createElement('div');
    shine.className = 'card-shine';
    front.appendChild(shine);
    setTimeout(() => shine.remove(), 900);
  }
  // Controlla se tutte rivelate
  const total = document.querySelectorAll('.card-wrap').length;
  const revealed = document.querySelectorAll('.card-wrap.flipped').length;
  if (revealed >= total) hideRevealBtn();
}

function renderPack(players, alreadyRevealed) {
  const area = document.getElementById('play-area');
  area.innerHTML = '';

  // Action bar
  const bar = document.createElement('div');
  bar.className = 'action-bar';

  if (state.isHost) {
    bar.innerHTML = `
      <button id="btn-reveal" class="abtn gold" onclick="revealAllLive()">⚡ Rivela tutte</button>
      <button class="abtn gold" onclick="addAllToSquad()">➕ Aggiungi tutte</button>
      <button class="abtn blue"   onclick="shareDownload()">📥 Salva immagine</button>
      <button class="abtn green"  onclick="shareWhatsApp()">💬 WhatsApp</button>
      <button class="abtn orange" onclick="shareEmail()">📧 Email</button>`;
  } else {
    bar.innerHTML = `
      <button class="abtn gold" onclick="addAllToSquad()">➕ Aggiungi tutte alla Rosa</button>
      <button class="abtn blue"   onclick="shareDownload()">📥 Salva immagine</button>`;
  }

  const grid = document.createElement('div');
  grid.className = 'cards-grid';
  grid.id = 'cards-grid';

  players.forEach((p, i) => {
    grid.appendChild(buildCard(p, i, alreadyRevealed.has(i)));
  });

  area.appendChild(bar);
  area.appendChild(grid);

  // Se tutte già rivelate (viewer che si unisce a metà), nascondi il btn
  if (alreadyRevealed.size >= players.length) hideRevealBtn();
}

// ================================================================
//  SQUAD (localStorage)
// ================================================================
function loadSquad() {
  try { return JSON.parse(localStorage.getItem(SQUAD_KEY) || '[]'); } catch { return []; }
}
function saveSquad() { localStorage.setItem(SQUAD_KEY, JSON.stringify(state.squad)); }
function isInSquad(id) { return state.squad.some(p => p.id === id); }

function addToSquad(player) {
  if (isInSquad(player.id)) return;
  state.squad.push({id:player.id, name:player.name, position:player.position, overall:player.overall, club:player.club});
  saveSquad(); refreshSquadUI(); schedulePool();
}

function removeFromSquad(id) {
  state.squad = state.squad.filter(p => p.id !== id);
  saveSquad(); refreshSquadUI(); schedulePool();
  const btn = document.querySelector(`.card-add-btn[data-id="${id}"]`);
  if (btn) setAddBtnState(btn, false);
}

function clearSquad() {
  if (!state.squad.length) return;
  if (!confirm(`Svuotare la rosa (${state.squad.length} giocatori)?`)) return;
  state.squad = []; saveSquad(); refreshSquadUI(); schedulePool();
  document.querySelectorAll('.card-add-btn.in-squad').forEach(b => setAddBtnState(b, false));
}

function setAddBtnState(btn, inSquad) {
  btn.classList.toggle('in-squad', inSquad);
  btn.textContent = inSquad ? '✓ In Rosa' : '➕ Aggiungi alla Rosa';
}

function handleAddBtn(btn, id) {
  const player = state.packMap[id];
  if (!player) return;
  if (isInSquad(id)) { removeFromSquad(id); setAddBtnState(btn, false); }
  else { addToSquad(player); setAddBtnState(btn, true); }
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

function refreshSquadUI() {
  const list  = document.getElementById('squad-list');
  const badge = document.getElementById('squad-badge');
  const n = state.squad.length;
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
  list.innerHTML = '';
  [...state.squad].reverse().forEach(p => {
    const item = document.createElement('div');
    item.className = 'squad-item';
    item.innerHTML = `<span class="squad-ovr">${p.overall}</span><span class="squad-name">${p.name}</span><span class="squad-pos">${p.position}</span><button class="btn-rm" onclick="removeFromSquad(${p.id})">✕</button>`;
    list.appendChild(item);
  });
}

// ================================================================
//  ROSTER (upload JSON)
// ================================================================
function parseRosterFile(filename, raw) {
  let data; try { data = JSON.parse(raw); } catch { return null; }
  let ids = [];
  if (Array.isArray(data)) ids = data.map(x => typeof x==='object'?(x.id||x.player_id):x).filter(Boolean).map(Number);
  else if (data.players) ids = data.players.map(x => typeof x==='object'?(x.id||x.player_id):x).filter(Boolean).map(Number);
  else if (data.squad) ids = data.squad.map(x => typeof x==='object'?(x.id||x.player_id):x).filter(Boolean).map(Number);
  if (!ids.length) return null;
  return {name: data.team||data.name||data.team_name||filename.replace('.json',''), ids};
}

function refreshRosterUI() {
  const list = document.getElementById('roster-list');
  list.innerHTML = '';
  state.rosters.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'roster-item';
    item.innerHTML = `<div class="roster-info"><span class="roster-name">${r.name}</span><span class="roster-count">${r.ids.length} giocatori</span></div><button class="btn-rm" onclick="removeRoster(${i})">✕</button>`;
    list.appendChild(item);
  });
  schedulePool();
}

function removeRoster(i) { state.rosters.splice(i,1); refreshRosterUI(); }

document.getElementById('roster-input').addEventListener('change', async e => {
  for (const file of e.target.files) {
    const r = parseRosterFile(file.name, await file.text());
    if (r && !state.rosters.find(x => x.name===r.name)) state.rosters.push(r);
    else if (!r) alert(`File "${file.name}" non riconosciuto.`);
  }
  e.target.value = ''; refreshRosterUI();
});

// ================================================================
//  CONFIG & POOL
// ================================================================
function getExcludedIds() {
  const ids = new Set();
  state.rosters.forEach(r => r.ids.forEach(id => ids.add(id)));
  if (document.getElementById('tog-excl').checked) state.squad.forEach(p => ids.add(p.id));
  return [...ids];
}

function getConfig() {
  return {
    ovr_min:         parseInt(document.getElementById('ovr-min').value),
    ovr_max:         parseInt(document.getElementById('ovr-max').value),
    num_cards:       parseInt(document.getElementById('num-cards').value),
    include_gk:      document.getElementById('tog-gk').checked,
    position_filter: document.getElementById('sel-pos').value,
    min_stats:       getMinStats(),
    excluded_ids:    getExcludedIds(),
  };
}

function getMinStats() {
  const s = {};
  document.querySelectorAll('[data-stat]').forEach(inp => {
    const v = parseInt(inp.value)||0; if (v>0) s[inp.dataset.stat]=v;
  });
  return s;
}

function buildStatGrid() {
  const isGK = document.getElementById('sel-pos').value === 'GK';
  const keys = isGK ? GK_STATS : OUTFIELD_STATS;
  document.getElementById('stat-type').textContent = isGK ? '(portiere)' : '(outfield)';
  document.getElementById('stat-grid').innerHTML = keys.map(k => `
    <div class="stat-cell">
      <label>${k}</label>
      <input type="number" data-stat="${k}" value="0" min="0" max="99"
        oninput="this.classList.toggle('active',parseInt(this.value)>0);schedulePool()">
    </div>`).join('');
}

let poolTimer = null;
function schedulePool() { clearTimeout(poolTimer); poolTimer = setTimeout(fetchPool, 420); }

async function fetchPool() {
  if (!state.isHost) return;
  const cfg = getConfig();
  if (isNaN(cfg.ovr_min)||isNaN(cfg.ovr_max)||cfg.ovr_min>cfg.ovr_max) {
    document.getElementById('pool-box').innerHTML = '<span style="color:var(--red)">Range non valido</span>'; return;
  }
  try {
    const r = await fetch('/api/pack/pool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
    const d = await r.json();
    document.getElementById('pool-box').innerHTML = d.pool_size!==undefined
      ? `<strong>${d.pool_size.toLocaleString()}</strong> giocatori disponibili`
      : `<span style="color:var(--red)">${d.error}</span>`;
  } catch { document.getElementById('pool-box').textContent='—'; }
}

// ================================================================
//  COLLAPSIBLE
// ================================================================
function toggleSection(sId, aId) {
  const s = document.getElementById(sId), a = document.getElementById(aId);
  const open = s.classList.toggle('open');
  a.classList.toggle('open', open);
}

// ================================================================
//  SHARE
// ================================================================
async function captureImage() {
  document.querySelectorAll('.card-wrap:not(.flipped)').forEach(w => w.classList.add('flipped'));
  const overlay = document.createElement('div');
  overlay.className = 'cap-overlay';
  overlay.innerHTML = '<div class="spinner"></div><span>Generazione immagine...</span>';
  document.body.appendChild(overlay);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-9999px;top:0;background:#0a0a14;padding:22px 18px 16px;border-radius:14px;';
  const hdr = document.createElement('div');
  hdr.style.cssText = 'text-align:center;margin-bottom:16px;font-family:Segoe UI,sans-serif;';
  hdr.innerHTML = `<span style="color:#f0d080;font-size:1.1rem;font-weight:800;letter-spacing:2px">⚽ FC26 PACK OPENER</span>`;
  wrap.appendChild(hdr);
  const gridClone = document.getElementById('cards-grid').cloneNode(true);
  gridClone.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:960px;';
  gridClone.querySelectorAll('.card-wrap').forEach(w => { w.style.animation='none'; w.style.perspective='none'; });
  gridClone.querySelectorAll('.card-inner').forEach(e => { e.style.cssText='transform:none;transform-style:flat;'; });
  gridClone.querySelectorAll('.card-face.card-back').forEach(e => e.remove());
  gridClone.querySelectorAll('.card-face.card-front').forEach(e => { e.style.cssText='position:relative;backface-visibility:visible;'; });
  gridClone.querySelectorAll('.card-shine,.card-add-btn').forEach(e => e.remove());
  wrap.appendChild(gridClone);
  const ftr = document.createElement('div');
  ftr.style.cssText = 'text-align:center;margin-top:12px;color:#8888a8;font-size:.65rem;font-family:Segoe UI,sans-serif;';
  ftr.textContent = `${APP_URL}?room=${state.roomCode||''}`;
  wrap.appendChild(ftr);
  document.body.appendChild(wrap);
  await new Promise(r => setTimeout(r,500));
  try {
    const canvas = await html2canvas(wrap,{backgroundColor:'#0a0a14',useCORS:true,allowTaint:true,scale:2,logging:false});
    return canvas;
  } finally { document.body.removeChild(wrap); document.body.removeChild(overlay); }
}

async function shareDownload() {
  try {
    const canvas = await captureImage();
    const a = document.createElement('a'); a.download='fc26-pack.png'; a.href=canvas.toDataURL('image/png'); a.click();
  } catch(e) { alert('Errore: '+e.message); }
}
function shareWhatsApp() {
  window.open(`https://wa.me/?text=${encodeURIComponent(`🎮 Ho aperto un pacchetto FC26! Prova anche tu: ${APP_URL}?room=${state.roomCode||''}`)}`, '_blank');
}
function shareEmail() {
  window.location.href = `mailto:?subject=${encodeURIComponent('FC26 Pack!')}&body=${encodeURIComponent(`Ho aperto un pacchetto su FC26 Pack Opener!\n\nUnisciti alla stanza: ${APP_URL}?room=${state.roomCode||''}`)}`;
}

// ================================================================
//  INIT
// ================================================================
function init() {
  state.squad = loadSquad();
  refreshSquadUI();
  buildStatGrid();

  document.getElementById('sel-pos').addEventListener('change', () => { buildStatGrid(); schedulePool(); });
  document.getElementById('tog-gk').addEventListener('change', schedulePool);
  document.getElementById('tog-excl').addEventListener('change', schedulePool);
  document.getElementById('num-cards').addEventListener('input', schedulePool);
  document.getElementById('ovr-min').addEventListener('change', () => {
    const mn=parseInt(document.getElementById('ovr-min').value), mx=parseInt(document.getElementById('ovr-max').value);
    if(mn>mx) document.getElementById('ovr-max').value=mn; schedulePool();
  });
  document.getElementById('ovr-max').addEventListener('change', () => {
    const mn=parseInt(document.getElementById('ovr-min').value), mx=parseInt(document.getElementById('ovr-max').value);
    if(mx<mn) document.getElementById('ovr-min').value=mx; schedulePool();
  });

  // Controlla URL per auto-join (gestito da socket.on('connect'))
  const params = new URLSearchParams(window.location.search);
  if (!params.get('room')) {
    // Nessun room nell'URL, mostra lobby normalmente
  }
}

function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

document.addEventListener('DOMContentLoaded', init);
