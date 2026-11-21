// PRAXEO v2 — onglet Réglages (18/11/2026 ; branché sur les données au lot 0).
// Principe : un onglet court. La plupart des choses se disent au coach ; ici, on vérifie et on corrige.

import * as donnees from './donnees.js';
import * as contenu from './contenu.js';
import { ouvrirFeuille, fermerFeuille } from './feuille.js';
import { lancerMinuteur, NOM_RACCOURCI } from './minuteur.js';
import * as annuler from './annuler.js';
import { coutDuMois, THEMES } from './coach.js';

const $ = (sel, racine = document) => racine.querySelector(sel);
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SVG_CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6l-6 6"/></svg>';
const SVG_CROIX = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const ouvertes = new Set();
const themesOuverts = new Set();
let carnetOuvert = false;
let semaineVue = 0;
// Version installée (nom du cache du service worker) : pour savoir si une mise à jour est bien arrivée sur l'iPhone
let versionAppli = '';
try { caches.keys().then((k) => { versionAppli = (k.find((n) => n.startsWith('praxeo-v2-')) || '').replace('praxeo-v2-', ''); }); } catch { /* pas de cache */ }   // Ma semaine : 0 = cette semaine, 1 = la prochaine (glissement du doigt)
let apresImport = () => {};

// ── Petits éléments ────────────────────────────
const interrupteur = (cle, on) =>
  `<button type="button" class="interrupteur${on ? ' oui' : ''}" role="switch" aria-checked="${on}" data-bascule="${cle}"></button>`;
const segment = (cle, options, valeur) =>
  `<span class="segment" data-champ="${cle}">${options.map((o) => `<button type="button" class="${o === valeur ? 'choisi' : ''}" data-val="${o}">${o}</button>`).join('')}</span>`;
const rang = (libelle, controle, note) =>
  `<div class="reg-rang"><span class="reg-lib">${libelle}${note ? `<span class="reg-note">${note}</span>` : ''}</span><span class="reg-ctrl">${controle}</span></div>`;
const dateLisible = (iso) => { const [a, m, j] = iso.split('-'); return `${Number(j)}/${Number(m)}/${a}`; };
// « sam. 13 février » (vacances scolaires)
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateLongue = (iso) => { const [a, m, j] = iso.split('-').map(Number); const x = new Date(a, m - 1, j); return `${JOURS_COURTS[x.getDay()]} ${j} ${MOIS_LONGS[m - 1]}`; };

// ── Sections ───────────────────────────────────
const NOMS_JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const versChamp = (h) => { if (!h || !h.includes('h') || h === '24h00') return ''; const [hh, mm] = h.split('h'); return `${hh.padStart(2, '0')}:${(mm || '00').padStart(2, '0')}`; };
const depuisChamp = (v, defaut) => { if (!v) return defaut; const [hh, mm] = v.split(':'); return `${Number(hh)}h${mm}`; };

