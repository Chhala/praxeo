/* ═══════════════════════════════════════
   PRAXEO — app.js  v2.0
═══════════════════════════════════════ */
'use strict';

const COLORS      = ['#005A92','#5D1935','#D4AF37','#E2953B','#6E7A68','#A66E4E','#1A1A18'];
const DAY_NAMES   = ['L','M','M','J','V','S','D'];
const TYPES       = ['routine','tache','long'];
const TYPE_LABELS = { routine:'Routines', tache:'Tâches', long:'Long terme' };

let state = {
  praxis:      [],
  currentPage: 'accueil',
  filter:      'all',
  undoStack:   [],
  undoPage:    null,  // page où le dernier undo s'est produit
  sheet:       { open:false, type:'tache', label:'', color:COLORS[0], days:[1,2,3,4,5] },
  wiggleId:    null,
  editId:      null,
  frozen:      false,  // gel de l'application
  frozenDays:  [],     // dates gelées ['YYYY-MM-DD']
  noteHistory: [],     // historique des notes bloc-notes
  statsHistory: {},    // { 'YYYY-MM-DD': { done: N, total: N, ids: ['r04',...] } }
  statsRecord:  0,     // meilleure série enregistrée
};

/* ══════════════════════════════════════════
   DONNÉES
══════════════════════════════════════════ */
const PRAXIS_DATA = [
  { id:'r01', type:'routine', label:'FAIRE LE LIT', color:randColor(), active:true,  days:[1,2,3,4,5,6,7] },
  { id:'t01', type:'tache',   label:'COURSES',      color:randColor(), active:true  },
  { id:'t02', type:'tache',   label:'SÉRIE TV',     color:randColor(), active:true  },
  { id:'l01', type:'long',    label:'LIRE UN LIVRE',color:randColor(), active:true,  progress:1 },
];

function randColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }

/* ── Persistance localStorage ── */
const STORAGE_KEY = 'praxeo_state_v1';

function saveState() {
  try {
    const snap = {
      praxis:       state.praxis,
      frozen:       state.frozen,
      frozenDays:   state.frozenDays,
      noteHistory:  state.noteHistory,
      statsHistory: state.statsHistory || {},
      statsRecord:  state.statsRecord  || 0,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch(e) { /* quota dépassé — silencieux */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    if (snap.praxis && snap.praxis.length) {
      state.praxis       = snap.praxis;
      state.frozen       = snap.frozen       || false;
      state.frozenDays   = snap.frozenDays   || [];
      state.noteHistory  = snap.noteHistory  || [];
      state.statsHistory = snap.statsHistory || {};
      state.statsRecord  = snap.statsRecord  || 0;
      return true;
    }
  } catch(e) { /* données corrompues — silencieux */ }
  return false;
}

function loadPraxis() {
  if (!loadState()) {
    // Première ouverture : charger les données par défaut
    state.praxis = PRAXIS_DATA.map(p => ({ ...p, days: p.days ? [...p.days] : undefined }));
    saveState();
  }
}

/* ══════════════════════════════════════════
   BOOT
══════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  loadPraxis();
  loadAccueil();
  setTimeout(() => {
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    navigate('accueil');
  }, 1800);
  initNav();
  initSheet();
});

/* ══════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════ */
const PAGE_SUBTITLES = {
  accueil: '',
  praxis:  '',
  stats:   ''
};

function navigate(page) {
  state.currentPage = page;
  exitWiggleMode();
  exitAccueilWiggle();

  document.querySelectorAll('.nav-btn[data-page]').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page)
  );
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById('page-' + page).classList.remove('hidden');

  const sub = document.getElementById('pageSubtitle');
  if (sub) sub.textContent = PAGE_SUBTITLES[page] || '';

  if (page === 'praxis')  renderPraxis();
  if (page === 'accueil') renderAccueil();
  if (page === 'stats')   renderStats();
}

function initNav() {
  document.querySelectorAll('.nav-btn[data-page]').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.page))
  );
  document.getElementById('undoBtn').addEventListener('click', doUndo);
  document.getElementById('menuBtn').addEventListener('click', openMenu);
}

/* ══════════════════════════════════════════
   UNDO
══════════════════════════════════════════ */
function pushUndo(action) {
  state.undoStack.push(action);
  state.undoPage = state.currentPage;
  if (state.undoStack.length > 4) state.undoStack.shift();
}

function doUndo() {
  if (!state.undoStack.length) return;
  const action = state.undoStack.pop();

  // Restaurer selon le type
  if (action.type === 'delete') {
    state.praxis.splice(action.idx, 0, action.praxis);
    saveState();
  }
  else if (action.type === 'accueil_routine') {
    delete accueil.routinesDone[action.id];
    delete accueil.routinesSkipped[action.id];
    saveAccueil();
  }
  else if (action.type === 'accueil_tache_done') {
    delete accueil.tachesDone[action.id];
    saveAccueil();
  }
  else if (action.type === 'accueil_tache_remove') {
    delete accueil.tachesRemoved[action.id];
    if (action.wasDone) accueil.tachesDone[action.id] = true;
    saveAccueil();
  }
  else if (action.type === 'accueil_skip') {
    delete accueil.routinesSkipped[action.id];
    saveAccueil();
  }
  else if (action.type === 'accueil_long_skip') {
    delete accueil.longsRemoved[action.id];
    saveAccueil();
  }
  else if (action.type === 'accueil_long_progress') {
    const p = state.praxis.find(x => x.id === action.id);
    if (p) {
      p.progress = action.prevProgress;
      if (action.exploded) {
        // Restaurer la bulle qui avait explosé
        p.active = true;
        delete accueil.longsRemoved[action.id];
        saveAccueil();
      }
      saveState();
    }
  }
  else if (action.type === 'accueil_note_remove') {
    accueil.notes.splice(action.nidx, 0, action.note);
    saveAccueil();
  }
  else if (action.type === 'accueil_note_tap') {
    accueil.notes.splice(action.nidx, 0, action.note);
    saveAccueil();
  }

  // Animer le bouton undo
  const btn = document.getElementById('undoBtn');
  if (btn) {
    btn.classList.remove('undo-flash');
    void btn.offsetWidth;
    btn.classList.add('undo-flash');
    const svgEl = btn.querySelector('svg');
    (svgEl || btn).addEventListener('animationend', () => btn.classList.remove('undo-flash'), { once: true });
  }

  const undoTarget = action.page || state.undoPage || state.currentPage;
  state.undoPage = null;
  navigate(undoTarget);
}

