'use strict';
/* =====================================================
   FC26 Pack Opener v3 — Login + Multiplayer + Search
   ===================================================== */

const OUTFIELD_STATS  = ['PAC','SHO','PAS','DRI','DEF','PHY'];
const GK_STATS        = ['DIV','HAN','KIC','POS','REF','SPD'];
const USER_KEY        = 'fc26_user_v3';
const SQUAD_KEY       = 'fc26_squad_v2';
const EXCL_KEY        = 'fc26_excl_manual';
const APP_URL         = window.location.origin;

// ── Stato ────────────────────────────────────────────────────────────────────
const user  = { uid: null, username: null };    // corrente utente
const state = {
  roomCode: null, isHost: false, members: 0,
  pack: [], packMap: {},
  rosters: [], squad: [], manualExcluded: [],
};

// ── Socket ───────────────────────────────────────────────────────────────────
const socket = io();

socket.on('connect', () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  if (code && user.uid) joinRoom(code);
});

socket.on('room_created', d => enterRoom(d.code, true, d.members, d.names || []));
socket.on('room_joined',  d => enterRoom(d.code, d.is_host, d.members, d.names || []));
socket.on('room_error',   d => { showLobbyError(d.message); hideLobbyLoading(); });

socket.on('members_updated', d => {
  state.members = d.count;
  updateMembersUI(d.count, d.names || []);
});

socket.on('pack_opened', d => {
  state.pack = d.players;
  state.packMap = {};
  d.players.forEach(p => { state.packMap[p.id] = p; });
  renderPack(d.players, new Set(d.revealed || []));
});

