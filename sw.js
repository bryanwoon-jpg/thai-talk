// Thai Talk service worker: precaches the whole app so lessons work offline once installed.
// Set CACHE_VERSION to the date (YYYY-MM-DD, add -2, -3 for extra same-day releases) whenever any file in ASSETS changes.
const CACHE_VERSION = '2026-11-22';
const CACHE = `thai-talk-${CACHE_VERSION}`;

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/fonts.css',
  '/css/styles.css',
  '/js/content.js',
  '/js/app.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/fonts/mitr-latin-400-normal.woff2',
  '/fonts/mitr-latin-500-normal.woff2',
  '/fonts/mitr-latin-600-normal.woff2',
  '/fonts/mitr-latin-ext-400-normal.woff2',
  '/fonts/mitr-latin-ext-500-normal.woff2',
  '/fonts/mitr-latin-ext-600-normal.woff2',
  '/fonts/mitr-thai-400-normal.woff2',
  '/fonts/mitr-thai-500-normal.woff2',
  '/fonts/mitr-thai-600-normal.woff2',
  '/fonts/prompt-latin-400-normal.woff2',
  '/fonts/prompt-latin-500-normal.woff2',
  '/fonts/prompt-latin-600-normal.woff2',
  '/fonts/prompt-latin-ext-400-normal.woff2',
  '/fonts/prompt-latin-ext-500-normal.woff2',
  '/fonts/prompt-latin-ext-600-normal.woff2',
  '/fonts/prompt-thai-400-normal.woff2',
  '/fonts/prompt-thai-500-normal.woff2',
  '/fonts/prompt-thai-600-normal.woff2',
  '/fonts/sarabun-latin-400-normal.woff2',
  '/fonts/sarabun-latin-500-normal.woff2',
  '/fonts/sarabun-latin-600-normal.woff2',
  '/fonts/sarabun-thai-400-normal.woff2',
  '/fonts/sarabun-thai-500-normal.woff2',
  '/fonts/sarabun-thai-600-normal.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('thai-talk-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first so updates land quickly, cached copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    );
    return;
  }

  // Everything else: cache first, refresh in the background.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