/* ══════════════════════════════════════════
   PAGE PRAXIS
══════════════════════════════════════════ */
function renderPraxis() {
  const el     = document.getElementById('page-praxis');
  const filter = state.filter;
  let list = state.praxis;
  if (filter !== 'all') list = list.filter(p => p.type === filter);
  list = [...list].sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  el.innerHTML = `
    <div class="section-label" style="margin-bottom:6px;">Gérer la liste</div>
    <div class="encart praxis-encart">
      <div class="filter-bar">
        ${['all','routine','tache','long'].map(f => `
          <button class="filter-btn ${filter===f?'active':''}" data-filter="${f}">
            ${f==='all'?'Tout':TYPE_LABELS[f]}
          </button>`).join('')}
      </div>
      <div class="praxis-bubble-list" id="praxisBubbleList">
        ${list.length
          ? list.map(p => renderPraxisItem(p)).join('')
          : `<span class="list-empty">Liste vide</span>`}
      </div>
      <div class="btn-add-row praxis-add-row">
        <button class="btn-add" id="btnCreate">+</button>
        <button class="btn-trash" id="btnTrash" title="Corbeille">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  // Filtres — le innerHTML est recréé entièrement à chaque render,
  // donc les listeners sont neufs. Pas d'accumulation possible ici.
  el.querySelectorAll('.filter-btn').forEach(btn =>
    btn.addEventListener('click', () => { state.filter = btn.dataset.filter; renderPraxis(); })
  );

  el.querySelector('#btnCreate').addEventListener('click', openSheet);
  initPraxisDragDrop(el);

  el.querySelectorAll('.praxis-item').forEach(item => {
    const id = item.dataset.id;
    let pressTimer = null;
    item.addEventListener('pointerdown', () => {
      pressTimer = setTimeout(() => enterWiggleMode(id), 900);
    });
    ['pointerup','pointercancel','pointermove'].forEach(ev =>
      item.addEventListener(ev, () => clearTimeout(pressTimer))
    );
    item.addEventListener('click', e => {
      if (e.target.closest('.delete-badge') || e.target.closest('.edit-badge')) return;
      if (state.wiggleId) { exitWiggleMode(); return; }
      toggleActive(id);
    });
  });

  el.querySelectorAll('.delete-badge').forEach(badge =>
    badge.addEventListener('click', e => { e.stopPropagation(); deletePraxis(badge.dataset.id); })
  );
  el.querySelectorAll('.edit-badge').forEach(badge =>
    badge.addEventListener('click', e => { e.stopPropagation(); openEditSheet(badge.dataset.id); })
  );

  el.addEventListener('click', e => {
    if (state.wiggleId && !e.target.closest('.praxis-item')) exitWiggleMode();
  });
}

function renderPraxisItem(p) {
  const wiggling  = state.wiggleId === p.id;
  const isLong    = p.type === 'long';
  const isRoutine = p.type === 'routine';

  let cls = 'praxis-item';
  if (isRoutine) cls += ' praxis-item-routine';
  if (isLong)    cls += ' praxis-item-long';
  if (!p.active) cls += ' inactive';
  if (wiggling)  cls += ' wiggle';

  const styleAttr = isLong
    ? `style="border-color:${p.color};color:${p.color};"`
    : `style="background:${p.color};"`;

  const checkSvg = p.active
    ? `<svg class="praxis-checkbox" viewBox="0 0 16 16" fill="none">
         <circle cx="8" cy="8" r="7" fill="#4caf50"/>
         <path d="M4.5 8 L7 10.5 L11.5 5.5" stroke="#fff" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round"/>
       </svg>`
    : `<svg class="praxis-checkbox" viewBox="0 0 16 16" fill="none">
         <circle cx="8" cy="8" r="7" stroke="${isLong ? p.color : 'rgba(255,255,255,0.5)'}"
                 stroke-width="1.5" fill="none"/>
       </svg>`;

  const gaugeFill = isLong
    ? `<div class="gauge-fill" style="width:${Math.min((p.progress||0)*25,100)}%;background:${p.color};"></div>`
    : '';

  const badges = wiggling
    ? `<div class="praxis-badges-group">
         <div class="edit-badge" data-id="${p.id}">✎</div>
       </div>`
    : '';

  return `
    <div class="${cls}" ${styleAttr} data-id="${p.id}" >
      ${gaugeFill}${checkSvg}
      <span class="praxis-item-label">${p.label}</span>
      ${badges}
    </div>`;
}

function toggleActive(id) {
  const p = state.praxis.find(x => x.id === id);
  if (p) { p.active = !p.active; saveState(); renderPraxis(); }
}

function enterWiggleMode(id) {
  state.wiggleId = id;
  renderPraxis();
}
function exitWiggleMode() {
  if (!state.wiggleId) return;
  state.wiggleId = null;
  if (state.currentPage === 'praxis') renderPraxis();
}

function deletePraxis(id) {
  const idx = state.praxis.findIndex(x => x.id === id);
  if (idx === -1) return;
  const removed = state.praxis[idx];
  pushUndo({ type:'delete', praxis:{ ...removed, days: removed.days ? [...removed.days] : undefined }, idx });
  state.praxis.splice(idx, 1);
  state.wiggleId = null;
  renderPraxis();
}

/* ── Drag & drop vers corbeille ── */
function initPraxisDragDrop(el) {
  const trash = el.querySelector('#btnTrash');
  if (!trash) return;

  let dragEl    = null;
  let dragId    = null;
  let clone     = null;
  let startX    = 0, startY = 0;
  let overTrash = false;

  function trashRect() { return trash.getBoundingClientRect(); }

  function onPointerDown(e) {
    if (state.wiggleId) return; // Ne pas démarrer si en mode wiggle
    const item = e.currentTarget;
    // Délai court pour distinguer tap et drag
    dragEl = item;
    dragId = item.dataset.id;
    startX = e.clientX;
    startY = e.clientY;
  }

  function onPointerMove(e) {
    if (!dragEl) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!clone && Math.sqrt(dx*dx + dy*dy) < 8) return; // seuil de déclenchement

    if (!clone) {
      // Créer le clone fantôme
      clone = dragEl.cloneNode(true);
      clone.style.cssText = `
        position:fixed; z-index:9999; pointer-events:none;
        opacity:0.75; transform:scale(1.05);
        left:${dragEl.getBoundingClientRect().left}px;
        top:${dragEl.getBoundingClientRect().top}px;
        width:${dragEl.offsetWidth}px;
        transition:none;
      `;
      document.body.appendChild(clone);
      dragEl.style.opacity = '0.3';
    }

    clone.style.left = (dragEl.getBoundingClientRect().left + dx) + 'px';
    clone.style.top  = (dragEl.getBoundingClientRect().top  + dy) + 'px';

    // Détecter survol corbeille
    const tr = trashRect();
    const cx = e.clientX, cy = e.clientY;
    const hit = cx >= tr.left && cx <= tr.right && cy >= tr.top && cy <= tr.bottom;
    if (hit !== overTrash) {
      overTrash = hit;
      trash.classList.toggle('trash-active', hit);
    }
  }

  function onPointerUp(e) {
    if (!dragEl) return;
    if (clone) {
      clone.remove(); clone = null;
      dragEl.style.opacity = '';
      trash.classList.remove('trash-active');
      if (overTrash && dragId) {
        const p = state.praxis.find(x => x.id === dragId);
        if (p) openConfirmDeleteSheet(dragId, p.label);
      }
    }
    dragEl = null; dragId = null; overTrash = false;
  }

  el.querySelectorAll('.praxis-item').forEach(item => {
    item.addEventListener('pointerdown', onPointerDown);
    item.addEventListener('pointermove', onPointerMove);
    item.addEventListener('pointerup',   onPointerUp);
    item.addEventListener('pointercancel', onPointerUp);
  });
}

/* ══════════════════════════════════════════
   BOTTOM SHEET (création / édition / confirm)
══════════════════════════════════════════ */
function initSheet() {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.id = 'sheetOverlay';
  overlay.addEventListener('click', closeSheet);

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.id = 'bottomSheet';

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
}

function buildSheetHTML(editMode) {
  const s = state.sheet;
  return `
    <div class="sheet-handle"></div>
    <div class="sheet-row">
      <div class="sheet-row-label">Type</div>
      <div class="type-radio-group">
        ${TYPES.map(t => `
          <button class="type-radio ${s.type===t?'selected':''}" data-type="${t}">
            ${TYPE_LABELS[t]}
          </button>`).join('')}
      </div>
    </div>
    <div class="sheet-row">
      <div class="name-preview-row">
        <input class="sheet-input sheet-input-short" id="sheetInput" type="text"
          placeholder="Nom…" value="${s.label}" maxlength="19"
          autocapitalize="characters" spellcheck="false">
        <div class="sheet-preview-inline" id="sheetPreview">
          ${renderPreviewBubble()}
        </div>
      </div>
    </div>
    <div class="sheet-row">
      <div class="sheet-row-label">Couleur${s.type==='routine'?' &amp; jours':''}</div>
      <div class="color-days-row">
        <div class="color-palette">
          ${COLORS.map(c => `
            <div class="color-swatch ${s.color===c?'selected':''}"
                 style="background:${c};" data-color="${c}"></div>`).join('')}
        </div>
        ${s.type==='routine' ? `
        <div class="days-grid-inline">
          ${DAY_NAMES.map((d,i) => `
            <button class="day-btn-sm ${s.days.includes(i+1)?'selected':''}" data-day="${i+1}">
              ${d}
            </button>`).join('')}
        </div>` : ''}
      </div>
    </div>
    <div class="sheet-actions">
      <button class="btn-sheet btn-cancel" id="btnSheetCancel">Annuler</button>
      ${editMode
        ? `<button class="btn-sheet btn-create-action" id="btnSheetSave">Modifier</button>`
        : `<button class="btn-sheet btn-create-action" id="btnSheetCreate">Créer</button>
           <button class="btn-sheet btn-activate" id="btnSheetActivate">Créer & activer</button>`}
    </div>
  `;
}

function renderPreviewBubble() {
  const s = state.sheet;
  if (!s.label) return '';
  const label = s.label.toUpperCase();
  if (s.type === 'long') {
    return `<div class="bubble-long" style="border-color:${s.color};color:${s.color};">
              <div class="gauge-fill" style="width:0%;background:${s.color};"></div>
              <span>${label}</span>
            </div>`;
  }
  return `<div class="bubble${s.type==='routine'?' bubble-routine':''}" style="background:${s.color};">${label}</div>`;
}

function bindSheetEvents(sheet, editMode) {
  sheet.addEventListener('click', e => {
    const typeBtn = e.target.closest('.type-radio');
    if (typeBtn) { state.sheet.type = typeBtn.dataset.type; refreshSheet(sheet, editMode); return; }
    const swatch = e.target.closest('.color-swatch');
    if (swatch)  { state.sheet.color = swatch.dataset.color; refreshSheet(sheet, editMode); return; }
    const dayBtn = e.target.closest('.day-btn-sm');
    if (dayBtn) {
      const d = parseInt(dayBtn.dataset.day);
      const idx = state.sheet.days.indexOf(d);
      if (idx > -1) state.sheet.days.splice(idx, 1); else state.sheet.days.push(d);
      refreshSheet(sheet, editMode);
      return;
    }
    if (e.target.id === 'btnSheetCancel')   closeSheet();
    if (e.target.id === 'btnSheetCreate')   createPraxis(false);
    if (e.target.id === 'btnSheetActivate') createPraxis(true);
    if (e.target.id === 'btnSheetSave')     savePraxis();
  });
  sheet.addEventListener('input', e => {
    if (e.target.id === 'sheetInput') {
      const input = e.target, pos = input.selectionStart;
      const upper = input.value.toUpperCase().slice(0, 19);
      input.value = upper;
      input.setSelectionRange(pos, pos);
      state.sheet.label = upper;
      updatePreview(sheet);
    }
  });
}

function refreshSheet(sheet, editMode) {
  state.sheet.label = sheet.querySelector('#sheetInput')?.value || '';
  // Remplace le nœud pour repartir sans listeners accumulés
  const fresh = getSheet();
  fresh.innerHTML = buildSheetHTML(editMode);
  fresh.classList.add('open');
  bindSheetEvents(fresh, editMode);
  const input = fresh.querySelector('#sheetInput');
  if (input && state.sheet.label) {
    input.focus();
    input.setSelectionRange(state.sheet.label.length, state.sheet.label.length);
  }
}

function updatePreview(sheet) {
  const prev = sheet.querySelector('#sheetPreview');
  if (prev) prev.innerHTML = renderPreviewBubble();
}

function getSheet() {
  // Remplace le nœud par un clone vierge pour éviter l'accumulation de listeners
  const old = document.getElementById('bottomSheet');
  const fresh = document.createElement('div');
  fresh.id = 'bottomSheet';
  fresh.className = 'bottom-sheet';
  old.parentNode.replaceChild(fresh, old);
  return fresh;
}

function openSheet() {
  state.sheet = { open:true, type:'tache', label:'',
    color: COLORS[Math.floor(Math.random() * COLORS.length)], days:[1,2,3,4,5] };
  const sheet = getSheet();
  sheet.innerHTML = buildSheetHTML(false);
  bindSheetEvents(sheet, false);
  document.getElementById('sheetOverlay').classList.add('open');
  sheet.classList.add('open');
  setTimeout(() => sheet.querySelector('#sheetInput')?.focus(), 350);
}

function openEditSheet(id) {
  const p = state.praxis.find(x => x.id === id);
  if (!p) return;
  state.editId = id;
  state.sheet  = { open:true, type:p.type, label:p.label,
    color:p.color, days:p.days ? [...p.days] : [1,2,3,4,5] };
  exitWiggleMode();
  const sheet = getSheet();
  sheet.innerHTML = buildSheetHTML(true);
  bindSheetEvents(sheet, true);
  document.getElementById('sheetOverlay').classList.add('open');
  sheet.classList.add('open');
  setTimeout(() => sheet.querySelector('#sheetInput')?.focus(), 350);
}

function openConfirmDeleteSheet(id, label) {
  const overlay = document.getElementById('sheetOverlay');
  const sheet = getSheet();
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-confirm-text">Supprimer <strong>${label}</strong> ?</div>
    <div class="sheet-confirm-sub">Cette action est irréversible.</div>
    <div class="sheet-actions" style="margin-top:20px;">
      <button class="btn-sheet btn-cancel" id="btnConfirmCancel">Annuler</button>
      <button class="btn-sheet btn-delete" id="btnConfirmDelete">Supprimer</button>
    </div>
  `;
  sheet.querySelector('#btnConfirmCancel').addEventListener('click', closeSheet);
  sheet.querySelector('#btnConfirmDelete').addEventListener('click', () => { closeSheet(); deletePraxis(id); });
  overlay.classList.add('open');
  sheet.classList.add('open');
}

