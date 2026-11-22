// PRAXEO v2 — onglet Praxis (bibliothèque). Cahier des charges §6.2.
// Lot 0 : les praxis viennent de l'appareil ; chaque modification de la fiche est enregistrée.

import * as donnees from './donnees.js';
import { urgenceTache } from './moteur.js';
import * as annuler from './annuler.js';
import { ouvrirFeuille, fermerFeuille } from './feuille.js';

const $ = (sel, racine = document) => racine.querySelector(sel);
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const SECTIONS = [
  { cle: 'piliers',   nom: 'Piliers' },
  { cle: 'routines',  nom: 'Routines' },
  { cle: 'taches',    nom: 'Tâches' },
  { cle: 'long',      nom: 'Long cours' },
  { cle: 'inactives', nom: 'Inactives' },
];
const SVG_CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6l-6 6"/></svg>';
const NOMS_JOURS = ['', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

const COULEURS = donnees.PALETTE;

const etat = {
  get praxis() { return donnees.cache.praxis; },
  ouvertes: new Set(),
  recherche: '',
  ajouterAuProgramme: () => {},
  dejaPrevue: () => false,
};

// ── Informations affichées ─────────────────────
function joursCourts(jours) {
  if (!jours) return '';
  const j = [...jours].sort((a, b) => a - b).join(',');
  if (j === '1,2,3,4,5,6,7') return 'chaque jour';
  if (j === '1,2,3,4,5') return 'lun → ven';
  if (j === '6,7') return 'le week-end';
  return jours.slice().sort((a, b) => a - b).map((n) => NOMS_JOURS[n]).join(' · ');
}

// L'info temporelle, toujours visible à droite de la bulle
function infoTemps(p) {
  if (p.section === 'long') return `${p.progression ?? 0} %`;
  // rythmes réels (21/11/2026) : le 15 du mois, après la lessive, d'avril à juillet
  if (p.jourDuMois) return `le ${p.jourDuMois} du mois`;
  if (p.apres) return `après : ${p.apres.toLowerCase()}`;
  if (p.mois) { const M = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']; return `${M[p.mois[0] - 1]} → ${M[p.mois[p.mois.length - 1] - 1]}`; }
  if (p.frequence) return `tous les ${p.frequence} j`;
  return joursCourts(p.jours);
}

// Dernière réalisation, tirée du journal (undefined : aucune trace)
const der = (p) => donnees.derniereFois(p.id);

// En retard : la dernière fois dépasse la fréquence, et elle n'est pas déjà au programme du jour
const enRetard = (p) => !etat.dejaPrevue(p.libelle) && p.section === 'taches' && urgenceTache(p) > 1;

function derniereFois(n) {
  if (n === undefined) return 'Jamais';
  if (n === 0) return 'Aujourd\'hui';
  if (n === 1) return 'Hier';
  return `Il y a ${n} jours`;
}

// ── Rendu de la liste ──────────────────────────
function correspond(p) {
  return !etat.recherche || sansAccents(p.libelle).includes(sansAccents(etat.recherche));
}

export function rendre() {
  const liste = $('#praxisListe');
  const html = SECTIONS.map((s) => {
    const items = etat.praxis
      .filter((p) => p.section === s.cle && correspond(p))
      .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr', { sensitivity: 'base' }));
    if (etat.recherche && !items.length) return s.cle === 'inactives' ? ligneUneFois() : '';
    const total = etat.praxis.filter((p) => p.section === s.cle).length;
    const ouverte = etat.recherche ? true : etat.ouvertes.has(s.cle);   // la recherche déplie ce qui contient un résultat
    const retards = items.filter(enRetard).length;
    const pastille = !ouverte && retards ? `<span class="pastille-nb" aria-label="${retards} en retard">${retards}</span>` : '';
    const lignes = items.map((p) => `
      <li class="praxis-ligne" data-id="${p.id}">
        <span class="bulle" style="background:${p.couleur}">${echapper(p.libelle)}</span>
        ${p.duree ? `<span class="duree">${p.duree < 60 ? `${p.duree} min` : `${Math.floor(p.duree / 60)}h${p.duree % 60 ? String(p.duree % 60).padStart(2, '0') : ''}`}</span>` : ''}
        <span class="praxis-droite">
          ${enRetard(p) ? '<button class="pastille-retard" type="button" data-retard="' + p.id + '">En retard</button>' : ''}
          <span class="praxis-info">${echapper(infoTemps(p))}</span>
        </span>
      </li>`).join('');
    return (s.cle === 'inactives' ? ligneUneFois() : '') + `
      <div class="ligne${ouverte ? ' ouverte' : ''}" data-section="${s.cle}">
        <button class="ligne-tete" type="button" aria-expanded="${ouverte}">
          <span class="ligne-nom">${s.nom}</span>
          <span class="ligne-val">${pastille}${etat.recherche ? items.length : total} ${SVG_CHEVRON}</span>
        </button>
        <ul class="ligne-corps praxis-corps">${lignes}</ul>
      </div>`;
  }).join('');
  const sansDate = etat.recherche ? 0 : donnees.tachesSansHistorique().length;
  const bandeau = sansDate
    ? `<button type="button" class="bandeau" data-action="questionnaire">${sansDate} tâche${sansDate > 1 ? 's' : ''} sans date : quand ${sansDate > 1 ? 'les as-tu faites' : 'l\'as-tu faite'} pour la dernière fois ? <span>Répondre (1 min)</span></button>`
    : '';
  liste.innerHTML = bandeau + (html || '<p class="a-venir">Aucune praxis ne correspond.</p>');
}

// ── Tâches « une fois » (ajoutées à la main ou par Kairos, 22/11/2026 : on ne pouvait ni les voir ni les modifier) ──
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
function quandUneFois(q) {
  if (!q.date && q.echeance) { const [, m, j] = q.echeance.split('-'); return `avant le ${Number(j)}/${Number(m)}`; }
  const auj = donnees.aujourdhui();
  if (!q.date || q.date <= auj) return q.heure ? `aujourd'hui, ${q.heure}` : 'aujourd\'hui';
  const [a, m, j] = q.date.split('-').map(Number);
  return `${JOURS_COURTS[new Date(a, m - 1, j).getDay()]} ${j}/${m}${q.heure ? `, ${q.heure}` : ''}`;
}
function ligneUneFois() {
  const items = donnees.cache.ponctuelles.filter(correspond)
    .sort((a, b) => (a.date || a.echeance || '').localeCompare(b.date || b.echeance || '') || (a.heure || '').localeCompare(b.heure || ''));
  if (etat.recherche && !items.length) return '';
  const ouverte = etat.recherche ? true : etat.ouvertes.has('uneFois');
  const lignes = items.map((q) => `
      <li class="praxis-ligne" data-ponctuelle="${q.id}">
        <span class="bulle" style="background:${q.couleur || '#A66E4E'}">${echapper(q.libelle)}</span>
        ${q.duree ? `<span class="duree">${q.duree < 60 ? `${q.duree} min` : `${Math.floor(q.duree / 60)}h${q.duree % 60 ? String(q.duree % 60).padStart(2, '0') : ''}`}</span>` : ''}
        <span class="praxis-droite"><span class="praxis-info">${echapper(quandUneFois(q))}</span></span>
      </li>`).join('');
  return `
      <div class="ligne${ouverte ? ' ouverte' : ''}" data-section="uneFois">
        <button class="ligne-tete" type="button" aria-expanded="${ouverte}">
          <span class="ligne-nom">Une fois</span>
          <span class="ligne-val">${items.length} ${SVG_CHEVRON}</span>
        </button>
        <ul class="ligne-corps praxis-corps">${lignes}</ul>
      </div>`;
}

// Fiche d'une tâche « une fois » : nom, durée, jour, heure, couleur ; supprimer
export function ouvrirPonctuelle(q, quandFermee = null) {
  const champ = (html, libelle) => `<div class="fiche-rang"><dt>${libelle}</dt><dd>${html}</dd></div>`;
  ouvrirFeuille(`
    <div class="fiche-tete"><input class="fiche-nom" data-champ="libelle" type="text" value="${echapper(q.libelle)}" style="background:${q.couleur || '#A66E4E'}" aria-label="Nom" autocomplete="off"></div>
    <dl class="fiche">
      ${champ(`<span class="fiche-nombre"><input class="fiche-champ" data-champ="duree" type="number" inputmode="numeric" min="1" max="600" value="${q.duree ?? ''}">min</span>`, 'Durée')}
      ${champ(`<input class="fiche-champ" data-champ="date" type="date" value="${q.date || ''}">`, 'Jour')}
      ${champ(`<input class="fiche-champ" data-champ="heure" type="time" value="${versChamp(q.heure)}">`, 'Heure')}
      ${champ(`<span class="nuancier">${COULEURS.map((c) => `<button type="button" class="nuance${c === q.couleur ? ' choisie' : ''}" data-couleur="${c}" style="background:${c}" aria-label="Couleur"></button>`).join('')}</span>`, 'Couleur')}
    </dl>
    <p class="reg-aide">Sans heure, Kairos la place dans la journée. Faite, elle disparaît en laissant une trace dans le journal.</p>
    <div class="feuille-choix">
      <button class="choix choix-supprimer" type="button" data-rep="supprimer">Supprimer</button>
      <button class="choix choix-oui" type="button" data-rep="fermer">Fermer</button>
    </div>`, (racine) => {
    const sauver = () => donnees.enregistrerPonctuelle(q);
    racine.addEventListener('change', (e) => {
      const c = e.target.dataset.champ;
      if (!c) return;
      let v = e.target.value.trim();
      if (c === 'libelle') { if (!v) { e.target.value = q.libelle; return; } v = v.charAt(0).toUpperCase() + v.slice(1); }
      if (c === 'duree') { v = Math.max(1, Math.round(Number(v) || 0)) || 20; e.target.value = v; }
      if (c === 'heure') v = depuisChamp(v);
      if (c === 'date' && v) delete q.echeance;
      if (v === '' || v === undefined) delete q[c]; else q[c] = v;
      if (c === 'date' && !q.date && !q.echeance) q.date = donnees.aujourdhui();
      sauver();
    });
    racine.addEventListener('click', async (e) => {
      const nu = e.target.closest('[data-couleur]');
      if (nu) {
        q.couleur = nu.dataset.couleur;
        racine.querySelectorAll('.nuance').forEach((x) => x.classList.toggle('choisie', x === nu));
        $('.fiche-nom', racine).style.background = q.couleur;
        sauver();
        return;
      }
      const b = e.target.closest('[data-rep]');
      if (!b) return;
      if (b.dataset.rep === 'supprimer') {
        const copie = { ...q };
        await donnees.supprimerPonctuelle(q.id);
        annuler.enregistrer(`${q.libelle} : supprimée`, () => donnees.restaurerPonctuelle(copie));
      }
      fermerFeuille();
      rendre();
    });
  }, quandFermee);
}

// ── Invite « En retard » ───────────────────────
function inviterRetard(p) {
  ouvrirFeuille(`
    <p class="feuille-question">L'ajouter au programme d'aujourd'hui ?</p>
    <p class="feuille-sous">${echapper(p.libelle)} · ${echapper(derniereFois(der(p)).toLowerCase())}</p>
    <div class="feuille-choix">
      <button class="choix choix-oui" type="button" data-rep="oui">Oui</button>
      <button class="choix" type="button" data-rep="non">Plus tard</button>
    </div>`, (racine) => {
    racine.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rep]');
      if (!b) return;
      if (b.dataset.rep === 'oui') {
        etat.ajouterAuProgramme(p);
        rendre();
      }
      fermerFeuille();
    });
  });
}

