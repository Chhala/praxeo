// PRAXEO v2 — interface. Cahier des charges : §6.1 (écran principal), §6.2 (en-tête commun), §6.3-6.4 (charte).
// Données sur l'appareil (donnees.js), journée composée par le moteur local (moteur.js), coach Claude (coach.js, lot 4).

import * as donnees from './donnees.js';
import * as moteur from './moteur.js';
import * as consignes from './consignes.js';
import * as annuler from './annuler.js';
import * as coachIA from './coach.js';
import { rendre as rendreStats } from './stats.js';
import { rendre as rendreReglages, ouvrirSection } from './reglages.js';
import { initPraxis, rendre as rendrePraxis } from './praxis.js';
import { initStats, ouvrirStats } from './stats.js';
import { initReglages } from './reglages.js';
import { lancerMinuteur, dureeCourte, SVG_SABLIER } from './minuteur.js';
import { ouvrirFeuille, fermerFeuille } from './feuille.js';

const $ = (sel) => document.querySelector(sel);

// ── Icônes ─────────────────────────────────────
// bulle avec trois points : « parle au coach » (remplace le micro, validé le 17/11/2026)
const SVG_MICRO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1"/><path class="points" d="M8 12v.01M12 12v.01M16 12v.01"/></svg>';
// flèche d'arc horizontale : pointe + double empennage (validée le 17/11/2026)
const SVG_FLECHE = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 16 H27"/><path d="M21 11 L28 16 L21 21 Z" fill="#fff"/><path d="M3 12 L8 16 L3 20 M7 12 L12 16 L7 20"/></svg>';
const SVG_CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6l-6 6"/></svg>';

// Coût lisible : « 0,05 centime », « 2,1 centimes »
function formatCout(usd) {
  const c = usd * 100;
  const t = c < 0.1 ? c.toFixed(3) : c < 10 ? c.toFixed(2) : c.toFixed(1);
  return `${t.replace('.', ',')} centime${c >= 2 ? 's' : ''}`;
}

// Petit bruit de frappe (§6.1), discret et désactivable ; synthétisé, sans fichier son.
// iOS n'autorise le son qu'après un premier geste : le contexte audio est ouvert au premier toucher.
let audio = null;
function cliquetis() {
  if (!audio || audio.state !== 'running' || !donnees.reglage('bruitFrappe')) return;
  try {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'square';
    o.frequency.value = 1800 + Math.random() * 600;
    g.gain.setValueAtTime(0.012, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.025);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.03);
  } catch { /* son indisponible */ }
}
document.addEventListener('pointerdown', () => {
  try {
    if (!audio && donnees.reglage('bruitFrappe')) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio && audio.state !== 'running') audio.resume();   // « suspended » ou « interrupted » (iOS, retour d'arrière-plan)
  } catch { /* idem */ }
}, { passive: true });

const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── État ───────────────────────────────────────
const MAX_PROGRAMME = 8;   // au plus 8 lignes à l'écran (§6.1)

const etat = {
  page: 'accueil',
  journee: [],   // la journée, ordre chronologique (moteur.composer)
  messageDuJour: null,
  lignesOuvertes: new Set(),
};

// Le programme affiché : ce qui reste à faire, dans l'ordre, 8 au plus.
// Quand une chose est faite, la suivante remonte dans la liste.
const programmeVisible = () => etat.journee.filter((t) => !t.faite).slice(0, MAX_PROGRAMME);

// Bulles de réponse rapide (§5.5) : seulement si le message pose une question, trois au plus,
// et jamais « Fait » : la validation reste un geste de l'utilisateur sur le programme.
function bulles(j) {
  if (!String(j.message || '').includes('?')) return [];
  return (j.reponses || []).filter((b) => !/(^|[^a-zà-ÿ])faite?($|[^a-zà-ÿ])/i.test(b)).slice(0, 3);
}

// ═══ Navigation et en-tête ═════════════════════
const PAGES = {
  accueil:  { titre: 'PRAXEO',   droite: 'couronne' },
  praxis:   { titre: 'PRAXIS',   droite: 'plus' },
  stats:    { titre: 'STATS',    droite: null },
  reglages: { titre: 'RÉGLAGES', droite: null },
};

