// PRAXEO v2 — service worker : l'application s'ouvre même sans réseau (lot 0).
// Stratégie « réseau d'abord » : en ligne, on prend toujours la dernière version (et on la met en cache) ;
// hors ligne, on sert la copie en cache. À chaque nouvelle publication, augmenter VERSION.
// « Dernière version » au sens strict : on contourne le cache HTTP du navigateur (GitHub Pages le garde 10 minutes),
// sinon une mise à jour publiée pouvait mettre jusqu'à 10 minutes à arriver sur l'iPhone (21/11/2026).

const VERSION = 'praxeo-v2-064';
const COQUILLE = [
  './',
  './index.html',
  './manifest.json',
  './css/praxeo.css',
  './js/app.js',
  './js/db.js',
  './js/donnees.js',
  './js/estimations.js',
  './js/contenu.js',
  './js/moteur.js',
  './js/consignes.js',
  './js/annuler.js',
  './js/claude.js',
  './js/coach.js',
  './js/feuille.js',
  './js/minuteur.js',
  './js/praxis.js',
  './js/stats.js',
  './js/reglages.js',
  './assets/couronne.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './assets/sons/plume.mp3',
  './assets/fonts/cinzel-latin.woff2',
  './assets/fonts/marcellus-latin.woff2',
];
// Jamais mis en cache : l'ancienne version et les dossiers de travail
const EXCLUS = ['/_v1/', '/conception/', '/_outils/', '/_stuff/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k.startsWith('praxeo-v2-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // l'API Claude (lot 4) n'est jamais mise en cache
  if (EXCLUS.some((d) => url.pathname.includes(d))) return;
  e.respondWith(
    // une page (navigation) ne peut pas être recopiée avec d'autres options : on la redemande par son adresse
    (req.mode === 'navigate' ? fetch(url.href, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' }))
      .then((rep) => {
        if (rep.ok) { const copie = rep.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); }
        return rep;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
  );
});