function closeSheet() {
  document.getElementById('sheetOverlay').classList.remove('open');
  document.getElementById('bottomSheet').classList.remove('open');
  state.sheet.open = false;
  state.editId = null;
}

function createPraxis(activate) {
  const label = state.sheet.label.trim();
  if (!label) { document.getElementById('sheetInput')?.focus(); return; }
  state.praxis.push({
    id: 'p_' + Date.now(), type: state.sheet.type, label,
    color: state.sheet.color, active: activate,
    ...(state.sheet.type === 'routine' ? { days: [...state.sheet.days] } : {}),
    ...(state.sheet.type === 'long'    ? { progress: 0 } : {})
  });
  closeSheet();
  renderPraxis();
}

function savePraxis() {
  const label = state.sheet.label.trim();
  if (!label || !state.editId) return;
  const p = state.praxis.find(x => x.id === state.editId);
  if (!p) return;
  p.label = label;
  p.color = state.sheet.color;
  p.type  = state.sheet.type;
  if (state.sheet.type === 'routine') p.days = [...state.sheet.days];
  closeSheet();
  renderPraxis();
}

/* ══════════════════════════════════════════
   PAGE ACCUEIL
══════════════════════════════════════════ */
/* ── État accueil — persisté par jour ── */
const ACCUEIL_KEY = () => 'praxeo_accueil_' + todayKeyStatic();

