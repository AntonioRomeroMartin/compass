// @ts-check
/// <reference lib="webworker" />
// Service worker: caches the app (not the data) so it opens offline.
// Data is cached separately in localStorage; calls to api.github.com do not go through here.
// One cache under a fixed name, with no version to bump: the app is fetched network first (so it is always the
// latest), the cache only serves it offline. A change to SHELL changes this file, so the browser installs it again,
// which caches the new list and drops what left it (tests/sw.test.mjs checks the list is complete).

const CACHE = 'compass-shell';
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

/** Full URLs of SHELL: only these are kept in the cache. */
const KEEP = new Set(SHELL.map((p) => new URL(p, sw.location.href).href));

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => sw.skipWaiting()));
});

/** Removes the caches of older versions (compass-v13, goals-…) and the files that are no longer in SHELL. */
async function prune() {
  for (const k of await caches.keys()) if ((k.startsWith('compass-') || k.startsWith('goals-')) && k !== CACHE) await caches.delete(k);
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) if (!KEEP.has(req.url)) await cache.delete(req);
}

sw.addEventListener('activate', (event) => {
  event.waitUntil(prune().then(() => sw.clients.claim()));
});

// Network first for the app (so you always see the latest version); the SHELL files are refreshed in the cache
// for when there is no network.
sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== sw.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && KEEP.has(req.url)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) ?? (await caches.match('./index.html')) ?? Response.error()),
  );
});
