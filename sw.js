// @ts-check
/// <reference lib="webworker" />
// Service worker: caches the app (not the data) so it opens offline.
// Data is cached separately in localStorage; calls to api.github.com do not go through here.
// Bump VERSION when the SHELL list changes (content updates by itself: network first).

const VERSION = 'v11';
const CACHE = `compass-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './app/styles.css',
  './manifest.webmanifest',
  './app/app.js',
  './app/core/data.js',
  './app/core/store.js',
  './app/core/ui.js',
  './app/modules/index.js',
  './app/modules/goals/view.js',
  './app/modules/tasks/view.js',
  './app/modules/habits/view.js',
  './app/modules/books/view.js',
  './app/modules/journal/view.js',
  './app/views/areas.js',
  './app/views/home.js',
  './app/views/settings.js',
  './app/views/today.js',
  './app/views/habits.js',
  './app/views/books.js',
  './lib/goals.js',
  './lib/tasks.js',
  './lib/domains.js',
  './lib/today.js',
  './lib/habits.js',
  './lib/books.js',
  './lib/journal.js',
  './lib/crypt.js',
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

// Network first for the app (so you always see the latest version); cache if offline.
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
