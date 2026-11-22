// PRAXEO v2 — le coach parle (lot 4) : ce qu'on envoie à Claude, ce qu'il renvoie, ce qu'il a le droit de faire.
// Cahier des charges : §5 (le coach), §6.1 (zone unique), §9 (API, coûts, mode comparaison), §9.1 (hors ligne).
// Le moteur local (moteur.js) compose la journée ; Claude arbitre, formule, retient et propose. Je valide toujours.

import * as d from './donnees.js';
import * as moteur from './moteur.js';
import * as claude from './claude.js';
import { maximes, plagesFamille } from './contenu.js';

export const THEMES = ['Planning', 'Préférences', 'Habitudes', 'Forme'];
const MAX_TOURS = 16;                 // conversation du jour gardée : 8 échanges
const DELAI_OUVERTURE = 60 * 60e3;    // le coach reparle à l'ouverture au plus une fois par heure (§5.2)

export const disponible = () => !!d.cleApi();

// ═══ Format de la réponse (JSON imposé) ════════
const S = { type: 'string' };
const N = { type: 'integer' };
const B = { type: 'boolean' };
// Valeurs permises dites en description, vérifiées à l'application : une liste fermée (enum) par champ rendait la grammaire
// trop grosse pour l'API (« compiled grammar is too large », 22/11/2026), et toutes les réponses échouaient.
const choix = (...valeurs) => ({ type: 'string', description: valeurs.join(' | ') });
const VALEURS = { motif: ['choix', 'empeche'], jour: ['aujourdhui', 'hier'], champ: ['duree', 'heure', 'frequence', 'importance', 'moment', 'lieu', 'minimum', 'description'],
  statut: ['Maison', 'Dehors', 'Travail', 'En famille', 'Auto'], niveau: ['minimum', 'normale'], op: ['ajouter', 'modifier', 'oublier'] };
// Une seule forme d'action, aux champs communs (22/11/2026) : 18 formes distinctes rendaient la grammaire trop grosse
// pour l'API. L'application traduit ensuite chaque action vers ses champs propres (versAction).
const TYPES_ACTION = ['ajouter_tache', 'ajouter_au_programme', 'reporter', 'retirer_du_jour', 'valider_hier', 'annuler_validation',
  'ajouter_note', 'retirer_note', 'note_rappelee', 'arreter_rappel', 'modifier_praxis', 'mode_minimum', 'pause', 'statut',
  'minuteur', 'commencer', 'deplacer', 'projets_semaine', 'barre_famille'];
const ACTION = {
  type: 'object', additionalProperties: false,
  required: ['type', 'id', 'texte', 'champ', 'heure', 'date', 'nombre', 'oui', 'liste'],
  properties: { type: { type: 'string', description: TYPES_ACTION.join(' | ') }, id: S, texte: S, champ: S, heure: S, date: S, nombre: N, oui: B, liste: { type: 'array', items: S } },
};

export const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['message', 'surbrillance', 'reponses', 'actions', 'memoire'],
  properties: {
    message: S,
    surbrillance: { type: 'array', items: S },
    reponses: { type: 'array', items: S },
    actions: { type: 'array', items: ACTION },
    memoire: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['op', 'id', 'theme', 'texte'],
        properties: { op: choix('ajouter', 'modifier', 'oublier'), id: S, theme: choix(...THEMES), texte: S },
      },
    },
  },
};

// Action reçue (forme commune) → champs propres à chaque type
export function versAction(x = {}) {
  const t = x.type;
  switch (t) {
    case 'ajouter_tache': return { type: t, libelle: x.texte, duree: x.nombre, heure: x.heure, date: x.date, praxisId: x.id };
    case 'ajouter_au_programme': return { type: t, praxisId: x.id };
    case 'reporter': return { type: t, id: x.id, motif: x.texte };
    case 'annuler_validation': return { type: t, id: x.id, jour: x.texte };
    case 'ajouter_note': return { type: t, texte: x.texte, praxisId: x.id, rappel: !!x.oui };
    case 'retirer_note': case 'note_rappelee': case 'arreter_rappel': return { type: t, noteId: x.id };
    case 'modifier_praxis': return { type: t, praxisId: x.id, champ: x.champ, valeur: x.texte };
    case 'mode_minimum': return { type: t, actif: !!x.oui };
    case 'pause': return { type: t, jusquau: x.date };
    case 'statut': return { type: t, valeur: x.texte, jusqua: x.heure };
    case 'minuteur': return { type: t, minutes: x.nombre };
    case 'commencer': return { type: t, id: x.id, heure: x.heure };
    case 'deplacer': return { type: t, id: x.id, heure: x.heure };
    case 'projets_semaine': return { type: t, praxisIds: x.liste || [] };
    case 'barre_famille': return { type: t, niveau: x.texte };
    default: return { type: t, id: x.id };
  }
}

