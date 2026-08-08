// Practex service worker — lets the app actually open with zero connectivity,
// instead of the browser just failing outright with no page to show at all.
//
// Deliberately NETWORK-FIRST, not cache-first: always try the real network
// first, and only fall back to a cached copy if that fails. A cache-first
// strategy risks silently serving a stale version of the app even when
// you're online and a newer one exists — this avoids that entirely.
//
// This only makes the PAGE SHELL (index.html, config.js) loadable offline.
// Your actual question library comes from a separate local-storage mirror
// (see persistLocalMirror()/loadLocalMirror() in index.html) — Supabase
// stays the source of truth when you have signal, the local mirror is the
// fallback when you don't.

const CACHE_NAME = 'practex-shell-v1';
const SHELL_URLS = ['index.html', 'config.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return; // never intercept POST/PUT/DELETE — those go straight to Supabase/ImgBB as normal

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase, ImgBB, or the CDN-hosted supabase-js/JSZip scripts
  if (url.pathname.startsWith('/api/')) return;     // never touch our own image-upload relay function

  event.respondWith(
    fetch(req)
      .then((res) => {
        // NETWORK-FIRST: always prefer the live response when online. Only
        // mirror a copy into the cache afterward, as a fallback for later.
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate') return caches.match('index.html'); // last resort: the shell itself
          return new Response('', { status: 504 });
        })
      )
  );
});
