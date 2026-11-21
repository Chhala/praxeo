// PRAXEO v2 — appel direct à l'API Claude (lot 4, choix du 19/11/2026 : sans bibliothèque).
// L'appel part du téléphone vers Anthropic avec ma clé (§9). Réponse en flux (effet machine à écrire),
// au format JSON imposé par un schéma. Nouvelles tentatives quand les serveurs sont saturés.

const URL_API = 'https://api.anthropic.com/v1/messages';
const VERSION_API = '2026-10-21';

// Modèles et tarifs (dollars par million de jetons, relevés le 19/11/2026)
export const MODELES = {
  Haiku: { id: 'claude-haiku-5-5', entree: 0.10, sortie: 0.50, ecritureCache: 0.125, lectureCache: 0.01 },
  Opus:  { id: 'claude-opus-5-5',  entree: 4,    sortie: 20,   ecritureCache: 5,     lectureCache: 0.20 },
};

// Codes qui valent une nouvelle tentative : trop de demandes, panne passagère, serveurs saturés
const A_RETENTER = new Set([429, 500, 502, 503, 504, 529]);
const ATTENTES = [2000, 5000];   // deux nouvelles tentatives, espacées

export class ErreurClaude extends Error {
  constructor(message, { statut = 0, type = '', reseau = false } = {}) {
    super(message);
    this.statut = statut;
    this.type = type;
    this.reseau = reseau;
  }
}

// Coût d'un appel en dollars, d'après l'usage renvoyé par l'API
export function cout(nomModele, u) {
  const t = MODELES[nomModele];
  if (!t || !u) return 0;
  return ((u.input_tokens || 0) * t.entree
    + (u.cache_creation_input_tokens || 0) * t.ecritureCache
    + (u.cache_read_input_tokens || 0) * t.lectureCache
    + (u.output_tokens || 0) * t.sortie) / 1e6;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// appeler({ cle, modele: 'Haiku' | 'Opus', systeme, messages, schema, surMessage })
// surMessage(texte) est appelé à chaque morceau reçu, avec le champ « message » du JSON en cours d'écriture.
// Renvoie { json, texte, usage, cout, duree, modele }.
export async function appeler({ cle, modele, systeme, messages, schema, surMessage, maxJetons }) {
  const m = MODELES[modele];
  if (!m) throw new ErreurClaude(`Modèle inconnu : ${modele}`);
  const corps = {
    model: m.id,
    max_tokens: maxJetons || 6000,
    stream: true,
    cache_control: { type: 'ephemeral' },   // le début de la demande (consignes, conversation) est mis en cache
    system: systeme,
    messages,
    // Haiku réfléchit avant de répondre, effort moyen : sans réflexion, il agissait de travers (banc d'essai du 20/11/2026).
    // Opus réfléchit toujours ; l'effort bas lui suffit.
    output_config: { effort: modele === 'Haiku' ? 'medium' : 'low', format: { type: 'json_schema', schema } },
  };
  if (modele === 'Haiku') corps.thinking = { type: 'adaptive' };

  const debut = performance.now();
  for (let essai = 0; ; essai++) {
    try {
      const r = await lireFlux(cle, corps, surMessage);
      const json = analyser(r.texte, r.stop);
      return { json, texte: r.texte, usage: r.usage, cout: cout(modele, r.usage), duree: Math.round(performance.now() - debut), modele };
    } catch (e) {
      const retenter = (e.reseau && navigator.onLine !== false) || A_RETENTER.has(e.statut);
      if (!retenter || essai >= ATTENTES.length || e.dejaCommence) throw e;
      await pause(ATTENTES[essai]);
    }
  }
}

async function lireFlux(cle, corps, surMessage) {
  let rep;
  try {
    rep = await fetch(URL_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cle,
        'anthropic-version': VERSION_API,
        'anthropic-dangerous-direct-browser-access': 'true',   // appel depuis le navigateur, avec ma propre clé
      },
      body: JSON.stringify(corps),
    });
  } catch {
    throw new ErreurClaude('Pas de réseau.', { reseau: true });
  }
  if (!rep.ok) {
    let type = '', message = '';
    try { const e = await rep.json(); type = e.error?.type || ''; message = e.error?.message || ''; } catch { /* corps illisible */ }
    throw new ErreurClaude(message || `Erreur ${rep.status}`, { statut: rep.status, type });
  }

  const lecteur = rep.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = '', texte = '', stop = '', usage = {};
  let dernierMessage = '';
  for (;;) {
    let morceau;
    try {
      morceau = await lecteur.read();
    } catch {
      const e = new ErreurClaude('Connexion coupée pendant la réponse.', { reseau: true });
      e.dejaCommence = !!texte;   // une réponse déjà affichée en partie n'est pas relancée en silence
      throw e;
    }
    if (morceau.done) break;
    tampon += decodeur.decode(morceau.value, { stream: true });
    let fin;
    while ((fin = tampon.indexOf('\n\n')) >= 0) {
      const evenement = tampon.slice(0, fin);
      tampon = tampon.slice(fin + 2);
      const ligne = evenement.split('\n').find((l) => l.startsWith('data:'));
      if (!ligne) continue;
      let d;
      try { d = JSON.parse(ligne.slice(5).trim()); } catch { continue; }
      if (d.type === 'message_start') usage = { ...usage, ...(d.message?.usage || {}) };
      else if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') {
        texte += d.delta.text;
        if (surMessage) {
          const m = extraireChaine(texte, 'message');
          if (m !== dernierMessage) { dernierMessage = m; surMessage(m); }
        }
      } else if (d.type === 'message_delta') {
        if (d.delta?.stop_reason) stop = d.delta.stop_reason;
        usage = { ...usage, ...(d.usage || {}) };
      } else if (d.type === 'error') {
        const e = new ErreurClaude(d.error?.message || 'Erreur pendant la réponse.', { type: d.error?.type || '', statut: d.error?.type === 'overloaded_error' ? 529 : 0 });
        e.dejaCommence = !!texte;
        throw e;
      }
    }
  }
  return { texte, stop, usage };
}

function analyser(texte, stop) {
  if (stop === 'refusal') throw new ErreurClaude('Le modèle a refusé de répondre.', { type: 'refusal' });
  try {
    return JSON.parse(texte);
  } catch {
    // réponse tronquée (limite de longueur) : on garde au moins le message
    const message = extraireChaine(texte, 'message');
    if (message) return { message, surbrillance: [], reponses: [], actions: [], memoire: [] };
    throw new ErreurClaude(stop === 'max_tokens' ? 'Réponse trop longue, coupée.' : 'Réponse illisible.');
  }
}

// Lit la valeur d'une chaîne JSON encore incomplète : "message":"Pouss… → « Pouss… »
export function extraireChaine(json, cle) {
  const m = new RegExp(`"${cle}"\\s*:\\s*"`).exec(json);
  if (!m) return '';
  let s = '';
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') break;
    if (c !== '\\') { s += c; continue; }
    const n = json[i + 1];
    if (n === undefined) break;
    if (n === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      s += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      s += { n: '\n', t: '\t', r: '', b: '', f: '' }[n] ?? n;
      i += 1;
    }
  }
  return s;
}