function todayKeyStatic() {
  return new Date().toISOString().slice(0, 10);
}

function loadAccueil() {
  try {
    const raw = localStorage.getItem(ACCUEIL_KEY());
    if (raw) {
      const s = JSON.parse(raw);
      accueil.routinesDone    = s.routinesDone    || {};
      accueil.routinesSkipped = s.routinesSkipped || {};
      accueil.tachesDone      = s.tachesDone      || {};
      accueil.tachesRemoved   = s.tachesRemoved   || {};
      accueil.longsRemoved    = s.longsRemoved     || {};
      accueil.notes           = s.notes            || [];
    }
  } catch(e) {}
}

function saveAccueil() {
  try {
    const snap = {
      routinesDone:    accueil.routinesDone,
      routinesSkipped: accueil.routinesSkipped,
      tachesDone:      accueil.tachesDone,
      tachesRemoved:   accueil.tachesRemoved,
      longsRemoved:    accueil.longsRemoved,
      notes:           accueil.notes,
    };
    localStorage.setItem(ACCUEIL_KEY(), JSON.stringify(snap));
    // Nettoyer les clés d'autres jours (garder 7 jours max)
    const today = todayKeyStatic();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('praxeo_accueil_') && !k.endsWith(today)) {
        const d = k.replace('praxeo_accueil_', '');
        const diff = (new Date(today) - new Date(d)) / 86400000;
        if (diff > 7) { localStorage.removeItem(k); i--; }
      }
    }
  } catch(e) {}
}

const accueil = {
  routinesDone:    {},
  routinesSkipped: {},
  tachesDone:      {},
  tachesRemoved:   {},
  longsRemoved:    {},
  notes:           [],
  wiggleId:        null,
  wiggleType:      null,
  gaugeEditId:     null,
};

/* ── Enregistrement stats quotidiennes ── */
function todayKey() { return new Date().toISOString().slice(0, 10); }

function recordRoutineDone() {
  const key = todayKey();
  const dow  = todayDow();
  const allActive = state.praxis.filter(p =>
    p.type === 'routine' && p.active && (!p.days || p.days.includes(dow))
  );
  const doneIds = Object.keys(accueil.routinesDone);
  const done    = doneIds.filter(id => allActive.some(p => p.id === id)).length;
  const total   = allActive.length;
  if (!state.statsHistory) state.statsHistory = {};
  state.statsHistory[key] = { done, total, ids: doneIds };
  // Mettre à jour le record de série
  const streak = computeStreak(state.statsHistory);
  if (streak > (state.statsRecord || 0)) state.statsRecord = streak;
  saveState();
}

function todayDow() { const d = new Date().getDay(); return d === 0 ? 7 : d; }

function renderAccueil() {
  const el  = document.getElementById('page-accueil');
  const dow = todayDow();

  const routines = state.praxis.filter(p =>
    p.type==='routine' && p.active &&
    (!p.days || p.days.includes(dow)) &&
    !accueil.routinesSkipped[p.id] &&
    !accueil.routinesDone[p.id]
  );
  const taches = state.praxis.filter(p =>
    p.type==='tache' && p.active && !accueil.tachesRemoved[p.id]
  );
  const longs = state.praxis.filter(p =>
    p.type==='long' && p.active && !accueil.longsRemoved[p.id]
  );

  el.innerHTML = `
    ${state.frozen ? `<div class="frozen-banner">⏸ Application gelée — bloc-notes actif</div>` : ''}
    <div class="encart-section fade-in">
      <div class="section-label">Routines</div>
      <div class="encart">
        <div class="bubble-row" id="rowRoutine" data-section="routine">
          ${routines.map(p => renderAccueilBubble(p,'routine')).join('')}
        </div>
        <div class="btn-add-row"><button class="btn-add" data-section="routine">+</button></div>
      </div>
    </div>
    <div class="encart-section fade-in" style="animation-delay:.05s">
      <div class="section-label">Tâches du jour</div>
      <div class="encart">
        <div class="bubble-row" id="rowTache" data-section="tache">
          ${taches.map(p => renderAccueilBubble(p,'tache')).join('')}
        </div>
        <div class="btn-add-row"><button class="btn-add" data-section="tache">+</button></div>
      </div>
    </div>
    <div class="encart-section fade-in" style="animation-delay:.1s">
      <div class="section-label">Long terme</div>
      <div class="encart">
        <div class="bubble-row" id="rowLong" data-section="long">
          ${longs.map(p => renderAccueilBubble(p,'long')).join('')}
        </div>
        <div class="btn-add-row"><button class="btn-add" data-section="long">+</button></div>
      </div>
    </div>
    <div class="encart-section fade-in" style="animation-delay:.15s">
      <div class="section-label">Bloc-notes</div>
      <div class="encart">
        <div class="bubble-row" id="rowNote" data-section="note">
          ${accueil.notes.map((n,i) => renderNoteBubble(n,i)).join('')}
        </div>
        <div class="btn-add-row"><button class="btn-add" data-section="note">+</button></div>
      </div>
    </div>
  `;

  bindAccueilEvents(el);
  initAccueilDragDrop(el);
}