function sectionMoi() {
  const pl = donnees.planning();
  const cette = donnees.semaineDe();
  const prochaine = cette === 'A' ? 'B' : 'A';
  const jours = (cle) => pl.semaines[cle].map((j, i) => `
    <li><button type="button" class="sem-ligne" data-jour="${cle}:${i}">
      <span class="sem-jour">${NOMS_JOURS[i]}</span>
      <span class="sem-texte">${echapper(contenu.decrireJour(j))}<span class="sem-heures">${echapper(contenu.heureCourte(j.lever))} → ${echapper(contenu.heureCourte(j.coucher))}${j.depart ? ` · départ ${echapper(contenu.heureCourte(j.departEcole || j.depart))}${j.departEcole ? ' (école)' : ''}` : ''}</span></span>
    </button></li>`).join('');
  const cle = semaineVue === 0 ? cette : prochaine;
  const fin = donnees.cache.meta.pauseJusquau;
  const pause = fin && fin >= donnees.aujourdhui()
    ? rang('Pause', `<button type="button" class="reg-bouton" data-action="reprendre">Reprendre</button>`, `en pause jusqu'au ${echapper(dateLisible(fin))}`)
    : rang('Pause', `<button type="button" class="reg-bouton" data-action="pause">Mettre en pause</button>`, 'vacances, maladie : la série est préservée');
  const vac = donnees.vacances().map((v, i) => `
    <li><button type="button" class="vac-ligne" data-vacances="${i}">${echapper(v.nom)} : du ${dateLongue(v.debut)} au ${dateLongue(v.fin)}</button></li>`).join('');
  const mm = donnees.cache.meta.modeMinimum;
  const enMinimum = mm && mm.debut <= donnees.aujourdhui() && donnees.aujourdhui() <= mm.fin;
  // Le mode minimum se demande à Kairos ; ici, seulement pour l'arrêter quand il est en cours (20/11/2026)
  const minimum = enMinimum
    ? rang('Mode minimum', `<button type="button" class="reg-bouton" data-action="finMinimum">Arrêter</button>`, `jusqu'au ${echapper(dateLisible(mm.fin))} : seulement les piliers, série gelée`)
    : '';
  return `
    ${minimum}
    <p class="reg-sous-titre">Ma semaine</p>
    <!-- une semaine à la fois ; glisser vers la gauche : la suivante, vers la droite : retour (20/11/2026) -->
    <div class="semaines" data-semaines>
      <div class="semaine"><p class="sem-titre">${semaineVue === 0 ? 'Cette semaine' : 'La semaine prochaine'}</p><ul>${jours(cle)}</ul></div>
    </div>
    <div class="sem-points" role="tablist" aria-label="Semaines">
      <button type="button" class="sem-point${semaineVue === 0 ? ' actif' : ''}" data-semaine="0" aria-label="Cette semaine"></button>
      <button type="button" class="sem-point${semaineVue === 1 ? ' actif' : ''}" data-semaine="1" aria-label="La semaine prochaine"></button>
    </div>
    <p class="reg-aide">Touche un jour pour le corriger.</p>
    <p class="reg-sous-titre" style="margin-top:14px">Vacances scolaires</p>
    <ul class="vacances">${vac}</ul>
    <button type="button" class="reg-lien" data-action="ajouterVacances">Ajouter des vacances</button>
    ${pause}`;
}

