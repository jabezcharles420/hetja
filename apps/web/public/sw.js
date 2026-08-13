/**
 * Hetja service worker.
 *
 * Responsibilities:
 *  1. Precache the app shell (/, /scan, /login, manifest, offline fallback) so
 *     the scan flow and key pages open with no connection.
 *  2. Network-first for the API (dog profile, medical, stories): a fresh copy
 *     wins, but a previously cached copy is served offline and flagged with
 *     `X-Hetja-Stale: 1`.
 *  3. Network-first for navigations, falling back to the cached route, then
 *     the cached root, then the branded /offline.html page.
 *  4. Stale-while-revalidate for the static shell (/_next CSS/JS, images) so
 *     the shell is cached after the first visit.
 *  5. On a Background Sync `hetja-feed-flush` event, wake any open tab so
 *     it can replay the IndexedDB feed queue; a closed-tab flush falls back to
 *     the flush-on-open path in lib/offline-queue.ts. Sync registration and
 *     the flush logic live in the lib, not here.
 *  6. Observes POST /api/v1/scans (feed logging) and signals open tabs on
 *     success so PwaBootstrap can ask for Web Push permission at the moment
 *     that earns it -- a feeder's first logged feed, never on page load
 *     (plan §3.3). The request itself passes straight through unchanged.
 *  7. Web Push: shows an incoming push and deep-links to the case on click
 *     (plan §3.4). Neither existed before this file -- there was no `push`
 *     or `notificationclick` listener at all.
 */

const CACHE = "hetja-shell-v1";
const API_PREFIX = "/api/v1";
const OFFLINE_URL = "/offline.html";
const SYNC_TAG = "hetja-feed-flush";

const SHELL_URLS = ["/", "/scan", "/login", OFFLINE_URL, "/manifest.webmanifest"];

const scope = self;

scope.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => scope.skipWaiting()),
  );
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => scope.clients.claim()),
  );
});

scope.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== scope.location.origin) return;

  // A successful feed log is the earned moment to ask for Web Push
  // permission (plan §3.3) -- observed here so it fires for the
  // offline-queue's replayed POST too, not just a live submit from an open
  // tab. The request itself is untouched either way.
  if (req.method === "POST" && url.pathname === `${API_PREFIX}/scans`) {
    event.respondWith(passThroughAndSignalFeedLogged(req));
    return;
  }

  if (req.method !== "GET") return;

  // Dog profile + medical (+ stories) fetches: fresh when online, stale cache offline.
  if (url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Page navigations: network-first with the offline fallback page as a last resort.
  if (req.mode === "navigate") {
    event.respondWith(navigationFirst(req));
    return;
  }

  // Static shell (/_next CSS/JS, images, manifest): stale-while-revalidate.
  event.respondWith(shellFirst(req));
});

/** Network-first: fresh response cached, stale copy served offline when the fetch fails. */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) void cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (!cached) return Response.error();
    const headers = new Headers(cached.headers);
    headers.set("X-Hetja-Stale", "1");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
}

/** Network-first for navigations with cache → root → offline.html fallbacks. */
async function navigationFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) {
      void cache.put(req, res.clone());
      return res;
    }
    throw new Error(`navigation fetch failed: ${res.status}`);
  } catch {
    const cached = await cache.match(req).catch(() => undefined);
    if (cached) return cached;
    const root = await cache.match("/").catch(() => undefined);
    if (root) return root;
    return (await cache.match(OFFLINE_URL).catch(() => undefined)) ?? Response.error();
  }
}

/** Stale-while-revalidate for static shell assets. */
async function shellFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req).catch(() => undefined);
  const fresh = fetch(req)
    .then(async (res) => {
      if (res.ok) void cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    void fresh;
    return cached;
  }
  return (await fresh) ?? Response.error();
}

/** Passes a feed-log POST straight through; signals open tabs only on success. */
async function passThroughAndSignalFeedLogged(req) {
  const res = await fetch(req);
  if (res.ok) void notifyClients({ type: "HETJA_FEED_LOGGED" });
  return res;
}

/** Wake open tabs so they can replay the feed queue. */
async function wakeClientsToFlush() {
  await notifyClients({ type: "HETJA_FLUSH" });
}

async function notifyClients(message) {
  const clients = await scope.clients.matchAll({ type: "window" });
  await Promise.all(clients.map((client) => client.postMessage(message)));
}

scope.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    wakeClientsToFlush().catch(() => undefined),
  );
});

/**
 * Web Push (plan §3.4). Payload is JSON: { title, body, caseId, url }. The
 * `url` may point at a case page that does not exist yet -- the click
 * behavior below is correct today regardless, and needs no further
 * service-worker change once that page ships.
 */
scope.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Hetja SOS";
  const options = {
    body: data.body || "A nearby dog needs help.",
    tag: data.caseId ? `sos-${data.caseId}` : undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(scope.registration.showNotification(title, options));
});

scope.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    scope.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(targetUrl) && "focus" in client) return client.focus();
      }
      return scope.clients.openWindow(targetUrl);
    }),
  );
});

scope.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void scope.skipWaiting();
  }
});
