// PRAXEO v2 — onglet Stats.
// Principe : une stat n'est utile que si elle mène à une décision (Harkin et al., 2016 : suivre ses
// progrès aide surtout quand on ajuste ensuite). L'écran est un miroir sobre ; le coach l'interprète
// au rendez-vous du dimanche.

import * as donnees from './donnees.js';
import * as moteur from './moteur.js';
import { ouvrirFeuille, fermerFeuille } from './feuille.js';

const $ = (sel, racine = document) => racine.querySelector(sel);
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SVG_CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6l-6 6"/></svg>';
const MOIS = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEP', 'OCT', 'NOV', 'DÉC'];
const SEMAINES = 20;
const SEUIL_TENDANCE = 5;      // points d'écart pour parler de hausse ou de baisse (en dessous : stable)
const SEUIL_TENDANCE_PRAXIS = 10;
const ARRET_LONG_COURS = 14;   // jours sans avancée : projet « à l'arrêt »

// ROUTINES dépliée par défaut, LONG COURS repliée ; les deux s'excluent (ouvrir l'une replie l'autre).
// HISTORIQUE est repliée au départ et se plie ou se déplie sans toucher aux autres (18/11/2026).
const OUVERTES_DEPART = ['routines'];
const ouvertes = new Set(OUVERTES_DEPART);
const EXCLUSIVES = ['routines', 'long'];

// ── Flèches de tendance (couleur ET direction : jamais la couleur seule, §6.4) ──
function fleche(ecart, seuil) {
  if (ecart >= seuil) return '<span class="tendance hausse" aria-label="en hausse"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17L17 5M9 5h8v8"/></svg></span>';
  if (ecart <= -seuil) return '<span class="tendance baisse" aria-label="en baisse"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l12 12M17 11v8h-8"/></svg></span>';
  return '';
}

// ── Historique réel (lot 0) ────────────────────
// niveau : 0 = rien, 1 = en partie, 2 = l'essentiel, 'pause' = jour en pause (vacances, maladie, gel)
// Les jours repris de la v1 sont approchés : « l'essentiel » = toutes les routines du jour faites (règle v1).
const cle = (d) => donnees.cleDate(d);
function joursReels() {
  return new Map([...donnees.cache.jours.values()].map((j) => [j.date, j.niveau]));
}
const jourAvant = (aujourdhui, n) => { const d = new Date(aujourdhui); d.setDate(d.getDate() - n); return d; };

// Part des journées où l'essentiel est fait, sur [debut, fin[ jours en arrière (pauses exclues)
function partEssentiel(jours, aujourdhui, debut, fin) {
  let ok = 0, n = 0;
  for (let d = debut; d < fin; d++) {
    const v = jours.get(cle(jourAvant(aujourdhui, d)));
    if (v === undefined || v === 'pause') continue;
    n++; if (v === 2) ok++;
  }
  return n ? Math.round((ok / n) * 100) : 0;
}

// Rebond : après un jour vide, combien de fois on repart dès le lendemain (« ne jamais rater deux fois », Clear)
function rebond(jours, aujourdhui, periode = 90) {
  let vides = 0, reprises = 0;
  for (let d = periode; d >= 1; d--) {
    const v = jours.get(cle(jourAvant(aujourdhui, d)));
    if (v !== 0) continue;
    const lendemain = jours.get(cle(jourAvant(aujourdhui, d - 1)));
    if (lendemain === 'pause' || lendemain === undefined) continue;
    vides++; if (lendemain !== 0) reprises++;
  }
  return { vides, reprises };
}

// Ancrage d'une routine sur 9 semaines (Lally et al., 2010 : ≈ 66 jours pour qu'une habitude devienne automatique)
function ancrage(p) {
  if (p.neufSemaines >= 80 && p.taux >= 75) return { cle: 'ancree', mot: 'ancrée' };
  if (p.neufSemaines >= 50) return { cle: 'construction', mot: 'en construction' };
  return { cle: 'fragile', mot: 'fragile' };
}