// Modifier un jour du planning (§4.1)
function modifierJour(cle, i) {
  const pl = structuredClone(donnees.planning());
  const j = pl.semaines[cle][i];
  const plages = contenu.plagesFamille(j);
  const avecFille = plages.length > 0;
  ouvrirFeuille(`
    <p class="feuille-question">${NOMS_JOURS[i]} · ${cle === donnees.semaineDe() ? 'cette semaine' : 'la semaine prochaine'}</p>
    <p class="feuille-sous">Ce réglage vaut pour ce jour une semaine sur deux (garde alternée).</p>
    <div class="fiche-rang"><span class="reg-lib">Travail</span>${segment('travail', ['Journée', 'Matin', 'Repos'], { journee: 'Journée', matin: 'Matin', aucun: 'Repos' }[j.travail])}</div>
    <div class="fiche-rang"><span class="reg-lib">Avec ta fille</span><button type="button" class="interrupteur${avecFille ? ' oui' : ''}" role="switch" aria-checked="${avecFille}" data-fille aria-label="Avec ta fille"></button></div>
    <div class="fiche-rang jour-fille"${avecFille ? '' : ' hidden'}><span class="reg-lib">Plage 1<span class="reg-note">vide = depuis minuit / jusqu'à minuit</span></span>
      <span class="reg-heures"><input type="time" id="filleDe1" value="${versChamp(plages[0]?.[0])}"> <input type="time" id="filleA1" value="${versChamp(plages[0]?.[1])}"></span></div>
    <div class="fiche-rang jour-fille"${avecFille ? '' : ' hidden'}><span class="reg-lib">Plage 2<span class="reg-note">facultative (ex. le matin, puis le soir)</span></span>
      <span class="reg-heures"><input type="time" id="filleDe2" value="${versChamp(plages[1]?.[0])}"> <input type="time" id="filleA2" value="${versChamp(plages[1]?.[1])}"></span></div>
    <div class="fiche-rang"><span class="reg-lib">Lever</span><input type="time" id="lever" value="${versChamp(j.lever)}"></div>
    <div class="fiche-rang"><span class="reg-lib">Coucher</span><input type="time" id="coucher" value="${versChamp(j.coucher)}"></div>
    <div class="fiche-rang"><span class="reg-lib">Départ le matin<span class="reg-note">jours travaillés</span></span><input type="time" id="depart" value="${versChamp(j.depart)}"></div>
    <div class="fiche-rang"><span class="reg-lib">Départ les jours d'école<span class="reg-note">si tu amènes ta fille ; pas pendant les vacances</span></span><input type="time" id="departEcole" value="${versChamp(j.departEcole)}"></div>
    <div class="fiche-rang"><span class="reg-lib">Précision</span><input class="fiche-champ" type="text" id="noteJour" value="${echapper(j.note || '')}" placeholder="ta fille arrive à 19h" autocomplete="off"></div>
    <div class="feuille-choix">
      <button class="choix" type="button" data-rep="non">Annuler</button>
      <button class="choix choix-oui" type="button" data-rep="oui">Enregistrer</button>
    </div>`, (r) => {
    let travail = j.travail;
    let fille = avecFille;
    r.addEventListener('click', async (e) => {
      const seg = e.target.closest('.segment button');
      if (seg) {
        travail = { 'Journée': 'journee', 'Matin': 'matin', 'Repos': 'aucun' }[seg.dataset.val];
        seg.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('choisi', x === seg));
        return;
      }
      const f = e.target.closest('[data-fille]');
      if (f) {
        fille = !fille;
        f.classList.toggle('oui', fille);
        f.setAttribute('aria-checked', String(fille));
        r.querySelectorAll('.jour-fille').forEach((x) => { x.hidden = !fille; });
        return;
      }
      const b = e.target.closest('[data-rep]');
      if (!b) return;
      if (b.dataset.rep === 'oui') {
        pl.semaines[cle][i] = {
          travail,
          famille: fille ? [
            [depuisChamp($('#filleDe1', r).value, '0h00'), depuisChamp($('#filleA1', r).value, '24h00')],
            ...(($('#filleDe2', r).value || $('#filleA2', r).value) ? [[depuisChamp($('#filleDe2', r).value, '0h00'), depuisChamp($('#filleA2', r).value, '24h00')]] : []),
          ] : null,
          lever: depuisChamp($('#lever', r).value, j.lever),
          coucher: depuisChamp($('#coucher', r).value, j.coucher),
          note: $('#noteJour', r).value.trim(),
          ...($('#depart', r).value ? { depart: depuisChamp($('#depart', r).value) } : {}),
          ...($('#departEcole', r).value ? { departEcole: depuisChamp($('#departEcole', r).value) } : {}),
        };
        await donnees.enregistrerPlanning(pl);
        rendre();
      }
      fermerFeuille();
    });
  });
}

