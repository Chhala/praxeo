// PRAXEO v2 — données de l'application (lot 0) : chargement, journal, migration v1, export / import.
// Une seule source de vérité : IndexedDB (db.js). Ce module garde une copie en mémoire (« cache »)
// pour que l'interface lise sans attendre ; chaque modification est écrite tout de suite sur l'appareil.

import * as db from './db.js';
import { ESTIMATIONS, PILIERS, SUPPRIMEES, normaliser, enPhrase, HABITUDES_TACHES, CHAMPS_HABITUDES } from './estimations.js';
import { PLANNING_DEFAUT, VACANCES_DEFAUT, MEMOIRE_DEPART, plagesFamille } from './contenu.js';

const CLE_API = 'praxeo_cle_api';   // gardée à part, dans localStorage : exclue de l'export par construction

export const cache = {
  praxis: [],
  events: [],
  jours: new Map(),     // 'AAAA-MM-JJ' → { date, niveau: 0 | 1 | 2 | 'pause', … }
  notes: [],
  ponctuelles: [],
  memoire: [],
  reglages: {},
  meta: {},
};

// ── Dates (heure locale de l'appareil) ─────────
export const cleDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const aujourdhui = () => cleDate();
export const jourSemaine = (d = new Date()) => (d.getDay() === 0 ? 7 : d.getDay());   // 1 = lundi … 7 = dimanche
const dateDe = (cle) => { const [a, m, j] = cle.split('-').map(Number); return new Date(a, m - 1, j); };
export const ecartJours = (cle, ref = aujourdhui()) => Math.round((dateDe(ref) - dateDe(cle)) / 864e5);
export const enMinutes = (h) => { if (!h || !h.includes('h')) return 24 * 60; const [hh, mm] = h.split('h').map(Number); return hh * 60 + (mm || 0); };

// ── Chargement ─────────────────────────────────
export async function charger() {
  await db.ouvrir();
  let meta = Object.fromEntries((await db.tout('meta')).map((m) => [m.cle, m.valeur]));
  if (!meta.initialise) {
    await migrerDepuisLocalStorage();
    await ecrireMeta('initialise', new Date().toISOString());
  }
  // premiers faits connus (§5.7) ; v3 : déroulé du matin (19/11/2026) ; v4 : le soir (20/11/2026, sorti de Réglages) ;
  // v5 : courses au travail et lit avant de partir (21/11/2026). On n'ajoute que les nouveaux, sans toucher aux faits corrigés.
  const NOUVEAUX = { 3: ['m_soir', 'm_courses', 'm_lit'], 4: ['m_courses', 'm_lit'] };
  if ((meta.memoireDepart || 0) < 3) await db.ecrire('memoire', MEMOIRE_DEPART);
  else if (NOUVEAUX[meta.memoireDepart]) await db.ecrire('memoire', MEMOIRE_DEPART.filter((f) => NOUVEAUX[meta.memoireDepart].includes(f.id)));
  if (meta.memoireDepart !== 5) await ecrireMeta('memoireDepart', 5);
  // Rythmes réels des tâches (21/11/2026) : corrigés une fois dans les données déjà reprises de la v1
  if ((meta.habitudesTaches || 0) < 3) {   // v2 : dîner à 19h30 y compris en famille ; v3 : le lit les jours de repos
    for (const p of await db.tout('praxis')) {
      const cle = normaliser(p.libelle);
      if (!HABITUDES_TACHES.includes(cle)) continue;
      const est = ESTIMATIONS[cle];
      const corrige = { ...p };
      for (const c of CHAMPS_HABITUDES) { if (c in est) corrige[c] = est[c]; else if (c !== 'lieu' && c !== 'presence' && c !== 'moment') delete corrige[c]; }
      await db.ecrire('praxis', [corrige]);
    }
    const soir = (await db.tout('memoire')).find((f) => f.id === 'm_soir');
    const nouveau = MEMOIRE_DEPART.find((f) => f.id === 'm_soir');
    if (soir && nouveau && (soir.texte.startsWith('Je dîne vers 19h') || soir.texte.startsWith('Je prépare à manger vers 19h30, un peu plus tôt'))) await db.ecrire('memoire', [{ ...soir, texte: nouveau.texte, date: nouveau.date }]);
    const lit = (await db.tout('memoire')).find((f) => f.id === 'm_lit');
    const litNouveau = MEMOIRE_DEPART.find((f) => f.id === 'm_lit');
    if (lit && litNouveau && lit.texte === 'Les jours travaillés, je fais mon lit avant de partir, vers 7h10.') await db.ecrire('memoire', [{ ...lit, texte: litNouveau.texte, date: litNouveau.date }]);
    await ecrireMeta('habitudesTaches', 3);
  }
  await recharger();
}