function allerA(page) {
  const precedente = etat.page;
  etat.page = page;
  const conf = PAGES[page];
  $('#titre').textContent = conf.titre;
  $('#couronne').hidden = conf.droite !== 'couronne';
  $('#btnPlus').hidden = conf.droite !== 'plus';
  // en revenant d'un autre onglet (qui a pu changer les données) ; pas au démarrage, pour garder le message du jour
  if (page === 'accueil' && precedente !== 'accueil' && coach.el) rafraichir();
  if (page === 'praxis') rendrePraxis();   // les retards dépendent du programme du jour
  if (page === 'stats') ouvrirStats();      // toujours l'état par défaut à l'ouverture
  for (const p of Object.keys(PAGES)) $('#page-' + p).hidden = p !== page;
  document.querySelectorAll('.onglet').forEach((b) => {
    const actif = b.dataset.page === page;
    b.classList.toggle('actif', actif);
    b.setAttribute('aria-current', actif ? 'page' : 'false');
  });
}

function afficherSerie(n) {
  const el = $('#serieNb');
  el.textContent = n;
  el.classList.toggle('long', n >= 100);
}

// ═══ Programme ═════════════════════════════════
const estPause = (t) => t.type === 'pause';

// Relit le programme du jour sur l'appareil et redessine l'accueil.
// garderMessage : on ne remplace pas ce que le coach (Claude) vient de dire.
function rafraichir({ garderMessage = false } = {}) {
  etat.journee = moteur.composer().items;
  rendreProgramme();
  rendreLignes();
  afficherSerie(moteur.serie());
  if (coach.mode === 'coach' && !garderMessage && !coach.flux) coach.afficher(consigne());
}

function rendreProgramme() {
  $('#programme').innerHTML = programmeVisible().map((t) => `
    <li class="tache" data-id="${t.id}">
      <span class="heure">${echapper(t.heure)}</span>
      <span class="bulle${estPause(t) || t.type === 'reserve' ? ' pause' : ''}"${estPause(t) || t.type === 'reserve' ? '' : ` style="background:${t.couleur}"`}>${echapper(t.libelle)}</span>
      ${t.duree ? `<span class="duree">${echapper(dureeCourte(t.duree))}</span>` : ''}
    </li>`).join('');
}

// Valider depuis le programme ou depuis une ligne : c'est la même chose (éléments synchronisés).
function valider(id) {
  const t = etat.journee.find((x) => x.id === id);
  if (!t || t.faite) return;
  const li = $(`.tache[data-id="${CSS.escape(id)}"]`);
  const finir = async () => {
    // enregistré dans le journal ; une tâche ponctuelle disparaît en ne laissant qu'une trace (§3.4)
    // une praxis proposée en version minimum est notée comme telle (honnêteté du journal, §5.10 point 9)
    if (t.ponctuelle) {
      const r = await donnees.terminerPonctuelle(id);
      if (r) annuler.enregistrer(`${t.libelle} : faite`, async () => { await donnees.restaurerPonctuelle(r.q); await donnees.supprimerEvenement(r.ev.id); });
    } else if (['pause', 'repas', 'reserve'].includes(t.type)) {
      const ev = await donnees.noter('fait', id);   // une pause ou un repas : simplement passé
      annuler.enregistrer(`${t.libelle} : terminé`, () => donnees.supprimerEvenement(ev.id));
    } else {
      const ev = await donnees.noter(t.minimum ? 'minimum' : 'fait', id);
      annuler.enregistrer(`${t.libelle} : fait`, async () => { await donnees.supprimerEvenement(ev.id); await moteur.majNiveauDuJour(); });
    }
    await moteur.majNiveauDuJour();
    rafraichir();
  };
  if (li && !li.classList.contains('explose')) {
    li.classList.add('explose');
    setTimeout(finir, 500);
  } else if (!li) {
    finir();
  }
}

// Une praxis en souffrance, ajoutée depuis l'onglet Praxis (« En retard » → Oui) :
// notée au journal du jour ; elle apparaît dans la ligne JOUR et dans le programme.
async function ajouterAuProgramme(p) {
  const ev = await donnees.noter('ajoute', p.id);
  annuler.enregistrer(`${p.libelle} : ajoutée au programme`, () => donnees.supprimerEvenement(ev.id));
  rafraichir();
}

