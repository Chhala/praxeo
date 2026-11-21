// PRAXEO v2 — accès à IndexedDB (lot 0, cahier des charges §11.1).
// Petite couche de promesses autour de l'API native ; aucune logique métier ici.

const NOM = 'praxeo';
const VERSION = 2;   // numéro de schéma : à incrémenter à chaque changement de structure
                     // v2 (lot 1) : magasin « ponctuelles » (tâches à faire une seule fois, §3.4)

// Magasins (stores) et leurs index
const SCHEMA = {
  praxis:   { keyPath: 'id' },
  events:   { keyPath: 'id', autoIncrement: true, index: [['date', 'date'], ['praxisId', 'praxisId']] },
  jours:    { keyPath: 'date' },     // niveau de chaque journée (historique, carte de chaleur)
  notes:    { keyPath: 'id' },       // bloc-notes
  ponctuelles: { keyPath: 'id' },    // tâches à faire une seule fois (§3.4) : hors bibliothèque
  memoire:  { keyPath: 'id' },       // ce que le coach sait de moi (§5.7)
  reglages: { keyPath: 'cle' },
  meta:     { keyPath: 'cle' },      // record, pause, initialisation, migration…
};
export const MAGASINS = Object.keys(SCHEMA);

let promesse = null;

export function ouvrir() {
  if (promesse) return promesse;
  promesse = new Promise((resoudre, rejeter) => {
    const req = indexedDB.open(NOM, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [nom, def] of Object.entries(SCHEMA)) {
        if (db.objectStoreNames.contains(nom)) continue;
        const store = db.createObjectStore(nom, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
        (def.index || []).forEach(([index, chemin]) => store.createIndex(index, chemin));
      }
    };
    req.onsuccess = () => resoudre(req.result);
    req.onerror = () => rejeter(req.error);
  });
  return promesse;
}

const enPromesse = (req) => new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); });
const finTransaction = (tx) => new Promise((ok, ko) => { tx.oncomplete = () => ok(); tx.onerror = () => ko(tx.error); tx.onabort = () => ko(tx.error); });

export async function tout(magasin) {
  const db = await ouvrir();
  return enPromesse(db.transaction(magasin).objectStore(magasin).getAll());
}

export async function lire(magasin, cle) {
  const db = await ouvrir();
  return enPromesse(db.transaction(magasin).objectStore(magasin).get(cle));
}

export async function parIndex(magasin, index, valeur) {
  const db = await ouvrir();
  return enPromesse(db.transaction(magasin).objectStore(magasin).index(index).getAll(valeur));
}

// Écrit un objet ou une liste d'objets ; renvoie la clé (ou les clés) écrites
export async function ecrire(magasin, objets) {
  const db = await ouvrir();
  const tx = db.transaction(magasin, 'readwrite');
  const store = tx.objectStore(magasin);
  const liste = Array.isArray(objets) ? objets : [objets];
  const cles = liste.map((o) => enPromesse(store.put(o)));
  await finTransaction(tx);
  const resultats = await Promise.all(cles);
  return Array.isArray(objets) ? resultats : resultats[0];
}

export async function supprimer(magasin, cle) {
  const db = await ouvrir();
  const tx = db.transaction(magasin, 'readwrite');
  tx.objectStore(magasin).delete(cle);
  return finTransaction(tx);
}

export async function vider(magasins = MAGASINS) {
  const db = await ouvrir();
  const tx = db.transaction(magasins, 'readwrite');
  magasins.forEach((m) => tx.objectStore(m).clear());
  return finTransaction(tx);
}