async function recharger() {
  const t = Object.fromEntries(await Promise.all(db.MAGASINS.map(async (m) => [m, await db.tout(m)])));
  const { praxis, events, jours, notes, ponctuelles, memoire, reglages, meta } = t;
  cache.praxis = praxis;
  cache.ponctuelles = ponctuelles;
  cache.events = events;
  cache.jours = new Map(jours.map((j) => [j.date, j]));
  cache.notes = notes;
  cache.memoire = memoire;
  cache.reglages = Object.fromEntries(reglages.map((r) => [r.cle, r.valeur]));
  cache.meta = Object.fromEntries(meta.map((m) => [m.cle, m.valeur]));
}

export async function ecrireMeta(cle, valeur) {
  cache.meta[cle] = valeur;
  await db.ecrire('meta', { cle, valeur });
}

// ── Réglages ───────────────────────────────────
const REGLAGES_DEFAUT = { maximes: true, bruitFrappe: true, volumeCrayon: 50, envoiAuto: true, delai: '1 s', taille: 'Normal', modele: 'Haiku', comparaison: false };
export const reglage = (cle) => (cle in cache.reglages ? cache.reglages[cle] : REGLAGES_DEFAUT[cle]);
export async function changerReglage(cle, valeur) {
  cache.reglages[cle] = valeur;
  await db.ecrire('reglages', { cle, valeur });
}

// ── Clé API : seulement sur cet appareil, jamais exportée ─
export const cleApi = () => { try { return localStorage.getItem(CLE_API) || ''; } catch { return ''; } };
export const enregistrerCleApi = (v) => { try { localStorage.setItem(CLE_API, v); } catch { /* stockage indisponible */ } };
export const supprimerCleApi = () => { try { localStorage.removeItem(CLE_API); } catch { /* idem */ } };

// ── Praxis ─────────────────────────────────────
export async function enregistrerPraxis(p) {
  const i = cache.praxis.findIndex((x) => x.id === p.id);
  if (i > -1) cache.praxis[i] = p; else cache.praxis.push(p);
  await db.ecrire('praxis', p);
}
export async function supprimerPraxis(id) {
  cache.praxis = cache.praxis.filter((p) => p.id !== id);
  await db.supprimer('praxis', id);
}
export const praxisParId = (id) => cache.praxis.find((p) => p.id === id);

// ── Journal des événements (§11.1) ─────────────
// type : 'fait' | 'minimum' | 'reporte' | 'retire' | 'ajoute' | 'empeche' | 'progression'
export async function noter(type, praxisId, extra = {}) {
  const maintenant = new Date();
  const ev = { type, praxisId, date: cleDate(maintenant), heure: `${maintenant.getHours()}h${String(maintenant.getMinutes()).padStart(2, '0')}`, ...extra };
  if (type === 'fait') {
    const reelle = mesurerDuree(praxisId, maintenant);
    if (reelle) ev.dureeReelle = reelle;
  }
  ev.id = await db.ecrire('events', ev);
  cache.events.push(ev);
  return ev;
}

// Durée réelle (§5.9) : temps écoulé depuis la validation précédente du jour, retenu seulement si la tâche
// a été validée dans la foulée (≤ 2 h d'écart) et reste plausible (entre la moitié et le double de la durée prévue).
function mesurerDuree(praxisId, maintenant) {
  const p = praxisParId(praxisId);
  if (!p || !p.duree) return null;
  const date = cleDate(maintenant);
  // commencée (minuteur, « C'est commencé ») : la mesure part de son heure de début (21/11/2026)
  const debut = cache.events.filter((e) => e.date === date && e.praxisId === praxisId && e.type === 'commence' && e.heure).pop();
  const precedentes = cache.events.filter((e) => e.date === date && e.heure && (e.type === 'fait' || e.type === 'minimum'));
  if (!debut && !precedentes.length) return null;
  const derniere = debut ? enMinutes(debut.heure) : precedentes.map((e) => enMinutes(e.heure)).sort((a, b) => b - a)[0];
  const ecart = maintenant.getHours() * 60 + maintenant.getMinutes() - derniere;
  if (ecart <= 0 || ecart > 120) return null;
  return ecart >= p.duree / 2 && ecart <= p.duree * 2 ? ecart : null;
}
// Remettre un événement retiré (« Annuler » après une validation retirée par Kairos)
export async function restaurerEvenement(e) {
  await db.ecrire('events', [e]);
  cache.events.push(e);
}
export async function supprimerEvenement(id) {
  cache.events = cache.events.filter((e) => e.id !== id);
  await db.supprimer('events', id);
}
const evenementsDu = (date) => cache.events.filter((e) => e.date === date);