// ═══ Lignes dépliables ═════════════════════════
// ROUTINES et JOUR montrent tout ce qui est prévu aujourd'hui, fait ou non (inventaire du jour).
function rendreLignes() {
  const routines = etat.journee.filter((t) => t.type === 'routine');
  const jour = etat.journee.filter((t) => t.type === 'jour');
  const lignes = [
    { nom: 'Routines', items: routines, val: `${routines.filter((t) => t.faite).length} / ${routines.length}` },
    { nom: 'Jour', items: jour, val: jour.filter((t) => !t.faite).length },
    { nom: 'Bloc-notes', items: donnees.cache.notes, val: donnees.cache.notes.length, notes: true },
  ];
  $('#lignes').innerHTML = lignes.map((l) => {
    const ouverte = etat.lignesOuvertes.has(l.nom);
    const bulles = l.items.map((x) => `<span class="bulle${x.faite ? ' faite' : ''}"${l.notes ? ` data-note="${echapper(x.id)}"` : ` data-id="${echapper(x.id)}"`} style="background:${x.couleur}">${echapper(x.libelle)}</span>`).join('')
      + (l.notes ? '<input class="note-saisie" type="text" placeholder="Ajouter une note…" enterkeyhint="done" autocomplete="off" aria-label="Ajouter une note">' : '');
    return `
      <div class="ligne${ouverte ? ' ouverte' : ''}" data-nom="${l.nom}">
        <button class="ligne-tete" type="button" aria-expanded="${ouverte}">
          <span class="ligne-nom">${echapper(l.nom)}</span>
          <span class="ligne-val">${l.val} ${SVG_CHEVRON}</span>
        </button>
        <div class="ligne-corps">${bulles}</div>
      </div>`;
  }).join('');
}

// ═══ Zone unique du coach ══════════════════════
function consigne() {
  // Le message du jour (mode minimum, rappel de la veille) passe une seule fois, avant la consigne du moment
  if (etat.messageDuJour) {
    const msg = etat.messageDuJour;
    etat.messageDuJour = null;
    donnees.ecrireMeta('messageDuJour', donnees.aujourdhui());
    if (msg.cle === 'annonceMinimum') donnees.ecrireMeta('annonceMinimum', msg.valeur);
    return msg.texte;
  }
  return consignes.consigne(programmeVisible()[0]);
}

// Minuteur proposé (§5.5) : une heure butoir suit la séance, ou une longue séance (≥ 45 min).
// Jamais pour une pause ni un repas. Si la séance est déjà commencée, il court jusqu'à sa fin.
const enMinutes = donnees.enMinutes;
function minuteurPropose() {
  const t = programmeVisible()[0];
  if (!t || estPause(t) || t.type === 'repas' || !t.heure.includes('h')) return null;
  if (t.enCours) return null;   // déjà commencée (minuteur lancé) : on ne le repropose pas
  if (!t.butoir && t.duree < 45) return null;
  const debut = enMinutes(t.heure);
  const fin = t.butoir ? enMinutes(t.butoir.heure) : debut + t.duree;
  const d = new Date();
  const maintenant = d.getHours() * 60 + d.getMinutes();
  return maintenant > debut && maintenant < fin ? fin - maintenant : fin - debut;
}

// Met en valeur les mots choisis par Claude ; un élément du bloc-notes cité se touche comme dans la ligne (§5.4)
function surligner(texte, mots = []) {
  let html = echapper(texte);
  const marques = [];
  [...new Set(mots.filter((m) => m && m.length > 1))].sort((a, b) => b.length - a.length).forEach((mot) => {
    const e = echapper(mot);
    const i = html.indexOf(e);
    if (i < 0) return;
    const note = donnees.cache.notes.find((n) => n.libelle.toLowerCase() === mot.toLowerCase());
    marques.push(`<b class="mot"${note ? ` data-note="${echapper(note.id)}"` : ''}>${e}</b>`);
    html = `${html.slice(0, i)}\u0000${marques.length - 1}\u0000${html.slice(i + e.length)}`;
  });
  return html.replace(/\u0000(\d+)\u0000/g, (_, k) => marques[k]);
}

