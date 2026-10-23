// @ts-check
/// <reference lib="webworker" />
// Service worker: guarda la app (no los datos) para que abra sin conexión.
// Los datos se cachean aparte en localStorage; las llamadas a api.github.com no pasan por aquí.
// Sube VERSION cuando cambie la lista SHELL (el contenido se actualiza solo: red primero).

const VERSION = 'v5';
const CACHE = `compass-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './app/styles.css',
  './manifest.webmanifest',
  './app/app.js',
  './lib/goals.js',
  './lib/github.js',
  './lib/period.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('compass-') || k.startsWith('goals-')) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

// Red primero para la app (así ves siempre la última versión); caché si no hay red.
sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== sw.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) ?? (await caches.match('./index.html')) ?? Response.error()),
  );
});
