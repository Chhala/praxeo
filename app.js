/* ═══════════════════════════════════════
   PRAXEO — app.js
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
  notes:       [],     // bulles bloc-notes (persistantes, hors clé journalière)
  noteHistory: [],     // historique des notes bloc-notes
  statsHistory: {},    // { 'YYYY-MM-DD': { done: N, total: N, ids: ['r04',...] } }
  statsRecord:  0,     // meilleure série enregistrée
};

/* ══════════════════════════════════════════
   DONNÉES
══════════════════════════════════════════ */
function randColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
function pickColors(n) {
  const pool = [...COLORS];
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
const _dc = pickColors(4);
const PRAXIS_DATA = [
  { id:'r01', type:'routine', label:'FAIRE LE LIT', color:_dc[0], active:true,  days:[1,2,3,4,5,6,7] },
  { id:'t01', type:'tache',   label:'COURSES',      color:_dc[1], active:true  },
  { id:'t02', type:'tache',   label:'SÉRIE TV',     color:_dc[2], active:true  },
  { id:'l01', type:'long',    label:'LIRE UN LIVRE',color:_dc[3], active:true,  progress:0 },
];

/* ── Persistance localStorage ── */
const STORAGE_KEY = 'praxeo_state_v1';

function saveState() {
  try {
    const snap = {
      praxis:       state.praxis,
      frozen:       state.frozen,
      frozenDays:   state.frozenDays,
      notes:        state.notes,
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
    // Toujours restaurer statsHistory et les métadonnées, quelle que soit l'état de praxis
    state.frozen       = snap.frozen       || false;
    state.frozenDays   = snap.frozenDays   || [];
    state.notes        = snap.notes        || [];
    state.noteHistory  = snap.noteHistory  || [];
    state.statsHistory = snap.statsHistory || {};
    state.statsRecord  = snap.statsRecord  || 0;
    if (snap.praxis && snap.praxis.length) {
      state.praxis = snap.praxis;
      return true;
    }
    return false; // praxis vide → sera réinitialisé, mais statsHistory est préservé
  } catch(e) { /* données corrompues — silencieux */ }
  return false;
}

function loadPraxis() {
  if (!loadState()) {
    // Première ouverture ou praxis vide : charger les données par défaut
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
  recalibrateTodayStats();
  setTimeout(() => {
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    navigate('accueil');
    requestAnimationFrame(() => {
      const h  = document.querySelector('.header');
      const sw = document.querySelector('.header-sub-wrap');
      if (h && sw) {
        const totalH = h.getBoundingClientRect().height + sw.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--header-total-height', totalH + 'px');
      }
    });
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
  initSwipeNav();
}

/* ══════════════════════════════════════════
   SWIPE NAVIGATION
══════════════════════════════════════════ */
function initSwipeNav() {
  const PAGES     = ['accueil','praxis','stats'];
  const THRESHOLD = 60;
  const RENDER    = { accueil: renderAccueil, praxis: renderPraxis, stats: renderStats };
  const EL = () => ({
    accueil: document.getElementById('page-accueil'),
    praxis:  document.getElementById('page-praxis'),
    stats:   document.getElementById('page-stats'),
  });

  let startX = 0, startY = 0;
  let active = false, moved = false;
  let dir = 0, adjPage = null, origPage = null;
  let pid = null;

  function isSwipeZone(e) {
    const page = state.currentPage;
    // Vérifier que la page courante est bien visible
    const pageEl = document.getElementById('page-' + page);
    if (!pageEl || pageEl.classList.contains('hidden')) return false;

    if (page === 'stats') {
      const navbar = document.querySelector('.navbar');
      if (navbar) {
        const navTop = navbar.getBoundingClientRect().top;
        return e.clientY > navTop - 480;
      }
      return true;
    }
    if (page === 'accueil') {
      const row = document.getElementById('rowNote');
      if (!row) return false;
      const r = row.getBoundingClientRect();
      if (r.bottom === 0) return false; // élément non visible
      return e.clientY > r.bottom;
    }
    if (page === 'praxis') {
      const enc = document.querySelector('#page-praxis .praxis-encart');
      if (!enc) return false;
      const r = enc.getBoundingClientRect();
      if (r.bottom === 0) return false;
      return e.clientY > r.bottom;
    }
    return false;
  }

  function cancel() {
    if (!moved || !adjPage) { active = false; moved = false; pid = null; return; }
    const els = EL();
    const oEl = els[origPage], aEl = els[adjPage];
    const W   = window.innerWidth;
    oEl.style.transition = 'transform 0.22s ease';
    aEl.style.transition = 'transform 0.22s ease';
    oEl.style.transform  = 'translateX(0)';
    aEl.style.transform  = `translateX(${dir > 0 ? -W : W}px)`;
    setTimeout(() => {
      aEl.classList.add('hidden');
      oEl.style.cssText = ''; aEl.style.cssText = '';
    }, 230);
    active = false; moved = false; adjPage = null; origPage = null; pid = null;
  }

  document.addEventListener('pointerdown', e => {
    if (_accueilDndActive || _praxisDndActive) return;
    if (state.sheet && state.sheet.open) return;
    if (!isSwipeZone(e)) return;
    startX = e.clientX; startY = e.clientY;
    active = true; moved = false; pid = e.pointerId;
  });

  document.addEventListener('pointermove', e => {
    if (!active || e.pointerId !== pid) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!moved) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { active = false; return; }
      // Déterminer direction et page adjacente
      dir      = dx > 0 ? 1 : -1;
      const idx = PAGES.indexOf(state.currentPage);
      const ni  = idx - dir;
      if (ni < 0 || ni >= PAGES.length) { active = false; return; }
      origPage = state.currentPage;
      adjPage  = PAGES[ni];

      // Pré-rendre la page adjacente (sans navigate, sans changer state.currentPage)
      const aEl = EL()[adjPage];
      RENDER[adjPage]();          // render le contenu
      const W = window.innerWidth;
      aEl.style.cssText = `transform:translateX(${dir > 0 ? -W : W}px);transition:none;`;
      aEl.classList.remove('hidden');
      EL()[origPage].style.cssText = 'transform:translateX(0);transition:none;';
      moved = true;
    }

    e.preventDefault();
    const dx2 = e.clientX - startX;
    const W   = window.innerWidth;
    const els = EL();
    els[origPage].style.transform = `translateX(${dx2}px)`;
    els[adjPage].style.transform  = `translateX(${(dir > 0 ? -W : W) + dx2}px)`;
  }, { passive: false });

  document.addEventListener('pointerup', e => {
    if (!active || e.pointerId !== pid) return;
    const dx = e.clientX - startX;

    if (!moved || !adjPage || Math.abs(dx) < THRESHOLD) { cancel(); return; }

    // Confirmer la navigation
    const W   = window.innerWidth;
    const els = EL();
    const oEl = els[origPage], aEl = els[adjPage];
    oEl.style.transition = 'transform 0.22s ease';
    aEl.style.transition = 'transform 0.22s ease';
    oEl.style.transform  = `translateX(${dir > 0 ? W : -W}px)`;
    aEl.style.transform  = 'translateX(0)';

    const dest = adjPage;
    setTimeout(() => {
      oEl.classList.add('hidden');
      oEl.style.cssText = ''; aEl.style.cssText = '';
      // Finaliser la navigation sans re-render (déjà rendu)
      state.currentPage = dest;
      document.querySelectorAll('.nav-btn[data-page]').forEach(b =>
        b.classList.toggle('active', b.dataset.page === dest)
      );
      const sub = document.getElementById('pageSubtitle');
      if (sub) sub.textContent = PAGE_SUBTITLES[dest] || '';
      exitWiggleMode(); exitAccueilWiggle();
    }, 230);

    active = false; moved = false; adjPage = null; origPage = null; pid = null;
  });

  document.addEventListener('pointercancel', e => {
    if (e.pointerId !== pid) return;
    cancel();
  });
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
    recordRoutineDone(); // recalcule l'entrée du jour dans statsHistory
  }
  else if (action.type === 'accueil_tache_done') {
    delete accueil.tachesDone[action.id];
    saveAccueil();
  }
  else if (action.type === 'accueil_tache_remove') {
    delete accueil.tachesRemoved[action.id];
    if (action.wasDone) accueil.tachesDone[action.id] = true;
    if (action.validated) {
      const p = state.praxis.find(x => x.id === action.id);
      if (p) { p.active = true; saveState(); }
    }
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
    state.notes.splice(action.nidx, 0, action.note);
    saveState();
  }
  else if (action.type === 'accueil_note_tap') {
    state.notes.splice(action.nidx, 0, action.note);
    saveState();
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
         <div class="edit-badge" data-id="${p.id}"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;pointer-events:none;"><path d="M4 20l3-1L19 7a2 2 0 00-3-3L4 16l-1 4z"/><line x1="14" y1="6" x2="18" y2="10"/></svg></div>
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
  // Si c'était une routine active, recalculer les stats du jour
  if (removed.type === 'routine' && removed.active) recordRoutineDone();
  else saveState(); // Sauvegarde pour les tâches et objectifs long terme
  renderPraxis();
}

/* ── Drag & drop vers corbeille ── */
// Flag global pour éviter l'accumulation de listeners entre renders
let _praxisDndActive = false;

function initPraxisDragDrop(el) {
  const trash = el.querySelector('#btnTrash');
  if (!trash) return;

  let dragEl    = null;
  let dragId    = null;
  let clone     = null;
  let startX    = 0, startY = 0;
  let isDragging  = false;
  let wasDragging = false;
  let overTrash   = false;
  let activePointerId = null;

  function cleanup() {
    _praxisDndActive = false;
    if (clone) { clone.remove(); clone = null; }
    if (dragEl) { dragEl.style.opacity = ''; }
    trash.classList.remove('trash-active');
    document.removeEventListener('pointermove',   onDocMove);
    document.removeEventListener('pointerup',     onDocUp);
    document.removeEventListener('pointercancel', onDocCancel);
    dragEl = null; dragId = null; isDragging = false; overTrash = false;
    activePointerId = null;
  }

  function onDocMove(e) {
    if (!dragEl || e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!isDragging && Math.sqrt(dx*dx + dy*dy) < 12) return;
    e.preventDefault();

    if (!isDragging) {
      isDragging  = true;
      wasDragging = true;
      const r = dragEl.getBoundingClientRect();
      clone = dragEl.cloneNode(true);
      clone.querySelectorAll('.edit-badge,.delete-badge,.praxis-badges-group').forEach(b => b.remove());
      clone.style.cssText = `position:fixed;z-index:9999;pointer-events:none;
        opacity:0.8;left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0;`;
      document.body.appendChild(clone);
      dragEl.style.opacity = '0.3';
    }

    clone.style.left = (e.clientX - 20) + 'px';
    clone.style.top  = (e.clientY - 15) + 'px';

    const tr = trash.getBoundingClientRect();
    const hit = e.clientX >= tr.left && e.clientX <= tr.right
             && e.clientY >= tr.top  && e.clientY <= tr.bottom;
    if (hit !== overTrash) { overTrash = hit; trash.classList.toggle('trash-active', hit); }
  }

  function onDocUp(e) {
    if (!dragEl || e.pointerId !== activePointerId) return;
    if (isDragging && overTrash) {
      // Sauvegarder id et label AVANT cleanup (qui remet dragId à null)
      const savedId    = dragId;
      const savedLabel = (state.praxis.find(x => x.id === savedId) || {}).label;
      cleanup();
      if (savedId && savedLabel) openConfirmDeleteSheet(savedId, savedLabel);
      return;
    }
    cleanup();
  }

  function onDocCancel(e) {
    if (!dragEl || e.pointerId !== activePointerId) return;
    cleanup();
  }

  el.querySelectorAll('.praxis-item').forEach(item => {
    item.addEventListener('pointerdown', e => {
      if (_praxisDndActive) return; // Évite accumulation si render entre-deux
      if (state.wiggleId) return;
      if (e.target.closest('.edit-badge,.delete-badge,.praxis-badges-group')) return;
      _praxisDndActive = true;
      dragEl = item;
      dragId = item.dataset.id;
      startX = e.clientX;
      startY = e.clientY;
      wasDragging = false;
      activePointerId = e.pointerId;
      document.addEventListener('pointermove',   onDocMove, { passive: false });
      document.addEventListener('pointerup',     onDocUp);
      document.addEventListener('pointercancel', onDocCancel);
    });

    item.addEventListener('click', e => {
      if (wasDragging) {
        e.stopImmediatePropagation();
        e.preventDefault();
        wasDragging = false;
      }
    }, true);
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

/* ── Variables globales pour le sélecteur (Picker) ── */
let pickerSection = null;
let pickerSelected = new Set();

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
    if (e.target.id === 'sheetInput')