// ── Fiche d'une praxis ─────────────────────────
function segment(nom, options, valeur) {
  return `<span class="segment" data-champ="${nom}">${options.map((o) =>
    `<button type="button" class="${o === valeur ? 'choisi' : ''}" data-val="${o}">${o}</button>`).join('')}</span>`;
}

// Heures : « 5h35 » (stockage) ↔ « 05:35 » (champ horaire)
const versChamp = (h) => { if (!h || !h.includes('h')) return ''; const [hh, mm] = h.split('h'); return `${hh.padStart(2, '0')}:${(mm || '00').padStart(2, '0')}`; };
const depuisChamp = (v) => { if (!v) return ''; const [hh, mm] = v.split(':'); return `${Number(hh)}h${mm}`; };
const TYPES = [['routines', 'Routine'], ['taches', 'Tâche'], ['long', 'Long cours']];
const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MAX_PILIERS = 4;   // §3.2 : 3 ou 4 piliers au maximum

// Fiche complète, sans intertitres (§6.2) : chaque champ est enregistré dès qu'il change (lot 1)
export function ouvrirFiche(p, quandFermee = null) {
  const actif = p.section !== 'inactives';
  const famille = actif ? p.section : (p.sectionAvant || 'routines');
  const routine = famille === 'routines' || famille === 'piliers';
  const long = famille === 'long';
  const champ = (cle, html, libelle) => `<div class="fiche-rang"><dt>${libelle}</dt><dd>${html}</dd></div>`;
  const texte = (cle, valeur, ph = '') => `<input class="fiche-champ" data-champ="${cle}" type="text" value="${echapper(valeur || '')}" placeholder="${ph}" autocomplete="off">`;
  const nombre = (cle, valeur, unite) => `<span class="fiche-nombre"><input class="fiche-champ" data-champ="${cle}" type="number" inputmode="numeric" min="1" max="600" value="${valeur ?? ''}">${unite}</span>`;
  const rangs = [
    champ('type', segment('type', TYPES.map(([, n]) => n), (TYPES.find(([c]) => c === (famille === 'piliers' ? 'routines' : famille)) || TYPES[0])[1]), 'Type'),
    routine && champ('pilier', `<button type="button" class="interrupteur${p.section === 'piliers' ? ' oui' : ''}" role="switch" aria-checked="${p.section === 'piliers'}" data-bascule="pilier" aria-label="Pilier"></button>`, 'Pilier'),
    !long && champ('duree', nombre('duree', p.duree, 'min'), 'Durée'),
    routine && champ('jours', `<span class="fiche-jours">${JOURS.map((j, i) => `<button type="button" class="jour${(p.jours || []).includes(i + 1) ? ' choisi' : ''}" data-jour="${i + 1}">${j}</button>`).join('')}</span>`, 'Jours'),
    famille === 'taches' && champ('frequence', `<span class="fiche-nombre">tous les ${`<input class="fiche-champ" data-champ="frequence" type="number" inputmode="numeric" min="1" max="365" value="${p.frequence ?? ''}">`} j</span>`, 'Fréquence'),
    !long && champ('heure', `<input class="fiche-champ" data-champ="heure" type="time" value="${versChamp(p.heure)}">`, 'Heure prévue'),
    champ('presence', segment('presence', ['Les 2', 'Seul', 'Famille'], p.presence || 'Les 2'), 'Présence'),
    champ('derniere', echapper(derniereFois(der(p))), 'Dernière fois'),
    champ('importance', segment('importance', ['essentielle', 'utile', 'bonus'], p.importance || 'utile'), 'Importance'),
    champ('moment', texte('moment', p.moment, 'Soir'), 'Moment'),
    champ('lieu', texte('lieu', p.lieu, 'Maison'), 'Lieu'),
    !long && champ('minimum', texte('minimum', p.minimum, 'Une page'), 'Minimum'),
    champ('couleur', `<span class="nuancier">${COULEURS.map((c) => `<button type="button" class="nuance${c === p.couleur ? ' choisie' : ''}" data-couleur="${c}" style="background:${c}" aria-label="Couleur"></button>`).join('')}</span>`, 'Couleur'),
  ].filter(Boolean);

  ouvrirFeuille(`
    <div class="fiche-tete"><input class="fiche-nom" data-champ="libelle" type="text" value="${echapper(p.libelle)}" style="background:${p.couleur}" aria-label="Nom" autocomplete="off"></div>
    ${long ? `
      <div class="fiche-progression">
        <input type="range" min="0" max="100" step="5" value="${p.progression ?? 0}" aria-label="Progression">
        <span class="fiche-pc">${p.progression ?? 0} %</span>
      </div>` : ''}
    <dl class="fiche">${rangs.join('')}</dl>
    <textarea class="fiche-description fiche-champ" data-champ="description" rows="2" placeholder="Description (pour Kairos)">${echapper(p.description || '')}</textarea>
    <p class="feuille-erreur" id="ficheErreur" hidden></p>
    <div class="fiche-rang fiche-active"><span>Active</span>
      <button type="button" class="interrupteur${actif ? ' oui' : ''}" role="switch" aria-checked="${actif}" data-bascule="active" aria-label="Active"></button>
    </div>
    <div class="feuille-choix">
      <button class="choix choix-supprimer" type="button" data-rep="supprimer">Supprimer</button>
      <button class="choix choix-oui" type="button" data-rep="fermer">Fermer</button>
    </div>`, (racine) => {
    const erreur = (t) => { const e = $('#ficheErreur', racine); e.textContent = t; e.hidden = !t; };
    const sauver = () => donnees.enregistrerPraxis(p);

    // Champs texte, nombres, heure, description, nom
    racine.addEventListener('change', (e) => {
      const c = e.target.dataset.champ;
      if (!c) return;
      let v = e.target.value.trim();
      if (c === 'libelle') { if (!v) { e.target.value = p.libelle; return; } v = v.charAt(0).toUpperCase() + v.slice(1); }
      if (c === 'duree' || c === 'frequence') { v = Math.max(1, Math.round(Number(v) || 0)) || undefined; }
      if (c === 'heure') v = depuisChamp(v);
      if (v === '' || v === undefined) delete p[c]; else p[c] = v;
      sauver();
    });

    const curseur = $('input[type=range]', racine);
    if (curseur) {
      curseur.addEventListener('input', () => {
        p.progression = Number(curseur.value);
        $('.fiche-pc', racine).textContent = `${p.progression} %`;
      });
      curseur.addEventListener('change', () => {   // une avancée est notée au journal (« dernière avancée », §10)
        sauver();
        donnees.noter('progression', p.id, { valeur: p.progression });
      });
    }

    racine.addEventListener('click', (e) => {
      const seg = e.target.closest('.segment button');
      if (seg) {
        const c = seg.parentElement.dataset.champ;
        if (c === 'type') {   // changer de type redessine la fiche (champs différents)
          const nouveau = TYPES.find(([, n]) => n === seg.dataset.val)[0];
          if (actif) p.section = nouveau; else p.sectionAvant = nouveau;
          if (nouveau === 'taches' && !p.frequence) p.frequence = 7;
          if (nouveau === 'long' && p.progression === undefined) p.progression = 0;
          if (nouveau === 'routines' && !p.jours) p.jours = [1, 2, 3, 4, 5, 6, 7];
          sauver().then(() => ouvrirFiche(p, quandFermee));
          return;
        }
        p[c] = seg.dataset.val;
        seg.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('choisi', x === seg));
        sauver();
        return;
      }
      const jour = e.target.closest('[data-jour]');
      if (jour) {
        const n = Number(jour.dataset.jour);
        const jours = new Set(p.jours || []);
        if (jours.has(n)) jours.delete(n); else jours.add(n);
        if (!jours.size) { erreur('Au moins un jour.'); return; }
        erreur('');
        p.jours = [...jours].sort((x, y) => x - y);
        jour.classList.toggle('choisi', jours.has(n));
        sauver();
        return;
      }
      const nu = e.target.closest('[data-couleur]');
      if (nu) {
        p.couleur = nu.dataset.couleur;
        racine.querySelectorAll('.nuance').forEach((x) => x.classList.toggle('choisie', x === nu));
        $('.fiche-nom', racine).style.background = p.couleur;
        sauver();
        return;
      }
      const bascule = e.target.closest('[data-bascule]');
      if (bascule) {
        const oui = !bascule.classList.contains('oui');
        if (bascule.dataset.bascule === 'pilier') {
          const autres = donnees.cache.praxis.filter((x) => x.section === 'piliers' && x.id !== p.id).length;
          if (oui && autres >= MAX_PILIERS) { erreur(`${MAX_PILIERS} piliers au maximum : retire d'abord un autre pilier.`); return; }
          p.section = oui ? 'piliers' : 'routines';
          if (oui) p.importance = 'essentielle';
        } else {   // active
          if (!oui && p.section !== 'inactives') p.sectionAvant = p.section;   // pour pouvoir la réactiver
          p.section = oui ? (p.sectionAvant || 'routines') : 'inactives';
        }
        erreur('');
        sauver().then(() => ouvrirFiche(p, quandFermee));
        return;
      }
      const b = e.target.closest('[data-rep]');
      if (!b) return;
      if (b.dataset.rep === 'supprimer') { confirmerSuppression(p); return; }
      fermerFeuille();
      rendre();
    });
  }, quandFermee);
}