// Jours écoulés depuis la dernière réalisation (undefined : aucune trace)
export function derniereFois(praxisId) {
  let derniere = null;
  for (const e of cache.events) {
    if (e.praxisId !== praxisId || (e.type !== 'fait' && e.type !== 'minimum' && e.type !== 'progression')) continue;
    if (!derniere || e.date > derniere) derniere = e.date;
  }
  return derniere ? ecartJours(derniere) : undefined;
}

// ── Tâches ponctuelles (§3.4) ──────────────────
// Palette des praxis (la même que la fiche) : une tâche ajoutée sans couleur prend la moins portée du moment
// (22/11/2026 : toutes les tâches ajoutées par Kairos étaient brunes)
export const PALETTE = ['#005A92', '#5D1935', '#D4AF37', '#E2953B', '#6E7A68', '#A66E4E', '#3B596A', '#1A1A18'];
function couleurLibre() {
  const n = new Map(PALETTE.map((c) => [c, 0]));
  for (const q of cache.ponctuelles) if (n.has(q.couleur)) n.set(q.couleur, n.get(q.couleur) + 1);
  const moins = Math.min(...n.values());
  const libres = PALETTE.filter((c) => n.get(c) === moins);
  return libres[Math.floor(Math.random() * libres.length)];
}
export async function ajouterPonctuelle(q) {
  const objet = { id: `q_${Date.now()}`, date: aujourdhui(), duree: 20, ...q, couleur: q.couleur || couleurLibre() };
  cache.ponctuelles.push(objet);
  await db.ecrire('ponctuelles', objet);
  return objet;
}
// Faite : elle disparaît, en ne laissant qu'une trace dans le journal (date, durée)
export async function terminerPonctuelle(id) {
  const q = cache.ponctuelles.find((x) => x.id === id);
  if (!q) return null;
  // une séance sur une praxis existante (q.praxisId) est notée au nom de cette praxis : elle nourrit ses stats
  const ev = await noter('fait', q.praxisId || id, { ponctuelle: q.libelle, duree: q.duree });
  cache.ponctuelles = cache.ponctuelles.filter((x) => x.id !== id);
  await db.supprimer('ponctuelles', id);
  return { q, ev };
}
export async function enregistrerPonctuelle(q) {
  const i = cache.ponctuelles.findIndex((x) => x.id === q.id);
  if (i > -1) cache.ponctuelles[i] = q; else cache.ponctuelles.push(q);
  await db.ecrire('ponctuelles', q);
}
export async function restaurerPonctuelle(q) {
  cache.ponctuelles.push(q);
  await db.ecrire('ponctuelles', q);
}
export async function supprimerPonctuelle(id) {
  cache.ponctuelles = cache.ponctuelles.filter((x) => x.id !== id);
  await db.supprimer('ponctuelles', id);
}

// ── Bloc-notes (§5.4) ──────────────────────────
export async function ajouterNote(libelle, praxisId = null, extra = {}) {
  const n = { id: `n_${Date.now()}`, libelle, couleur: '#4a453e', ...(praxisId ? { praxisId } : {}), date: aujourdhui(), ...extra };
  cache.notes.push(n);
  await db.ecrire('notes', n);
  return n;
}
export async function supprimerNote(id) {
  const n = cache.notes.find((x) => x.id === id);
  cache.notes = cache.notes.filter((x) => x.id !== id);
  await db.supprimer('notes', id);
  return n;
}
export async function restaurerNote(n) {
  cache.notes.push(n);
  await db.ecrire('notes', n);
}
// Rappel d'idée (§5.4) : le coach note quand il l'a rappelée, pour ne pas insister
export async function modifierNote(id, champs) {
  const n = cache.notes.find((x) => x.id === id);
  if (!n) return null;
  Object.assign(n, champs);
  await db.ecrire('notes', n);
  return n;
}