// Ajouter, corriger ou supprimer une période de vacances scolaires
function modifierVacances(i) {
  const liste = structuredClone(donnees.vacances());
  const v = i === null ? { nom: '', debut: donnees.aujourdhui(), fin: donnees.aujourdhui() } : liste[i];
  ouvrirFeuille(`
    <p class="feuille-question">${i === null ? 'Ajouter des vacances' : 'Vacances scolaires'}</p>
    <label class="reg-date">Nom <input type="text" id="vacNom" value="${echapper(v.nom)}" placeholder="Pâques" autocomplete="off"></label>
    <label class="reg-date">Du <input type="date" id="vacDebut" value="${v.debut}"></label>
    <label class="reg-date">Au <input type="date" id="vacFin" value="${v.fin}"></label>
    <p class="feuille-erreur" id="vacErreur" hidden></p>
    <div class="feuille-choix">
      ${i === null ? '<button class="choix" type="button" data-rep="non">Annuler</button>' : '<button class="choix choix-supprimer" type="button" data-rep="supprimer">Supprimer</button>'}
      <button class="choix choix-oui" type="button" data-rep="oui">Enregistrer</button>
    </div>`, (r) => r.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    if (b.dataset.rep === 'oui') {
      const nv = { nom: $('#vacNom', r).value.trim() || 'Vacances', debut: $('#vacDebut', r).value, fin: $('#vacFin', r).value };
      if (!nv.debut || !nv.fin || nv.fin < nv.debut) { const er = $('#vacErreur', r); er.textContent = 'La fin doit suivre le début.'; er.hidden = false; return; }
      if (i === null) liste.push(nv); else liste[i] = nv;   // corrigée : n'est plus « à confirmer »
      liste.sort((x, y) => x.debut.localeCompare(y.debut));
      await donnees.enregistrerVacances(liste);
    }
    if (b.dataset.rep === 'supprimer') { liste.splice(i, 1); await donnees.enregistrerVacances(liste); }
    fermerFeuille();
    rendre();
  }));
}

function sectionCoach() {
  const memoire = donnees.cache.memoire;
  const themes = memoire.length
    ? [...new Set([...THEMES, ...memoire.map((m) => m.theme)])].map((theme) => {
      const faits = memoire.filter((m) => m.theme === theme);
      if (!faits.length) return '';
      const ouvert = themesOuverts.has(theme);
      return `
      <div class="memo${ouvert ? ' ouverte' : ''}">
        <button type="button" class="memo-tete" data-theme="${echapper(theme)}" aria-expanded="${ouvert}">
          <span>${echapper(theme)}</span><span class="ligne-val">${faits.length} ${SVG_CHEVRON}</span>
        </button>
        <ul class="memo-faits">${faits.map((f) => `
          <li><button type="button" class="memo-fait" data-fait="${echapper(f.id)}">${echapper(f.texte)}<span class="memo-date">${f.date ? echapper(dateLisible(f.date)) : ''}</span></button><button type="button" class="memo-oubli" data-oubli="${echapper(f.id)}" aria-label="Oublier ce fait">${SVG_CROIX}</button></li>`).join('')}
        </ul>
      </div>`;
    }).join('')
    : '<p class="reg-texte">Kairos n\'a encore rien retenu. Il apprendra en parlant avec toi.</p>';
  const carnet = carnetOuvert
    ? `<ul class="carnet">${contenu.maximes.map(([m, a]) => `<li>${echapper(m)} <span class="carnet-auteur">— ${echapper(a)}</span></li>`).join('')}</ul>`
    : '';
  return `
    <p class="reg-sous-titre">Ce que Kairos sait de moi</p>
    <div class="memoire">${themes}</div>
    <p class="reg-aide">Touche une phrase pour la corriger. Kairos regroupe et oublie de lui-même ce qui n'est plus vrai.</p>
    ${rang('Maximes de Kairos', interrupteur('maximes', donnees.reglage('maximes')), `<button type="button" class="reg-lien" data-action="carnet">${carnetOuvert ? 'Masquer le carnet' : 'Voir le carnet'}</button>`)}
    ${carnet}
    ${rang('Minuteur', `<span class="reg-boutons"><button type="button" class="reg-bouton" data-action="installerMinuteur">Installer</button><button type="button" class="reg-bouton" data-action="testerMinuteur">Tester</button></span>`, 'raccourci iOS « Praxeo Minuteur »')}
    ${rang('Bruit de frappe', interrupteur('bruitFrappe', donnees.reglage('bruitFrappe')))}
    ${rang('Dictée : envoi automatique', interrupteur('envoiAuto', donnees.reglage('envoiAuto')), 'après un silence')}
    ${donnees.reglage('envoiAuto') ? rang('Délai de silence', segment('delai', ['0,5 s', '1 s', '1,5 s'], ['0,5 s', '1 s', '1,5 s'].includes(donnees.reglage('delai')) ? donnees.reglage('delai') : '1 s'), 'avant l\'envoi, le temps de corriger') : ''}`;
}

