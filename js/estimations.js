// PRAXEO v2 — attributs de départ des praxis réelles (§14 point 3, validé le 19/11/2026).
// La v1 ne connaissait ni durée, ni fréquence, ni importance : ces valeurs sont des estimations,
// à corriger ensuite en parlant au coach. Clé = libellé v1 normalisé (majuscules, sans accents).

export const normaliser = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

// Piliers de départ (§14 point 5)
export const PILIERS = ['FAIRE LE LIT', 'PIEDS AU SOL 5H30', 'LEXIS', 'LIRE 10 PAGES'];

// Supprimées à la migration (§11.4 : événement passé, plus d'objet)
export const SUPPRIMEES = ['DISNEY', 'LIBRE'];

const JOURS_OUVRES = [1, 2, 3, 4, 5];

// heure : heure prévue par défaut (en attendant le moteur de planning, lot 2)
// Pour les long cours v1, le libellé « BOXE » est renommé « Boxe tutos » (§11.4).
export const ESTIMATIONS = {
  'FAIRE LE LIT':      { heure: '5h35', duree: 5,  importance: 'essentielle', moment: 'Avant de partir', lieu: 'Maison', minimum: 'Tirer la couette' },   // jours travaillés : 20 min avant le départ (21/11/2026)
  'PIEDS AU SOL 5H30': { heure: '5h30', duree: 5,  importance: 'essentielle', moment: '5h30', lieu: 'Maison', minimum: 'Se lever avant 6h' },
  'LEXIS':             { heure: '6h15', duree: 15, importance: 'essentielle', moment: 'Matin', lieu: 'Partout', minimum: 'Une série de mots', jours: JOURS_OUVRES,
                         description: 'Mon application pour apprendre le dictionnaire' },
  'LIRE 10 PAGES':     { heure: '21h30', duree: 30, importance: 'essentielle', moment: '21h30 – 22h', lieu: 'Maison', minimum: 'Une page' },
  'ECHAUFFEMENT':      { heure: '5h40', duree: 10, importance: 'utile', moment: 'Matin', lieu: 'Maison', minimum: '2 minutes' },
  'EXERCICE 1':        { heure: '5h50', duree: 20, importance: 'utile', moment: 'Matin', lieu: 'Maison', minimum: 'Une série' },
  'EXERCICE 2':        { heure: '6h00', duree: 20, importance: 'utile', moment: 'Matin', lieu: 'Maison', minimum: 'Une série' },
  'BOXE':              { heure: '18h30', duree: 90, importance: 'utile', moment: 'Soir', lieu: 'Gymnase', presence: 'Seul',
                         description: 'Séance au gymnase. Suspendue pendant les vacances scolaires de Corse (gymnase fermé)' },
  'PROJET':            { heure: '14h00', duree: 60, importance: 'utile', moment: 'Jeudi après-midi', lieu: 'Maison',
                         description: 'Faire avancer un projet, quel qu\'il soit' },
  'SONARA':            { heure: '20h00', duree: 30, description: 'Une application en développement' },
  'MEDITER':           { heure: '21h00', duree: 10 },
  'DESSIN':            { heure: '20h30', duree: 30, description: 'Centre d\'intérêt à explorer (loisir)' },
  // Tâches récurrentes
  'COURSES':    { duree: 20, importance: 'utile', lieu: 'Travail', moment: 'Au travail, avant de partir' },   // plusieurs fois par semaine, jamais « en retard »
  'SERIE TV':   { frequence: 4,  duree: 45, importance: 'bonus', lieu: 'Maison', presence: 'Seul', moment: 'Soir de détente' },
  'FILM':       { frequence: 14, duree: 120, importance: 'bonus', lieu: 'Maison', presence: 'Les 2' },
  'LESSIVE':    { frequence: 7,  duree: 15, importance: 'utile', lieu: 'Maison' },
  'EPILATION':  { frequence: 45, duree: 20, importance: 'bonus', lieu: 'Maison', horsMois: [7, 8] },   // pause l'été
  'LINGE':      { duree: 20, importance: 'utile', lieu: 'Maison', apres: 'LESSIVE' },                   // rangé après chaque lessive
  'RANGEMENT':  { frequence: 7,  duree: 30, importance: 'utile', lieu: 'Maison' },
  'SOL':        { frequence: 30, duree: 30, importance: 'utile', lieu: 'Maison', presence: 'Seul', moment: 'Milieu de matinée' },
  'RECYCLAGE':  { frequence: 17, duree: 15, importance: 'utile', lieu: 'Maison' },                      // 2 à 3 semaines, selon la corbeille
  'AQUARIUM':   { frequence: 21, duree: 30, importance: 'utile', lieu: 'Maison' },
  'VOYAGE':     { frequence: 30, duree: 45, importance: 'bonus', lieu: 'Maison', mois: [4, 5, 6, 7] },  // départ en juillet, préparé 3 mois avant
  'FINANCE':    { frequence: 30, duree: 30, importance: 'utile', lieu: 'Maison', jourDuMois: 15 },      // le 15, séances en plus possibles
  // Long cours
  'LIRE UN LIVRE': { importance: 'utile' },
  'MAGIE':         { importance: 'bonus', description: 'Centre d\'intérêt à explorer (loisir)' },
  'NOEUDS':        { libelle: 'Nœuds', importance: 'bonus', description: 'Centre d\'intérêt à explorer (loisir)' },
  'SURVIE':        { importance: 'bonus', description: 'Centre d\'intérêt à explorer (loisir)' },
  'VIDEO':         { libelle: 'Vidéo', importance: 'bonus', description: 'Mon montage vidéo sur CapCut, pas encore terminé' },
  'APPLI':         { importance: 'utile', description: 'Faire avancer un projet d\'application précis' },
  'BOXE TUTOS':    { importance: 'bonus', description: 'Regarder des tutos, travailler la technique' },
};

// Rythmes donnés le 21/11/2026 : appliqués une fois aux données déjà en place (voir donnees.charger)
export const HABITUDES_TACHES = ['COURSES', 'SERIE TV', 'LESSIVE', 'EPILATION', 'LINGE', 'SOL', 'RECYCLAGE', 'AQUARIUM', 'VOYAGE', 'FINANCE'];
export const CHAMPS_HABITUDES = ['frequence', 'presence', 'moment', 'mois', 'horsMois', 'jourDuMois', 'apres', 'lieu'];

// « FAIRE LE LIT » → « Faire le lit » (les bulles s'affichent de toute façon en capitales)
export function enPhrase(s) {
  const t = String(s || '').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
