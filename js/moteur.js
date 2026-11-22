// PRAXEO v2 — moteur local (lot 2), sans IA : compose la journée, tient la série, gère le mode minimum.
// Cahier des charges : §1 (amphore : pierres, gravier, sable), §4 (planning, statuts), §5.8 à §5.10, §6.1.
// Le coach (lot 4) arbitrera et rédigera ; ce moteur fonctionne seul, hors ligne et gratuitement.

import * as d from './donnees.js';
import { normaliser } from './estimations.js';
import { plagesFamille } from './contenu.js';

const m = d.enMinutes;
// Horaires ronds (20/11/2026) : on place tout sur les 5 minutes, pas « 17h31 »
const cinq = (min) => Math.ceil(min / 5) * 5;
const versHeure = (min) => `${Math.floor(min / 60)}h${String(Math.round(min) % 60).padStart(2, '0')}`;

// ── Réglages du moteur (points de départ, ajustables par la mémoire du coach) ──
export const REGLES = {
  marge: 0.25,             // 25 % du temps libre jamais planifié (§5.9)
  retourAuCalme: '21h30',  // plus rien de nouveau après (§4.1)
  pierre: 30,              // au-delà : une pierre ; 6 à 30 : gravier ; ≤ 5 : sable (§1, règle interne)
  sable: 5,
  seanceLongCours: 45,     // durée d'une séance sur un projet au long cours
  pauseCourte: 10,         // après 25 à 45 min de tâches enchaînées (§5.9)
  pauseLongue: 15,         // après une pierre
  effortAvantPause: 40,
  dejeuner: 45,            // à la maison quand l'après-midi n'est pas travaillé (§4.1)
  diner: 60,
  dinerFamille: 75,
  heureDiner: '19h30',   // je prépare à manger vers 19h30 (21/11/2026)
  heureDinerFamille: '19h30',
  enPlusMinimum: 30,      // mode minimum : minutes d'autres praxis pour que la journée fasse avancer la série   // 19h30 aussi en famille (21/11/2026) ; le repas dure alors un peu plus
};

// ── Mode minimum (§5.10 point 6) : 7 jours au plus, série gelée ──
export function modeMinimum(date = d.aujourdhui()) {
  const mm = d.cache.meta.modeMinimum;
  return !!(mm && mm.debut <= date && date <= mm.fin);
}
// Sortie progressive (20/11/2026) : après le mode minimum, 4 jours de remontée —
// les piliers en entier, les autres routines en petite version, pas de longue séance ; puis le rythme habituel.
export const JOURS_REMONTEE = 4;
export function remontee(date = d.aujourdhui()) {
  const mm = d.cache.meta.modeMinimum;
  if (!mm || date <= mm.fin) return null;
  const [a, mo, j] = mm.fin.split('-').map(Number);
  const debut = d.cleDate(new Date(a, mo - 1, j + 1));
  const fin = d.cleDate(new Date(a, mo - 1, j + JOURS_REMONTEE));
  return date >= debut && date <= fin ? { debut, fin } : null;
}
export async function demarrerModeMinimum(jours = 7) {
  const debut = d.aujourdhui();
  const fin = new Date(); fin.setDate(fin.getDate() + jours - 1);
  await d.ecrireMeta('modeMinimum', { debut, fin: d.cleDate(fin) });
}
export async function arreterModeMinimum() {
  const mm = d.cache.meta.modeMinimum;
  if (!mm) return;
  const hier = new Date(); hier.setDate(hier.getDate() - 1);
  // arrêté le jour même où il a commencé : il n'a jamais eu lieu (sinon il restait actif jusqu'au soir)
  await d.ecrireMeta('modeMinimum', d.cleDate(hier) < mm.debut ? null : { ...mm, fin: d.cleDate(hier) });
}
const enPause = (date) => { const f = d.cache.meta.pauseJusquau; return !!(f && f >= date); };

// ── Durées apprises (§5.9) : médiane des 5 dernières mesures retenues, à partir de 3 ──
export function dureeApprise(p) {
  const mesures = d.cache.events.filter((e) => e.praxisId === p.id && e.dureeReelle).slice(-5).map((e) => e.dureeReelle).sort((a, b) => a - b);
  if (mesures.length < 3) return null;
  return mesures[Math.floor(mesures.length / 2)];
}
// Sans historique, marge de 25 % sur l'estimation (erreur de planification)
const duree = (p) => Math.max(5, Math.round((dureeApprise(p) ?? (p.duree || 20) * (p.origine === 'v1' || !p.duree ? 1.25 : 1)) / 5) * 5);