const coach = {
  mode: 'coach',          // 'coach' | 'saisie' | 'reponse'
  flux: false,            // une réponse de Claude arrive (texte qui s'allonge)
  claudeAffiche: false,   // le message à l'écran vient de Claude (ou d'une erreur d'appel) : le double toucher relance
  surbrillance: [],
  reponses: [],
  minutesClaude: null,
  dernierTap: 0,
  minuteurFrappe: null,
  minuteurRetour: null,
  minuteurEnvoi: null,
  texteComplet: '',
  reco: null,

  el: null, btn: null,

  init() {
    this.el = $('#zoneTexte');
    this.btn = $('#zoneBtn');
    this.el.dataset.vide = '';
    $('#zone').addEventListener('click', (e) => {
      if (e.target.closest('#zoneBtn') || e.target.closest('#zoneMinuteur')) return;
      const mot = e.target.closest('.mot[data-note]');
      if (mot && this.mode !== 'saisie') { this.noteTouchee(mot); return; }
      // Double toucher (repris de Zia, 19/11/2026) : relance la dernière demande à Claude
      const t = Date.now();
      if (t - this.dernierTap < 320) { this.dernierTap = 0; this.doubleToucher(); return; }
      this.dernierTap = t;
      this.toucherZone();
    });
    $('#reponses').addEventListener('click', (e) => {
      const b = e.target.closest('[data-reponse]');
      if (b) this.parler(b.dataset.reponse);
    });
    this.el.addEventListener('input', () => this.majBouton());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.envoyer(); }
    });
    this.el.addEventListener('blur', () => {
      if (this.mode === 'saisie' && !this.texteSaisi() && !this.reco) {
        setTimeout(() => { if (document.activeElement !== this.el && this.mode === 'saisie') this.afficher(consigne()); }, 150);
      }
    });
    this.btnMinuteur = $('#zoneMinuteur');
    this.btnMinuteur.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.minutesMinuteur) return;
      lancerMinuteur(this.minutesMinuteur);              // dans le geste : exigé par iOS
      noterDebut(programmeVisible()[0]);
      this.btnMinuteur.classList.add('lance');
      this.btnMinuteur.innerHTML = `${SVG_SABLIER}lancé`;
      setTimeout(() => this.montrerMinuteur(null), 1500);   // une fois lancé, il disparaît : le texte reprend sa place
    });
    this.btn.addEventListener('click', () => {
      if (this.reco) { this.reco.stop(); return; }
      if (this.mode === 'saisie' && this.texteSaisi()) this.envoyer();
      else this.ecouter();
    });
    if (!coachIA.doitParlerALouverture()) this.afficher(consigne());
  },

  texteSaisi() { return this.el.textContent.trim(); },

  // Bouton sablier dans le coin bas gauche ; le texte le contourne comme le bouton de droite
  montrerMinuteur(minutes) {
    this.minutesMinuteur = minutes;
    this.btnMinuteur.hidden = !minutes;
    $('#zone').classList.toggle('avec-minuteur', !!minutes);
    if (minutes) {
      this.btnMinuteur.classList.remove('lance');
      this.btnMinuteur.innerHTML = `${SVG_SABLIER}${dureeCourte(minutes)}`;
      this.btnMinuteur.setAttribute('aria-label', `Lancer un minuteur de ${dureeCourte(minutes)}`);
    }
  },

  majBouton() {
    const fleche = this.mode === 'saisie' && !!this.texteSaisi() && !this.reco;
    this.btn.innerHTML = fleche ? SVG_FLECHE : SVG_MICRO;
    this.btn.setAttribute('aria-label', fleche ? 'Envoyer à Kairos' : 'Parler à Kairos');
  },

  arreterMinuteurs() {
    clearInterval(this.minuteurFrappe); this.minuteurFrappe = null;
    clearTimeout(this.minuteurRetour);
    clearTimeout(this.minuteurEnvoi);
  },

  // le coach écrit lettre à lettre ; mode 'coach' (consigne) ou 'reponse'.
  // options.flux : le texte arrivera morceau par morceau (majFlux), jusqu'à finFlux.
  afficher(texte, mode = 'coach', { flux = false, claude = false, surbrillance = [], reponses = [], minutes = null } = {}) {
    this.arreterMinuteurs();
    this.mode = mode;
    this.flux = flux;
    this.claudeAffiche = claude;
    this.texteComplet = texte;
    this.surbrillance = surbrillance;
    this.reponses = reponses;
    this.minutesClaude = minutes;
    this.montrerReponses([]);
    this.el.contentEditable = 'false';
    this.el.classList.remove('saisie');
    this.el.classList.toggle('attente', flux && !texte);
    this.el.textContent = flux && !texte ? '…' : '';
    this.majBouton();
    this.montrerMinuteur(null);
    let i = 0;
    let bruit = 0;
    this.minuteurFrappe = setInterval(() => {
      if (i >= this.texteComplet.length) { if (!this.flux) this.finFrappe(); return; }
      i++;
      this.el.classList.remove('attente');
      this.el.textContent = this.texteComplet.slice(0, i);
      if (++bruit % 3 === 0) cliquetis();
    }, 28);
  },

  // un morceau de plus de la réponse de Claude
  majFlux(texte) { if (this.flux) this.texteComplet = texte; },

  // la réponse est complète : elle finit de s'écrire, puis les mots en valeur et les bulles de réponse apparaissent
  finFlux(texte, { surbrillance = [], reponses = [], minutes = null, claude = true } = {}) {
    // un autre texte que celui qui s'écrivait (erreur, autre modèle gardé en comparaison) : on le réécrit depuis le début
    const deja = this.el.classList.contains('attente') ? '' : this.el.textContent;
    if (!this.flux || !texte.startsWith(deja)) { this.afficher(texte, this.mode, { claude, surbrillance, reponses, minutes }); return; }
    this.texteComplet = texte;
    this.surbrillance = surbrillance;
    this.reponses = reponses;
    this.minutesClaude = minutes;
    this.claudeAffiche = claude;
    this.flux = false;
  },

  finFrappe() {
    if (this.flux) return;   // tant que la réponse arrive, on ne coupe pas
    clearInterval(this.minuteurFrappe); this.minuteurFrappe = null;
    this.el.classList.remove('attente');
    this.el.innerHTML = surligner(this.texteComplet, this.surbrillance);
    this.montrerReponses(this.reponses);
    if (this.minutesClaude) this.montrerMinuteur(this.minutesClaude);
    else if (this.mode === 'coach') this.montrerMinuteur(minuteurPropose());
    if (this.mode === 'reponse' && !this.reponses.length && !this.minutesClaude) {
      // la réponse reste quelques secondes, puis la consigne (recalculée) revient
      const duree = Math.max(4500, this.texteComplet.length * 80);
      this.minuteurRetour = setTimeout(() => this.afficher(consigne()), duree);
    }
  },

  // Réponses rapides en bulles, sous la zone (§5.5) : un toucher = je réponds ça
  montrerReponses(liste) {
    const r = $('#reponses');
    r.innerHTML = liste.map((x) => `<button type="button" class="reponse" data-reponse="${echapper(x)}">${echapper(x)}</button>`).join('');
    r.hidden = !liste.length;
  },

  noteTouchee(mot) {
    mot.classList.add('explose-mot');
    setTimeout(async () => {
      const n = await donnees.supprimerNote(mot.dataset.note);
      if (n) annuler.enregistrer(`Note « ${n.libelle} » retirée`, () => donnees.restaurerNote(n));
      mot.replaceWith(document.createTextNode(mot.textContent));
      rendreLignes();
    }, 350);
  },

  doubleToucher() {
    const envoi = donnees.cache.meta.dernierEnvoi;
    if (!this.claudeAffiche || !envoi || envoi.date !== donnees.aujourdhui() || !coachIA.disponible()) {
      // rien à relancer : le premier toucher a ouvert la saisie, on la referme si elle est vide
      if (this.mode === 'saisie' && !this.texteSaisi()) { this.el.blur(); this.afficher(consigne()); }
      return;
    }
    this.el.blur();
    this.parler(envoi.texte, { relance: true, consigneLocale: envoi.consigneLocale });
  },

  // ═══ Parler à Claude (lot 4) ═══
  // texte : ce que je dis ; null : ouverture de l'application (le coach donne la consigne du moment).
  async parler(texte, { relance = false, consigneLocale = null } = {}) {
    const ouverture = texte === null;
    const locale = consigneLocale ?? (ouverture ? consigne() : '');
    if (!coachIA.disponible()) {
      this.afficher(ouverture ? locale : coachIA.expliquer({ type: 'cle' }), ouverture ? 'coach' : 'reponse');
      return;
    }
    if (navigator.onLine === false) {
      if (ouverture) { this.afficher(locale); return; }
      await coachIA.mettreEnAttente(texte);
      this.afficher('Pas de réseau. Je te répondrai dès qu\'il reviendra.', 'reponse');
      return;
    }
    this.afficher('', ouverture ? 'coach' : 'reponse', { flux: true, claude: true });
    try {
      const r = await coachIA.demander(texte, { consigneLocale: locale, relance, surMessage: (m) => this.majFlux(m) });
      if (r.principal && r.autre) { this.comparer(r); return; }
      await this.garder(r, r.principal || r.autre);
    } catch (e) {
      console.warn('[Praxeo] coach', e);
      if (ouverture) { this.finFlux(locale, { claude: false }); return; }   // à l'ouverture : la consigne locale, sans bruit
      if (e.reseau && navigator.onLine === false) await coachIA.mettreEnAttente(texte);
      this.finFlux(coachIA.expliquer(e));
    }
  },

  async garder(r, retenue) {
    await coachIA.retenir(r.tours, r.dit, retenue);
    const effet = await coachIA.appliquer(retenue.json, r.dit);
    if (effet.annuler) annuler.enregistrer(`Kairos : ${effet.resume.join(', ') || 'changement fait'}`, effet.annuler);
    rafraichir({ garderMessage: true });
    const j = retenue.json;
    this.finFlux(j.message, { surbrillance: j.surbrillance, reponses: bulles(j), minutes: effet.minuteur });
  },

  // Mode comparaison (§9) : les deux réponses côte à côte ; je garde celle que je préfère
  comparer(r) {
    const colonne = (x, i) => `
      <div class="comp-col">
        <p class="comp-modele">${x.modele}</p>
        <p class="comp-texte">${echapper(x.json.message)}</p>
        <p class="comp-info">${(x.duree / 1000).toFixed(1).replace('.', ',')} s · ${formatCout(x.cout)}</p>
        <button class="choix${i === 0 ? ' choix-oui' : ''}" type="button" data-garder="${i}">Garder</button>
      </div>`;
    const reponses = [r.principal, r.autre];
    let choisie = 0;
    ouvrirFeuille(`
      <p class="feuille-question">Deux réponses</p>
      <div class="comparaison">${reponses.map(colonne).join('')}</div>`,
    (f) => f.addEventListener('click', (e) => {
      const b = e.target.closest('[data-garder]');
      if (!b) return;
      choisie = Number(b.dataset.garder);
      fermerFeuille();
    }),
    () => this.garder(r, reponses[choisie]));
  },

  toucherZone() {
    if (this.flux) return;                                  // une réponse arrive : on la laisse finir
    if (this.minuteurFrappe) { this.montrerTout(); return; }   // tap = tout afficher d'un coup
    clearTimeout(this.minuteurEnvoi);                       // tap pendant le délai = annuler l'envoi
    if (this.mode !== 'saisie') this.passerEnSaisie('');
    this.el.focus();
  },

  passerEnSaisie(texte) {
    this.arreterMinuteurs();
    this.mode = 'saisie';
    try { this.el.contentEditable = 'plaintext-only'; } catch { /* non pris en charge */ }
    if (this.el.contentEditable !== 'plaintext-only') this.el.contentEditable = 'true';
    this.el.classList.add('saisie');
    this.el.classList.remove('attente');
    this.montrerMinuteur(null);
    this.montrerReponses([]);
    this.flux = false;
    this.el.textContent = texte;
    this.majBouton();
  },

  montrerTout() { this.finFrappe(); },

  envoyer() {
    const texte = this.texteSaisi();
    if (!texte) return;
    this.el.blur();
    this.parler(texte);
  },

  // Dictée : reconnaissance vocale de Safari, envoi après ≈ 1 s de silence (§6.1)
  ecouter() {
    const Reco = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Reco) { this.passerEnSaisie(''); this.el.focus(); return; }   // à défaut : dictée du clavier
    this.passerEnSaisie('');
    const r = new Reco();
    r.lang = 'fr-FR';
    r.continuous = false;
    r.interimResults = true;
    this.reco = r;
    this.btn.classList.add('ecoute');
    this.majBouton();
    r.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      this.el.textContent = t;
    };
    r.onend = () => {
      this.reco = null;
      this.btn.classList.remove('ecoute');
      this.majBouton();
      // délai de silence choisi dans Réglages (0,5 / 1 / 1,5 s) : le temps de corriger avant l'envoi
      const delai = Math.round((parseFloat(String(donnees.reglage('delai')).replace(',', '.')) || 1) * 1000);
      if (this.texteSaisi() && donnees.reglage('envoiAuto')) this.minuteurEnvoi = setTimeout(() => this.envoyer(), Math.min(delai, 1500));
      else if (this.texteSaisi()) this.majBouton();
      else this.afficher(consigne());
    };
    r.onerror = () => { /* onend suit toujours */ };
    r.start();
  },
};