function sectionAffichage() {
  return rang('Taille du texte', segment('taille', ['Petit', 'Normal', 'Grand'], donnees.reglage('taille')));
}

function sectionIA() {
  const v = donnees.cleApi();
  const cle = v
    ? rang('Clé API', `<button type="button" class="reg-bouton danger" data-action="supprimerCle">Supprimer</button>`, echapper(`${v.slice(0, 7)}•••••••••••${v.slice(-4)}`))
    : `<div class="reg-rang reg-cle">
         <span class="reg-lib">Clé API<span class="reg-note">gardée seulement sur cet appareil, jamais exportée</span></span>
         <span class="reg-saisie"><input type="password" id="saisieCle" placeholder="sk-ant-…" autocomplete="off" aria-label="Clé API"><button type="button" class="reg-bouton" data-action="enregistrerCle">Enregistrer</button></span>
       </div>`;
  const modele = donnees.reglage('modele');
  return `
    ${rang('Modèle', segment('modele', ['Haiku', 'Opus'], modele), modele === 'Haiku' ? 'rapide et économique' : 'plus fin, plus coûteux')}
    ${cle}
    ${rang('Coût du mois', `<span class="reg-valeur">${echapper(montant(coutDuMois().usd))}</span>`)}
    ${rang('Mode comparaison', interrupteur('comparaison', donnees.reglage('comparaison')), 'chaque réponse aux deux modèles : coûte surtout le prix d\'Opus')}`;
}

// Une seule unité à la fois, avec son symbole : en cents sous 1 $ (« 0,34 ¢ », « 12 ¢ »), en dollars au-delà (« 1,40 $ »)
function montant(usd) {
  if (!usd) return '0 ¢';
  if (usd >= 1) return `${usd.toFixed(2).replace('.', ',')} $`;
  const cent = usd * 100;
  const txt = cent < 1 ? cent.toFixed(2) : cent < 10 ? cent.toFixed(1) : String(Math.round(cent));
  return `${txt.replace('.', ',').replace(/,0$/, '')} ¢`;
}

// Corriger un fait (§5.7) : la phrase et son thème ; la date passe à aujourd'hui
function modifierFait(id) {
  const f = donnees.cache.memoire.find((m) => m.id === id);
  if (!f) return;
  ouvrirFeuille(`
    <p class="feuille-question">Ce que Kairos sait</p>
    <textarea class="fait-saisie" rows="3" aria-label="Le fait">${echapper(f.texte)}</textarea>
    <div class="fait-themes">${segment('themeFait', THEMES, f.theme)}</div>
    <div class="feuille-choix">
      <button class="choix" type="button" data-rep="non">Annuler</button>
      <button class="choix choix-oui" type="button" data-rep="oui">Enregistrer</button>
    </div>`, (r) => r.addEventListener('click', async (e) => {
    const s = e.target.closest('.segment button');
    if (s) { r.querySelectorAll('.fait-themes button').forEach((b) => b.classList.toggle('choisi', b === s)); return; }
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    if (b.dataset.rep === 'oui') {
      const texte = $('.fait-saisie', r).value.trim();
      const theme = $('.fait-themes .choisi', r)?.dataset.val || f.theme;
      if (texte) {
        const avant = { ...f };
        await donnees.modifierFait(id, { texte, theme });
        annuler.enregistrer('Fait corrigé', () => donnees.restaurerFait(avant));
      }
    }
    fermerFeuille();
    rendre();
  }));
}