// ── Score d'une tâche : urgence × importance (§5.1) ──
const POIDS = { essentielle: 3, utile: 2, bonus: 1 };
// Urgence d'une tâche (≥ 1 : due ; au-delà : en retard ; 0 : jamais en retard), selon son rythme réel (21/11/2026) :
// mois permis ou pause saisonnière, jour fixe du mois (la finance le 15), tâche qui suit une autre (le linge après la lessive)
export function urgenceTache(p, maintenant = new Date()) {
  const mo = maintenant.getMonth() + 1;
  if ((p.mois && !p.mois.includes(mo)) || (p.horsMois && p.horsMois.includes(mo))) return 0;
  const der = d.derniereFois(p.id);
  if (p.apres) {
    const q = d.cache.praxis.find((x) => normaliser(x.libelle) === p.apres);
    const dq = q ? d.derniereFois(q.id) : undefined;
    return dq !== undefined && (der === undefined || dq < der) ? 1.5 : 0;
  }
  if (p.jourDuMois) {
    const jour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
    const repere = new Date(jour.getFullYear(), jour.getMonth(), p.jourDuMois);
    if (repere > jour) repere.setMonth(repere.getMonth() - 1);
    const depuis = Math.round((jour - repere) / 864e5);
    return der === undefined || der > depuis ? 1 + depuis / 7 : 0;
  }
  if (!p.frequence) return 0;
  return der === undefined ? 0.4 : der / p.frequence;   // sans date : peu urgente
}
function score(p) {
  const der = d.derniereFois(p.id);
  if (p.section === 'long') return (POIDS[p.importance] || 1) * Math.min(3, ((der ?? 14) + 1) / 7);
  return urgenceTache(p) * (POIDS[p.importance] || 2);
}
const taille = (min) => (min > REGLES.pierre ? 'pierre' : min <= REGLES.sable ? 'sable' : 'gravier');
// Nature d'une tâche : d'après sa durée déclarée (la marge de planification ne change pas sa nature, 20/11/2026)
export const natureDe = (p) => taille(p.duree || duree(p));
const estMatinale = (p) => p.heure && m(p.heure) < 9 * 60;
const estLit = (p) => normaliser(p.libelle) === 'FAIRE LE LIT';
const enFamilleA = (j, min) => plagesFamille(j).some(([de, a]) => min >= m(de) && min < m(a));

// Séance précédente d'une routine à jours fixes (la boxe du mardi, vue le lundi suivant) :
// null si elle a été faite (ou s'il n'y en a pas), sinon { jour, date, empechee } (20/11/2026)
const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export function seancePrecedente(p, maintenant = new Date()) {
  if (!p.jours || p.jours.length >= 7) return null;   // les routines quotidiennes : c'est « hier » qui le dit
  const x = new Date(maintenant);
  for (let i = 1; i <= 7; i++) {
    x.setDate(x.getDate() - 1);
    if (!p.jours.map(Number).includes(d.jourSemaine(x))) continue;
    const cle = d.cleDate(x);
    if (d.cache.jours.get(cle)?.niveau === 'pause') return null;
    const evs = d.cache.events.filter((e) => e.date === cle && e.praxisId === p.id);
    if (evs.some((e) => e.type === 'fait' || e.type === 'minimum')) return null;
    return { jour: JOURS_FR[x.getDay()], date: cle, empechee: evs.some((e) => e.type === 'empeche') };
  }
  return null;
}