function renderAccueilBubble(p, type) {
  const wiggling  = accueil.wiggleId === p.id && accueil.wiggleType === type;
  const gaugeEdit = accueil.gaugeEditId === p.id;

  // Badge suppression — toujours à droite
  const delBadge = wiggling
    ? `<div class="acc-badge acc-badge-delete" data-id="${p.id}" data-type="${type}">−</div>` : '';

  // Badge édition jauge — à gauche du badge suppression (donc rendu en premier pour long terme)
  const editGauge = (wiggling && type === 'long')
    ? `<div class="acc-badge acc-badge-edit" data-id="${p.id}">✎</div>` : '';

  if (type === 'routine') {
    return `<div class="bubble bubble-routine${wiggling?' acc-wiggle':''}"
               style="background:${p.color}; position:relative;"
               data-id="${p.id}" data-type="routine" >
               ${p.label}${delBadge}
             </div>`;
  }
  if (type === 'tache') {
    const done = accueil.tachesDone[p.id];
    return `<div class="bubble${done?' bubble-done':''}${wiggling?' acc-wiggle':''}"
               style="background:${p.color};${done?'opacity:.38;':''} position:relative;"
               data-id="${p.id}" data-type="tache" >
               ${p.label}${delBadge}
             </div>`;
  }
  if (type === 'long') {
    // Badges groupés côte à côte à droite : [✎][−]
    const badges = wiggling ? `
      <div class="acc-badges-group">
        <div class="acc-badge acc-badge-edit" data-id="${p.id}">✎</div>
      </div>` : '';
    return `<div class="acc-bubble-wrap${wiggling?' acc-wiggle':''}${gaugeEdit?' gauge-editing-wrap':''}"
               data-id="${p.id}" data-type="long" >
               <div class="bubble-long${gaugeEdit?' gauge-editing':''}"
                    style="border-color:${p.color};color:${p.color};">
                 <div class="gauge-fill" style="width:${Math.min((p.progress||0)*25,100)}%;background:${p.color};"></div>
                 <span>${p.label}</span>
               </div>
               ${badges}
             </div>`;
  }
  return '';
}

function renderNoteBubble(note, idx) {
  const wiggling = accueil.wiggleId === 'note_'+idx && accueil.wiggleType === 'note';
  const badge    = wiggling
    ? `<div class="acc-badge acc-badge-delete" data-noteidx="${idx}" data-type="note">−</div>` : '';
  const noteColor = note.color || '';
  const noteStyle = noteColor
    ? `position:relative;background:${noteColor};color:#fff;border-color:${noteColor};`
    : `position:relative;`;
  return `<div class="bubble-note-style${wiggling?' acc-wiggle':''}"
             style="${noteStyle}"
             data-noteidx="${idx}" data-type="note">
             ${note.label.toLowerCase()}${badge}
           </div>`;
}

function bindAccueilEvents(el) {
  el.addEventListener('click', e => {
    if (accueil.gaugeEditId && !e.target.closest('[data-type="long"]')) {
      accueil.gaugeEditId = null; renderAccueil(); return;
    }
    if (accueil.wiggleId && !e.target.closest('[data-id],[data-noteidx]')) {
      exitAccueilWiggle();
    }
  });

  el.querySelectorAll('[data-type]').forEach(b => {
    if (b.classList.contains('btn-add') ||
        b.classList.contains('acc-badge-delete') ||
        b.classList.contains('acc-badge-edit') ||
        b.classList.contains('acc-badges-group')) return;

    const type = b.dataset.type;
    const id   = b.dataset.id;
    const nidx = b.dataset.noteidx !== undefined ? parseInt(b.dataset.noteidx) : null;
    let pressTimer = null;

    b.addEventListener('pointerdown', e => {
      if (e.target.closest('.acc-badge-delete') || e.target.closest('.acc-badge-edit')) return;
      pressTimer = setTimeout(() => enterAccueilWiggle(id || ('note_'+nidx), type), 900);
    });
    ['pointerup','pointercancel','pointermove'].forEach(ev =>
      b.addEventListener(ev, () => clearTimeout(pressTimer))
    );

    b.addEventListener('click', e => {
      if (e.target.closest('.acc-badge-delete') || e.target.closest('.acc-badge-edit') ||
          e.target.closest('.acc-badges-group')) return;
      if (accueil.wiggleId) { exitAccueilWiggle(); return; }
      if (state.frozen && type !== 'note') return;

      if (type === 'routine') {
        pushUndo({ type:'accueil_routine', id, page:'accueil' });
        accueil.routinesDone[id] = true;
        recordRoutineDone();
        saveAccueil();
        explodeBubble(b, () => renderAccueil());
      }
      else if (type === 'tache') {
        if (accueil.tachesDone[id]) {
          pushUndo({ type:'accueil_tache_remove', id, page:'accueil' });
          explodeBubble(b, () => {
            accueil.tachesRemoved[id] = true;
            delete accueil.tachesDone[id];
            saveAccueil();
            renderAccueil();
          });
        } else {
          pushUndo({ type:'accueil_tache_done', id, page:'accueil' });
          accueil.tachesDone[id] = true;
          saveAccueil();
          b.style.opacity = '0.38';
        }
      }
      else if (type === 'long') {
        if (accueil.gaugeEditId === id) {
          const p = state.praxis.find(x => x.id === id);
          if (!p) return;
          p.progress = ((p.progress||0) + 1) % 5;
          renderAccueil(); return;
        }
        const p = state.praxis.find(x => x.id === id);
        if (!p) return;
        const prevProgress = p.progress || 0;
        p.progress = prevProgress + 1;
        if (p.progress >= 4) {
          // Explosion — undo possible avant seulement (on sauvegarde l'état pré-explosion)
          pushUndo({ type:'accueil_long_progress', id, prevProgress, exploded: true, page:'accueil' });
          saveState();
          const inner = b.querySelector('.bubble-long') || b;
          explodeBubble(inner, () => {
            p.active = false; p.progress = 0;
            accueil.longsRemoved[id] = true;
            saveAccueil(); saveState();
            renderAccueil();
          });
        } else {
          pushUndo({ type:'accueil_long_progress', id, prevProgress, exploded: false, page:'accueil' });
          saveState();
          const fill = b.querySelector('.gauge-fill');
          if (fill) fill.style.width = (p.progress * 25) + '%';
        }
      }
      else if (type === 'note') {
        pushUndo({ type:'accueil_note_tap', note: { ...accueil.notes[nidx] }, nidx, page:'accueil' });
        saveAccueil();
        explodeBubble(b, () => { accueil.notes.splice(nidx, 1); saveAccueil(); renderAccueil(); });
      }
    });
  });

  el.querySelectorAll('.acc-badge-delete').forEach(badge =>
    badge.addEventListener('click', e => {
      e.stopPropagation();
      if (state.frozen && badge.dataset.type !== 'note') return;
      removeFromAccueil(
        badge.dataset.type, badge.dataset.id,
        badge.dataset.noteidx !== undefined ? parseInt(badge.dataset.noteidx) : null
      );
    })
  );

  el.querySelectorAll('.acc-badge-edit').forEach(badge =>
    badge.addEventListener('click', e => {
      e.stopPropagation();
      if (state.frozen) return;
      accueil.gaugeEditId = badge.dataset.id;
      exitAccueilWiggle();
      renderAccueil();
    })
  );

  el.querySelectorAll('.btn-add').forEach(btn =>
    btn.addEventListener('click', () => {
      if (state.frozen && btn.dataset.section !== 'note') return;
      exitAccueilWiggle();
      const s = btn.dataset.section;
      if (s === 'note') openNoteSheet(); else openPickerSheet(s);
    })
  );
}