// ═══ Appui long sur une bulle : Pas maintenant · Modifier · Retirer · Minuteur (§6.1, §5.5) ═══
let appuiLongFait = false;
function brancherAppuiLong() {
  const prog = $('#programme');
  let minuteur = null;
  const annuler = () => { clearTimeout(minuteur); minuteur = null; };
  prog.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.tache');
    if (!li) return;
    annuler();
    minuteur = setTimeout(() => { appuiLongFait = true; menuTache(li.dataset.id); }, 500);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => prog.addEventListener(ev, annuler));
  prog.addEventListener('pointermove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 4) annuler(); });
  prog.addEventListener('contextmenu', (e) => { if (e.target.closest('.tache')) e.preventDefault(); });
}

const fermerSurReponse = (r) => r.addEventListener('click', (e) => { if (e.target.closest('[data-rep]')) fermerFeuille(); });

// Début d'une tâche (minuteur lancé, ou « C'est commencé ») : elle garde son heure, le temps restant se compte (21/11/2026)
function noterDebut(t) {
  if (!t || t.enCours || t.faite || estPause(t) || t.type === 'repas' || t.type === 'reserve') return;
  donnees.noter('commence', t.id).then((ev) => {
    annuler.enregistrer(`${t.libelle} : commencé`, () => donnees.supprimerEvenement(ev.id));
    rafraichir();
  });
}