// ═══ Composition de la journée ═════════════════
// Renvoie la journée entière (faite ou non), dans l'ordre : le programme affiché en tire les 8 premières non faites.
export function composer(maintenant = new Date()) {
  const date = d.cleDate(maintenant);
  const dow = d.jourSemaine(maintenant);
  const j = d.jourDuPlanning(maintenant);
  const vacances = d.enVacancesScolaires(maintenant);
  const minimum = modeMinimum(date);
  const remonte = !minimum && !!remontee(date);
  const now = maintenant.getHours() * 60 + maintenant.getMinutes();
  if (enPause(date)) return { items: [], pause: true, minimum };

  const evs = d.cache.events.filter((e) => e.date === date);
  const ens = (...types) => new Set(evs.filter((e) => types.includes(e.type)).map((e) => e.praxisId));
  const faits = ens('fait'), minis = ens('minimum'), retires = ens('retire', 'empeche'), reportes = ens('reporte');
  const ajoutees = evs.filter((e) => e.type === 'ajoute').map((e) => e.praxisId);
  const etat = (id) => ({ faite: faits.has(id) || minis.has(id), enMinimum: minis.has(id) });

  const items = [];
  const routinesDuJour = d.cache.praxis.filter((p) => (p.section === 'piliers' || p.section === 'routines')
    && (!p.jours || p.jours.includes(dow)) && !retires.has(p.id)
    // Boxe : gymnase fermé pendant les vacances scolaires (§4.1), sans compter comme ratée
    && !(vacances && normaliser(p.libelle) === 'BOXE'));
  const garder = (p) => !minimum || p.section === 'piliers';

  // ── 1. Le matin : du lever à la fin de la fenêtre (§4.1) ──
  const lever = m(j.lever);
  const finMatin = m(d.finFenetreMatin(maintenant) || '7h30');
  const douche = (d.planning().matin || {}).douche || 0;
  // Les jours travaillés, le lit se fait juste avant de partir (vers 7h10 pour un départ à 7h30, 21/11/2026)
  const depart = j.travail !== 'aucun' ? d.departDuJour(maintenant) : null;
  // les jours de repos, le lit se fait au moins une heure après le lever, chambre aérée (22/11/2026)
  const heureMatin = (p) => (estLit(p) ? (depart ? m(depart) - 20 : lever + 60) : m(p.heure));
  // Déplacée pour aujourd'hui (« Mouvement après le cinéma », 22/11/2026) : un bloc fixe à l'heure choisie
  // Commencée ou déplacée : c'est le dernier des deux qui compte (22/11/2026 : Mouvement, noté « commencé » par erreur,
  // restait en cours à 13h45 malgré le déplacement à 19h00)
  const dernierHoraire = new Map();
  for (const e of evs.filter((x) => (x.type === 'commence' || x.type === 'deplace') && x.heure).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) dernierHoraire.set(e.praxisId, e);
  const deplaces = new Map([...dernierHoraire].filter(([, e]) => e.type === 'deplace').map(([id, e]) => [id, e.heure]));
  const matinales = routinesDuJour.filter(estMatinale).filter((p) => !deplaces.has(p.id)).filter(garder).sort((a, b) => heureMatin(a) - heureMatin(b));
  const besoin = matinales.reduce((s, p) => s + (p.duree || 10), 0) + douche;
  const matinCourt = minimum || remonte || besoin > finMatin - lever;   // pas le temps de tout, ou remontée : petite version (§5.10)
  const versSoir = [];
  let t = lever;
  let doucheFaite = false;
  for (const p of matinales) {
    const st = etat(p.id);
    const min = matinCourt && p.minimum && p.section !== 'piliers' ? 2 : (p.duree || 10);
    const litAvantDepart = estLit(p) && !!depart;
    const litAere = estLit(p) && !depart;
    const heureNormale = litAvantDepart || litAere ? heureMatin(p) : Math.max(t, m(p.heure));
    // Passé l'heure : « trop tard » pour les routines du matin, sauf le lit et ce qui se fait partout (Lexis)
    // (le lit d'avant le départ reste possible jusqu'au départ, même quand la fenêtre se ferme plus tôt avec ma fille)
    if (!st.faite && now > (litAvantDepart ? m(depart) : litAere ? m('12h00') : finMatin)) {
      if (estLit(p) || (p.lieu || '').toLowerCase() === 'partout') versSoir.push(p);
      continue;
    }
    items.push({ id: p.id, heure: versHeure(heureNormale), libelle: p.libelle, couleur: p.couleur, duree: min,
      type: 'routine', pilier: p.section === 'piliers', minimum: matinCourt && !!p.minimum && p.section !== 'piliers', derniere: d.derniereFois(p.id), ...st });
    if (!litAvantDepart && !litAere) t = heureNormale + min;
    // la douche suit le lever (après la première routine, « pieds au sol ») ; les jours de repos, après le lit comme avant
    if (douche && !doucheFaite && !estLit(p)) {
      items.push({ id: 'reserve_douche', heure: versHeure(t), libelle: 'Douche', duree: douche, type: 'reserve', faite: faits.has('reserve_douche') || now > t + douche });
      t += douche;
      doucheFaite = true;
    }
  }
  // jour travaillé sans autre routine du matin (le samedi) : la douche suit le lever
  if (douche && !doucheFaite && matinales.length) items.push({ id: 'reserve_douche', heure: versHeure(lever), libelle: 'Douche', duree: douche, type: 'reserve', faite: faits.has('reserve_douche') || now > lever + douche });

  // ── 2. La journée et le soir ──
  const debutApresMidi = { journee: m('18h00'), matin: m('13h30'), aucun: m('9h00') }[j.travail] ?? m('18h00');
  const finJournee = m(REGLES.retourAuCalme);
  const famille = (min) => enFamilleA(j, min);

  // Blocs fixes : repas, routines à heure fixe du soir, lecture du retour au calme
  const fixes = [];
  if (j.travail !== 'journee') fixes.push({ id: 'repas_dejeuner', libelle: 'Déjeuner', heure: Math.max(debutApresMidi, m('12h30')), duree: REGLES.dejeuner, type: 'repas', couleur: '#6E7A68' });
  const dinerFamille = famille(m(REGLES.heureDiner));
  fixes.push({ id: 'repas_diner', libelle: 'Dîner', heure: m(dinerFamille ? REGLES.heureDinerFamille : REGLES.heureDiner), duree: dinerFamille ? REGLES.dinerFamille : REGLES.diner, type: 'repas', couleur: '#6E7A68' });
  for (const p of routinesDuJour.filter((x) => !estMatinale(x) || deplaces.has(x.id)).filter(garder)) {
    const petite = !!p.minimum && (minimum || (remonte && p.section !== 'piliers'));   // remontée : piliers en entier, le reste en petit
    fixes.push({ id: p.id, libelle: p.libelle, heure: m(deplaces.get(p.id) || p.heure || REGLES.retourAuCalme), ...(deplaces.has(p.id) ? { fixe: true } : {}), duree: petite ? 5 : (p.duree || 20), type: 'routine', couleur: p.couleur, pilier: p.section === 'piliers', minimum: petite, derniere: d.derniereFois(p.id) });
  }
  // Le lit oublié le matin revient en rentrant, avec un peu de rangement (§4.1) ; Lexis aussi
  // Passé le retour au calme, plus de lit : c'est l'heure de se coucher (19/11/2026)
  for (const p of versSoir) {
    if (estLit(p) && now >= finJournee) continue;
    fixes.push({ id: p.id, libelle: p.libelle, heure: cinq(Math.max(now, debutApresMidi)), duree: p.duree || 10, type: 'routine', couleur: p.couleur, pilier: p.section === 'piliers', derniere: d.derniereFois(p.id), rattrapage: true });
  }
  // Le soir, ce qui demande de la concentration (Lexis rattrapé) passe avant la lecture du retour au calme :
  // la fatigue aidant, on lit en dernier (19/11/2026)
  const finRattrapages = Math.max(0, ...fixes.filter((f) => f.rattrapage && !etat(f.id).faite).map((f) => f.heure + f.duree));
  for (const f of fixes) {
    if (f.type === 'routine' && !f.rattrapage && !f.fixe && f.heure >= finJournee && f.heure < finRattrapages && !etat(f.id).faite) f.heure = finRattrapages;
  }

  // Candidats flexibles : ajoutées (« En retard » → Oui), ponctuelles, tâches dues, séances au long cours
  const candidats = [];
  const vus = new Set(fixes.map((f) => f.id));
  // Tâche commencée et pas encore validée : elle garde son heure de début, au lieu d'être replacée à l'heure actuelle (21/11/2026)
  const debuts = new Map([...dernierHoraire].filter(([, e]) => e.type === 'commence').map(([id, e]) => [id, e.heure]));
  for (const [id, h] of debuts) {
    if (vus.has(id) || faits.has(id) || minis.has(id) || retires.has(id) || !h) continue;
    const p = d.praxisParId(id);
    const q = !p && d.cache.ponctuelles.find((x) => x.id === id);
    if (!p && !q) continue;
    const dureeT = p ? (p.section === 'long' ? REGLES.seanceLongCours : duree(p)) : (q.duree || 20);
    fixes.push({ id, libelle: (p || q).libelle, heure: m(h), duree: dureeT, type: p && p.section === 'routines' ? 'routine' : 'jour', couleur: (p || q).couleur || '#A66E4E',
      ponctuelle: !!q, enCours: true, derniere: p ? d.derniereFois(p.id) : undefined });
    vus.add(id);
    if (q && q.praxisId) vus.add(q.praxisId);
  }
  for (const [id, h] of deplaces) {
    if (vus.has(id) || faits.has(id) || minis.has(id) || retires.has(id)) continue;
    const p = d.praxisParId(id);
    const q = !p && d.cache.ponctuelles.find((x) => x.id === id);
    if (!p && !q) continue;
    const dureeT = p ? (p.section === 'long' ? REGLES.seanceLongCours : duree(p)) : (q.duree || 20);
    fixes.push({ id, libelle: (p || q).libelle, heure: m(h), duree: dureeT, type: p && p.section === 'routines' ? 'routine' : 'jour', couleur: (p || q).couleur || '#A66E4E',
      ponctuelle: !!q, fixe: true, derniere: p ? d.derniereFois(p.id) : undefined });
    vus.add(id);
    if (q && q.praxisId) vus.add(q.praxisId);
  }
  // Retirer une praxis du jour la retire sous toutes ses formes : ajoutée au programme, ou tâche du jour qui la porte
  // (sinon « le linge, fais-le dimanche » laissait une copie du linge au programme, 21/11/2026)
  for (const id of ajoutees) {
    const p = d.praxisParId(id);
    if (p && !vus.has(id) && !retires.has(id)) { candidats.push({ p, force: true }); vus.add(id); }
  }
  for (const q of d.cache.ponctuelles) {
    const due = (q.date && q.date <= date) || (!q.date && q.echeance);
    if (due && q.praxisId && retires.has(q.praxisId) && (q.date || date) <= date) continue;
    if (vus.has(q.id)) continue;   // déjà placée (commencée, 21/11/2026) : pas une deuxième fois
    if (due && q.praxisId && vus.has(q.praxisId)) continue;   // une seule fois la même praxis dans la journée
    // une séance fixée par le coach (« Masques jusqu'à 16h30 ») : un bloc à heure fixe, aujourd'hui
    if (due && q.heure && q.date === date && !retires.has(q.id)) {
      // une heure dite (le cinéma à 14h30, un rendez-vous) se garde : les autres blocs se placent autour (22/11/2026)
      fixes.push({ id: q.id, libelle: q.libelle, heure: m(q.heure), duree: q.duree || 20, type: 'jour', ponctuelle: true, fixe: true, couleur: q.couleur || '#A66E4E', ...(q.butoir ? { butoir: q.butoir } : {}) });
      vus.add(q.id);
      if (q.praxisId) vus.add(q.praxisId);
      continue;
    }
    if (due && !retires.has(q.id)) {
      candidats.push({ p: { ...q, section: 'ponctuelle', importance: q.importance || 'utile' }, force: !!q.date, ponctuelle: true });
      if (q.praxisId) vus.add(q.praxisId);   // le linge prévu dimanche n'apparaît qu'une fois ce jour-là
    }
  }
  if (!minimum) {
    const dues = d.cache.praxis
      .filter((p) => (p.section === 'taches' || p.section === 'long') && !vus.has(p.id) && !retires.has(p.id))
      .map((p) => ({ p, s: score(p) }))
      .filter(({ p, s }) => (p.section === 'long' ? s >= 1 : s >= 0.9))
      .filter(({ p }) => (p.lieu || '').toLowerCase() !== 'travail')   // ce qui se fait au travail (les courses) n'occupe pas le temps libre
      .filter(({ p }) => !remonte || (p.section !== 'long' && natureDe(p) !== 'pierre'))   // remontée : pas de longue séance
      .sort((a, b) => b.s - a.s);
    dues.forEach(({ p }) => candidats.push({ p }));
  }

  // Un repas retiré à ma demande (« je dîne chez des amis ») sort du programme (20/11/2026)
  for (let i = fixes.length - 1; i >= 0; i--) if (fixes[i].type === 'repas' && retires.has(fixes[i].id)) fixes.splice(i, 1);

  // Capacité du soir : temps libre restant, moins les blocs fixes, moins la marge
  const debut = Math.max(now, debutApresMidi);
  const occupe = fixes.filter((f) => f.heure + f.duree > debut && f.heure < finJournee).reduce((s, f) => s + f.duree, 0);
  // remontée après le mode minimum : la moitié du temps libre reste vide, au lieu du quart
  let capacite = Math.max(0, (finJournee - debut - occupe) * (1 - (remonte ? 0.5 : REGLES.marge)));

  // Ordre de l'amphore : forcées, puis pierres, gravier, sable ; en famille, seulement le sable et le petit gravier
  const ordre = { pierre: 0, gravier: 1, sable: 2 };
  const flexibles = [];
  // Projets au long cours : une séance par jour, deux les jours de repos (on avance régulièrement, sans tout envahir)
  let seancesLongCours = j.travail === 'aucun' ? 2 : 1;
  // une séance au long cours déjà commencée compte dans le quota du jour
  seancesLongCours -= fixes.filter((f) => f.enCours && d.praxisParId(f.id)?.section === 'long').length;
  for (const c of candidats.sort((a, b) => (b.force - a.force) || ordre[natureDe(a.p)] - ordre[natureDe(b.p)])) {
    if (c.p.section === 'long' && !c.force) {
      if (seancesLongCours <= 0) continue;
      if (d.derniereFois(c.p.id) === 0) continue;   // déjà avancé aujourd'hui
    }
    const min = c.p.section === 'long' ? REGLES.seanceLongCours : duree(c.p);
    if (!c.force && min > capacite) continue;
    if (!c.force && famille(debut) && min > 15) continue;
    if (!c.force && c.p.presence === 'Seul' && famille(debut)) continue;
    capacite -= min;
    if (c.p.section === 'long' && !c.force) seancesLongCours--;
    flexibles.push({ id: c.p.id, force: !!c.force, libelle: c.p.libelle, couleur: c.p.couleur || '#A66E4E', duree: min,
      seul: c.p.presence === 'Seul', prefere: /soir/i.test(c.p.moment || '') ? 'soir' : /matin/i.test(c.p.moment || '') ? 'matin' : '',
      type: c.ponctuelle || c.p.section === 'taches' || c.p.section === 'long' ? 'jour' : 'routine',
      ponctuelle: !!c.ponctuelle, longCours: c.p.section === 'long', taille: c.p.section === 'long' ? 'pierre' : natureDe(c.p), derniere: c.ponctuelle ? undefined : d.derniereFois(c.p.id) });
  }

  // Placement : on remplit les créneaux entre les blocs fixes, avec une pause après l'effort (§5.9)
  const reportees = flexibles.filter((f) => reportes.has(f.id));
  // préférences de moment (21/11/2026) : « milieu de matinée » d'abord (le sol), « soir » après le dîner (la série)
  const normales = flexibles.filter((f) => !reportes.has(f.id));
  const aPlacer = [...normales.filter((f) => f.prefere === 'matin'), ...normales.filter((f) => !f.prefere), ...reportees.filter((f) => f.prefere !== 'soir'), ...flexibles.filter((f) => f.prefere === 'soir')];
  const finDiner = (() => { const r = fixes.find((x) => x.id === 'repas_diner'); return r ? r.heure + r.duree : 0; })();
  const placees = [];
  const fixesTries = fixes.slice().sort((a, b) => a.heure - b.heure || (a.rattrapage ? -1 : 0));
  // chaque bloc commence après la fin la plus tardive de ceux d'avant (pas seulement du précédent : un bloc gardé
  // à son heure au milieu du dîner ne doit pas faire remonter la lecture dans le dîner, 22/11/2026)
  let finMax = fixesTries.length ? fixesTries[0].heure + fixesTries[0].duree : 0;
  for (let i = 1; i < fixesTries.length; i++) {
    const f = fixesTries[i];
    // une tâche commencée garde son heure : c'est le repas ou le bloc d'avant qui a été écourté (22/11/2026) ;
    // une tâche déplacée à une heure précise la garde aussi
    if (!f.enCours && !f.fixe && f.heure < finJournee + 30) {
      if (f.heure < finMax) f.heure = finMax;
      // et pas par-dessus un bloc gardé à son heure, plus loin dans la soirée (Mouvement déplacé à 22h00)
      for (let n = 0; n < 6; n++) {
        const g = fixesTries.find((x) => x !== f && (x.enCours || x.fixe) && x.heure < f.heure + f.duree && x.heure + x.duree > f.heure);
        if (!g) break;
        f.heure = g.heure + g.duree;
      }
    }
    finMax = Math.max(finMax, f.heure + f.duree);
  }
  fixesTries.sort((a, b) => a.heure - b.heure);   // l'ordre a pu changer : le placement suit les heures réelles
  let curseur = cinq(Math.max(now, debutApresMidi));   // on ne place rien dans le passé, et à l'heure ronde
  let effort = 0;
  const prochainFixe = (c) => fixesTries.find((f) => f.heure + f.duree > c);
  for (const f of aPlacer) {
    if (f.prefere === 'soir' && curseur < finDiner) { curseur = finDiner; effort = 0; }
    for (let essais = 0; essais < 12; essais++) {
      const fx = prochainFixe(curseur);
      if (fx && curseur >= fx.heure) { curseur = cinq(fx.heure + fx.duree); effort = 0; continue; }   // reprise à l'heure ronde
      if (fx && curseur + f.duree > fx.heure) { curseur = cinq(fx.heure + fx.duree); effort = 0; continue; }
      break;
    }
    if (!f.force && famille(curseur) && f.duree > 15) continue;
    if (!f.force && f.seul && famille(curseur)) continue;   // jamais en famille (le sol, la série)
    if (curseur + f.duree > finJournee && !f.force) continue;
    placees.push({ ...f, heureMin: curseur });
    curseur += f.duree;
    effort += f.duree;
    const pause = f.taille === 'pierre' ? REGLES.pauseLongue : effort >= REGLES.effortAvantPause ? REGLES.pauseCourte : 0;
    const suivant = prochainFixe(curseur);
    if (pause && curseur + pause < finJournee && (!suivant || curseur + pause <= suivant.heure)) {
      placees.push({ id: `pause_${curseur}`, libelle: 'Pause', duree: pause, type: 'pause', heureMin: curseur });
      curseur += pause;
      effort = 0;
    }
  }

  for (const f of fixesTries) {
    const st = f.type === 'routine' || f.ponctuelle || f.enCours ? etat(f.id) : { faite: faits.has(f.id) || f.heure + f.duree <= now };
    items.push({ ...f, heure: versHeure(f.heure), ...st });
  }
  for (const f of placees) {
    const st = f.type === 'pause' ? { faite: faits.has(f.id) || f.heureMin + f.duree <= now } : etat(f.id);
    items.push({ ...f, heure: versHeure(f.heureMin), reportee: reportes.has(f.id), ...st });
  }
  items.sort((a, b) => m(a.heure) - m(b.heure));
  return { items, minimum, remonte, matinCourt, pause: false };
}