function enterAccueilWiggle(id, type) {
  accueil.wiggleId   = id;
  accueil.wiggleType = type;
  renderAccueil();
}
function exitAccueilWiggle() {
  if (!accueil.wiggleId && !accueil.gaugeEditId) return;
  accueil.wiggleId    = null;
  accueil.wiggleType  = null;
  accueil.gaugeEditId = null;
  if (state.currentPage === 'accueil') renderAccueil();
}

function removeFromAccueil(type, id, nidx) {
  // Capturer l'état pour undo
  if (type === 'routine') {
    pushUndo({ type:'accueil_skip', id, page:'accueil' });
    accueil.routinesSkipped[id] = true;
  } else if (type === 'tache') {
    pushUndo({ type:'accueil_tache_remove', id, wasDone: !!accueil.tachesDone[id], page:'accueil' });
    accueil.tachesRemoved[id] = true;
    delete accueil.tachesDone[id];
  } else if (type === 'long') {
    pushUndo({ type:'accueil_long_skip', id, page:'accueil' });
    accueil.longsRemoved[id] = true;
  } else if (type === 'note' && nidx !== null) {
    pushUndo({ type:'accueil_note_remove', note: { ...accueil.notes[nidx] }, nidx, page:'accueil' });
    accueil.notes.splice(nidx, 1);
  }
  accueil.wiggleId = accueil.wiggleType = null;
  saveAccueil();
  renderAccueil();
}

/* ── Drag & drop réordonnage accueil ── */
function initAccueilDragDrop(el) {
  ['rowRoutine','rowTache','rowLong','rowNote'].forEach(rowId => {
    const row = el.querySelector('#'+rowId);
    if (!row) return;

    let dragEl  = null;
    let clone   = null;
    let startX  = 0, startY = 0;
    let offsetX = 0, offsetY = 0;

    function getBubbles() {
      return [...row.querySelectorAll('[data-id],[data-noteidx]')].filter(b => b !== dragEl);
    }

    function onDown(e) {
      // Ignorer les badges
      if (e.target.closest('.acc-badge')) return;
      const bubble = e.target.closest('[data-id],[data-noteidx]');
      if (!bubble) return;
      dragEl = bubble;
      startX = e.clientX;
      startY = e.clientY;
      const r = bubble.getBoundingClientRect();
      offsetX = e.clientX - r.left;
      offsetY = e.clientY - r.top;
    }

    function onMove(e) {
      if (!dragEl) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!clone && Math.sqrt(dx*dx + dy*dy) < 8) return;

      if (!clone) {
        clone = dragEl.cloneNode(true);
        // Supprimer les badges éventuels dans le clone
        clone.querySelectorAll('.acc-badge,.acc-badges-group').forEach(b => b.remove());
        const r = dragEl.getBoundingClientRect();
        clone.style.cssText = `
          position:fixed; z-index:9999; pointer-events:none;
          opacity:0.75; transform:scale(1.06);
          left:${r.left}px; top:${r.top}px;
          width:${dragEl.offsetWidth}px;
          transition:none;
        `;
        document.body.appendChild(clone);
        dragEl.style.opacity = '0.25';
      }

      clone.style.left = (e.clientX - offsetX) + 'px';
      clone.style.top  = (e.clientY - offsetY) + 'px';

      // Trouver la bulle cible et réordonner visuellement
      const cx = e.clientX;
      let inserted = false;
      for (const sib of getBubbles()) {
        const r = sib.getBoundingClientRect();
        if (cx < r.left + r.width / 2) {
          row.insertBefore(dragEl, sib);
          inserted = true;
          break;
        }
      }
      if (!inserted) row.appendChild(dragEl);
    }

    function onUp() {
      if (!dragEl) return;
      if (clone) { clone.remove(); clone = null; }
      dragEl.style.opacity = '';
      dragEl = null;
    }

    row.addEventListener('pointerdown',   onDown);
    row.addEventListener('pointermove',   onMove);
    row.addEventListener('pointerup',     onUp);
    row.addEventListener('pointercancel', onUp);
  });
}

/* ══════════════════════════════════════════
   PICKER SHEET
══════════════════════════════════════════ */
let pickerSection  = null;
let pickerSelected = new Set();

function openPickerSheet(section) {
  pickerSection  = section;
  pickerSelected = new Set();
  const dow = todayDow();

  const available = state.praxis.filter(p => {
    if (p.type !== section) return false;
    if (section === 'routine') {
      if (p.days && !p.days.includes(dow)) return false;
      return !(p.active && !accueil.routinesSkipped[p.id] && !accueil.routinesDone[p.id]);
    }
    if (section === 'tache') return !(p.active && !accueil.tachesRemoved[p.id]);
    if (section === 'long')  return !(p.active && !accueil.longsRemoved[p.id]);
    return false;
  }).sort((a,b) => a.label.localeCompare(b.label,'fr'));

  const overlay = document.getElementById('sheetOverlay');
  const sheet   = getSheet();

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">${TYPE_LABELS[section]}</div>
    <div class="picker-bubble-list" id="pickerList">
      ${available.length
        ? available.map(p => pickerItemHTML(p)).join('')
        : `<div class="picker-empty">Toutes les praxis sont déjà présentes</div>`}
    </div>
    <div class="sheet-actions" style="margin-top:16px;">
      <button class="btn-sheet btn-cancel"   id="btnPickerCancel">Annuler</button>
      <button class="btn-sheet btn-activate" id="btnPickerValidate">Valider</button>
    </div>
  `;

  sheet.querySelectorAll('.picker-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      if (pickerSelected.has(id)) { pickerSelected.delete(id); item.classList.remove('picker-selected'); }
      else                        { pickerSelected.add(id);    item.classList.add('picker-selected'); }
    });
  });
  sheet.querySelector('#btnPickerCancel')?.addEventListener('click', closeSheet);
  sheet.querySelector('#btnPickerValidate')?.addEventListener('click', validatePicker);

  overlay.classList.add('open');
  sheet.classList.add('open');
}

function pickerItemHTML(p) {
  if (p.type === 'long') {
    return `<div class="picker-item bubble-long" style="border-color:${p.color};color:${p.color};" data-id="${p.id}">
              <div class="gauge-fill" style="width:${Math.min((p.progress||0)*25,100)}%;background:${p.color};"></div>
              <span>${p.label}</span>
            </div>`;
  }
  const cls = p.type === 'routine' ? 'bubble bubble-routine' : 'bubble';
  return `<div class="picker-item ${cls}" style="background:${p.color};" data-id="${p.id}">${p.label}</div>`;
}

function validatePicker() {
  pickerSelected.forEach(id => {
    const p = state.praxis.find(x => x.id === id);
    if (p) p.active = true;
    if (pickerSection === 'routine') { delete accueil.routinesSkipped[id]; delete accueil.routinesDone[id]; }
    else if (pickerSection === 'tache') { delete accueil.tachesRemoved[id]; delete accueil.tachesDone[id]; }
    else if (pickerSection === 'long')  { delete accueil.longsRemoved[id]; }
  });
  closeSheet();
  renderAccueil();
}

/* ══════════════════════════════════════════
   NOTE SHEET
══════════════════════════════════════════ */
function openNoteSheet() {
  const overlay = document.getElementById('sheetOverlay');
  const sheet   = getSheet();

  const histHTML = state.noteHistory.length ? `
    <div class="note-history-row">
      ${state.noteHistory.slice(0,6).map((n,i) => `
        <div class="note-hist-bubble" data-hidx="${i}">${n.toLowerCase()}</div>
      `).join('')}
    </div>` : '';

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-row">
      <input class="sheet-input" id="noteInput" type="text"
        placeholder="Note…" autocapitalize="sentences" spellcheck="true">
    </div>
    ${histHTML}
    <div class="sheet-actions">
      <button class="btn-sheet btn-cancel"        id="btnNoteCancel">Annuler</button>
      <button class="btn-sheet btn-create-action" id="btnNoteCreate">Ajouter</button>
    </div>
  `;

  const input = sheet.querySelector('#noteInput');

  function addNote(label) {
    if (!label) return;
    accueil.notes.push({ label, color: COLORS[Math.floor(Math.random()*COLORS.length)] });
    // Mettre à jour l'historique (max 6, pas de doublons)
    state.noteHistory = [label, ...state.noteHistory.filter(n => n !== label)].slice(0, 6);
    saveState();
    closeSheet();
    renderAccueil();
  }

  // Pas de forçage de casse — le clavier natif gère la saisie normalement
  // Le rendu se fait en minuscule via .toLowerCase() dans renderNoteBubble
  input.addEventListener('keydown', e => { if (e.key==='Enter') addNote(input.value.trim()); });
  sheet.querySelector('#btnNoteCancel').addEventListener('click', closeSheet);
  sheet.querySelector('#btnNoteCreate').addEventListener('click', () => addNote(input.value.trim()));

  sheet.querySelectorAll('.note-hist-bubble').forEach(b =>
    b.addEventListener('click', () => addNote(b.textContent.trim().toUpperCase()))
  );

  overlay.classList.add('open');
  sheet.classList.add('open');
  setTimeout(() => input.focus(), 350);
}