function menuTache(id) {
  const t = etat.journee.find((x) => x.id === id);
  if (!t) return;
  const avecMinuteur = !estPause(t) && t.type !== 'repas';
  const bulle = estPause(t) ? '<span class="bulle pause">' : `<span class="bulle" style="background:${t.couleur}">`;
  ouvrirFeuille(`
    <div class="fiche-tete">${bulle}${echapper(t.libelle)}</span></div>
    <div class="menu-tache">
      ${avecMinuteur && !t.enCours ? '<button class="choix" type="button" data-rep="commence">C\'est commencé</button>' : ''}
      <button class="choix" type="button" data-rep="plustard">Pas maintenant</button>
      <button class="choix" type="button" data-rep="modifier">Modifier</button>
      <button class="choix" type="button" data-rep="retirer">Retirer</button>
      ${avecMinuteur ? `<button class="choix choix-oui" type="button" data-rep="minuteur">${SVG_SABLIER}Minuteur · ${dureeCourte(t.duree)}</button>` : ''}
    </div>
    <button class="choix choix-annuler" type="button" data-rep="fermer">Fermer</button>`, (r) => r.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    const rep = b.dataset.rep;
    if (rep === 'minuteur') { lancerMinuteur(t.duree); noterDebut(t); }     // dans le geste : exigé par iOS
    if (rep === 'commence') noterDebut(t);
    fermerFeuille();
    if (rep === 'modifier') {
      setTimeout(() => ouvrirFeuille(`<p class="feuille-question">Pour modifier, dis-le à Kairos.</p>
        <p class="feuille-sous">« Masques jusqu'à 20h », « la poussière demain »…</p>
        <div class="feuille-choix"><button class="choix choix-oui" type="button" data-rep="ok">Compris</button></div>`, fermerSurReponse), 250);
    }
    if (rep === 'plustard' || rep === 'retirer') {          // noté au journal : repoussée en fin de journée, ou retirée
      donnees.noter(rep === 'plustard' ? 'reporte' : 'retire', t.id).then((ev) => {
        annuler.enregistrer(`${t.libelle} : ${rep === 'plustard' ? 'repoussée' : 'retirée'}`, () => donnees.supprimerEvenement(ev.id));
        rafraichir();
      });
    }
  }));
}