// ═══ Niveau du jour et série (§5.10 point 8) ════
// L'essentiel du jour : les piliers prévus (en version normale) et les tâches essentielles prévues.
export function essentielDuJour(maintenant = new Date()) {
  // passé le retour au calme, le programme n'affiche plus le lit oublié : l'essentiel, lui, se juge sur la journée entière
  // (sinon un lit pas fait disparaissait du bilan à 23h59, 22/11/2026)
  const fin = m(REGLES.retourAuCalme);
  const avant = maintenant.getHours() * 60 + maintenant.getMinutes() >= fin
    ? new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), Math.floor((fin - 1) / 60), (fin - 1) % 60)
    : maintenant;
  const { items } = composer(avant);
  return items.filter((x) => x.pilier || (x.type === 'jour' && (d.praxisParId(x.id)?.importance === 'essentielle')));
}

// maintenant : un autre jour pour recompter la veille (« Hier, la poussière : faite ? » → oui, §5.9)
export async function majNiveauDuJour(maintenant = new Date()) {
  const date = d.cleDate(maintenant);
  const evs = d.cache.events.filter((e) => e.date === date);
  const faits = new Set(evs.filter((e) => e.type === 'fait').map((e) => e.praxisId));
  const touches = new Set(evs.filter((e) => e.type === 'fait' || e.type === 'minimum').map((e) => e.praxisId));
  const essentiel = essentielDuJour(maintenant);
  const famille = plagesFamille(d.jourDuPlanning(maintenant)).length > 0;
  // En famille, les piliers en version minimum suffisent (§5.10, validé le 19/11/2026),
  // sauf si le coach a relevé la barre (j'en fais habituellement davantage ces jours-là)
  const barreBasse = (d.cache.meta.barreFamille || 'minimum') === 'minimum';
  // En mode minimum, la petite version EST l'essentiel du jour (22/11/2026 : la journée restait « en partie » tout validé)
  const fait = (x) => faits.has(x.id) || ((modeMinimum(date) || (famille && barreBasse)) && touches.has(x.id));
  const niveau = essentiel.length && essentiel.every(fait) ? 2 : touches.size ? 1 : 0;
  // En mode minimum, une journée où j'en fais nettement plus que le minimum fait avancer la série (22/11/2026) :
  // l'essentiel fait, plus au moins 30 minutes d'autres praxis (pas quelques bricoles de 5 minutes)
  const idsEssentiel = new Set(essentiel.map((x) => x.id));
  const enPlus = evs.filter((e) => (e.type === 'fait' || e.type === 'minimum') && !idsEssentiel.has(e.praxisId))
    .reduce((s, e) => s + (e.dureeReelle || e.duree || d.praxisParId(e.praxisId)?.duree || 0), 0);
  const minimum = modeMinimum(date);
  const jour = { date, niveau, minimum, ...(minimum ? { enPlus, plus: niveau === 2 && enPlus >= REGLES.enPlusMinimum } : {}), source: 'v2' };
  d.cache.jours.set(date, jour);
  await (await import('./db.js')).ecrire('jours', jour);
  return niveau;
}