/* ══════════════════════════════════════════
   UTILITAIRES
══════════════════════════════════════════ */
function explodeBubble(el, cb) {
  el.classList.add('bubble-explode');
  el.addEventListener('animationend', () => { el.style.display='none'; if (cb) cb(); }, { once:true });
}

/* ══════════════════════════════════════════
   MENU 3 POINTS
══════════════════════════════════════════ */
function openMenu() {
  const overlay = document.getElementById('sheetOverlay');
  const sheet   = getSheet();
  const frozenLabel = state.frozen ? 'Reprendre l\'application' : 'Geler l\'application';

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="menu-list">
      <button class="menu-item${state.frozen?' menu-item-frozen':''}" id="menuFreeze">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07"/>
        </svg>
        ${frozenLabel}
      </button>
      <div class="menu-divider"></div>
      <button class="menu-item" id="menuExport">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Exporter les données
      </button>
      <button class="menu-item" id="menuImport">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Importer les données
      </button>
      <input type="file" id="importFile" accept=".json" style="display:none;">
      <div class="menu-divider"></div>
      <button class="menu-item menu-item-danger" id="menuResetStats">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.61"/>
        </svg>
        Réinitialiser les stats
      </button>
    </div>
    <div class="sheet-actions" style="margin-top:12px;">
      <button class="btn-sheet btn-cancel" id="menuClose">Fermer</button>
    </div>
  `;

  sheet.querySelector('#menuClose').addEventListener('click', closeSheet);

  sheet.querySelector('#menuFreeze').addEventListener('click', () => {
    closeSheet();
    if (state.frozen) {
      // Reprendre directement
      state.frozen = false;
      renderAccueil();
    } else {
      openConfirmSheet(
        'Geler l\'application ?',
        'Les routines ne seront plus comptabilisées. Le bloc-notes reste actif.',
        'Geler',
        () => { state.frozen = true; renderAccueil(); }
      );
    }
  });

  sheet.querySelector('#menuExport').addEventListener('click', () => {
    closeSheet();
    exportData();
  });

  sheet.querySelector('#menuImport').addEventListener('click', () => {
    sheet.querySelector('#importFile').click();
  });

  sheet.querySelector('#importFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    closeSheet();
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        openConfirmSheet(
          'Importer les données ?',
          'Les données actuelles seront remplacées.',
          'Importer',
          () => importData(data)
        );
      } catch(err) {
        alert('Fichier invalide.');
      }
    };
    reader.readAsText(file);
  });

  sheet.querySelector('#menuResetStats').addEventListener('click', () => {
    closeSheet();
    openConfirmSheet(
      'Réinitialiser les stats ?',
      'Toutes les statistiques seront effacées. Les praxis sont conservées.',
      'Réinitialiser',
      () => {
        state.frozenDays   = [];
        state.frozen       = false;
        state.statsHistory = {};
        state.statsRecord  = 0;
        saveState();
        renderStats();
      }
    );
  });

  overlay.classList.add('open');
  sheet.classList.add('open');
}

function openConfirmSheet(title, sub, confirmLabel, onConfirm) {
  const overlay = document.getElementById('sheetOverlay');
  const sheet   = getSheet();
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-confirm-text">${title}</div>
    <div class="sheet-confirm-sub">${sub}</div>
    <div class="sheet-actions" style="margin-top:20px;">
      <button class="btn-sheet btn-cancel" id="btnConfirmCancel">Annuler</button>
      <button class="btn-sheet btn-delete" id="btnConfirmOk">${confirmLabel}</button>
    </div>
  `;
  sheet.querySelector('#btnConfirmCancel').addEventListener('click', closeSheet);
  sheet.querySelector('#btnConfirmOk').addEventListener('click', () => { closeSheet(); onConfirm(); });
  overlay.classList.add('open');
  sheet.classList.add('open');
}