// ═══ Démarrage ═════════════════════════════════
async function init() {
  try {
    await donnees.charger();
  } catch (e) {
    console.error('[Praxeo] chargement des données impossible', e);
  }
  document.documentElement.style.setProperty('--zoom', { Petit: 0.92, Normal: 1, Grand: 1.12 }[donnees.reglage('taille')] || 1);
  // La v2 démarre en mode minimum (§14, validé le 19/11/2026) : une seule fois, au premier lancement
  if (!donnees.cache.meta.modeMinimumInitial) {
    await moteur.demarrerModeMinimum(7);
    await donnees.ecrireMeta('modeMinimumInitial', true);
  }
  etat.messageDuJour = consignes.messageDuJour();
  etat.journee = moteur.composer().items;
  afficherSerie(moteur.serie());
  rendreProgramme();
  rendreLignes();
  coach.init();
  if (coachIA.doitParlerALouverture()) coach.parler(null);
  // De retour sur l'appli (iOS la garde en mémoire) : le coach reparle s'il ne l'a pas fait depuis une heure
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    rafraichir({ garderMessage: true });
    if (etat.page === 'accueil' && coach.mode === 'coach' && !coach.flux && coachIA.doitParlerALouverture()) coach.parler(null);
  });
  // File d'attente (§9.1) : ce que j'ai dit sans réseau part dès qu'il revient
  window.addEventListener('online', async () => {
    const file = await coachIA.viderFile();
    if (file.length) coach.parler(file.join('\n'));
  });

  document.querySelectorAll('.onglet').forEach((b) => b.addEventListener('click', () => allerA(b.dataset.page)));
  $('#couronne').addEventListener('click', () => allerA('stats'));

  $('#programme').addEventListener('click', (e) => {
    if (appuiLongFait) { appuiLongFait = false; return; }   // le tap qui suit un appui long ne valide pas
    const li = e.target.closest('.tache');
    if (li) valider(li.dataset.id);
  });
  brancherAppuiLong();
  // Bloc-notes : une note touchée est faite (elle disparaît) ; on en ajoute avec la touche Entrée
  $('#lignes').addEventListener('keydown', async (e) => {
    if (!e.target.matches('.note-saisie') || e.key !== 'Enter') return;
    const v = e.target.value.trim();
    if (!v) return;
    await donnees.ajouterNote(v.charAt(0).toUpperCase() + v.slice(1));
    rendreLignes();
    const champ = $('#lignes .note-saisie');
    if (champ) champ.focus();
  });
  $('#lignes').addEventListener('click', (e) => {
    const note = e.target.closest('.ligne-corps .bulle[data-note]');
    if (note) {
      note.classList.add('explose-note');
      setTimeout(async () => {
        const n = await donnees.supprimerNote(note.dataset.note);
        if (n) annuler.enregistrer(`Note « ${n.libelle} » retirée`, () => donnees.restaurerNote(n));
        rendreLignes();
      }, 350);
      return;
    }
    const bulle = e.target.closest('.ligne-corps .bulle[data-id]');
    if (bulle) { valider(bulle.dataset.id); return; }
    const tete = e.target.closest('.ligne-tete');
    if (!tete) return;
    const ligne = tete.parentElement;
    const ouverte = ligne.classList.toggle('ouverte');
    tete.setAttribute('aria-expanded', String(ouverte));
    if (ouverte) etat.lignesOuvertes.add(ligne.dataset.nom); else etat.lignesOuvertes.delete(ligne.dataset.nom);
  });

  initPraxis({
    ajouterAuProgramme,
    dejaPrevue: (libelle) => etat.journee.some((t) => !t.faite && t.libelle === libelle),
  });
  initStats();
  initReglages({ apresImport: () => location.reload() });
  annuler.initAnnuler();
  document.addEventListener('praxeo:change', () => {   // après un « Annuler » : on redessine l'onglet affiché
    rafraichir();
    if (etat.page === 'praxis') rendrePraxis();
    if (etat.page === 'stats') rendreStats();
    if (etat.page === 'reglages') rendreReglages();
  });
  brancherBalayage();
  brancherClavier();
  // juste après « Mettre à jour » : on reste sur Réglages, Données, pour voir la nouvelle version
  let apresMaj = false;
  try { apresMaj = sessionStorage.getItem('praxeoApresMaj') === '1'; sessionStorage.removeItem('praxeoApresMaj'); } catch { /* rien */ }
  if (apresMaj) { allerA('reglages'); ouvrirSection('donnees'); } else allerA('accueil');
  enregistrerServiceWorker();
}