function sectionDonnees() {
  return `
    ${rang('Exporter', `<button type="button" class="reg-bouton" data-action="exporter">Exporter</button>`, 'une sauvegarde complète, sans la clé API')}
    ${rang('Importer', `<button type="button" class="reg-bouton" data-action="importer">Importer</button>`, 'remplace les données de cet appareil')}
    ${rang('Réinitialiser', `<button type="button" class="reg-bouton danger" data-action="reinitialiser">Tout effacer</button>`, 'repartir de zéro')}
    ${versionAppli ? `<p class="reg-aide">Version ${echapper(versionAppli)}</p>` : ''}
    <input type="file" id="fichierImport" accept="application/json,.json" hidden>`;
}

const SECTIONS = [
  ['moi', 'Moi', sectionMoi],
  ['coach', 'Kairos', sectionCoach],
  ['affichage', 'Affichage', sectionAffichage],
  ['ia', 'IA et coûts', sectionIA],
  ['donnees', 'Données', sectionDonnees],
];

export function rendre() {
  $('#reglagesContenu').innerHTML = `<div class="lignes-reglages">${SECTIONS.map(([cle, nom, f]) => {
    const ouverte = ouvertes.has(cle);
    return `
      <div class="ligne${ouverte ? ' ouverte' : ''}" data-section="${cle}">
        <button class="ligne-tete" type="button" aria-expanded="${ouverte}">
          <span class="ligne-nom">${nom}</span>
          <span class="ligne-val">${SVG_CHEVRON}</span>
        </button>
        <div class="ligne-corps reg-corps">${ouverte ? f() : ''}</div>
      </div>`;
  }).join('')}</div>`;
}

// ── Taille du texte : appliquée tout de suite à toute l'interface (§6.4) ──
function appliquerTaille() {
  const facteur = { Petit: 0.92, Normal: 1, Grand: 1.12 }[donnees.reglage('taille')] || 1;
  document.documentElement.style.setProperty('--zoom', facteur);
}

// ── Feuilles ───────────────────────────────────
function message(texte, sous = '', ensuite = null) {
  ouvrirFeuille(`<p class="feuille-question">${texte}</p>${sous ? `<p class="feuille-sous">${sous}</p>` : ''}
    <div class="feuille-choix"><button class="choix choix-oui" type="button" data-rep="ok">Compris</button></div>`,
  (r) => r.addEventListener('click', (e) => { if (e.target.closest('[data-rep]')) { fermerFeuille(); if (ensuite) setTimeout(ensuite, 250); } }));
}

function demanderPause() {
  const dans7 = new Date(); dans7.setDate(dans7.getDate() + 7);
  ouvrirFeuille(`
    <p class="feuille-question">Mettre Praxeo en pause</p>
    <p class="feuille-sous">Kairos se tait, les routines ne comptent pas, la série est préservée.</p>
    <label class="reg-date">Jusqu'au <input type="date" id="dateFinPause" value="${donnees.cleDate(dans7)}" min="${donnees.aujourdhui()}"></label>
    <div class="feuille-choix">
      <button class="choix" type="button" data-rep="non">Annuler</button>
      <button class="choix choix-oui" type="button" data-rep="oui">Mettre en pause</button>
    </div>`, (r) => r.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    if (b.dataset.rep === 'oui') {
      const v = $('#dateFinPause', r).value;
      if (v) await donnees.ecrireMeta('pauseJusquau', v);
      rendre();
    }
    fermerFeuille();
  }));
}

function confirmerSuppressionCle() {
  ouvrirFeuille(`
    <p class="feuille-question">Supprimer la clé API ?</p>
    <p class="feuille-sous">Kairos ne pourra plus répondre tant qu'une nouvelle clé n'est pas inscrite. Le reste de l'application fonctionne.</p>
    <div class="feuille-choix">
      <button class="choix" type="button" data-rep="non">Annuler</button>
      <button class="choix choix-supprimer" type="button" data-rep="oui">Supprimer</button>
    </div>`, (r) => r.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    if (b.dataset.rep === 'oui') { donnees.supprimerCleApi(); rendre(); }
    fermerFeuille();
  }));
}