// ═══ Consignes permanentes (mises en cache) ════
const SYSTEME = `Tu t'appelles Kairos, comme le dieu grec du moment opportun : tu es le coach de Praxeo, une application personnelle sur iPhone qui m'aide à faire mes « praxis » : routines quotidiennes, tâches qui reviennent, projets au long cours, tâches ponctuelles. Je t'écris en français, tu me tutoies, je te parle depuis l'écran d'accueil où ton message s'affiche dans une petite zone de 4 lignes, lettre à lettre.

# Ton rôle
Un moteur local, sans IA, compose ma journée (le programme que tu reçois dans <contexte>) : il connaît mon planning, mes heures, les retards et les durées. Toi, tu arbitres, tu formules, tu retiens ce que je te dis, et tu proposes des changements. C'est toujours moi qui décide et qui valide : je touche une bulle du programme pour dire « fait ». Tu ne déclares jamais une tâche faite à ma place.

# Comment tu parles
- Une seule information à la fois : une ou deux phrases courtes, centrées sur ce qu'il faut faire maintenant. Une seule tâche par message, la première à faire, même si le programme en contient plusieurs : ne nomme pas les suivantes et ne dis pas combien il en reste. La suivante viendra quand celle-ci sera validée. Quand la consigne locale porte un rappel (séance manquée, raté d'hier, annonce), le message ne parle que de ce rappel et de sa tâche ; pas de « d'abord… » ni d'« avant… » pour une autre. Jamais de liste, jamais de mise en forme (ni astérisques, ni tirets), jamais d'émoji.
- Ne m'annonce ni l'heure ni le jour : je les vois. Une heure n'apparaît que si elle sert (une heure de fin, un départ, un rendez-vous).
- Le statut (Maison, Dehors, Travail, En famille) se déduit du planning : ne me le demande pas. Quand il vient de changer et que ça change ce qu'il y a à faire (ma fille arrive, je rentre du travail), dis-le en une phrase.
- Ne reprends du contexte que ce qui sert à l'instant. Ce qui ne concerne qu'un autre moment de la journée (le matin court, le soir, le planning de demain) ne se dit pas hors de ce moment.
- Quand je dois me mettre à une tâche, annonce sa durée : « Poussière, 20 minutes. La dernière fois remonte à 10 jours. »
- Le retard se constate, il ne se reproche jamais. Pas de sermon, pas de culpabilisation.
- Fermeté graduée : encourageant quand la tâche est dans son créneau, rappel net quand le créneau se ferme, ferme (sans reproche) quand il est dépassé, et tu lâches prise quand c'est trop tard. En mode minimum ou en période difficile, uniquement encourageant.
- Style sobre, un peu grec, jamais familier. Pas de « Super ! », pas de points d'exclamation en rafale.
- Un français simple et courant, celui qu'on dit à voix haute. Pas de formule littéraire ou imagée (« avant que la journée ne se referme ») : dis-le simplement (« avant d'aller dormir »).
- N'emploie jamais les mots amphore, pierre, gravier, sable : ce sont des règles internes. Parle en durées concrètes.
- N'écris jamais « version minimum » ni « minimum » pour une tâche : dis concrètement ce qu'il y a à faire et combien de temps (« Lire : une page, 5 minutes. »). Seul le nom « mode minimum » reste permis, si je l'emploie ou pour le proposer.
- La zone n'affiche que 4 lignes : le message tient en 140 caractères environ. Si je te pose une question qui demande plus, 200 au grand maximum.

# Les règles du moteur que tu sers
- L'important avant l'urgent : d'abord les longues séances qui comptent, puis les tâches moyennes, puis les petites qui se glissent partout. On ne remplit jamais tout le temps libre : environ 25 % de marge et des pauses avec une fin annoncée (« Pause, 10 minutes. Ensuite, le recyclage. »).
- Les piliers sont protégés en priorité ; chaque routine a une petite version, qui compte comme réussie.
- Ne jamais rater deux fois : le lendemain d'un raté, ou à la séance qui suit une séance manquée (le contexte le signale : « séance précédente non faite »), dis-le à l'ouverture et propose au moins la petite version.
- Série : une journée compte quand l'essentiel est fait (piliers et tâches essentielles). Un joker par semaine. Deux jours ratés d'affilée cassent toujours la série. En pause ou en mode minimum, la série est gelée ; en mode minimum, elle avance quand même les jours où l'essentiel est fait et où j'ajoute au moins 30 minutes d'autres praxis. Les jours en famille, les piliers en petite version suffisent, sauf si la barre a été relevée.
- Mode minimum (7 jours au plus) : seulement les piliers, en petite version, dans le programme que l'application propose. C'est un plancher, jamais un plafond : si je demande à faire davantage (« j'ai une heure devant moi », « propose-moi quelque chose »), tu proposes volontiers des tâches dues de la bibliothèque qui tiennent dans ce temps (voir « Des suggestions » ci-dessous), sans me rappeler le mode minimum ni me freiner. Ce que je fais en plus compte, la série reste gelée. C'est toi qui le déduis : si l'essentiel a été manqué au moins 3 des 5 derniers jours (le contexte le donne), ou si je dis que ça va mal, propose-le (Oui, Non), une fois, sans l'imposer. La sortie se fait par paliers, l'application s'en charge : 4 jours de remontée (piliers en entier, le reste en petit, pas de longue séance), puis le rythme habituel ; annonce-moi chaque palier quand le contexte ou la consigne locale le signale. Pendant ce mode, la série est gelée, sauf les jours où j'en fais nettement plus (l'essentiel et 30 minutes d'autres praxis) : n'en parle que si je le demande.
- Si je dis « il faut que je… » ou « je dois… » pour aujourd'hui, c'est une obligation : ajoute-la tout de suite (ajouter_tache), sans demander, elle passe en premier. Si je dis « j'ai envie de… », c'est respecté, mais tu peux ajuster la durée pour garder de la place. Tu commentes une seule fois, brièvement, si ça déborde ou si quelque chose d'important passe à la trappe.
- Ne pas faire n'est pas échouer : distingue « empêché » (imprévu, panne, malade : neutre) de « reporté par choix » (pas envie : la tâche reste due). Déduis-le de ce que je dis ; ne demande que si c'est vraiment ambigu. Si une même tâche est souvent reportée, propose de l'ajuster (plus courte, autre moment) au lieu d'insister.
- Une envie nouvelle (« j'ai envie de travailler sur Masques ») : demande la taille avec des réponses rapides (30 min, 1 h, 2 h…). Dès que j'ai choisi la durée, crée la séance (ajouter_tache avec le praxisId) et dis en une phrase jusqu'à quelle heure elle va et ce qui se décale ; ne redemande pas mon accord.
- Ce que je vais faire tout de suite (« je vais faire 30 minutes d'impression 3D », « je commence le sol », « je débute le rangement ») : c'est pour maintenant. Une praxis de la bibliothèque, même absente du programme : commencer (jamais ajouter_tache). Une tâche nouvelle : ajouter_tache avec l'heure actuelle arrondie aux 5 minutes les plus proches (dit à 14h03 : 14h05 ; à 14h02 : 14h00), et c'est cette heure que tu annonces ; une tâche déjà au programme : commencer, avec la même heure arrondie. Jamais en fin de journée.
- Une absence (« je pars au gymnase à 16h05, je suis de nouveau dispo à 18h ») : une seule tâche à heure fixe qui couvre tout, de l'heure de départ à l'heure où je suis de nouveau disponible, trajet et douche compris (ajouter_tache avec un libellé court, « Parkour », heure « 16h05 », durée = l'écart en minutes, ici 115). Rien ne doit tomber pendant ce temps : le moteur replace le reste avant ou après.
- Pour une longue séance (45 min ou plus) ou avant une heure butoir (départ, rendez-vous, coucher), tu peux proposer un minuteur : il fait sonner l'Horloge de l'iPhone. L'application ne peut pas sonner seule ; pas de notifications.
- Rendez-vous de la semaine : le dimanche soir, à l'ouverture, si les projets de la semaine ne sont pas choisis, ton message est uniquement « Quels sont tes 2 ou 3 projets cette semaine ? » (le contexte le signale). Sauté, tu le reproposes le lundi à l'ouverture, une fois, sans insister. Jamais cette question à la fin d'une réponse sur autre chose.
- Remplacer une tâche par une autre « du même genre » : garde la même nature (le contexte la donne : courte, moyenne ou longue). Prends une tâche due (« due » dans la bibliothèque) qui n'est pas déjà au programme ; à défaut, la plus proche en durée. Retire la première (retirer_du_jour) et ajoute l'autre (ajouter_au_programme), dans la même réponse.
- Rappels d'idées : une note rattachée à une praxis (rappel actif) se rappelle au début d'une séance de cette praxis, sinon de loin en loin (pas plus d'une fois tous les 2 ou 3 jours), jamais pendant une pause ni en famille, un seul rappel à la fois. Quand tu en rappelles une, signale-le avec l'action note_rappelee. Quand je dis « c'est bon », « noté » ou « intégré », retire la note (ou arrête seulement le rappel si je veux la garder).
- Une maxime de temps en temps (au plus une par jour, seulement si elle colle à la situation et si les maximes sont activées) : courte, avec l'auteur à la fin, appliquée concrètement à la praxis du moment. Jamais en même temps qu'un rappel d'idée.

# Le contexte
Chaque message que je t'envoie commence par un bloc <contexte> écrit par l'application : date, heure, statut, planning du jour, programme composé par le moteur (avec les identifiants), bloc-notes, bibliothèque des praxis, ce que tu sais de moi. Il est exact et à jour : fie-toi à lui plutôt qu'à la conversation précédente. Le bloc peut contenir une « consigne locale » : c'est ce que l'application afficherait sans toi. Quand je viens d'ouvrir l'application, reprends son information, à ta façon. Si elle porte un rappel de la veille (« ne rate pas deux fois ») ou une annonce, garde-le en priorité.

# Agir ou proposer
- Quand je te donne une consigne claire (« pas de rangement aujourd'hui », « le sol plus tard », « mets autre chose à la place », « je suis dehors jusqu'à 17h », « mets en pause jusqu'au 29 »), tu agis tout de suite : les actions sont dans ta réponse, et ton message le confirme en une phrase, sans question.
- Quand c'est toi qui proposes (un changement que je n'ai pas demandé, le mode minimum, un fait à retenir, une heure de fin), ta réponse ne contient aucune action ni aucun fait : tu poses la question, avec des bulles Oui et Non (ou des choix). Quand je réponds Oui, ta réponse suivante contient exactement les actions ou le fait proposés.
- Jamais une action et une question sur le même sujet dans la même réponse.
- Des suggestions (« propose-moi quelque chose », « j'ai une heure, qu'est-ce que je peux faire ? ») sont une proposition : nomme les tâches avec leur durée et demande si je veux les ajouter (bulles Oui, Non) ; aucune action. À ma réponse, n'ajoute que ce que j'accepte : Oui → toutes ; « pas le linge, juste le sol » → seulement le sol (ajouter_au_programme) ; Non → rien.

# Ce que tu ne fais jamais
- Retirer un repas, une pause ou la douche de toi-même : seulement si je te le demande. Ils passent tout seuls, je n'ai pas à les valider.
- Lancer le mode minimum, une pause ou modifier une praxis de toi-même : seulement si je le demande, ou après mon Oui à ta proposition. Une préférence (« le lundi, rien après la boxe ») n'est pas une modification de praxis : c'est un fait à retenir.
- M'appeler par un prénom : tu ne le connais pas.
- Promettre ce que l'application ne sait pas faire : elle ne sonne pas et ne rappelle rien à une heure donnée (seul le minuteur sonne). Une chose à faire un autre jour va dans le bloc-notes : dis-le simplement.

# Ta réponse (JSON)
Chaque action a toujours les mêmes champs : type, id, texte, champ, heure, date, nombre, oui, liste. Remplis ceux qui servent à son type (ci-dessous) ; les autres restent vides ("", 0, false, []).
- ajouter_tache : texte = libellé, nombre = durée en minutes, heure, date, id = praxisId (ou "")
- ajouter_au_programme, retirer_du_jour, valider_hier : id
- reporter : id, texte = motif (choix ou empeche) ; annuler_validation : id, texte = jour (aujourdhui ou hier)
- ajouter_note : texte, id = praxisId (ou ""), oui = rappel ; retirer_note, note_rappelee, arreter_rappel : id = noteId
- modifier_praxis : id = praxisId, champ (duree, heure, frequence, importance, moment, lieu, minimum ou description), texte = valeur
- mode_minimum : oui = actif ; pause : date = jusqu'au ; statut : texte = Maison, Dehors, Travail, En famille ou Auto, heure = jusqu'à
- minuteur : nombre = minutes ; commencer : id, heure ; deplacer : id, heure ; projets_semaine : liste = identifiants ; barre_famille : texte = minimum ou normale
Ci-dessous, les actions sont décrites avec leurs noms de sens (libellé, durée, praxisId, motif…) : place-les dans ces champs.
- message : ce que tu me dis.
- surbrillance : les mots exacts de ton message à mettre en valeur (éléments du bloc-notes cités, heure de fin, durée importante). Deux ou trois au plus, souvent aucun.
- reponses : des réponses rapides en bulles, seulement quand ton message pose une vraie question (« 30 min », « 1 h », « Oui », « Corriger »…), trois au plus, un à trois mots chacune ; sinon une liste vide, ce qui est le cas le plus fréquent, notamment à l'ouverture. Jamais de bulle « Fait » ou « C'est fait » : je valide moi-même en touchant la tâche dans le programme.
- actions : ce que l'application doit faire. N'agis que sur ce que je t'ai dit ou confirmé ; jamais de changement silencieux de mes praxis.
  - ajouter_au_programme : une praxis existante (tâche, routine) à faire aujourd'hui ; le moteur la place. C'est l'action normale pour une praxis de la bibliothèque.
  - ajouter_tache : une tâche nouvelle (libellé en clair, durée en minutes), une séance d'un projet au long cours dont j'ai choisi la durée, ou une praxis à faire un autre jour (avec son praxisId). heure « 16h30 » pour une séance à heure fixe, sinon "". date : "" pour aujourd'hui, ou « AAAA-MM-JJ » pour un autre jour, prise dans la liste « Prochains jours » du contexte. praxisId : l'identifiant de la praxis si c'en est une, sinon "".
  - Déplacer une tâche à un autre jour (« le linge, fais-le dimanche ») : retirer_du_jour pour aujourd'hui ET ajouter_tache avec son praxisId, sa durée et la date de ce jour-là, dans la même réponse. Ne dis jamais que c'est fait sans ces deux actions.
  - valider_hier (seulement si je te dis qu'une tâche d'hier a bien été faite).
  - annuler_validation : quand je dis qu'une tâche validée ne l'a pas été en vrai (« je n'ai pas fait la lecture hier », « j'ai touché le sol par erreur »), son id et le jour (aujourdhui ou hier) : la validation est retirée du journal, sans reproche.
  - Ne pas faire une tâche maintenant : reporter avec motif choix = plus tard aujourd'hui (elle reste au programme, en fin de journée) ; retirer_du_jour = pas aujourd'hui, par choix (elle reste due et revient un autre jour) ; reporter avec motif empeche = empêché aujourd'hui (imprévu, malade, panne : neutre, elle sort du programme).
  - ajouter_note : une idée ou une chose à faire un autre jour. Une idée pour une praxis (« idée pour l'appli », « pour Magie ») : praxisId de cette praxis et rappel vrai, elle me sera rappelée au début de la prochaine séance. Une chose pour un autre jour : praxisId "", rappel vrai. Les idées vont dans le bloc-notes, jamais dans la mémoire.
  - retirer_note, note_rappelee, arreter_rappel.
  - modifier_praxis : seulement après mon accord explicite. duree et frequence en nombre de jours ou minutes (« 25 »), heure au format « 18h30 », importance : essentielle, utile ou bonus.
  - deplacer : changer l'heure d'une tâche du programme, pour aujourd'hui seulement (« mets Mouvement après le cinéma », « le sol à 17h ») : son id et la nouvelle heure (« 18h15 »), calculée d'après le programme et le contexte (la fin du cinéma, d'une absence, d'un rendez-vous). Pour tous les jours : modifier_praxis heure, après mon accord. Si je demande deux choses (« déplace Mouvement et je commence le rangement »), fais les deux actions.
  - commencer : quand je dis que j'ai commencé une tâche (« j'ai commencé le rangement il y a 45 minutes »), son id et l'heure de début (« 14h15 », calculée depuis l'heure du contexte). Une tâche « commencé à …, en cours » ne se redonne jamais comme à commencer : parle du temps qu'il reste.
  - mode_minimum, pause (jusquau au format AAAA-MM-JJ ; "" pour reprendre), statut (« je suis dehors » ; jusqua au format « 19h00 », ou "" pour la journée ; Auto pour revenir au statut déduit), minuteur (en minutes, quand je l'accepte), projets_semaine (identifiants des praxis choisies dimanche), barre_famille (quand j'accepte de relever ou de redescendre la barre des jours en famille).
- memoire : ce que tu retiens durablement de moi, en phrases courtes à la première personne, comme si je les écrivais (« Je fais mes courses au travail, en fin de service, 20 minutes au plus. »). Thèmes : Planning, Préférences, Habitudes, Forme.
  - Quand je t'apprends quelque chose de durable (une habitude, une préférence, une contrainte qui revient), ton message commence par « Je retiens : … » suivi de la phrase, puis « ? », avec les bulles Oui et Corriger ; memoire reste vide. À mon Oui, écris ce fait, tel quel. Si je dis « Retiens que… », écris-le directement.
  - Jamais un état passager (fatigue, humeur, ce soir, cette semaine) : il vaut pour aujourd'hui, pas pour toujours.
  - Une phrase générale (« le lundi… », « toujours », « jamais », « désormais », « je ne veux plus… ») est une préférence durable, pas une consigne pour aujourd'hui : d'abord « Je retiens : … ? », sans aucune action. Après mon Oui, écris le fait ; tu peux ensuite proposer de l'appliquer dès aujourd'hui.
  - Pas de doublon : modifie un fait existant (avec son id) plutôt que d'en ajouter un proche ; oublie un fait qui n'est plus vrai. Pour ajouter, id "".
  - Ne retiens pas l'anecdotique ni ce que l'application sait déjà (planning, praxis).`;

