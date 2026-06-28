// handmux service worker — single purpose: replace the browser's own cold-launch network-error
// page (e.g. Chromium's ERR_NETWORK_CHANGED white screen) with our offline fallback, then let the
// page auto-retry into the real app once the network is ready. It caches EXACTLY one immutable file
// (offline.html) and NEVER caches app code or /api — every launch fetches the latest app from the
// network, so deploys always take effect (no stale-shell trap).
// See docs/superpowers/specs/2026-06-04-cold-launch-offline-shell-design.md
const CACHE = 'tmw-offline-v1';
const OFFLINE_URL = '/offline.html';
// Web Share Target intake: a shared file arrives as a POST navigation to /share-target. We can't hand
// a File to the page across the redirect, so we stash it in this cache; the page consumes it on boot
// (see src/shareIntake.js — these two constants MUST match its SHARE_CACHE / SHARE_PREFIX).
const SHARE_CACHE = 'tmw-share-v1';
const SHARE_PREFIX = '/__share__/';
const SHARE_ACTION = '/share-target';

self.addEventListener('install', (event) => {
  // skipWaiting is chained AFTER the cache write so we never activate before offline.html is cached.
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Keep both our caches: the offline shell AND any pending share (a file shared just before an SW
  // update must survive until the page consumes it). Drop everything else.
  const KEEP = new Set([CACHE, SHARE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stash a shared file, then redirect into the app with ?share so it knows to pick it up. The File
// can't ride the redirect, so we cache it under SHARE_PREFIX+name (the name rides the key; the type
// rides the cached Response's Content-Type). Failures still redirect — the page just finds nothing.
async function handleShareTarget(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('file').filter((f) => f && typeof f.name === 'string');
    if (files.length) {
      const cache = await caches.open(SHARE_CACHE);
      for (const k of await cache.keys()) await cache.delete(k); // keep only the latest share
      const f = files[0];
      await cache.put(
        SHARE_PREFIX + encodeURIComponent(f.name || 'shared'),
        new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }),
      );
    }
  } catch { /* fall through to the redirect; the page finds no pending file and carries on */ }
  return Response.redirect('/?share=1', 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Web Share Target POST — intercept before the navigation guard below (a share POST IS a navigate).
  if (req.method === 'POST' && new URL(req.url).pathname === SHARE_ACTION) {
    event.respondWith(handleShareTarget(req));
    return;
  }
  // Only guard top-level navigations. Everything else (JS/CSS/fonts/icons and /api) falls through
  // to the browser's default network handling — the SW neither caches nor intercepts it.
  if (req.mode !== 'navigate') return;
  // Network-first: a normal launch gets the freshest index.html; only when the fetch REJECTS (the
  // radio-wakeup transient that makes the browser show its error page) do we serve the offline page.
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
});

// --- Web Push ---------------------------------------------------------------------------------
// Show a notification for each push. `tag` collapses repeats: a second push with the same tag
// REPLACES the visible notification instead of stacking, so a given pane never shows a pile of
// stale alerts. iOS requires us to actually show something on every push, which we always do.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'handmux', {
    body: d.body || '',
    tag: d.tag || 'handmux',
    renotify: false,
    // icon = the large right-side logo. We MUST set it: HyperOS/MIUI always reserves that slot, and an
    // empty `icon` makes it back-fill the slot with the PWA's own icon at a stray size (the `>` reads as
    // a lone "v") plus leaves a gap. An explicit app icon fills the slot cleanly.
    icon: '/icons/icon-192.png',
    // badge = the small monochrome status-bar icon. Android reads only its ALPHA and tints the
    // silhouette; an opaque image (icon-192 has no alpha) can't be used, so it falls back to the
    // browser's own Chrome logo. badge-96.png is a white `>▮` silhouette on transparent → our mark.
    badge: '/icons/badge-96.png',
    data: d.data || {},
  }));
});

// Tapping the notification deep-links to the pane: focus an open client (and tell it where to go),
// or open a new window at the deep-link hash.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const e = encodeURIComponent;
  const url = d.session
    ? `/#/s/${e(d.session)}/w/${e(d.window || '')}/p/${e(d.pane || '')}`
    : '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => 'focus' in c);
    if (open) {
      await open.focus();
      // Prefer navigate(): it changes the client URL, so the target survives even a backgrounded tab
      // the browser discarded (it reloads into the deep-link hash, which the boot effect reads).
      // postMessage is a fallback for engines without WindowClient.navigate. URL format MUST match
      // hashRoute.readRoute()/buildDeepLink.
      if ('navigate' in open) { try { await open.navigate(url); return; } catch { /* fall back ↓ */ } }
      open.postMessage({ type: 'navigate', session: d.session, window: d.window, pane: d.pane });
      return;
    }
    return self.clients.openWindow(url);
  })());
});