function confirmerSuppression(p) {
  fermerFeuille();
  setTimeout(() => ouvrirFeuille(`
    <p class="feuille-question">Supprimer ${echapper(p.libelle)} ?</p>
    <p class="feuille-sous">Elle disparaît de la bibliothèque. Son historique reste dans le journal. Pour la mettre de côté sans la perdre, désactive-la plutôt.</p>
    <div class="feuille-choix">
      <button class="choix" type="button" data-rep="non">Annuler</button>
      <button class="choix choix-supprimer" type="button" data-rep="oui">Supprimer</button>
    </div>`, (r) => r.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    if (b.dataset.rep === 'oui') {
      await donnees.supprimerPraxis(p.id);
      annuler.enregistrer(`${p.libelle} : supprimée`, () => donnees.enregistrerPraxis(p));
    }
    fermerFeuille();
    rendre();
  })), 250);
}

// ── Questionnaire « dernière fois ? » (§11.4) ─
// La v1 n'enregistrait pas les tâches : une question par tâche, réponse en un tap, interruptible.
function questionnaire() {
  const file = donnees.tachesSansHistorique();
  const total = file.length;
  let i = 0;
  const suivante = () => {
    if (i >= file.length) {
      fermerFeuille();
      rendre();
      return;
    }
    const p = file[i];
    ouvrirFeuille(`
      <p class="feuille-sous">${i + 1} / ${total}</p>
      <div class="fiche-tete" style="margin-top:6px"><span class="bulle" style="background:${p.couleur}">${echapper(p.libelle)}</span></div>
      <p class="feuille-question">La dernière fois ?</p>
      <div class="menu-tache">
        <button class="choix" type="button" data-rep="semaine">Cette semaine</button>
        <button class="choix" type="button" data-rep="mois">Ce mois-ci</button>
        <button class="choix" type="button" data-rep="longtemps">Plus longtemps</button>
        <button class="choix" type="button" data-rep="inconnu">Je ne sais pas</button>
      </div>
      <button class="choix choix-annuler" type="button" data-rep="stop">Arrêter là</button>`, (r) => r.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rep]');
      if (!b) return;
      if (b.dataset.rep === 'stop') { fermerFeuille(); rendre(); return; }
      await donnees.repondreDerniereFois(p.id, b.dataset.rep);
      i++;
      suivante();
    }));
  };
  suivante();
}

