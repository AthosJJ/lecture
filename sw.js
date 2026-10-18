/* Service worker de Lecture, portée limitée à son dossier (/lecture/).
   Ne garde que des fichiers de l'app : la coquille, le moteur OCR et les
   trois fichiers du SDK Firebase (versionnés, depuis le CDN officiel), sans
   lesquels l'app ne s'ouvrirait pas hors ligne. Jamais les requêtes vers
   Firebase (comptes, base de données), Google Books (recherche et images de
   couverture) ni le Wiktionnaire : elles vont toujours au réseau, et le
   hors-ligne des données passe par le cache de Firestore.
   À tester est servie sur le même domaine : on ne touche qu'aux caches
   « lecture-* ».
   Publier une version = incrémenter VERSION (et APP_VERSION dans app.js). */
const VERSION = 'lecture-v17';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './firebase.js',
  './account.js',
  './legacy.js',
  './importer.js',
  './covers.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  // Moteur OCR local (scan de citations), disponible hors ligne
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/lang/best_int/fra.traineddata.gz'
];

/* SDK Firebase, même version que firebase.js, account.js et db.js. */
const SDK = [
  'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache:'reload' : contourne le cache HTTP, pour ne jamais figer
    // une ancienne version d'un fichier dans le nouveau cache.
    caches.open(VERSION)
      .then((cache) => cache.addAll([...ASSETS, ...SDK].map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Seulement les anciens caches de Lecture : ceux d'À tester restent.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lecture-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // SDK Firebase : la copie gardée, sinon le réseau.
  if (SDK.includes(url.href)) {
    event.respondWith(caches.match(url.href, { cacheName: VERSION }).then((hit) => hit || fetch(request)));
    return;
  }

  // Tout le reste hors de l'app (Firebase, Wiktionnaire…) : réseau, jamais en cache.
  if (url.origin !== self.location.origin) return;

  // Navigation : index.html depuis le cache, réseau en secours.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { cacheName: VERSION }).then((cached) => cached || fetch(request))
    );
    return;
  }

  // Fichiers de l'app : cache d'abord, réseau en secours (gardé au passage).
  event.respondWith(
    caches.match(request, { cacheName: VERSION }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