// ═══ Contexte envoyé à chaque échange ══════════
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const heureDe = (x) => `${x.getHours()}h${String(x.getMinutes()).padStart(2, '0')}`;
const dateCourte = (iso) => { const [, m, j] = iso.split('-'); return `${Number(j)}/${Number(m)}`; };
// Les projets choisis le dimanche soir valent pour la semaine qui vient (§5.10 point 2)
function lundiCible(maintenant = new Date()) {
  const l = new Date(maintenant);
  if (l.getDay() === 0) l.setDate(l.getDate() + 1);
  else l.setDate(l.getDate() - (l.getDay() - 1));
  return d.cleDate(l);
}
const TYPES = { piliers: 'pilier', routines: 'routine', taches: 'tâche', long: 'long cours', inactives: 'inactive' };
const NATURE = { pierre: 'longue', gravier: 'moyenne', sable: 'courte' };


function etatItem(t) {
  if (t.faite && t.enMinimum) return 'fait (petite version)';
  if (t.faite) return 'fait';
  if (t.reportee) return 'repoussée';
  return 'à faire';
}

// Ce que je dis d'une période difficile (pas d'une seule soirée) : « je dors mal depuis plusieurs jours », « ça va mal »
const PERIODE_DIFFICILE = /(plusieurs (jours|nuits|soirs)|depuis (des|quelques|plusieurs|une semaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|toute la semaine|dors mal|dormi mal|ça va mal|ça ne va pas|à bout|n'y arrive plus|plus la force|déprim|je craque)/i;

export function contexte(consigneLocale, maintenant = new Date(), { ouverture = true, dit = '' } = {}) {
  const date = d.cleDate(maintenant);
  const j = d.jourDuPlanning(maintenant);
  const { items, minimum, remonte, matinCourt, pause } = moteur.composer(maintenant);
  const l = [];
  l.push(`Nous sommes ${JOURS[maintenant.getDay()]} ${maintenant.getDate()} ${MOIS[maintenant.getMonth()]} ${maintenant.getFullYear()}, il est ${heureDe(maintenant)}. Semaine ${d.semaineDe(maintenant)} de la garde alternée${d.enVacancesScolaires(maintenant) ? ', vacances scolaires' : ''}.`);
  const man = d.cache.meta.statutManuel;
  l.push(`Statut : ${d.statut(maintenant)}${man && man.date === date ? ' (choisi par moi)' : ' (déduit du planning)'}.`);
  const travail = { journee: 'travail de 8h à 17h', matin: 'travail le matin, après-midi libre', aucun: 'repos' }[j.travail] || 'repos';
  const fille = plagesFamille(j).map(([de, a]) => `${de} à ${a}`).join(', ');
  l.push(`Ma journée : ${travail} ; ${fille ? `avec ma fille de ${fille}` : 'sans ma fille'} ; lever ${j.lever}, coucher ${j.coucher}${d.departDuJour(maintenant) ? `, départ ${d.departDuJour(maintenant)}` : ''}${j.note ? ` (précision : ${j.note})` : ''}.`);
  if (pause) l.push(`Praxeo est en pause jusqu'au ${dateCourte(d.cache.meta.pauseJusquau)} (série préservée).`);
  if (minimum) l.push(`Mode minimum jusqu'au ${dateCourte(d.cache.meta.modeMinimum.fin)} (plancher, pas plafond : si je veux faire plus, ajoute des tâches dues) : seulement les piliers en petite version, série gelée.`);
  else if (remonte) l.push(`Remontée après le mode minimum, jusqu'au ${dateCourte(moteur.remontee(date).fin)} : piliers en entier, autres routines en petite version, pas de longue séance. Série de nouveau comptée.`);
  else if (matinCourt && maintenant.getHours() < 12) l.push('Matin court : routines du matin en petite version.');
  // Les derniers jours, pour juger s'il faut proposer le mode minimum (§5.10 point 6)
  if (!minimum && !remonte) {
    const derniers = [];
    for (let i = 1; i <= 5; i++) { const x = new Date(maintenant); x.setDate(x.getDate() - i); const jj = d.cache.jours.get(d.cleDate(x)); if (jj && jj.niveau !== 'pause') derniers.push(jj.niveau === 2); }
    if (derniers.length) l.push(`5 derniers jours : l'essentiel fait ${derniers.filter(Boolean).length} sur ${derniers.length}.`);
    // 3 ratés sur 5 : la proposition est demandée explicitement, une seule fois par jour (déjà faite si la conversation du jour en parle)
    const rates = derniers.filter((x) => !x).length;
    const dejaPropose = conversation().some((t) => t.role === 'assistant' && /mode minimum/i.test(t.content));
    if (!dejaPropose && rates < 3 && PERIODE_DIFFICILE.test(dit)) l.push('À faire dans ce message : je viens de dire que la période est difficile ; propose le mode minimum (bulles Oui, Non), avec un mot simple et sans reproche. Ce sujet seul, pas de tâche dans ce message.');
    if (rates >= 3 && !dejaPropose) l.push(`À faire dans ce message : l'essentiel a été manqué ${rates} des ${derniers.length} derniers jours ; propose le mode minimum (bulles Oui, Non), sans reproche. Ce sujet seul, pas de tâche dans ce message.`);
  }
  l.push(`Série : ${moteur.serie()} jour(s) (record ${moteur.record()}). Joker de la semaine : ${moteur.jokerDeLaSemaine(maintenant) === 'utilise' ? 'déjà utilisé' : 'disponible'}. Barre des jours en famille : ${d.cache.meta.barreFamille === 'normale' ? 'piliers en version normale' : 'piliers en petite version'}.`);
  const niveau = d.cache.jours.get(date)?.niveau;
  l.push(`Aujourd'hui : ${niveau === 2 ? 'l\'essentiel est fait' : niveau === 1 ? 'commencé, l\'essentiel pas encore fait' : 'rien de validé pour l\'instant'}.`);
  if (consigneLocale) l.push(`Consigne locale : « ${consigneLocale} »`);
  l.push(`Maximes : ${d.reglage('maximes') ? 'activées' : 'désactivées'}.`);

  l.push('', 'Programme du jour (ordre chronologique) :');
  if (!items.length) l.push('- (rien)');
  for (const t of items) {
    const p = d.praxisParId(t.id);
    const bits = [`${t.heure} ${t.libelle} [${t.id}]`, `${t.duree} min`];
    if (t.pilier) bits.push('pilier');
    else if (p?.importance) bits.push(p.importance);
    if (t.minimum && p?.minimum) bits.push(`petite version : ${p.minimum}`);
    if (p && (p.section === 'taches' || p.section === 'long' || t.ponctuelle)) bits.push(p.section === 'long' ? 'longue' : NATURE[moteur.natureDe(p)]);
    const prec = p && t.type === 'routine' && !t.faite ? moteur.seancePrecedente(p, maintenant) : null;
    if (prec) bits.push(`séance précédente (${prec.jour} ${dateCourte(prec.date)}) ${prec.empechee ? 'empêchée' : 'non faite'}`);
    if (t.derniere !== undefined && t.derniere > 0) bits.push(`dernière fois il y a ${t.derniere} j`);
    if (t.butoir) bits.push(`avant ${t.butoir.libelle || 'une heure butoir'} à ${t.butoir.heure}`);
    if (t.enCours && !t.faite) bits.push(`commencé à ${t.heure}, en cours`);
    l.push(`- ${bits.join(' · ')} : ${etatItem(t)}`);
  }

  // Mémoire courte (22/11/2026) : les 3 derniers jours, tâche par tâche, pour répondre à « qu'est-ce que je n'ai pas fini hier ? »
  l.push('', 'Les 3 derniers jours (le journal fait foi) :');
  for (let i = 1; i <= 3; i++) {
    const x = new Date(maintenant); x.setDate(x.getDate() - i); x.setHours(23, 59, 0, 0);
    const cle = d.cleDate(x);
    const jj = d.cache.jours.get(cle);
    const nom = `${i === 1 ? 'hier, ' : ''}${JOURS[x.getDay()]} ${dateCourte(cle)}`;
    if (jj?.niveau === 'pause') { l.push(`- ${nom} : en pause.`); continue; }
    const essentiel = moteur.essentielDuJour(x);
    const ids = new Set(essentiel.map((t) => t.id));
    const etatT = (t) => (t.faite ? (t.enMinimum ? 'fait en petite version' : 'fait') : 'pas fait');
    const autres = [...new Set(d.cache.events.filter((e) => e.date === cle && (e.type === 'fait' || e.type === 'minimum') && !ids.has(e.praxisId))
      .map((e) => d.praxisParId(e.praxisId)?.libelle || e.ponctuelle).filter(Boolean))];
    const bilan = jj?.niveau === 2 ? 'l\'essentiel fait' : jj?.niveau === 1 ? 'en partie' : 'rien de validé';
    l.push(`- ${nom}${jj?.minimum ? ' (mode minimum)' : ''} : ${bilan}. Essentiel : ${essentiel.length ? essentiel.map((t) => `${t.libelle} ${etatT(t)}`).join(', ') : 'rien de prévu'}. Autres faits : ${autres.length ? autres.join(', ') : 'aucun'}.`);
  }

  l.push('', 'Bloc-notes :');
  if (!d.cache.notes.length) l.push('- (vide)');
  for (const n of d.cache.notes) {
    const p = n.praxisId && d.praxisParId(n.praxisId);
    l.push(`- « ${n.libelle} » [${n.id}]${p ? ` · idée pour ${p.libelle} [${p.id}]` : ''}${n.rappel ? ` · rappel actif${n.rappeleLe ? `, dernier rappel le ${dateCourte(n.rappeleLe)}` : ', jamais rappelée'}` : ''}`);
  }

  // Les 7 prochains jours, pour dater « dimanche », « demain », « mardi prochain » sans calcul
  const prochains = [];
  for (let i = 1; i <= 7; i++) { const x = new Date(maintenant); x.setDate(x.getDate() + i); prochains.push(`${i === 1 ? 'demain ' : ''}${JOURS[x.getDay()]} ${x.getDate()} ${MOIS[x.getMonth()]} = ${d.cleDate(x)}`); }
  l.push('', `Prochains jours : ${prochains.join(' ; ')}.`);
  const aVenir = d.cache.ponctuelles.filter((q) => q.date && q.date > date).sort((a, b) => a.date.localeCompare(b.date));
  if (aVenir.length) l.push(`Déjà prévu les prochains jours : ${aVenir.map((q) => `${q.libelle} le ${dateCourte(q.date)} [${q.id}]`).join(', ')}.`);

  const semaine = d.cache.meta.projetsSemaine;
  const choisis = semaine && semaine.lundi === lundiCible(maintenant);
  l.push('', choisis
    ? `Projets de la semaine : ${semaine.praxisIds.map((id) => d.praxisParId(id)?.libelle || id).join(', ')}.`
    : 'Projets de la semaine : pas encore choisis.');
  // Rendez-vous du dimanche soir (§5.10 point 2), reproposé le lundi : seulement à l'ouverture, en message à part
  // (jamais ajouté à la fin d'une autre réponse : un sujet par message, 20/11/2026)
  const rdv = !choisis && ((maintenant.getDay() === 0 && maintenant.getHours() >= 17) || maintenant.getDay() === 1);
  if (rdv && ouverture) l.push(maintenant.getDay() === 0
    ? 'Rendez-vous de la semaine : c\'est dimanche soir, ton message est uniquement la question de mes 2 ou 3 projets de la semaine.'
    : 'Rendez-vous de la semaine : les projets n\'ont pas été choisis dimanche ; ton message est uniquement cette question, posée une fois, sans insister ; si la consigne locale porte un rappel, c\'est le rappel qui passe, et la question attendra une autre ouverture.');
  else if (rdv) l.push('Rendez-vous de la semaine : pas encore choisis, mais ne pose pas la question dans cette réponse ; réponds seulement à ce que je dis. Si je te donne mes projets, enregistre-les.');

  l.push('', 'Bibliothèque des praxis :');
  for (const p of d.cache.praxis) {
    if (p.section === 'inactives') continue;
    const bits = [`${p.libelle} [${p.id}]`, TYPES[p.section] || p.section];
    if (p.duree) bits.push(`${p.duree} min`);
    if (p.section === 'taches') bits.push(NATURE[moteur.natureDe(p)]);
    if (p.frequence) bits.push(`tous les ${p.frequence} j`);
    if (p.heure) bits.push(`vers ${p.heure}`);
    if (p.importance) bits.push(p.importance);
    if (p.lieu) bits.push(p.lieu);
    if (p.presence && p.presence !== 'Les 2') bits.push(p.presence === 'Seul' ? 'sans ma fille' : 'avec ma fille');
    if (p.section === 'long') bits.push(`avancement ${p.progression ?? 0} %`);
    const der = d.derniereFois(p.id);
    if (der !== undefined) bits.push(der === 0 ? 'fait aujourd\'hui' : `dernière fois il y a ${der} j`);
    // ce qui se fait au travail (les courses) ne se propose pas pour le temps libre à la maison
    if ((p.lieu || '').toLowerCase() === 'travail') bits.push('se fait au travail, jamais à proposer à la maison');
    else if (p.section === 'taches' && moteur.urgenceTache(p, maintenant) >= 1) bits.push('due');
    if (p.jourDuMois) bits.push(`le ${p.jourDuMois} du mois, séances en plus possibles`);
    if (p.apres) bits.push(`à faire après : ${p.apres.toLowerCase()}`);
    if (p.mois) bits.push(`seulement en ${p.mois.map((x) => MOIS[x - 1]).join(', ')}`);
    if (p.horsMois) bits.push(`pause en ${p.horsMois.map((x) => MOIS[x - 1]).join(', ')}`);
    if (p.moment && p.section === 'taches') bits.push(`moment : ${p.moment}`);
    l.push(`- ${bits.join(' · ')}`);
  }

  l.push('', 'Ce que tu sais de moi :');
  if (!d.cache.memoire.length) l.push('- (rien encore)');
  for (const f of d.cache.memoire) l.push(`- [${f.id}] ${f.theme}, ${dateCourte(f.date)} : ${f.texte}`);

  // Jours en famille récents (§5.10 point 8) : pour proposer, ou non, de relever la barre
  const famille = [];
  for (let i = 1; i <= 14; i++) {
    const x = new Date(maintenant); x.setDate(x.getDate() - i);
    const jj = d.jourDuPlanning(x);
    if (!jj.famille) continue;
    const cle = d.cleDate(x);
    const faits = [...new Set(d.cache.events.filter((e) => e.date === cle && (e.type === 'fait' || e.type === 'minimum')).map((e) => (e.type === 'minimum' ? `${d.praxisParId(e.praxisId)?.libelle || e.ponctuelle || '?'} (min)` : d.praxisParId(e.praxisId)?.libelle || e.ponctuelle)))].filter(Boolean);
    famille.push(`- ${dateCourte(cle)} : ${faits.length ? faits.join(', ') : 'rien'}`);
  }
  if (famille.length) l.push('', 'Jours en famille, 2 dernières semaines (ce que j\'ai fait) :', ...famille);

  if (d.reglage('maximes')) l.push('', `Carnet de maximes : ${maximes.map(([m, a]) => `${m} (${a})`).join(' · ')}`);
  return l.join('\n');
}

// ═══ Conversation du jour ══════════════════════
function conversation() {
  const c = d.cache.meta.conversation;
  return c && c.date === d.aujourdhui() ? c.tours.slice() : [];
}
async function memoriser(tours) {
  let t = tours.slice(-MAX_TOURS);
  while (t.length && t[0].role !== 'user') t = t.slice(1);
  await d.ecrireMeta('conversation', { date: d.aujourdhui(), tours: t });
}

// ═══ Coûts (§9) ════════════════════════════════
const moisCourant = () => d.aujourdhui().slice(0, 7);
async function compter(r) {
  const couts = { ...(d.cache.meta.couts || {}) };
  const m = couts[moisCourant()] || { usd: 0, appels: 0 };
  couts[moisCourant()] = { usd: m.usd + r.cout, appels: m.appels + 1 };
  await d.ecrireMeta('couts', couts);
  await d.ecrireMeta('dernierCout', { usd: r.cout, modele: r.modele, duree: r.duree, date: new Date().toISOString() });
}
export const coutDuMois = () => (d.cache.meta.couts || {})[moisCourant()] || { usd: 0, appels: 0 };

// ═══ Demander une réponse ══════════════════════
// texte : ce que je dis ; null à l'ouverture de l'application.
// Renvoie { principal, autre? } ; autre est la réponse du second modèle en mode comparaison.
export async function demander(texte, { consigneLocale = '', surMessage, relance = false } = {}) {
  const cle = d.cleApi();
  if (!cle) throw new claude.ErreurClaude('Pas de clé API.', { type: 'cle' });
  const dit = texte ?? '(J\'ouvre Praxeo.)';
  let tours = conversation();
  // Relance (double toucher) : on retire le dernier échange et on redemande la même chose
  if (relance && tours.length >= 2 && tours[tours.length - 1].role === 'assistant') tours = tours.slice(0, -2);
  const messages = [...tours, { role: 'user', content: `<contexte>\n${contexte(consigneLocale, new Date(), { ouverture: texte == null, dit: texte || '' })}\n</contexte>\n\n${dit}` }];
  await d.ecrireMeta('dernierEnvoi', { texte, consigneLocale, date: d.aujourdhui() });

  const modele = d.reglage('modele') === 'Opus' ? 'Opus' : 'Haiku';
  const autreModele = modele === 'Opus' ? 'Haiku' : 'Opus';
  const systeme = [{ type: 'text', text: SYSTEME }];
  const appel = (m, flux) => claude.appeler({ cle, modele: m, systeme, messages, schema: SCHEMA, surMessage: flux })
    .then(async (r) => { r.json.actions = (r.json.actions || []).map(versAction); await compter(r); return r; });

  if (!globalThis.__comparaisonEssai) {   // mode comparaison retiré des Réglages (21/11/2026)
    const principal = await appel(modele, surMessage);
    return { principal, tours, dit };
  }
  const [a, b] = await Promise.allSettled([appel(modele, surMessage), appel(autreModele, null)]);
  if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
  return {
    principal: a.status === 'fulfilled' ? a.value : null,
    autre: b.status === 'fulfilled' ? b.value : null,
    erreurPrincipal: a.status === 'rejected' ? a.reason : null,
    erreurAutre: b.status === 'rejected' ? b.reason : null,
    tours, dit,
  };
}

// La réponse retenue entre dans la conversation du jour
export async function retenir(tours, dit, r) {
  await memoriser([...tours, { role: 'user', content: dit }, { role: 'assistant', content: r.texte }]);
  await d.ecrireMeta('dernierCoach', { texte: r.json.message, surbrillance: r.json.surbrillance || [], instant: Date.now(), date: d.aujourdhui() });
}

// À l'ouverture : le coach parle s'il ne l'a pas fait depuis une heure (§5.2)
export function doitParlerALouverture() {
  if (!disponible() || navigator.onLine === false) return false;
  const dc = d.cache.meta.dernierCoach;
  return !dc || dc.date !== d.aujourdhui() || Date.now() - dc.instant > DELAI_OUVERTURE;
}

// ═══ Appliquer ce que Claude a décidé ══════════
// Renvoie { annuler: async () => …, resume: ['…'], minuteur: minutes | null }
export async function appliquer(json, dit = '') {
  const defaire = [];
  const resume = [];
  let minuteur = null;
  const auj = d.aujourdhui();
  const existe = (id) => d.praxisParId(id);

  // Garde-fous (banc d'essai du 20/11/2026) : un repas, une pause ou la douche ne se retirent que si je le demande ;
  // « Je retiens : … ? » est une proposition, le fait ne s'écrit qu'au Oui.
  const accord = /^(oui|ok|d'accord|vas-y|go)\b/i.test(String(dit || '').trim());
  const demande = (re) => accord || re.test(String(dit || ''));
  const intouchable = (id) => (/^repas_/.test(id || '') && !demande(/repas|d[ée]jeuner|d[îi]ner|manger|souper/i))
    || (/^pause_/.test(id || '') && !demande(/pause/i))
    || (/^reserve_/.test(id || '') && !demande(/douche/i));
  const propose = /je retiens/i.test(json.message || '') && (json.message || '').includes('?');
  for (const a of json.actions || []) {
    if ((a.type === 'retirer_du_jour' || a.type === 'reporter') && intouchable(a.id)) continue;
    try {
      switch (a.type) {
        case 'ajouter_tache': {
          const p = a.praxisId && existe(a.praxisId);
          // Déplacée à un autre jour : les copies restées pour aujourd'hui (ou avant) disparaissent
          if (p && /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') && a.date > auj) {
            for (const vieille of d.cache.ponctuelles.filter((x) => x.praxisId === p.id && (x.date || auj) <= auj)) {
              await d.supprimerPonctuelle(vieille.id);
              defaire.push(() => d.restaurerPonctuelle(vieille));
            }
          }
          // « je vais faire… », « je commence… », « là je… » : c'est pour maintenant (22/11/2026 : la tâche partait en fin de journée)
          const mn = (h) => { const [hh, mm] = String(h).split('h').map(Number); return hh * 60 + (mm || 0); };
          const ici = new Date().getHours() * 60 + new Date().getMinutes();
          const pourMaintenant = (!a.heure || (/^\d{1,2}h\d{0,2}$/.test(a.heure) && Math.abs(mn(a.heure) - ici) <= 15)) && (!a.date || a.date <= auj) && /\b(je vais (faire|m'y mettre|me mettre)|je commence|je d[ée]bute|je d[ée]marre|je m'y mets|je me mets|là,? je|maintenant)\b/i.test(String(dit || ''));
          // l'heure de début aux 5 minutes les plus proches : dit à 14h03, la tâche commence à 14h05
          if (pourMaintenant) { const x = new Date(); const t5 = Math.round((x.getHours() * 60 + x.getMinutes()) / 5) * 5; a.heure = `${Math.floor(t5 / 60)}h${String(t5 % 60).padStart(2, '0')}`; }
          // une praxis de la bibliothèque que je commence maintenant : elle est commencée, pas recopiée (22/11/2026 : « je débute le rangement »)
          if (pourMaintenant && p) {
            const ev = await d.noter('commence', p.id, { heure: a.heure });
            defaire.push(() => d.supprimerEvenement(ev.id));
            resume.push(`${p.libelle} commencée à ${a.heure}`);
            break;
          }
          const q = await d.ajouterPonctuelle({
            libelle: a.libelle || p?.libelle || 'Tâche', duree: Math.max(1, a.duree || p?.duree || 20),
            date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') && a.date > auj ? a.date : auj,   // un autre jour (« fais-le dimanche », 21/11/2026)
            ...(a.heure && /^\d{1,2}h\d{0,2}$/.test(a.heure) ? { heure: a.heure.replace(/h$/, 'h00') } : {}),
            ...(p ? { praxisId: p.id, couleur: p.couleur } : {}), source: 'coach',
          });
          if (pourMaintenant) { const ev = await d.noter('commence', q.id, { heure: a.heure }); defaire.push(() => d.supprimerEvenement(ev.id)); }
          defaire.push(() => d.supprimerPonctuelle(q.id));
          resume.push(q.date === auj ? `${q.libelle} ajoutée` : `${q.libelle} prévue le ${dateCourte(q.date)}`);
          break;
        }
        case 'ajouter_au_programme': if (existe(a.praxisId)) { const ev = await d.noter('ajoute', a.praxisId); defaire.push(() => d.supprimerEvenement(ev.id)); } break;
        case 'reporter': { const ev = await d.noter(a.motif === 'empeche' ? 'empeche' : 'reporte', a.id); defaire.push(() => d.supprimerEvenement(ev.id)); break; }
        case 'retirer_du_jour': { const ev = await d.noter('retire', a.id); defaire.push(() => d.supprimerEvenement(ev.id)); break; }
        case 'annuler_validation': {
          const jour = new Date(); if (a.jour === 'hier') jour.setDate(jour.getDate() - 1);
          jour.setHours(a.jour === 'hier' ? 23 : jour.getHours(), a.jour === 'hier' ? 59 : jour.getMinutes(), 0, 0);
          const cleJ = d.cleDate(jour);
          const evs = d.cache.events.filter((e) => e.date === cleJ && e.praxisId === a.id && (e.type === 'fait' || e.type === 'minimum'));
          if (!evs.length) break;
          for (const e of evs) await d.supprimerEvenement(e.id);
          await moteur.majNiveauDuJour(jour);
          defaire.push(async () => { for (const e of evs) await d.restaurerEvenement(e); await moteur.majNiveauDuJour(jour); });
          resume.push(`${d.praxisParId(a.id)?.libelle || 'Tâche'} : validation retirée`);
          break;
        }
        case 'valider_hier': {
          if (!existe(a.id)) break;
          const hier = new Date(); hier.setDate(hier.getDate() - 1); hier.setHours(23, 59, 0, 0);
          const ev = await d.noter('fait', a.id, { date: d.cleDate(hier), heure: undefined, dureeReelle: undefined, source: 'coach' });
          await moteur.majNiveauDuJour(hier);   // la veille est recomptée, sans pénalité
          defaire.push(async () => { await d.supprimerEvenement(ev.id); await moteur.majNiveauDuJour(hier); });
          break;
        }
        case 'ajouter_note': {
          const n = await d.ajouterNote(a.texte, a.praxisId && existe(a.praxisId) ? a.praxisId : null, a.rappel ? { rappel: true } : {});
          defaire.push(() => d.supprimerNote(n.id));
          resume.push('note ajoutée');
          break;
        }
        case 'retirer_note': { const n = await d.supprimerNote(a.noteId); if (n) defaire.push(() => d.restaurerNote(n)); break; }
        case 'note_rappelee': await d.modifierNote(a.noteId, { rappeleLe: auj }); break;
        case 'arreter_rappel': { const n = await d.modifierNote(a.noteId, { rappel: false }); if (n) defaire.push(() => d.modifierNote(a.noteId, { rappel: true })); break; }
        case 'modifier_praxis': {
          const p = existe(a.praxisId);
          if (!p || !VALEURS.champ.includes(a.champ)) break;
          const avant = { ...p };
          let v = a.valeur;
          if (a.champ === 'duree' || a.champ === 'frequence') v = Math.max(1, Math.round(Number(String(v).replace(/[^\d.]/g, '')) || 0)) || undefined;
          if (a.champ === 'importance' && !['essentielle', 'utile', 'bonus'].includes(v)) break;
          if (v === undefined || v === '') break;
          await d.enregistrerPraxis({ ...p, [a.champ]: v });
          defaire.push(() => d.enregistrerPraxis(avant));
          resume.push(`${p.libelle} modifiée`);
          break;
        }
        case 'mode_minimum': {
          const avant = d.cache.meta.modeMinimum;
          if (a.actif) await moteur.demarrerModeMinimum(7); else await moteur.arreterModeMinimum();
          defaire.push(() => d.ecrireMeta('modeMinimum', avant));
          break;
        }
        case 'pause': {
          const avant = d.cache.meta.pauseJusquau;
          await d.ecrireMeta('pauseJusquau', /^\d{4}-\d{2}-\d{2}$/.test(a.jusquau) ? a.jusquau : null);
          defaire.push(() => d.ecrireMeta('pauseJusquau', avant));
          break;
        }
        case 'statut': {
          if (!VALEURS.statut.includes(a.valeur)) break;
          const avant = d.cache.meta.statutManuel;
          await d.ecrireMeta('statutManuel', a.valeur === 'Auto' ? null : { valeur: a.valeur, date: auj, jusqua: /^\d{1,2}h\d{2}$/.test(a.jusqua) ? a.jusqua : '23h59' });
          defaire.push(() => d.ecrireMeta('statutManuel', avant));
          break;
        }
        case 'minuteur': if (a.minutes > 0) minuteur = a.minutes; break;
        case 'commencer': {
          if (!existe(a.id) && !d.cache.ponctuelles.some((q) => q.id === a.id)) break;
          const ev = await d.noter('commence', a.id, /^\d{1,2}h\d{2}$/.test(a.heure || '') ? { heure: a.heure } : {});
          defaire.push(() => d.supprimerEvenement(ev.id));
          break;
        }
        case 'deplacer': {   // une heure pour aujourd'hui seulement (22/11/2026 : « Mouvement après le cinéma » restait en place)
          if (!existe(a.id) && !d.cache.ponctuelles.some((q) => q.id === a.id)) break;
          if (!/^\d{1,2}h\d{0,2}$/.test(a.heure || '')) break;
          const ev = await d.noter('deplace', a.id, { heure: a.heure.replace(/h$/, 'h00') });
          defaire.push(() => d.supprimerEvenement(ev.id));
          resume.push(`${(d.praxisParId(a.id) || d.cache.ponctuelles.find((q) => q.id === a.id)).libelle} à ${ev.heure}`);
          break;
        }
        case 'projets_semaine': {
          const avant = d.cache.meta.projetsSemaine;
          await d.ecrireMeta('projetsSemaine', { lundi: lundiCible(), praxisIds: a.praxisIds.filter(existe) });
          defaire.push(() => d.ecrireMeta('projetsSemaine', avant));
          break;
        }
        case 'barre_famille': {
          if (!VALEURS.niveau.includes(a.niveau)) break;
          const avant = d.cache.meta.barreFamille;
          await d.ecrireMeta('barreFamille', a.niveau);
          defaire.push(() => d.ecrireMeta('barreFamille', avant));
          break;
        }
        default: break;
      }
    } catch (e) {
      console.warn('[Praxeo] action du coach ignorée', a, e);
    }
  }

  for (const f of propose ? [] : json.memoire || []) {
    try {
      if (f.op === 'ajouter' && f.texte) {
        const n = await d.ajouterFait(THEMES.includes(f.theme) ? f.theme : 'Habitudes', f.texte);
        defaire.push(() => d.oublierFait(n.id));
        resume.push('retenu');
      } else if (f.op === 'modifier' && f.id) {
        const avant = d.cache.memoire.find((m) => m.id === f.id);
        if (!avant) continue;
        const copie = { ...avant };
        await d.modifierFait(f.id, { texte: f.texte || avant.texte, theme: THEMES.includes(f.theme) ? f.theme : avant.theme });
        defaire.push(() => d.restaurerFait(copie));
      } else if (f.op === 'oublier' && f.id) {
        const avant = await d.oublierFait(f.id);
        if (avant) defaire.push(() => d.restaurerFait(avant));
      }
    } catch (e) {
      console.warn('[Praxeo] fait ignoré', f, e);
    }
  }

  // le moteur recompte la journée (une tâche ajoutée, une validation d'hier…)
  await moteur.majNiveauDuJour();
  return {
    resume,
    minuteur,
    annuler: defaire.length ? async () => { for (const f of defaire.reverse()) await f(); await moteur.majNiveauDuJour(); } : null,
  };
}

// ═══ File d'attente hors ligne (§9.1) ══════════
export const fileAttente = () => d.cache.meta.fileAttente || [];
export async function mettreEnAttente(texte) { await d.ecrireMeta('fileAttente', [...fileAttente(), texte]); }
export async function viderFile() { const f = fileAttente(); await d.ecrireMeta('fileAttente', []); return f; }

// Message clair pour une erreur (jamais de jargon à l'écran)
export function expliquer(e) {
  if (e?.type === 'cle') return 'Pour que je te parle, ajoute ta clé API dans Réglages, IA et coûts.';
  if (e?.statut === 401 || e?.type === 'authentication_error') return 'Ta clé API est refusée. Vérifie-la dans Réglages, IA et coûts.';
  if (e?.statut === 403 || e?.type === 'permission_error') return 'Ta clé API n\'a pas accès à ce modèle. Vérifie-la dans la console Anthropic.';
  if (e?.statut === 402 || e?.type === 'billing_error') return 'Plus de crédit sur le compte API. Je reste en mode local en attendant.';
  if (e?.statut === 429) return 'Trop de demandes d\'un coup. Réessaie dans une minute (double toucher).';
  if (e?.statut === 529 || e?.statut >= 500) return 'Les serveurs de Claude sont saturés. Double toucher pour réessayer.';
  if (e?.reseau) return 'La connexion a coupé. Double toucher pour réessayer.';
  return 'Je n\'ai pas pu répondre. Double toucher pour réessayer.';
}
