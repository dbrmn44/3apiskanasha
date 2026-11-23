/* Евробюджет service worker. Lives at /3apiskanasha/sw.js, so its scope is /3apiskanasha/.
   - The page (index.html): network first, revalidated (no-cache), so a new version shows on the next open.
     The saved copy is used only when there is no network or it is very slow.
   - Same-origin static files (manifest, icons): saved copy first, refreshed in the background.
   - Pinned Firebase SDK modules (www.gstatic.com/firebasejs/<x.y.z>/...): saved copy first; these URLs never change.
   - Everything else (Firestore, Google sign-in, token refresh, fonts, reCAPTCHA, ...) is NOT touched:
     no respondWith, so the browser handles it exactly as if there were no service worker. */
const VERSION = 'v1';                       // change this line whenever this file or the icons change
const SHELL = 'eb-shell-' + VERSION;
const SDK = 'eb-sdk-' + VERSION;
const SCOPE = new URL('./', self.location).href;
const SCOPE_PATH = new URL(SCOPE).pathname;
const CORE = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const SDK_RE = /^https:\/\/www\.gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-[a-z-]+\.js$/;
const NET_TIMEOUT = 4000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all([SCOPE, ...CORE].map(u =>
      cache.add(new Request(new URL(u, SCOPE).href, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('eb-') && name !== SHELL && name !== SDK) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (!url.pathname.startsWith(SCOPE_PATH)) return;      // other repos on this github.io host
    if (req.mode === 'navigate') return onPage(event, url);
    return onStatic(event);
  }
  const m = SDK_RE.exec(req.url);
  if (m) return onSdk(event, m[1]);
});

function isAppPage(url) {
  return url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html';
}

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Евробюджет</title><body style="font-family:system-ui,sans-serif;margin:0;padding:24px;background:#EDF0F4;color:#172131">' +
    '<p>Нет интернета, а сохранённой копии сайта на этом устройстве пока нет.</p>' +
    '<p>Подключитесь к сети и обновите страницу.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function onPage(event, url) {
  let saving = Promise.resolve();
  const network = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res.ok && res.type === 'basic' && !res.redirected && isAppPage(url)) {
      const copy = res.clone();
      saving = caches.open(SHELL).then(c => c.put(SCOPE, copy));
    }
    return res;
  });
  event.waitUntil(network.then(() => saving).catch(() => {}));
  const saved = () => caches.match(SCOPE, { cacheName: SHELL });
  const slow = new Promise(r => setTimeout(r, NET_TIMEOUT)).then(async () => (await saved()) || network);
  event.respondWith((async () => {
    try {
      const res = await Promise.race([network, slow]);
      if (res.status >= 500) return (await saved()) || res;
      return res;
    } catch (e) {
      return (await saved()) || offlinePage();
    }
  })());
}

function onStatic(event) {
  const req = event.request;
  let saving = Promise.resolve();
  const network = fetch(req).then(res => {
    if (res.ok && res.type === 'basic' && !res.redirected) {
      const copy = res.clone();
      saving = caches.open(SHELL).then(c => c.put(req, copy));
    }
    return res;
  });
  event.waitUntil(network.then(() => saving).catch(() => {}));
  event.respondWith(caches.match(req, { cacheName: SHELL }).then(hit => hit || network));
}

function onSdk(event, version) {
  const req = event.request;
  event.respondWith((async () => {
    const cache = await caches.open(SDK);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (res.type === 'cors' || res.type === 'basic')) {
      await cache.put(req, res.clone());
      for (const k of await cache.keys()) {
        const m = SDK_RE.exec(k.url);
        if (m && m[1] !== version) await cache.delete(k);
      }
    }
    return res;
  })());
}

/* EMERGENCY KILL SWITCH: if this worker ever needs removing, replace this whole file with:
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('eb-')) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
*/
