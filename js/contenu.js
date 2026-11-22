// PRAXEO v2 — contenus de départ repris du cahier des charges : planning (§4.1) et carnet de maximes (§5.11).
// Le planning est modifiable dans Réglages > Moi (lot 1) ; ces valeurs ne servent qu'au premier lancement.

// Cycle de deux semaines (garde alternée, §4.1) ; référence : semaine A = semaine du lundi 16/11/2026.
// travail : 'journee' (8h – 17h) | 'matin' (8h – 12h) | 'aucun'
// famille : plages de présence de ta fille ce jour-là, [[début, fin], …], ou null ; note : précision libre
// depart : heure de départ le matin (jours travaillés) ; departEcole : départ plus tôt les jours d'école
//          de ta fille (hors vacances scolaires) — jeudi et vendredi, 7h15 ; je m'occupe d'elle dès 6h30 (19/11/2026)
const jour = (travail, famille, lever, coucher, note = '', departEcole = '') => ({
  travail, famille, lever, coucher, note,
  ...(travail !== 'aucun' ? { depart: '7h30' } : {}),
  ...(departEcole ? { departEcole } : {}),
});
const ECOLE = ['6h30', '7h15'];   // jeudi et vendredi matin : je m'occupe de ma fille, puis école et travail

export const PLANNING_DEFAUT = {
  referenceA: '2026-11-16',
  // Déroulé du matin (19/11/2026) : réveil à l'heure de lever du jour, puis douche, puis échauffement et exercice.
  // La douche est du temps réservé (comme les repas) : le moteur la retire de la fenêtre du matin.
  matin: { douche: 30 },
  semaines: {
    A: [
      jour('journee', null, '5h30', '22h00'),
      jour('matin', null, '5h30', '22h00'),
      jour('journee', [['19h00', '24h00']], '5h30', '22h00', 'ta fille arrive à 19h'),
      jour('matin', [ECOLE, ['18h00', '24h00']], '5h30', '22h00', 'ta fille dès 6h30 (école) ; tu la récupères vers 18h', '7h15'),
      jour('journee', [ECOLE, ['17h00', '19h00']], '5h30', '22h00', 'ta fille dès 6h30 (école) ; le soir, elle repart chez sa mère', '7h15'),
      jour('matin', null, '5h30', '22h00'),
      jour('aucun', null, '7h00', '22h00', 'seul à la maison'),
    ],
    B: [
      jour('journee', null, '5h30', '22h00'),
      jour('journee', null, '5h30', '22h00'),
      jour('journee', [['19h00', '24h00']], '5h30', '22h00', 'ta fille arrive à 19h'),
      jour('matin', [ECOLE, ['18h00', '24h00']], '5h30', '22h00', 'ta fille dès 6h30 (école) ; tu la récupères vers 18h', '7h15'),
      jour('journee', [ECOLE, ['17h00', '24h00']], '5h30', '22h30', 'ta fille dès 6h30 (école), puis le soir', '7h15'),
      jour('aucun', [['0h00', '24h00']], '7h00', '22h30'),
      jour('aucun', [['0h00', '19h00']], '7h00', '22h00', 'le soir, elle repart'),
    ],
  },
};

// Premiers faits connus du coach (§5.7), dits au cours de la conception ; le coach en ajoutera d'autres
export const MEMOIRE_DEPART = [
  { id: 'm_reveil', theme: 'Habitudes', texte: 'Réveil à 5h30, mais en général je me lève plutôt vers 5h40.', date: '2026-11-19' },
  { id: 'm_matin', theme: 'Planning', texte: 'Le matin : douche (25 à 30 min), puis échauffement et exercice.', date: '2026-11-19' },
  { id: 'm_soir', theme: 'Planning', texte: 'Je prépare à manger vers 19h30, y compris quand ma fille est là (le repas dure alors un peu plus). À partir de 21h30, retour au calme : plus rien de nouveau.', date: '2026-11-21' },
  { id: 'm_courses', theme: 'Habitudes', texte: 'Je travaille dans une grande surface : je fais mes courses avant de partir, au jour le jour, en 15 à 20 minutes. Le dimanche matin, je peux aussi faire des courses (30 minutes).', date: '2026-11-21' },
  { id: 'm_lit', theme: 'Habitudes', texte: 'Les jours travaillés, je fais mon lit avant de partir, vers 7h10. Les jours de repos, au moins une heure après mon lever : j\'aère la chambre d\'abord.', date: '2026-11-22' },
  { id: 'm_ecole', theme: 'Planning', texte: 'Le jeudi et le vendredi (hors vacances scolaires), je m\'occupe de ma fille dès 6h30, puis je pars à 7h15 (école, puis travail) : le matin est court, échauffement et exercice réduits au plus simple.', date: '2026-11-19' },
];

// Vacances scolaires (Corse) : dates confirmées le 20/11/2026, modifiables dans Réglages
export const VACANCES_DEFAUT = [
  { nom: 'Noël', debut: '2026-12-19', fin: '2027-01-04' },
  { nom: 'Hiver', debut: '2027-02-13', fin: '2027-03-01' },
];


// Carnet de maximes (§5.11)
export const maximes = [
  ['Si ça prend moins de 2 minutes, fais-le maintenant.', 'David Allen'],
  ['Commence par 2 minutes : le plus dur, c\'est de commencer.', 'James Clear'],
  ['Ne remets pas au lendemain, ni au surlendemain.', 'Hésiode'],
  ['Le travail s\'étale pour occuper tout le temps disponible : fixe la fin.', 'Loi de Parkinson'],
  ['Associe une tâche pénible à un plaisir.', 'Katherine Milkman'],
  ['Distingue ce qui dépend de toi de ce qui n\'en dépend pas.', 'Épictète'],
  ['Rater une fois est un accident ; deux fois, le début d\'une habitude.', 'James Clear'],
  ['Prépare ce soir ce qui rendra demain facile, concrètement.', 'James Clear'],
  ['Plus que deux. On termine en beauté ?', 'Gradient d\'objectif'],
  ['Nous sommes ce que nous faisons chaque jour.', 'Attribué à Aristote'],
  ['Nouveau départ : c\'est le bon moment pour reprendre.', 'Dai, Milkman, Riis'],
  ['Pause sans écran : elle reposera mieux.', 'Kang & Kurtzberg'],
];

// Texte lisible d'une journée du planning (Réglages > Ma semaine)
export const heureCourte = (h) => String(h || '').replace(/h00$/, 'h');

// Plages de présence de ta fille : accepte l'ancien format (une seule plage [début, fin])
export const plagesFamille = (j) => (!j.famille ? [] : Array.isArray(j.famille[0]) ? j.famille : [j.famille]);

export function decrireJour(j) {
  const travail = { journee: 'Travail 8h – 17h', matin: 'Travail le matin, après-midi libre', aucun: 'Repos' }[j.travail] || '';
  const famille = j.note ? '' : plagesFamille(j).map(decrirePlage).join(', ');   // la précision dit déjà l'essentiel
  return [travail, famille, j.note].filter(Boolean).join(' · ');
}

function decrirePlage([debut, fin]) {
  let famille = '';
  {
    if (debut === '0h00' && fin === '24h00') famille = 'avec ta fille';
    else if (debut === '0h00') famille = `avec ta fille jusqu'à ${heureCourte(fin)}`;
    else if (fin === '24h00') famille = `avec ta fille dès ${heureCourte(debut)}`;
    else famille = `avec ta fille de ${heureCourte(debut)} à ${heureCourte(fin)}`;
  }
  return famille;
}