// Export : un fichier JSON téléchargé (sur l'iPhone, la feuille de partage propose de l'enregistrer)
async function exporter() {
  const contenuExport = await donnees.exporter();
  const blob = new Blob([JSON.stringify(contenuExport, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `praxeo-v2_${donnees.aujourdhui()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importerFichier(fichier) {
  try {
    const texte = await fichier.text();
    const r = await donnees.importer(JSON.parse(texte));
    const detail = r.format === 'v1'
      ? `${r.praxis} praxis, ${r.jours} jours d'historique, ${r.evenements} réalisations.`
      : 'Tes données sont restaurées.';
    message('Import terminé', detail, apresImport);
  } catch (err) {
    message('Import impossible', echapper(err.message || 'Le fichier n\'est pas lisible.'));
  }
}

// Réinitialisation : avertissement, puis confirmation en deux temps
function confirmerReinitialisation() {
  let arme = false;
  ouvrirFeuille(`
    <p class="feuille-question attention">Tout effacer ?</p>
    <p class="feuille-sous">Praxis, journal, statistiques, série, mémoire de Kairos, réglages et clé API seront supprimés de cet appareil. <strong>C'est définitif.</strong></p>
    <p class="feuille-sous">Exporte d'abord une sauvegarde si tu veux pouvoir revenir en arrière.</p>
    <div class="feuille-choix">
      <button class="choix" type="button" data-rep="exporter">Exporter d'abord</button>
      <button class="choix choix-supprimer" type="button" data-rep="effacer">Tout effacer</button>
    </div>
    <button class="choix choix-annuler" type="button" data-rep="non">Annuler</button>`, (r) => r.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    if (b.dataset.rep === 'effacer' && !arme) {
      arme = true;
      b.textContent = 'Confirmer';
      b.classList.add('arme');
      setTimeout(() => { if (b.isConnected) { arme = false; b.textContent = 'Tout effacer'; b.classList.remove('arme'); } }, 5000);
      return;
    }
    if (b.dataset.rep === 'exporter') { exporter(); return; }   // la feuille reste ouverte : on peut effacer ensuite
    fermerFeuille();
    if (b.dataset.rep === 'effacer') {
      await donnees.reinitialiser();
      setTimeout(() => message('Tout est effacé', 'Praxeo repart de zéro.', apresImport), 250);
    }
  }));
}

// ── Minuteur : pas-à-pas d'installation du raccourci (§5.5) ──
function guideMinuteur() {
  ouvrirFeuille(`
    <p class="feuille-question">Installer le minuteur</p>
    <p class="feuille-sous">Une seule fois. Praxeo ne peut pas sonner quand elle n'est pas à l'écran : ce raccourci lui permet de lancer le minuteur de l'Horloge.</p>
    <ol class="guide">
      <li>Ouvre l'app <strong>Raccourcis</strong>, onglet <em>Raccourcis</em>, et touche <strong>+</strong>.</li>
      <li>Touche le nom en haut et appelle-le exactement <strong>${NOM_RACCOURCI}</strong>.</li>
      <li>Ajoute l'action <strong>Démarrer le minuteur</strong> (cherche « minuteur »).</li>
      <li>Touche la durée, choisis <strong>Entrée du raccourci</strong>, puis l'unité <strong>minutes</strong>.</li>
      <li>Touche <strong>OK</strong>, reviens dans Praxeo et touche <strong>Tester</strong> : un minuteur d'une minute doit démarrer.</li>
    </ol>
    <div class="feuille-choix"><button class="choix choix-oui" type="button" data-rep="ok">Compris</button></div>`,
  (r) => r.addEventListener('click', (e) => { if (e.target.closest('[data-rep]')) fermerFeuille(); }));
}