const enHeures = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ' ' + String(m).padStart(2, '0') : ''}` : `${m} min`; };

// ── Cases du haut ──────────────────────────────
function rendreCases(jours, aujourdhui) {
  const ceMois = partEssentiel(jours, aujourdhui, 0, 30);
  const avant = partEssentiel(jours, aujourdhui, 30, 60);
  const ecart = ceMois - avant;
  const r = rebond(jours, aujourdhui);
  return `
    <div class="stats-cases">
      <div class="stats-case stats-serie">
        <span class="stats-lib">Série en cours</span>
        <span class="stats-couronne"><span class="couronne-img" aria-hidden="true"></span><span class="stats-serie-nb">${moteur.serie()}</span></span>
        <span class="stats-lib">record : ${moteur.record()} jours</span>
      </div>
      <div class="stats-case">
        <span class="stats-lib">Tendance du mois</span>
        <span class="stats-val">${ceMois} % ${fleche(ecart, SEUIL_TENDANCE)}</span>
        <span class="stats-detail">${Math.abs(ecart) < SEUIL_TENDANCE ? 'stable' : `${ecart > 0 ? '+' : '−'}${Math.abs(ecart)} pts`} sur 30 jours</span>
      </div>
      <div class="stats-case">
        <span class="stats-lib">Rebond</span>
        ${r.vides
          ? `<span class="stats-val">${r.reprises} fois sur ${r.vides}</span>
        <span class="stats-detail">reprise le lendemain d'un jour vide</span>`
          : `<span class="stats-val">Aucun jour vide</span>
        <span class="stats-detail">sur les 3 derniers mois</span>`}
      </div>
    </div>`;
}

// ── Historique (inchangé) ──────────────────────
function rendreHistorique(jours, aujourdhui) {
  const dow = (aujourdhui.getDay() + 6) % 7;
  const lundiDebut = jourAvant(aujourdhui, dow + (SEMAINES - 1) * 7);
  let moisPrec = -1;
  const colonnes = [];
  for (let s = 0; s < SEMAINES; s++) {
    const lundi = new Date(lundiDebut); lundi.setDate(lundiDebut.getDate() + s * 7);
    const m = lundi.getMonth();
    const etiquette = m !== moisPrec && lundi.getDate() <= 7 ? MOIS[m] : '';
    if (etiquette) moisPrec = m;
    const cases = [];
    for (let j = 0; j < 7; j++) {
      const date = new Date(lundi); date.setDate(lundi.getDate() + j);
      if (date > aujourdhui) { cases.push('<span class="hm-case hm-futur"></span>'); continue; }
      const n = jours.get(cle(date));
      const classe = n === 'pause' ? 'hm-pause' : n === 2 ? 'hm-2' : n === 1 ? 'hm-1' : 'hm-0';
      cases.push(`<span class="hm-case ${classe}"></span>`);
    }
    colonnes.push(`<div class="hm-col"><span class="hm-mois">${etiquette}</span>${cases.join('')}</div>`);
  }
  return `
    <div class="hm">
      <div class="hm-col hm-jours"><span class="hm-mois"></span><span>L</span><span></span><span>M</span><span></span><span>V</span><span></span><span>D</span></div>
      ${colonnes.join('')}
    </div>
    <div class="hm-legende">
      <span class="hm-case hm-0"></span>rien
      <span class="hm-case hm-1"></span>en partie
      <span class="hm-case hm-2"></span>l'essentiel
      <span class="hm-case hm-pause"></span>pause
    </div>
    ${rendreTemps()}`;
}

// Temps investi : secondaire (estimé d'après les durées prévues), placé sous l'historique
function rendreTemps() {
  const t = tempsSemaine();
  const total = t.routines + t.projets + t.taches;
  const pc = (v) => (v / total) * 100;
  return `
    <div class="temps">
      <span class="temps-tete"><span class="stats-lib">Temps investi cette semaine</span><span class="temps-total">${enHeures(total)}</span></span>
      <span class="temps-barre" aria-hidden="true">
        <span class="tb-routines" style="width:${pc(t.routines)}%"></span><span class="tb-projets" style="width:${pc(t.projets)}%"></span><span class="tb-taches" style="width:${pc(t.taches)}%"></span>
      </span>
      <span class="temps-legende">
        <span><i class="tb-routines"></i>Routines ${enHeures(t.routines)}</span>
        <span><i class="tb-projets"></i>Projets ${enHeures(t.projets)}</span>
        <span><i class="tb-taches"></i>Tâches ${enHeures(t.taches)}</span>
      </span>
    </div>`;
}

// Temps investi depuis lundi, d'après les durées prévues des praxis faites (en minutes)
function tempsSemaine() {
  const t = { routines: 0, projets: 0, taches: 0 };
  const lundi = new Date(); lundi.setHours(0, 0, 0, 0);
  lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  const debut = cle(lundi);
  for (const e of donnees.cache.events) {
    if (e.date < debut || (e.type !== 'fait' && e.type !== 'minimum')) continue;
    const p = donnees.praxisParId(e.praxisId);
    if (!p) continue;
    const minutes = e.duree || p.duree || 0;
    if (p.section === 'long') t.projets += minutes;
    else if (p.section === 'taches') t.taches += minutes;
    else t.routines += minutes;
  }
  return t;
}

// Statistiques d'une routine sur une fenêtre de jours [debut, fin[ en arrière :
// part des jours prévus (et enregistrés, hors pause) où elle a été faite
function statsRoutine(p, jours, aujourdhui) {
  const faits = new Set(donnees.cache.events.filter((e) => e.praxisId === p.id && (e.type === 'fait' || e.type === 'minimum')).map((e) => e.date));
  const taux = (debut, fin) => {
    let prevus = 0, ok = 0;
    for (let d = debut; d < fin; d++) {
      const date = jourAvant(aujourdhui, d);
      const c = cle(date);
      const niveau = jours.get(c);
      if (niveau === undefined || niveau === 'pause') continue;
      if (p.jours && !p.jours.includes(donnees.jourSemaine(date))) continue;
      prevus++; if (faits.has(c)) ok++;
    }
    return prevus ? Math.round((ok / prevus) * 100) : null;
  };
  let minutes = 0;
  for (let d = 0; d < 30; d++) if (faits.has(cle(jourAvant(aujourdhui, d)))) minutes += p.duree || 0;
  return { taux: taux(0, 30), avant: taux(30, 60), neufSemaines: taux(0, 63), temps: minutes ? enHeures(minutes) : '' };
}

// ── Routines : ancrage ─────────────────────────
function rendreRoutines(jours, aujourdhui) {
  const routines = donnees.cache.praxis.filter((p) => p.section === 'piliers' || p.section === 'routines');
  if (!routines.length) return '<li class="sp-ligne"><span class="sp-bas">Pas encore de routines.</span></li>';
  return routines
    .map((p) => ({ ...p, ...statsRoutine(p, jours, aujourdhui) }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr', { sensitivity: 'base' }))
    .map((p) => {
      if (p.taux === null) {
        return `
      <li class="sp-ligne">
        <span class="sp-haut"><span class="sp-point" style="background:${p.couleur}"></span><span class="sp-nom">${echapper(p.libelle)}</span><span class="sp-taux">—</span></span>
        <span class="sp-bas">pas encore de données</span>
      </li>`;
      }
      const a = ancrage({ taux: p.taux, neufSemaines: p.neufSemaines ?? p.taux });
      return `
      <li class="sp-ligne">
        <span class="sp-haut">
          <span class="sp-point" style="background:${p.couleur}"></span>
          <span class="sp-nom">${echapper(p.libelle)}</span>
          ${p.avant === null ? '' : fleche(p.taux - p.avant, SEUIL_TENDANCE_PRAXIS)}
          <span class="sp-barre"><span style="width:${p.taux}%;background:${p.couleur}"></span></span>
          <span class="sp-taux">${p.taux} %</span>
        </span>
        <span class="sp-bas"><span class="ancrage ${a.cle}">${a.mot}</span>${p.temps ? ` · ${echapper(p.temps)} sur 30 jours` : ''}</span>
      </li>`;
    }).join('');
}

// ── Long cours : progression et dernière avancée (principe du progrès, Amabile) ──
function rendreLongCours() {
  return donnees.cache.praxis.filter((p) => p.section === 'long')
    .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr', { sensitivity: 'base' }))
    .map((p) => {
      const d = donnees.derniereFois(p.id);
      const arret = d === undefined || d > ARRET_LONG_COURS;
      const quand = d === undefined ? 'jamais commencé' : d === 0 ? 'avancé aujourd\'hui' : d === 1 ? 'avancé hier' : `sans avancée depuis ${d} jours`;
      return `
      <li class="sp-ligne">
        <span class="sp-haut">
          <span class="sp-point" style="background:${p.couleur}"></span>
          <span class="sp-nom">${echapper(p.libelle)}</span>
          <span class="sp-barre"><span style="width:${p.progression ?? 0}%;background:${p.couleur}"></span></span>
          <span class="sp-taux">${p.progression ?? 0} %</span>
        </span>
        <span class="sp-bas"><span class="${arret ? 'ancrage fragile' : ''}">${quand}</span></span>
      </li>`;
    }).join('');
}

function ligne(cleSection, nom, val, corps) {
  const ouverte = ouvertes.has(cleSection);
  return `
    <div class="ligne${ouverte ? ' ouverte' : ''}" data-section="${cleSection}">
      <button class="ligne-tete" type="button" aria-expanded="${ouverte}">
        <span class="ligne-nom">${nom}</span>
        <span class="ligne-val">${val} ${SVG_CHEVRON}</span>
      </button>
      <div class="ligne-corps stats-corps">${corps}</div>
    </div>`;
}

export function rendre() {
  const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
  const jours = joursReels();
  const nbLong = donnees.cache.praxis.filter((p) => p.section === 'long').length;
  const nbRoutines = donnees.cache.praxis.filter((p) => p.section === 'piliers' || p.section === 'routines').length;
  $('#statsContenu').innerHTML = `
    ${rendreCases(jours, aujourdhui)}
    <div class="lignes-stats">
      ${ligne('historique', 'Historique', '', rendreHistorique(jours, aujourdhui))}
      ${ligne('routines', 'Routines', nbRoutines, `<ul class="sp-liste">${rendreRoutines(jours, aujourdhui)}</ul>`)}
      ${ligne('long', 'Long cours', nbLong, `<ul class="sp-liste">${rendreLongCours()}</ul>`)}
    </div>
    <div class="stats-aide"><button class="btn-aide" type="button" id="statsAide" aria-label="Comprendre les stats">?</button></div>`;
}

// ── Aide « ? » ─────────────────────────────────
const AIDE = [
  ['Série en cours', 'Jours d\'affilée où l\'essentiel a été fait : les piliers en version normale et les tâches essentielles du jour. Un joker par semaine : un jour réduit au plus simple ou un jour raté préserve la série ; au deuxième, elle repart à zéro. Deux jours ratés d\'affilée la cassent toujours : ne jamais rater deux fois. Les jours en pause ne la cassent pas, et elle est gelée en mode minimum.'],
  ['Tendance du mois', 'Part des journées où l\'essentiel a été fait sur les 30 derniers jours, comparée aux 30 jours d\'avant. Flèche verte : hausse d\'au moins 5 points ; flèche rouge : baisse. Une baisse est le signal pour alléger (mode minimum) avant de s\'épuiser.'],
  ['Rebond', 'Après un jour sans rien, combien de fois tu as repris dès le lendemain (3 derniers mois). Ce qui compte n\'est pas de ne jamais rater, mais de ne jamais rater deux fois.'],
    ['Historique', 'Une case par jour, sur 20 semaines. Sombre : l\'essentiel est fait (piliers et tâches essentielles du jour). Claire : une partie. Hachurée : jour en pause. En dessous, le temps investi cette semaine, en trois parts (routines, projets, tâches), estimé d\'après les durées prévues.'],
  ['Routines', 'Pour chaque routine, sa régularité sur 30 jours et son ancrage sur 9 semaines (une habitude met en moyenne 66 jours à devenir automatique). Ancrée : elle tient toute seule. En construction : continue. Fragile : réduis-la au plus simple plutôt que de l\'abandonner. N\'ajoute une routine que quand les autres sont ancrées. Une flèche signale une variation d\'au moins 10 points sur le mois.'],
  ['Long cours', 'Progression de chaque projet et date de sa dernière avancée. Voir ses projets avancer motive ; au-delà de 14 jours sans avancée, à toi de choisir : relancer ou mettre en pause.'],
];

function ouvrirAide() {
  ouvrirFeuille(`
    <p class="feuille-question aide-titre">Comprendre les stats</p>
    <dl class="aide">
      ${AIDE.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
    </dl>
    <div class="feuille-choix"><button class="choix choix-oui" type="button" data-rep="fermer">Fermer</button></div>`,
  (racine) => racine.addEventListener('click', (e) => { if (e.target.closest('[data-rep]')) fermerFeuille(); }));
}

// À chaque ouverture de l'onglet : retour à l'état par défaut (ROUTINES dépliée, le reste replié)
export function ouvrirStats() {
  ouvertes.clear();
  OUVERTES_DEPART.forEach((c) => ouvertes.add(c));
  rendre();
  $('#page-stats').scrollTop = 0;
}

export function initStats() {
  $('#statsContenu').addEventListener('click', (e) => {
    if (e.target.closest('#statsAide')) { ouvrirAide(); return; }
    const tete = e.target.closest('.ligne-tete');
    if (!tete) return;
    const c = tete.parentElement.dataset.section;
    if (ouvertes.has(c)) {
      ouvertes.delete(c);
    } else {
      ouvertes.add(c);
      if (EXCLUSIVES.includes(c)) EXCLUSIVES.filter((x) => x !== c).forEach((x) => ouvertes.delete(x));
    }
    rendre();
  });
  rendre();
}