// ═══ Balayage entre onglets (conservé de la v1, §12) ═══
// Un geste horizontal franc change d'onglet ; on ignore les champs, curseurs, feuilles et la carte de chaleur.
const ORDRE = ['accueil', 'praxis', 'stats', 'reglages'];
function brancherBalayage() {
  const zone = $('.pages');
  let x0 = null, y0 = null, t0 = 0;
  zone.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input, textarea, .hm, .segment, .zone')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  zone.addEventListener('touchend', (e) => {
    if (x0 === null || document.querySelector('.voile')) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 50 || Date.now() - t0 > 600) return;
    const i = ORDRE.indexOf(etat.page) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < ORDRE.length) allerA(ORDRE[i]);
  });
}

// ═══ Clavier de l'iPhone (§6.1) : la zone du coach est en haut et de taille fixe ; rien ne doit bouger ═══
// Safari fait défiler la page pour montrer le champ actif : on la ramène en haut tant que le clavier est ouvert.
function brancherClavier() {
  const recaler = () => { if (document.activeElement === coach.el && (window.scrollY || document.documentElement.scrollTop)) window.scrollTo(0, 0); };
  coach.el.addEventListener('focus', () => setTimeout(recaler, 50));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', recaler);
    window.visualViewport.addEventListener('scroll', recaler);
  }
}

// Hors-ligne : le service worker garde l'application en cache (§2, lot 0)
function enregistrerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('[Praxeo] service worker', e));
}

init();