/* ── Export / Import ── */
function exportData() {
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    praxis:       state.praxis,
    frozen:       state.frozen,
    frozenDays:   state.frozenDays,
    noteHistory:  state.noteHistory,
    statsHistory: state.statsHistory || {},
    statsRecord:  state.statsRecord  || 0,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `praxeo_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(data) {
  if (data.praxis)                state.praxis       = data.praxis;
  if (data.frozenDays)            state.frozenDays   = data.frozenDays;
  if (data.noteHistory)           state.noteHistory  = data.noteHistory;
  if (data.frozen !== undefined)  state.frozen       = data.frozen;
  if (data.statsHistory)          state.statsHistory = data.statsHistory;
  if (data.statsRecord !== undefined) state.statsRecord = data.statsRecord;
  saveState();
  navigate(state.currentPage);
}

/* ══════════════════════════════════════════
   PAGE STATS
══════════════════════════════════════════ */
function getHistory() {
  // Historique réel uniquement — pas de données fictives
  return state.statsHistory || {};
}

function computeStreak(history) {
  const today = new Date(); let streak=0;
  for (let d=0; d<=83; d++) {
    const date = new Date(today); date.setDate(date.getDate()-d);
    const h = history[date.toISOString().slice(0,10)];
    if (!h||h.total===0) continue;
    if (h.done===h.total) streak++; else break;
  }
  return streak;
}

function renderStats() {
  const el=document.getElementById('page-stats'), today=new Date();
  const history=getHistory(), streak=computeStreak(history), record=state.statsRecord||0;
  const MONTHS=['Jan','Fév','Mar','Avr','Mai','Jui','Jul','Aoû','Sep','Oct','Nov','Déc'];

  let total30=0, done30=0;
  for (let d=0;d<30;d++) {
    const date=new Date(today); date.setDate(date.getDate()-d);
    const h=history[date.toISOString().slice(0,10)];
    if(h&&h.total>0){total30+=h.total;done30+=h.done;}
  }
  const rate30=total30>0?Math.round(done30/total30*100):0;
  const totalFull=Object.values(history).filter(h=>h.total>0&&h.done===h.total).length;

  const WEEKS=20, todayDow=(today.getDay()+6)%7;
  let hmHTML=`<div class="hm-wrap"><div class="hm-days">`;
  ['L','M','M','J','V','S','D'].forEach(d=>hmHTML+=`<div class="hm-day-lbl">${d}</div>`);
  hmHTML+=`</div><div class="hm-cols">`;
  let lastMonth=-1;
  for (let w=0;w<WEEKS;w++) {
    hmHTML+=`<div class="hm-col">`;
    const startMonday=new Date(today); startMonday.setDate(today.getDate()-todayDow-(WEEKS-1-w)*7);
    const m=startMonday.getMonth();
    const monthLbl=(m!==lastMonth&&startMonday.getDate()<=7)?MONTHS[m]:'';
    if(monthLbl)lastMonth=m;
    hmHTML+=`<div class="hm-month">${monthLbl}</div>`;
    for (let day=0;day<7;day++) {
      const cellD=new Date(startMonday); cellD.setDate(startMonday.getDate()+day);
      const isFuture  = cellD > today;
      const isFrozen  = state.frozenDays.includes(cellD.toISOString().slice(0,10));
      const h = history[cellD.toISOString().slice(0,10)];
      let cls='hm-cell';
      if (isFuture)              cls+=' hm-future';
      else if (isFrozen)         cls+=' hm-frozen';
      else if(!h||h.total===0)   cls+=' hm-empty';
      else if(h.done===h.total)  cls+=' hm-full';
      else if(h.done>0)          cls+=' hm-partial';
      else                       cls+=' hm-none';
      hmHTML+=`<div class="${cls}"></div>`;
    }
    hmHTML+=`</div>`;
  }
  hmHTML+=`</div></div>`;

  const routines=state.praxis.filter(p=>p.type==='routine'&&p.active);
  const praxisStats=routines
    .map(p=>({...p,rate:0,streak:0}))
    .sort((a,b)=>a.label.localeCompare(b.label,'fr',{sensitivity:'base'}));

  const opacity=record>0?Math.min(0.25+streak/record*0.75,1).toFixed(2):'0.25';

  el.innerHTML=`
    <div class="encart-section fade-in">
      <div class="section-label">Série en cours</div>
      <div class="encart stats-streak-encart">
        <div class="stats-streak-row">
          <div class="stats-streak-left">
            <div class="stats-streak-number">${streak}</div>
            <div class="stats-streak-label">jours consécutifs</div>
            <div class="stats-mini-row">
              <div class="stats-mini"><div class="stats-mini-val">${record}</div><div class="stats-mini-lbl">Record</div></div>
              <div class="stats-mini"><div class="stats-mini-val">${rate30}%</div><div class="stats-mini-lbl">30 jours</div></div>
              <div class="stats-mini"><div class="stats-mini-val">${totalFull}</div><div class="stats-mini-lbl">Total</div></div>
            </div>
          </div>
          <div class="stats-laurier">
            <img src="couronne.svg" alt="Couronne" class="laurier-img" style="opacity:${opacity};">
          </div>
        </div>
      </div>
    </div>
    <div class="encart-section fade-in" style="animation-delay:.05s">
      <div class="section-label">Historique</div>
      <div class="encart">${hmHTML}
        <div class="hm-legend">
          <div class="hm-legend-cell hm-none"></div><span class="hm-legend-lbl">Aucune</span>
          <div class="hm-legend-cell hm-partial"></div><span class="hm-legend-lbl">Partielle</span>
          <div class="hm-legend-cell hm-full"></div><span class="hm-legend-lbl">Complète</span>
        </div>
    <div class="encart-section fade-in" style="animation-delay:.1s">
      <div class="section-label">Par praxis</div>
      <div class="encart">
        ${praxisStats.map((p,i)=>`
          ${i>0?'<div class="stats-divider"></div>':''}
          <div class="stats-praxis-row">
            <div class="stats-dot" style="background:${p.color};"></div>
            <div class="stats-praxis-name">${p.label}</div>
            <div class="stats-praxis-streak">${p.streak}j</div>
            <div class="stats-bar-wrap"><div class="stats-bar" style="width:${p.rate}%;background:${p.color};"></div></div>
            <div class="stats-praxis-rate">${p.rate}%</div>
          </div>`).join('')}
      </div>
    </div>
    <div class="stats-help-row fade-in">
      <button class="stats-help-btn" id="statsHelpBtn">?</button>
    </div>
  `;

  document.getElementById('statsHelpBtn').addEventListener('click', openStatsHelp);
}

function openStatsHelp() {
  const overlay=document.getElementById('sheetOverlay'), sheet=getSheet();
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Comprendre les stats</div>
    <div class="stats-help-content">
      <div class="stats-help-item">
        <div class="stats-help-label">Jours consécutifs</div>
        <div class="stats-help-desc">Nombre de jours d'affilée où toutes tes routines programmées ont été complétées.</div>
      </div>
      <div class="stats-help-item">
        <div class="stats-help-label">Record</div>
        <div class="stats-help-desc">Ta meilleure série depuis le début.</div>
      </div>
      <div class="stats-help-item">
        <div class="stats-help-label">30 jours</div>
        <div class="stats-help-desc">Taux de complétion global sur les 30 derniers jours (routines réalisées / routines programmées).</div>
      </div>
      <div class="stats-help-item">
        <div class="stats-help-label">Total</div>
        <div class="stats-help-desc">Nombre de journées où toutes tes routines ont été complétées, depuis le début.</div>
      </div>
      <div class="stats-help-item">
        <div class="stats-help-label">Historique</div>
        <div class="stats-help-desc">Chaque case = un jour. Bleu plein = toutes les routines faites. Bleu atténué = partiellement. Gris = aucune.</div>
      </div>
      <div class="stats-help-item">
        <div class="stats-help-label">Par praxis</div>
        <div class="stats-help-desc">Série individuelle et taux de complétion sur 30 jours pour chaque routine active.</div>
      </div>
      <div class="stats-help-item">
        <div class="stats-help-label">Couronne de laurier</div>
        <div class="stats-help-desc">Plus ta série est longue, plus la couronne est dense. Elle reflète ton engagement quotidien.</div>
      </div>
    </div>
    <div class="sheet-actions">
      <button class="btn-sheet btn-activate" id="btnHelpClose">Fermer</button>
    </div>
  `;
  sheet.querySelector('#btnHelpClose').addEventListener('click', closeSheet);
  overlay.classList.add('open');
  sheet.classList.add('open');
}