// ── Questionnaire « dernière fois ? » (§11.4) ──
// Les tâches sans aucune trace dans le journal ; « Je ne sais pas » n'est plus redemandé.
export function tachesSansHistorique() {
  const ignorees = new Set(cache.meta.questionnaireIgnore || []);
  return cache.praxis.filter((p) => p.section === 'taches' && derniereFois(p.id) === undefined && !ignorees.has(p.id));
}
const ILYA = { semaine: 3, mois: 15, longtemps: 45 };   // estimation prudente, au milieu de chaque période
export async function repondreDerniereFois(praxisId, reponse) {
  if (reponse === 'inconnu') {
    await ecrireMeta('questionnaireIgnore', [...(cache.meta.questionnaireIgnore || []), praxisId]);
    return;
  }
  const d = new Date(); d.setDate(d.getDate() - ILYA[reponse]);
  const ev = { type: 'fait', praxisId, date: cleDate(d), source: 'questionnaire', estime: true };
  ev.id = await db.ecrire('events', ev);
  cache.events.push(ev);
}

// ── Planning et statut (§4.1, §4.3) ────────────
export const planning = () => cache.meta.planning || PLANNING_DEFAUT;
export const vacances = () => cache.meta.vacances || VACANCES_DEFAUT;
export async function enregistrerPlanning(pl) { await ecrireMeta('planning', pl); }
export async function enregistrerVacances(v) { await ecrireMeta('vacances', v); }

// Semaine du cycle de garde alternée : 'A' ou 'B'
export function semaineDe(d = new Date()) {
  const ref = dateDe(planning().referenceA);
  const jour = new Date(d); jour.setHours(0, 0, 0, 0);
  const ecart = Math.floor(Math.round((jour - ref) / 864e5) / 7);
  return ((ecart % 2) + 2) % 2 === 0 ? 'A' : 'B';
}
export const jourDuPlanning = (d = new Date()) => planning().semaines[semaineDe(d)][jourSemaine(d) - 1];

const HORAIRES_TRAVAIL = { journee: [8 * 60, 17 * 60], matin: [8 * 60, 12 * 60] };
const TRAJET = 30;   // minutes, avant et après le travail (≈ 1 h au retour avec les courses)

// Statut déduit du planning et de l'heure (§4.3). Je peux le changer en le disant au coach (« je suis dehors ») :
// le choix manuel vaut jusqu'à l'heure dite, puis le statut déduit reprend (lot 4).
export function statut(d = new Date()) {
  const fin = cache.meta.pauseJusquau;
  if (fin && fin >= cleDate(d)) return 'Pause';
  const man = cache.meta.statutManuel;
  if (man && man.date === cleDate(d) && d.getHours() * 60 + d.getMinutes() < enMinutes(man.jusqua || '23h59')) return man.valeur;
  const j = jourDuPlanning(d);
  const m = d.getHours() * 60 + d.getMinutes();
  const h = HORAIRES_TRAVAIL[j.travail];
  if (h) {
    if (m >= h[0] && m < h[1]) return 'Travail';
    if ((m >= h[0] - TRAJET && m < h[0]) || (m >= h[1] && m < h[1] + 60)) return 'Dehors';
  }
  if (plagesFamille(j).some(([de, a]) => m >= enMinutes(de) && m < enMinutes(a))) return 'En famille';
  return 'Maison';
}
export const enVacancesScolaires = (d = new Date()) => vacances().some((v) => v.debut <= cleDate(d) && cleDate(d) <= v.fin);

// Heure de départ le matin : plus tôt les jours d'école de ma fille, sauf pendant les vacances scolaires.
// La fenêtre du matin va du lever au départ (moins la préparation) : le moteur (lot 2) y place les routines.
export function departDuJour(d = new Date()) {
  const j = jourDuPlanning(d);
  if (j.departEcole && !enVacancesScolaires(d)) return j.departEcole;
  return j.depart || null;
}