// Série : journées « l'essentiel » d'affilée ; un joker par semaine (jour minimum ou raté) ;
// deux jours ratés d'affilée la cassent toujours ; pause neutre ; mode minimum : série gelée.
export function serie() {
  let n = 0;
  let jokerUtilise = new Map();   // semaine (lundi) → joker consommé
  let veilleRatee = false;
  const curseur = new Date();
  for (let i = 0; i < 500; i++) {
    const cle = d.cleDate(curseur);
    const jour = d.cache.jours.get(cle);
    const lundi = new Date(curseur); lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
    const semaine = d.cleDate(lundi);
    curseur.setDate(curseur.getDate() - 1);
    if (i === 0 && (!jour || jour.niveau !== 2)) continue;   // aujourd'hui ne compte qu'une fois réussi
    if (jour && jour.minimum && jour.plus) { n++; veilleRatee = false; continue; }   // mode minimum, mais nettement plus : la série avance
    if (jour && (jour.niveau === 'pause' || jour.minimum)) { veilleRatee = false; continue; }
    if (jour && jour.niveau === 2) { n++; veilleRatee = false; continue; }
    if (!jour && n === 0 && i < 2) continue;                  // hier pas encore enregistré
    // Jour raté ou en version minimum
    if (veilleRatee) break;                                   // ne jamais rater deux fois
    if (jokerUtilise.get(semaine)) break;                     // deuxième dans la semaine
    jokerUtilise.set(semaine, true);
    veilleRatee = true;
  }
  return n;
}
export const record = () => Math.max(d.cache.meta.record || 0, serie());

export function jokerDeLaSemaine(maintenant = new Date()) {
  const lundi = new Date(maintenant); lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  for (let x = new Date(lundi); x < maintenant; x.setDate(x.getDate() + 1)) {
    const j = d.cache.jours.get(d.cleDate(x));
    if (d.cleDate(x) === d.cleDate(maintenant)) break;
    if (j && j.niveau !== 'pause' && !j.minimum && j.niveau !== 2) return 'utilise';
  }
  return 'disponible';
}