// ── Bouton + : nouvelle praxis (validé le 19/11/2026 : la fiche vierge) ─
// Lot 0 : nom, type et couleur ; les autres attributs se règlent ensuite dans la fiche ou avec le coach.
function nouvellePraxis() {
  let type = 'routines';
  let couleur = COULEURS[0];
  ouvrirFeuille(`
    <p class="feuille-question">Nouvelle praxis</p>
    <label class="reg-date" style="margin-top:14px">Nom <input type="text" id="nouveauNom" maxlength="40" autocomplete="off" placeholder="Poussière"></label>
    <div class="fiche-rang" style="margin-top:12px"><span class="reg-lib">Type</span>
      <span class="segment" data-champ="type"><button type="button" class="choisi" data-val="routines">Routine</button><button type="button" data-val="taches">Tâche</button><button type="button" data-val="long">Long cours</button><button type="button" data-val="ponctuelle">Une fois</button></span>
    </div>
    <div class="nouveau-ponctuelle" hidden>
      <p class="reg-aide">Une chose à faire une seule fois : elle va dans la ligne JOUR, pas dans la bibliothèque, et disparaît une fois faite.</p>
      <label class="reg-date">Le <input type="date" id="nouvelleDate" value="${donnees.aujourdhui()}"></label>
      <label class="reg-date">Ou avant le <input type="date" id="nouvelleEcheance"></label>
      <label class="reg-date">Durée <input type="number" id="nouvelleDuree" inputmode="numeric" min="1" value="20" style="max-width:80px"> min</label>
    </div>
    <div class="fiche-rang"><span class="reg-lib">Couleur</span>
      <span class="nuancier">${COULEURS.map((c, i) => `<button type="button" class="nuance${i ? '' : ' choisie'}" data-couleur="${c}" style="background:${c}" aria-label="Couleur ${i + 1}"></button>`).join('')}</span>
    </div>
    <p class="feuille-erreur" id="nouveauErreur" hidden>Donne-lui un nom.</p>
    <div class="feuille-choix">
      <button class="choix" type="button" data-rep="non">Annuler</button>
      <button class="choix choix-oui" type="button" data-rep="oui">Créer</button>
    </div>`, (r) => {
    $('#nouveauNom', r).addEventListener('input', () => { $('#nouveauErreur', r).hidden = true; });
    r.addEventListener('click', async (e) => {
      const seg = e.target.closest('.segment button');
      if (seg) {
        type = seg.dataset.val;
        seg.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('choisi', x === seg));
        $('.nouveau-ponctuelle', r).hidden = type !== 'ponctuelle';
        return;
      }
      const nu = e.target.closest('[data-couleur]');
      if (nu) { couleur = nu.dataset.couleur; r.querySelectorAll('.nuance').forEach((x) => x.classList.toggle('choisie', x === nu)); return; }
      const b = e.target.closest('[data-rep]');
      if (!b) return;
      if (b.dataset.rep === 'oui') {
        const nom = $('#nouveauNom', r).value.trim();
        if (!nom) { $('#nouveauErreur', r).hidden = false; return; }
        if (type === 'ponctuelle') {
          const echeance = $('#nouvelleEcheance', r).value;
          await donnees.ajouterPonctuelle({
            libelle: nom.charAt(0).toUpperCase() + nom.slice(1), couleur,
            date: echeance ? '' : ($('#nouvelleDate', r).value || donnees.aujourdhui()),
            ...(echeance ? { echeance } : {}),
            duree: Math.max(1, Number($('#nouvelleDuree', r).value) || 20),
          });
          fermerFeuille();
          rendre();
          return;
        }
        const p = {
          id: `p_${Date.now()}`, libelle: nom.charAt(0).toUpperCase() + nom.slice(1), couleur, section: type,
          ...(type === 'routines' ? { jours: [1, 2, 3, 4, 5, 6, 7], duree: 15 } : {}),
          ...(type === 'taches' ? { frequence: 7, duree: 20 } : {}),
          ...(type === 'long' ? { progression: 0 } : {}),
          importance: 'utile',
        };
        await donnees.enregistrerPraxis(p);
        etat.ouvertes.add(type);
      }
      fermerFeuille();
      rendre();
    });
  });
}