// Temps libre du matin pour les routines (en minutes) : du lever à la fin de la fenêtre, moins la douche.
// Ex. jeudi : 5h30 → 6h30 = 60 min, moins 30 min de douche = 30 min (lever à 5h40 : 20 min).
export function tempsLibreMatin(d = new Date(), retardLever = 0) {
  const j = jourDuPlanning(d);
  const fin = finFenetreMatin(d);
  if (!fin) return null;
  const douche = (planning().matin || {}).douche || 0;
  return Math.max(0, enMinutes(fin) - enMinutes(j.lever) - retardLever - douche);
}

// Fin du temps libre du matin pour mes routines : départ, ou plus tôt si je m'occupe de ma fille
// (jours d'école : dès 6h30, précisé le 19/11/2026). Ex. jeudi : 5h30 → 6h30, soit une heure.
export function finFenetreMatin(d = new Date()) {
  const j = jourDuPlanning(d);
  const depart = departDuJour(d);
  const ecole = j.departEcole && !enVacancesScolaires(d);
  const matinFille = plagesFamille(j).map(([de]) => de).filter((de) => enMinutes(de) > enMinutes(j.lever) && (!depart || enMinutes(de) < enMinutes(depart)));
  if (ecole && matinFille.length) return matinFille.sort((x, y) => enMinutes(x) - enMinutes(y))[0];
  return depart;
}

// ── Notes et mémoire du coach ──────────────────
export async function oublierFait(id) {
  const f = cache.memoire.find((m) => m.id === id);
  cache.memoire = cache.memoire.filter((m) => m.id !== id);
  await db.supprimer('memoire', id);
  return f;
}
// Un fait : une phrase courte à la première personne, un thème, une date (§5.7, précisé le 19/11/2026)
export async function ajouterFait(theme, texte) {
  const f = { id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, theme, texte, date: aujourdhui() };
  cache.memoire.push(f);
  await db.ecrire('memoire', f);
  return f;
}
export async function modifierFait(id, champs) {
  const f = cache.memoire.find((m) => m.id === id);
  if (!f) return null;
  Object.assign(f, champs, { date: aujourdhui() });
  await db.ecrire('memoire', f);
  return f;
}
export async function restaurerFait(f) {
  cache.memoire = cache.memoire.filter((m) => m.id !== f.id);
  cache.memoire.push(f);
  await db.ecrire('memoire', f);
}

// ── Migration depuis la v1 (§11.2) ─────────────
async function migrerDepuisLocalStorage() {
  let etat = null, notes = [], accueil = null;
  try {
    etat = JSON.parse(localStorage.getItem('praxeo_state_v2') || localStorage.getItem('praxeo_state_v1') || 'null');
    notes = JSON.parse(localStorage.getItem('praxeo_notes_v1') || '[]');
    const cleAccueil = `praxeo_accueil_${aujourdhui()}`;
    accueil = JSON.parse(localStorage.getItem(cleAccueil) || 'null');
    if (accueil) accueil = { accueilKey: cleAccueil, accueilData: accueil };
  } catch { etat = null; }
  if (!etat || !Array.isArray(etat.praxis) || !etat.praxis.length) return false;
  await importerV1({ ...etat, notes, ...(accueil || {}) });
  return true;
}