socket.on('card_revealed',  d => flipCardByIndex(d.index, true));
socket.on('all_revealed',   d => {
  const n = d.total || state.pack.length;
  for (let i = 0; i < n; i++) setTimeout(() => flipCardByIndex(i, true), i * 150);
  hideRevealBtn();
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function generateUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

function doLogin() {
  const name = document.getElementById('login-name').value.trim();
  if (name.length < 2) {
    document.getElementById('login-error').classList.remove('hidden');
    return;
  }
  user.uid      = generateUID();
  user.username = name;
  localStorage.setItem(USER_KEY, JSON.stringify({uid: user.uid, username: user.username}));
  document.getElementById('screen-login').classList.add('hidden');
  showLobby();
}

// ── LOBBY ─────────────────────────────────────────────────────────────────────
function showLobby() {
  document.getElementById('screen-lobby').classList.remove('hidden');
  document.getElementById('screen-app').classList.add('hidden');
  // Mostra nome utente
  const el = document.getElementById('lobby-user');
  if (el && user.username) el.innerHTML = `Ciao, <span>${user.username}</span>! &nbsp;<a href="#" onclick="changeUser()" style="color:var(--text2);font-size:.72rem">cambia</a>`;
  // Auto-join se ?room nell'URL
  const code = new URLSearchParams(window.location.search).get('room');
  if (code) { document.getElementById('code-input').value = code.toUpperCase(); joinRoomFromInput(); }
}

function changeUser() {
  localStorage.removeItem(USER_KEY);
  document.getElementById('screen-lobby').classList.add('hidden');
  document.getElementById('screen-login').classList.remove('hidden');
}

function showLobbyError(msg) {
  const el = document.getElementById('lobby-error');
  el.textContent = msg; el.classList.remove('hidden');
}
function hideLobbyLoading() { document.getElementById('lobby-loading').classList.add('hidden'); }

function createRoom() {
  document.getElementById('lobby-error').classList.add('hidden');
  document.getElementById('lobby-loading').classList.remove('hidden');
  socket.emit('create_room', { uid: user.uid, username: user.username });
}

function joinRoomFromInput() {
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  if (!code) { showLobbyError('Inserisci il codice stanza'); return; }
  joinRoom(code);
}

function joinRoom(code) {
  document.getElementById('lobby-error').classList.add('hidden');
  document.getElementById('lobby-loading').classList.remove('hidden');
  socket.emit('join_room_req', { code, uid: user.uid, username: user.username });
}

// ── ROOM ─────────────────────────────────────────────────────────────────────
function enterRoom(code, isHost, members, names) {
  state.roomCode = code; state.isHost = isHost; state.members = members;
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  window.history.replaceState({}, '', url.toString());
  document.getElementById('hdr-code').textContent = code;
  updateMembersUI(members, names);
  const roleEl = document.getElementById('hdr-role');
  roleEl.textContent = isHost ? '👑 Host' : '👁 Spettatore';
  roleEl.className = isHost ? 'host' : 'viewer';
  document.getElementById('sidebar').style.display = isHost ? '' : 'none';
  document.getElementById('idle-msg').textContent = isHost
    ? 'Configura il pacchetto e premi APRI PACCHETTO'
    : 'In attesa che l\'host apra un pacchetto...';
  document.getElementById('screen-lobby').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');
  if (isHost) fetchPool();
}

function updateMembersUI(count, names) {
  document.getElementById('hdr-members').textContent = `👥 ${count}`;
  const popup = document.getElementById('members-popup');
  if (popup) {
    popup.innerHTML = `<div class="mp-title">Connessi</div>` +
      (names||[]).map(n => `<div class="mp-item">${n === state.roomCode ? '' : ''}${n}</div>`).join('') ||
      '<div class="mp-item" style="color:var(--text2)">—</div>';
  }
}

function toggleMembersList() {
  document.getElementById('members-popup').classList.toggle('hidden');
}

function leaveRoom() {
  state.roomCode = null; state.isHost = false; state.pack = [];
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url.toString());
  document.getElementById('screen-app').classList.add('hidden');
  document.getElementById('play-area').innerHTML = `<div class="idle"><div class="idle-icon">🎁</div><p id="idle-msg">...</p></div>`;
  showLobby();
}

function copyLink() {
  const url = `${APP_URL}?room=${state.roomCode}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.btn-copy');
    const orig = btn.textContent;
    btn.textContent = '✓ Copiato!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }).catch(() => prompt('Copia questo link:', url));
}

// ── PACK OPENING ──────────────────────────────────────────────────────────────
function openPackLive() {
  if (!state.isHost || !state.roomCode) return;
  socket.emit('open_pack_live', { room_code: state.roomCode, uid: user.uid, config: getConfig() });
}

function revealCardLive(index) {
  if (!state.isHost || !state.roomCode) return;
  socket.emit('reveal_card_live', { room_code: state.roomCode, uid: user.uid, index });
}

function revealAllLive() {
  if (!state.isHost || !state.roomCode) return;
  socket.emit('reveal_all_live', { room_code: state.roomCode, uid: user.uid });
  hideRevealBtn();
}

function hideRevealBtn() {
  const btn = document.getElementById('btn-reveal');
  if (btn) btn.classList.add('hidden');
}

// ── CARD RENDERING ────────────────────────────────────────────────────────────
function tier(ovr) { return ovr>=87?'t-elite':ovr>=82?'t-high':ovr>=75?'t-mid':'t-low'; }
function statColor(v) { return v>=85?'#f0d080':v>=75?'#48bb78':v>=65?'#7abcf5':'#8888a8'; }

function buildCard(player, index, alreadyFlipped) {
  const wrap = document.createElement('div');
  wrap.className = 'card-wrap' + (alreadyFlipped ? ' flipped' : '');
  wrap.style.animationDelay = alreadyFlipped ? '0s' : `${index*0.1}s`;
  wrap.dataset.index = index;
  const inSquad = isInSquad(player.id);
  const statsHTML = Object.entries(player.stats)
    .map(([k,v]) => `<div class="sitem"><span class="sval" style="color:${statColor(v)}">${v}</span><span class="slbl">${k}</span></div>`).join('');
  const imgHTML = player.face_url
    ? `<img src="${player.face_url}" alt="${player.name}" crossorigin="anonymous" onerror="this.outerHTML='<span class=no-img>⚽</span>'">`
    : '<span class="no-img">⚽</span>';
  wrap.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-back">⚽</div>
      <div class="card-face card-front ${tier(player.overall)}">
        <div class="card-hdr"><div class="card-ovr">${player.overall}</div><div class="card-pos">${player.position}</div></div>
        <div class="card-img">${imgHTML}</div>
        <div class="card-name">${player.name}</div>
        <div class="card-club">${player.club}</div>
        <div class="card-div"></div>
        <div class="card-stats">${statsHTML}</div>
        <button class="card-add-btn ${inSquad?'in-squad':''}" data-id="${player.id}"
          onclick="event.stopPropagation();handleAddBtn(this,${player.id})">
          ${inSquad?'✓ In Rosa':'➕ Aggiungi alla Rosa'}
        </button>
        ${alreadyFlipped?'':'<div class="card-shine"></div>'}
      </div>
    </div>`;
  if (!alreadyFlipped) {
    wrap.addEventListener('click', () => { if (state.isHost && !wrap.classList.contains('flipped')) revealCardLive(index); });
    setTimeout(() => { const s = wrap.querySelector('.card-shine'); if (s) s.remove(); }, 900);
  }
  return wrap;
}

function flipCardByIndex(index, animate) {
  const wrap = document.querySelector(`.card-wrap[data-index="${index}"]`);
  if (!wrap || wrap.classList.contains('flipped')) return;
  wrap.classList.add('flipped');
  if (animate) {
    const front = wrap.querySelector('.card-front');
    if (front) { const sh = document.createElement('div'); sh.className='card-shine'; front.appendChild(sh); setTimeout(()=>sh.remove(),900); }
  }
  const total = document.querySelectorAll('.card-wrap').length;
  if (document.querySelectorAll('.card-wrap.flipped').length >= total) hideRevealBtn();
}

function renderPack(players, alreadyRevealed) {
  const area = document.getElementById('play-area');
  area.innerHTML = '';
  const bar = document.createElement('div');
  bar.className = 'action-bar';
  if (state.isHost) {
    bar.innerHTML = `
      <button id="btn-reveal" class="abtn gold" onclick="revealAllLive()">⚡ Rivela tutte</button>
      <button class="abtn gold" onclick="addAllToSquad()">➕ Aggiungi tutte</button>
      <button class="abtn blue" onclick="shareDownload()">📥 Salva immagine</button>
      <button class="abtn green" onclick="shareWhatsApp()">💬 WhatsApp</button>
      <button class="abtn orange" onclick="shareEmail()">📧 Email</button>`;
  } else {
    bar.innerHTML = `
      <button class="abtn gold" onclick="addAllToSquad()">➕ Aggiungi tutte alla Rosa</button>
      <button class="abtn blue" onclick="shareDownload()">📥 Salva immagine</button>`;
  }
  const grid = document.createElement('div');
  grid.className = 'cards-grid'; grid.id = 'cards-grid';
  players.forEach((p,i) => grid.appendChild(buildCard(p, i, alreadyRevealed.has(i))));
  area.appendChild(bar); area.appendChild(grid);
  if (alreadyRevealed.size >= players.length) hideRevealBtn();
}

// ── SQUAD ─────────────────────────────────────────────────────────────────────
function loadSquad() { try { return JSON.parse(localStorage.getItem(SQUAD_KEY)||'[]'); } catch { return []; } }
function saveSquad() { localStorage.setItem(SQUAD_KEY, JSON.stringify(state.squad)); }
function isInSquad(id) { return state.squad.some(p=>p.id===id); }
function addToSquad(p) {
  if (isInSquad(p.id)) return;
  state.squad.push({id:p.id,name:p.name,position:p.position,overall:p.overall,club:p.club});
  saveSquad(); refreshSquadUI(); schedulePool();
}
function removeFromSquad(id) {
  state.squad = state.squad.filter(p=>p.id!==id);
  saveSquad(); refreshSquadUI(); schedulePool();
  const btn = document.querySelector(`.card-add-btn[data-id="${id}"]`);
  if (btn) setAddBtnState(btn, false);
}
function clearSquad() {
  if (!state.squad.length) return;
  if (!confirm(`Svuotare la rosa (${state.squad.length} giocatori)?`)) return;
  state.squad=[]; saveSquad(); refreshSquadUI(); schedulePool();
  document.querySelectorAll('.card-add-btn.in-squad').forEach(b=>setAddBtnState(b,false));
}
function setAddBtnState(btn, inSquad) {
  btn.classList.toggle('in-squad',inSquad);
  btn.textContent = inSquad ? '✓ In Rosa' : '➕ Aggiungi alla Rosa';
}
function handleAddBtn(btn, id) {
  const p = state.packMap[id]; if (!p) return;
  if (isInSquad(id)) { removeFromSquad(id); setAddBtnState(btn,false); }
  else { addToSquad(p); setAddBtnState(btn,true); }
}
function addAllToSquad() {
  state.pack.forEach(p => {
    if (!isInSquad(p.id)) { addToSquad(p); const b=document.querySelector(`.card-add-btn[data-id="${p.id}"]`); if(b) setAddBtnState(b,true); }
  });
}
function refreshSquadUI() {
  const list=document.getElementById('squad-list'), badge=document.getElementById('squad-badge'), n=state.squad.length;
  badge.textContent=n; badge.classList.toggle('hidden',n===0);
  list.innerHTML='';
  [...state.squad].reverse().forEach(p=>{
    const item=document.createElement('div'); item.className='squad-item';
    item.innerHTML=`<span class="squad-ovr">${p.overall}</span><span class="squad-name">${p.name}</span><span class="squad-pos">${p.position}</span><button class="btn-rm" onclick="removeFromSquad(${p.id})">✕</button>`;
    list.appendChild(item);
  });
}

// ── RICERCA MANUALE GIOCATORI ─────────────────────────────────────────────────
function loadManualExcl() { try { return JSON.parse(localStorage.getItem(EXCL_KEY)||'[]'); } catch { return []; } }
function saveManualExcl() { localStorage.setItem(EXCL_KEY, JSON.stringify(state.manualExcluded)); }

function isManualExcluded(id) { return state.manualExcluded.some(p=>p.id===id); }

function addManualExcl(p) {
  if (isManualExcluded(p.id)) return;
  state.manualExcluded.push({id:p.id,name:p.name,overall:p.overall,position:p.position,club:p.club});
  saveManualExcl(); refreshManualExclUI(); schedulePool();
}
function removeManualExcl(id) {
  state.manualExcluded = state.manualExcluded.filter(p=>p.id!==id);
  saveManualExcl(); refreshManualExclUI(); schedulePool();
}
function refreshManualExclUI() {
  const list=document.getElementById('manual-excl-list'), badge=document.getElementById('excl-badge');
  const n = state.manualExcluded.length;
  if (badge) { badge.textContent=n; badge.classList.toggle('hidden',n===0); }
  if (!list) return;
  list.innerHTML='';
  state.manualExcluded.forEach(p=>{
    const item=document.createElement('div'); item.className='excl-item';
    item.innerHTML=`<span class="excl-ovr">${p.overall}</span><span class="excl-name">${p.name}</span><span class="excl-pos">${p.position}</span><button class="btn-rm" onclick="removeManualExcl(${p.id})">✕</button>`;
    list.appendChild(item);
  });
}

let searchTimer = null;
function onSearchInput(val) {
  clearTimeout(searchTimer);
  if (val.trim().length < 2) { hideSearchResults(); return; }
  searchTimer = setTimeout(() => doSearch(val.trim()), 300);
}

async function doSearch(q) {
  try {
    const ovrMin = parseInt(document.getElementById('ovr-min')?.value||47);
    const ovrMax = parseInt(document.getElementById('ovr-max')?.value||91);
    const r = await fetch(`/api/players/search?q=${encodeURIComponent(q)}&ovr_min=${ovrMin}&ovr_max=${ovrMax}`);
    const d = await r.json();
    showSearchResults(d.players || []);
  } catch { hideSearchResults(); }
}

function showSearchResults(players) {
  const el = document.getElementById('search-results');
  if (!el) return;
  if (!players.length) { el.innerHTML='<div style="padding:10px 12px;color:var(--text2);font-size:.78rem">Nessun risultato</div>'; el.classList.remove('hidden'); return; }
  el.innerHTML = players.map(p => {
    const added = isManualExcluded(p.id);
    return `<div class="search-result-item">
      <span class="sr-ovr">${p.overall}</span>
      <div class="sr-info"><div class="sr-name">${p.name}</div><div class="sr-sub">${p.club}</div></div>
      <span class="sr-pos">${p.position}</span>
      <button class="sr-add ${added?'added':''}" onclick="toggleManualExcl(this,${JSON.stringify(p).replace(/"/g,'&quot;')})">
        ${added?'✓':'+ Escludi'}
      </button>
    </div>`;
  }).join('');
  el.classList.remove('hidden');
}

function toggleManualExcl(btn, player) {
  if (isManualExcluded(player.id)) { removeManualExcl(player.id); btn.textContent='+ Escludi'; btn.classList.remove('added'); }
  else { addManualExcl(player); btn.textContent='✓'; btn.classList.add('added'); }
}

function hideSearchResults() { document.getElementById('search-results')?.classList.add('hidden'); }

// ── ROSTER UPLOAD ─────────────────────────────────────────────────────────────
function parseRosterFile(filename, raw) {
  let d; try { d=JSON.parse(raw); } catch { return null; }
  let ids=[];
  if (Array.isArray(d)) ids=d.map(x=>typeof x==='object'?(x.id||x.player_id):x).filter(Boolean).map(Number);
  else if (d.players) ids=d.players.map(x=>typeof x==='object'?(x.id||x.player_id):x).filter(Boolean).map(Number);
  else if (d.squad) ids=d.squad.map(x=>typeof x==='object'?(x.id||x.player_id):x).filter(Boolean).map(Number);
  if (!ids.length) return null;
  return {name:d.team||d.name||d.team_name||filename.replace('.json',''), ids};
}
function refreshRosterUI() {
  const list=document.getElementById('roster-list'); list.innerHTML='';
  state.rosters.forEach((r,i)=>{
    const item=document.createElement('div'); item.className='roster-item';
    item.innerHTML=`<div class="roster-info"><span class="roster-name">${r.name}</span><span class="roster-count">${r.ids.length} giocatori</span></div><button class="btn-rm" onclick="removeRoster(${i})">✕</button>`;
    list.appendChild(item);
  });
  schedulePool();
}
function removeRoster(i) { state.rosters.splice(i,1); refreshRosterUI(); }

document.getElementById('roster-input').addEventListener('change', async e => {
  for (const file of e.target.files) {
    const r=parseRosterFile(file.name, await file.text());
    if (r && !state.rosters.find(x=>x.name===r.name)) state.rosters.push(r);
    else if (!r) alert(`File "${file.name}" non riconosciuto.`);
  }
  e.target.value=''; refreshRosterUI();
});

// ── CONFIG & POOL ─────────────────────────────────────────────────────────────
function getExcludedIds() {
  const ids = new Set();
  state.rosters.forEach(r=>r.ids.forEach(id=>ids.add(id)));
  state.manualExcluded.forEach(p=>ids.add(p.id));
  if (document.getElementById('tog-excl').checked) state.squad.forEach(p=>ids.add(p.id));
  return [...ids];
}
function getConfig() {
  return {
    ovr_min:parseInt(document.getElementById('ovr-min').value),
    ovr_max:parseInt(document.getElementById('ovr-max').value),
    num_cards:parseInt(document.getElementById('num-cards').value),
    include_gk:document.getElementById('tog-gk').checked,
    position_filter:document.getElementById('sel-pos').value,
    min_stats:getMinStats(),
    excluded_ids:getExcludedIds(),
  };
}
function getMinStats() {
  const s={}; document.querySelectorAll('[data-stat]').forEach(i=>{ const v=parseInt(i.value)||0; if(v>0) s[i.dataset.stat]=v; }); return s;
}
function buildStatGrid() {
  const isGK=document.getElementById('sel-pos').value==='GK', keys=isGK?GK_STATS:OUTFIELD_STATS;
  document.getElementById('stat-type').textContent=isGK?'(portiere)':'(outfield)';
  document.getElementById('stat-grid').innerHTML=keys.map(k=>`
    <div class="stat-cell"><label>${k}</label>
    <input type="number" data-stat="${k}" value="0" min="0" max="99"
      oninput="this.classList.toggle('active',parseInt(this.value)>0);schedulePool()"></div>`).join('');
}
let poolTimer=null;
function schedulePool(){clearTimeout(poolTimer);poolTimer=setTimeout(fetchPool,420);}
async function fetchPool() {
  if (!state.isHost) return;
  const cfg=getConfig();
  if (isNaN(cfg.ovr_min)||isNaN(cfg.ovr_max)||cfg.ovr_min>cfg.ovr_max){document.getElementById('pool-box').innerHTML='<span style="color:var(--red)">Range non valido</span>';return;}
  try {
    const r=await fetch('/api/pack/pool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
    const d=await r.json();
    document.getElementById('pool-box').innerHTML=d.pool_size!==undefined
      ?`<strong>${d.pool_size.toLocaleString()}</strong> giocatori disponibili`
      :`<span style="color:var(--red)">${d.error}</span>`;
  } catch {document.getElementById('pool-box').textContent='—';}
}

// ── COLLAPSIBLE ───────────────────────────────────────────────────────────────
function toggleSection(sId,aId){
  const s=document.getElementById(sId),a=document.getElementById(aId);
  s.classList.toggle('open'); a.classList.toggle('open',s.classList.contains('open'));
}

// ── SHARE ─────────────────────────────────────────────────────────────────────
async function captureImage() {
  document.querySelectorAll('.card-wrap:not(.flipped)').forEach(w=>w.classList.add('flipped'));
  const overlay=document.createElement('div'); overlay.className='cap-overlay';
  overlay.innerHTML='<div class="spinner"></div><span>Generazione immagine...</span>';
  document.body.appendChild(overlay);
  const wrap=document.createElement('div');
  wrap.style.cssText='position:fixed;left:-9999px;top:0;background:#0a0a14;padding:22px 18px 16px;border-radius:14px;';
  const hdr=document.createElement('div'); hdr.style.cssText='text-align:center;margin-bottom:16px;font-family:Segoe UI,sans-serif;';
  hdr.innerHTML=`<span style="color:#f0d080;font-size:1.1rem;font-weight:800;letter-spacing:2px">⚽ FC26 PACK OPENER</span>`;
  wrap.appendChild(hdr);
  const gridClone=document.getElementById('cards-grid').cloneNode(true);
  gridClone.style.cssText='display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:960px;';
  gridClone.querySelectorAll('.card-wrap').forEach(w=>{w.style.animation='none';w.style.perspective='none';});
  gridClone.querySelectorAll('.card-inner').forEach(e=>{e.style.cssText='transform:none;transform-style:flat;';});
  gridClone.querySelectorAll('.card-face.card-back').forEach(e=>e.remove());
  gridClone.querySelectorAll('.card-face.card-front').forEach(e=>{e.style.cssText='position:relative;backface-visibility:visible;';});
  gridClone.querySelectorAll('.card-shine,.card-add-btn').forEach(e=>e.remove());
  wrap.appendChild(gridClone);
  const ftr=document.createElement('div'); ftr.style.cssText='text-align:center;margin-top:12px;color:#8888a8;font-size:.65rem;font-family:Segoe UI,sans-serif;';
  ftr.textContent=`${APP_URL}?room=${state.roomCode||''}`;
  wrap.appendChild(ftr); document.body.appendChild(wrap);
  await new Promise(r=>setTimeout(r,500));
  try {
    const canvas=await html2canvas(wrap,{backgroundColor:'#0a0a14',useCORS:true,allowTaint:true,scale:2,logging:false});
    return canvas;
  } finally {document.body.removeChild(wrap);document.body.removeChild(overlay);}
}
async function shareDownload(){try{const c=await captureImage();const a=document.createElement('a');a.download='fc26-pack.png';a.href=c.toDataURL('image/png');a.click();}catch(e){alert('Errore: '+e.message);}}
function shareWhatsApp(){window.open(`https://wa.me/?text=${encodeURIComponent(`🎮 Ho aperto un pacchetto FC26!\nUnisciti: ${APP_URL}?room=${state.roomCode||''}`)}`, '_blank');}
function shareEmail(){window.location.href=`mailto:?subject=${encodeURIComponent('FC26 Pack!')}&body=${encodeURIComponent(`Ho aperto un pacchetto!\nUnisciti: ${APP_URL}?room=${state.roomCode||''}`)}`);}

// ── INIT ──────────────────────────────────────────────────────────────────────
function init() {
  // Carica dati persistenti
  state.squad          = loadSquad();
  state.manualExcluded = loadManualExcl();
  refreshSquadUI();
  refreshManualExclUI();

  // Controlla se utente già loggato
  const savedUser = loadUser();
  if (savedUser && savedUser.uid && savedUser.username) {
    user.uid = savedUser.uid; user.username = savedUser.username;
    showLobby();
  } else {
    document.getElementById('screen-login').classList.remove('hidden');
  }

  // Event listeners sidebar
  document.getElementById('sel-pos').addEventListener('change',()=>{buildStatGrid();schedulePool();});
  document.getElementById('tog-gk').addEventListener('change',schedulePool);
  document.getElementById('tog-excl').addEventListener('change',schedulePool);
  document.getElementById('num-cards').addEventListener('input',schedulePool);
  document.getElementById('ovr-min').addEventListener('change',()=>{
    const mn=parseInt(document.getElementById('ovr-min').value),mx=parseInt(document.getElementById('ovr-max').value);
    if(mn>mx)document.getElementById('ovr-max').value=mn; schedulePool();
  });
  document.getElementById('ovr-max').addEventListener('change',()=>{
    const mn=parseInt(document.getElementById('ovr-min').value),mx=parseInt(document.getElementById('ovr-max').value);
    if(mx<mn)document.getElementById('ovr-min').value=mx; schedulePool();
  });
  buildStatGrid();

  // Chiudi popup membri cliccando fuori
  document.addEventListener('click', e => {
    if (!e.target.closest('.members-wrap')) document.getElementById('members-popup')?.classList.add('hidden');
  });
}

function closeModal(){document.getElementById('modal-overlay')?.classList.add('hidden');}
document.addEventListener('DOMContentLoaded', init);
