/* ============================================================================
   Maven — Service Worker
   ----------------------------------------------------------------------------
   Strategy:
     • Install  : pre-cache the app shell (so the login page is reachable offline)
     • Activate : drop old caches, claim clients so the first load is controlled
     • Fetch    : network-first for HTML navigations, cache-first for everything
                  else, with a runtime fallback to the offline shell.
   Notes:
     • Caches are versioned (maven-cache-vN). Bump CACHE_NAME to invalidate.
     • The service worker scope is /Mavenstudio/ (the directory where this file
       lives) — that is why the URLs below are root-relative.
   ============================================================================ */

const CACHE_NAME    = 'maven-cache-v1';
const OFFLINE_URL   = './index.html';
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './icon/favicon-16x16.png',
    './icon/favicon-32x32.png',
    './icon/apple-touch-icon.png',
    './icon/appicon_192.png',
    './icon/appicon_512.png'
];

// ---------- Install ----------
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {
                // Some assets may legitimately be missing on first install;
                // addAll fails atomically only when one URL errors. Fall back
                // to per-URL adds so a single 404 does not break install.
                return Promise.all(
                    PRECACHE_URLS.map((url) =>
                        cache.add(url).catch((err) => {
                            console.warn('[SW] pre-cache skip:', url, err);
                        })
                    )
                );
            }))
            .then(() => self.skipWaiting())
    );
});

// ---------- Activate ----------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// ---------- Fetch ----------
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Only handle same-origin requests; let everything else pass through.
    if (url.origin !== self.location.origin) return;

    // Treat top-level navigations specially: network-first, offline-shell fallback.
    if (request.mode === 'navigate' || request.destination === 'document') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Update the offline shell copy opportunistically.
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(OFFLINE_URL, copy));
                    return response;
                })
                .catch(() => caches.match(OFFLINE_URL).then((cached) => cached || new Response(
                    '<!doctype html><meta charset="utf-8"><title>Maven offline</title>' +
                    '<body style="font-family:Inter,system-ui;background:#f0f9ff;color:#0c4a6e;' +
                    'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">' +
                    '<div style="text-align:center;padding:24px;border:1px solid rgba(14,165,233,.3);' +
                    'border-radius:18px;background:rgba(240,249,255,.65);backdrop-filter:blur(12px)">' +
                    '<div style="font:700 18px Playfair Display,serif;letter-spacing:.12em">MAVEN</div>' +
                    '<p style="margin:8px 0 0;color:#64748b">You are offline. Reconnect to continue.</p></div>',
                    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                )))
        );
        return;
    }

    // Static assets: cache-first, fall back to network, then store in cache.
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request)
                .then((response) => {
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => cached);
        })
    );
});

// ---------- Update notification ----------
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