// Convertit une sauvegarde v1 (localStorage ou fichier exporté) vers le modèle v2
export async function importerV1(v1) {
  const praxis = [];
  const garde = new Set();
  for (const p of v1.praxis || []) {
    const cle = normaliser(p.label);
    if (SUPPRIMEES.includes(cle)) continue;
    const long = p.type === 'long';
    const cleEst = long && cle === 'BOXE' ? 'BOXE TUTOS' : cle;
    const est = ESTIMATIONS[cleEst] || {};
    let section;
    if (p.type === 'routine') section = PILIERS.includes(cle) ? 'piliers' : (p.active ? 'routines' : 'inactives');
    else section = long ? 'long' : 'taches';   // en v1, « active » d'une tâche = au programme du jour, pas désactivée
    const v2 = {
      id: p.id,
      libelle: est.libelle || (cleEst === 'BOXE TUTOS' ? 'Boxe tutos' : enPhrase(p.label)),
      couleur: p.color || '#005A92',
      section,
      ...(section === 'inactives' ? { sectionAvant: 'routines' } : {}),
      ...(p.type === 'routine' ? { jours: est.jours || p.days || [1, 2, 3, 4, 5, 6, 7] } : {}),
      ...(long ? { progression: Math.min(100, (p.progress || 0) * 25) } : {}),
      origine: 'v1',
    };
    for (const champ of ['heure', 'duree', 'frequence', 'importance', 'moment', 'lieu', 'minimum', 'description', 'presence', 'mois', 'horsMois', 'jourDuMois', 'apres']) {
      if (est[champ] !== undefined) v2[champ] = est[champ];
    }
    praxis.push(v2);
    garde.add(p.id);
  }

  // Historique : chaque routine faite devient un événement ; chaque journée garde son niveau
  const events = [];
  const jours = [];
  const dejaNotes = new Set();
  for (const [date, h] of Object.entries(v1.statsHistory || {})) {
    (h.ids || []).forEach((id) => {
      if (!garde.has(id)) return;
      events.push({ type: 'fait', praxisId: id, date, source: 'v1' });
      dejaNotes.add(`${date}|${id}`);
    });
    (h.skipped || []).forEach((id) => { if (garde.has(id)) events.push({ type: 'empeche', praxisId: id, date, source: 'v1' }); });
    if (h.total > 0) jours.push({ date, niveau: h.done >= h.total ? 2 : h.done > 0 ? 1 : 0, fait: h.done, prevu: h.total, source: 'v1' });
  }
  for (const date of v1.frozenDays || []) jours.push({ date, niveau: 'pause', source: 'v1' });

  // État du jour en cours (si la sauvegarde date d'aujourd'hui)
  if (v1.accueilData && v1.accueilKey === `praxeo_accueil_${aujourdhui()}`) {
    Object.keys(v1.accueilData.routinesDone || {}).forEach((id) => {
      if (garde.has(id) && !dejaNotes.has(`${aujourdhui()}|${id}`)) events.push({ type: 'fait', praxisId: id, date: aujourdhui(), source: 'v1' });
    });
  }

  const notes = (Array.isArray(v1.notes) ? v1.notes : []).map((n, i) => ({ id: `n${i + 1}`, libelle: enPhrase(n.label || n), couleur: n.color || '#4a453e' }));

  await db.vider(['praxis', 'events', 'jours', 'notes']);
  await db.ecrire('praxis', praxis);
  if (events.length) await db.ecrire('events', events);
  // jours : un même jour peut être à la fois dans l'historique et gelé → la pause l'emporte
  const parDate = new Map();
  jours.forEach((j) => { if (!parDate.has(j.date) || j.niveau === 'pause') parDate.set(j.date, j); });
  if (parDate.size) await db.ecrire('jours', [...parDate.values()]);
  if (notes.length) await db.ecrire('notes', notes);
  await db.ecrire('meta', [
    { cle: 'record', valeur: v1.statsRecord || 0 },
    { cle: 'historiqueNotes', valeur: v1.noteHistory || [] },
    { cle: 'migration', valeur: { date: new Date().toISOString(), praxis: praxis.length, evenements: events.length, jours: parDate.size } },
  ]);
  await recharger();
  return { praxis: praxis.length, evenements: events.length, jours: parDate.size };
}

// ── Export / import / réinitialisation (§11.3) ─
export async function exporter() {
  const contenu = { format: 'praxeo-v2', schema: 1, exportedAt: new Date().toISOString() };
  for (const m of db.MAGASINS) contenu[m] = await db.tout(m);
  return contenu;   // la clé API n'y est pas : elle vit à part (localStorage)
}

export async function importer(donnees) {
  if (donnees && donnees.format === 'praxeo-v2') {
    await db.vider();
    for (const m of db.MAGASINS) if (Array.isArray(donnees[m]) && donnees[m].length) await db.ecrire(m, donnees[m]);
    await recharger();
    return { format: 'v2' };
  }
  if (donnees && Array.isArray(donnees.praxis) && donnees.statsHistory) {
    await db.vider(['ponctuelles']);   // les tâches ajoutées ne se mélangent pas à la sauvegarde (praxis, journal, journées : vidés par importerV1)
    const r = await importerV1(donnees);
    return { format: 'v1', ...r };
  }
  throw new Error('Fichier non reconnu : ce n\'est pas une sauvegarde Praxeo.');
}

export async function reinitialiser() {
  await db.vider();
  supprimerCleApi();
  await ecrireMeta('initialise', new Date().toISOString());   // ne pas re-migrer la v1 automatiquement
  await recharger();
}