// ── Initialisation ─────────────────────────────
export function initPraxis({ ajouterAuProgramme, dejaPrevue }) {
  etat.ajouterAuProgramme = ajouterAuProgramme;
  etat.dejaPrevue = dejaPrevue;
  $('#btnPlus').addEventListener('click', nouvellePraxis);

  $('#praxisRecherche').addEventListener('input', (e) => {
    etat.recherche = e.target.value.trim();
    rendre();
  });
  $('#praxisListe').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="questionnaire"]')) { questionnaire(); return; }
    const retard = e.target.closest('[data-retard]');
    if (retard) {
      inviterRetard(etat.praxis.find((p) => p.id === retard.dataset.retard));
      return;
    }
    const uneFois = e.target.closest('[data-ponctuelle]');
    if (uneFois) {
      const q = donnees.cache.ponctuelles.find((x) => x.id === uneFois.dataset.ponctuelle);
      if (q) ouvrirPonctuelle(q);
      return;
    }
    const ligne = e.target.closest('.praxis-ligne');
    if (ligne) {
      ouvrirFiche(etat.praxis.find((p) => p.id === ligne.dataset.id));
      return;
    }
    const tete = e.target.closest('.ligne-tete');
    if (tete && !etat.recherche) {
      const cle = tete.parentElement.dataset.section;
      // une seule ligne ouverte à la fois, comme dans les Réglages (21/11/2026)
      if (etat.ouvertes.has(cle)) etat.ouvertes.delete(cle); else { etat.ouvertes.clear(); etat.ouvertes.add(cle); }
      rendre();
    }
  });
  rendre();
}
