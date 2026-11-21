// PRAXEO v2 — consignes du coach, écrites sans IA (lot 2). Une information à la fois (§6.1), jamais de reproche (§5.3).
// Au lot 4, Claude reformulera et enrichira ; ces phrases restent le repli hors ligne.

import * as d from './donnees.js';
import * as moteur from './moteur.js';
import { dureeCourte } from './minuteur.js';
import { normaliser } from './estimations.js';

const dateLisible = (iso) => { const [, mo, j] = iso.split('-'); return `${Number(j)}/${Number(mo)}`; };
const listeFr = (mots) => (mots.length <= 1 ? mots.join('') : `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`);

// ── Message du jour : dit une seule fois, à la première ouverture (mode minimum, rappel de la veille) ──
export function messageDuJour(maintenant = new Date()) {
  const date = d.cleDate(maintenant);
  if (d.cache.meta.messageDuJour === date) return null;

  // 1. Entrée en mode minimum (§5.10 point 6)
  const mm = d.cache.meta.modeMinimum;
  if (moteur.modeMinimum(date) && d.cache.meta.annonceMinimum !== mm.debut) {
    return { cle: 'annonceMinimum', valeur: mm.debut,
      texte: `On démarre en douceur : mode minimum jusqu'au ${dateLisible(mm.fin)}. Seulement les piliers, réduits au plus simple. Ensuite, on remonte par paliers.` };
  }

  // 1 bis. Sortie progressive du mode minimum : début de la remontée, puis retour au rythme habituel (20/11/2026)
  const rm = moteur.remontee(date);
  if (rm && rm.debut === date) {
    return { cle: 'messageDuJour', valeur: date,
      texte: `Le mode minimum est terminé. On remonte en douceur jusqu'au ${dateLisible(rm.fin)} : les piliers en entier, le reste en petit.` };
  }
  if (mm && !moteur.modeMinimum(date) && !rm) {
    const veille = new Date(maintenant); veille.setDate(veille.getDate() - 1);
    if (moteur.remontee(d.cleDate(veille))) return { cle: 'messageDuJour', valeur: date, texte: 'Retour au rythme habituel : tout le programme reprend.' };
  }

  // 2. Rappel de ce qui a cloché la veille (§5.10 point 8) : « Ne rate pas deux fois »
  const hier = new Date(maintenant); hier.setDate(hier.getDate() - 1); hier.setHours(23, 59, 0, 0);
  const jourHier = d.cache.jours.get(d.cleDate(hier));
  if (jourHier && jourHier.niveau !== 'pause' && !jourHier.minimum && jourHier.niveau !== 2) {
    // déjà rattrapé aujourd'hui (Lexis raté hier, fait ce matin) : rien à rappeler
    const faitAujourdhui = (id) => d.cache.events.some((e) => e.date === date && e.praxisId === id && (e.type === 'fait' || e.type === 'minimum'));
    const manques = moteur.essentielDuJour(hier).filter((x) => !x.faite && !faitAujourdhui(x.id)).map((x) => x.libelle.toLowerCase());
    if (manques.length) {
      const sujet = manques.length === 1 ? `${manques[0]} est passé` : `${listeFr(manques)} sont passés`;
      return { cle: 'messageDuJour', valeur: date,
        texte: `Hier, ${sujet} à la trappe. Ne rate pas deux fois : aujourd'hui, on ${manques.length === 1 ? 'le' : 'les'} place en premier ?` };
    }
  }
  // 3. Une routine à jours fixes dont la séance précédente a sauté (la boxe du mardi, revue le lundi)
  if (!moteur.modeMinimum(date)) {
    const items = moteur.composer(maintenant).items.filter((t) => t.type === 'routine' && !t.faite);
    for (const t of items) {
      const p = d.praxisParId(t.id);
      const prec = p && moteur.seancePrecedente(p, maintenant);
      if (!prec) continue;
      const quand = d.enMinutes(t.heure) >= 17 * 60 ? 'Ce soir' : 'Aujourd\'hui';
      // empêchée : neutre, sans reproche, mais l'habitude compte quand même
      const motif = prec.empechee ? `la séance de ${prec.jour} n'a pas pu se faire` : `la séance de ${prec.jour} a sauté`;
      return { cle: 'messageDuJour', valeur: date,
        texte: `${quand}, ${t.libelle.toLowerCase()} à ${t.heure} : ${motif}. Ne rate pas deux fois.` };
    }
  }
  return null;
}

// ── Consigne du moment : la première chose du programme ──
export function consigne(item, maintenant = new Date()) {
  if (!d.cache.praxis.length) return 'Bienvenue. Pour commencer, importe ta sauvegarde : Réglages, Données, Importer.';
  const f = d.cache.meta.pauseJusquau;
  if (f && f >= d.cleDate(maintenant)) return `Praxeo est en pause jusqu'au ${dateLisible(f)}. Repose-toi, la série t'attend.`;
  if (!item) return 'Tout est fait pour aujourd\'hui. Profite de ta soirée.';

  // Une idée rattachée à cette praxis : rappelée au début de la séance (§5.4)
  const idee = d.cache.notes.find((n) => n.praxisId && n.praxisId === item.id);
  if (idee) return `Avant de commencer : ton idée, « ${idee.libelle} ».`;

  const temps = item.duree < 60 ? `${item.duree} minutes` : dureeCourte(item.duree);
  if (item.enCours) {
    const reste = d.enMinutes(item.heure) + item.duree - (maintenant.getHours() * 60 + maintenant.getMinutes());
    return reste > 0
      ? `${item.libelle}, commencé à ${item.heure} : encore ${reste < 60 ? `${reste} minutes` : dureeCourte(reste)}.`
      : `${item.libelle} : le temps prévu est passé. Touche la bulle quand c'est fini.`;
  }
  if (item.type === 'pause') return `Pause, ${item.duree} minutes. Un tour dehors, sans écran ?`;
  if (item.type === 'repas') return `${item.libelle}, ${temps}. Une petite tâche peut se glisser pendant la cuisson.`;
  if (item.type === 'reserve') return `${item.libelle}, ${temps}.`;
  if (item.rattrapage && normaliser(item.libelle) === 'FAIRE LE LIT') return 'Avant de te poser : le lit, et 5 minutes de rangement.';
  if (item.minimum) {
    // la raison dépend du moment : mode minimum en cours, ou matin trop court (§5.10)
    const raison = d.cache.meta.modeMinimum && d.cache.meta.modeMinimum.fin >= d.cleDate(maintenant) ? 'Ça compte comme fait.' : 'Le matin est court, ça suffit.';
    // ce qu'il y a concrètement à faire (« une page »), jamais le mot « minimum » à l'écran (19/11/2026)
    const court = (d.praxisParId(item.id)?.minimum || '').trim();
    return `${item.libelle} : ${court ? `${court.charAt(0).toLowerCase()}${court.slice(1)}, ` : ''}${temps}. ${raison}`;
  }
  let s = `${item.libelle}, ${temps}.`;
  if (item.derniere > 1) s += ` La dernière fois remonte à ${item.derniere} jours.`;
  return s;
}