// ── Initialisation ─────────────────────────────
export function initReglages(options = {}) {
  apresImport = options.apresImport || (() => {});
  const racine = $('#reglagesContenu');
  racine.addEventListener('change', (e) => {
    if (e.target.id === 'fichierImport' && e.target.files[0]) importerFichier(e.target.files[0]);
  });
  // Ma semaine : glisser vers la gauche montre la semaine prochaine, vers la droite revient à celle-ci
  let depart = null;
  racine.addEventListener('touchstart', (e) => {
    depart = e.target.closest('[data-semaines]') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  racine.addEventListener('touchend', (e) => {
    if (!depart) return;
    const dx = e.changedTouches[0].clientX - depart.x, dy = e.changedTouches[0].clientY - depart.y;
    depart = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const vue = dx < 0 ? 1 : 0;
    if (vue !== semaineVue) { semaineVue = vue; rendre(); glisse = true; setTimeout(() => { glisse = false; }, 350); }
  });
  let glisse = false;   // un glissement n'ouvre pas le jour touché au départ
  racine.addEventListener('click', async (e) => {
    if (glisse) return;
    const tete = e.target.closest('.ligne-tete');
    if (tete) {
      const c = tete.parentElement.dataset.section;
      if (ouvertes.has(c)) ouvertes.delete(c); else ouvertes.add(c);
      rendre();
      return;
    }
    const theme = e.target.closest('[data-theme]');
    if (theme) {
      const t = theme.dataset.theme;
      if (themesOuverts.has(t)) themesOuverts.delete(t); else themesOuverts.add(t);
      rendre();
      return;
    }
    const oubli = e.target.closest('[data-oubli]');
    if (oubli) {
      const f = await donnees.oublierFait(oubli.dataset.oubli);
      if (f) annuler.enregistrer('Fait oublié', () => donnees.restaurerFait(f));
      rendre();
      return;
    }
    const fait = e.target.closest('[data-fait]');
    if (fait) { modifierFait(fait.dataset.fait); return; }
    const bascule = e.target.closest('[data-bascule]');
    if (bascule) {
      const c = bascule.dataset.bascule;
      await donnees.changerReglage(c, !donnees.reglage(c));
      rendre();
      return;
    }
    const seg = e.target.closest('.segment button');
    if (seg) {
      const champ = seg.parentElement.dataset.champ;
      await donnees.changerReglage(champ, seg.dataset.val);
      if (champ === 'taille') appliquerTaille();
      rendre();
      return;
    }
    const point = e.target.closest('[data-semaine]');
    if (point) { semaineVue = Number(point.dataset.semaine); rendre(); return; }
    const jourPl = e.target.closest('[data-jour]');
    if (jourPl) { const [c, i] = jourPl.dataset.jour.split(':'); modifierJour(c, Number(i)); return; }
    const vac = e.target.closest('[data-vacances]');
    if (vac) { modifierVacances(Number(vac.dataset.vacances)); return; }
    const action = e.target.closest('[data-action]');
    if (!action) return;
    switch (action.dataset.action) {
      case 'ajouterVacances': modifierVacances(null); break;
      case 'finMinimum': await (await import('./moteur.js')).arreterModeMinimum(); rendre(); break;
      case 'carnet': carnetOuvert = !carnetOuvert; rendre(); break;
      case 'installerMinuteur': guideMinuteur(); break;
      case 'testerMinuteur': lancerMinuteur(1); break;   // dans le geste : exigé par iOS
      case 'pause': demanderPause(); break;
      case 'reprendre': await donnees.ecrireMeta('pauseJusquau', ''); rendre(); break;
      case 'supprimerCle': confirmerSuppressionCle(); break;
      case 'enregistrerCle': {
        const v = $('#saisieCle').value.trim();
        if (v) { donnees.enregistrerCleApi(v); rendre(); }
        break;
      }
      case 'exporter': exporter(); break;
      case 'importer': $('#fichierImport').click(); break;   // dans le geste : exigé pour ouvrir le sélecteur de fichier
      case 'reinitialiser': confirmerReinitialisation(); break;
    }
  });
  rendre();
}
