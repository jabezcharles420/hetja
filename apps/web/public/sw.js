/**
 * StrayNet Feeder service worker.
 *
 * Responsibilities:
 *  1. Cache the app shell for offline use (network-first).
 *  2. Cache dog profile GETs (network-first) so the collar profile works
 *     offline and serves a stale copy flagged with X-StrayNet-Stale: 1.
 *  3. On a Background Sync `straynet-feed-flush` event, wake any open tab so
 *     it can replay the IndexedDB feed queue; a closed-tab flush falls back to
 *     the flush-on-open path in lib/offline-queue.ts.
 */

const CACHE = "straynet-feeder-shell-v1";
const API_PREFIX = "/api/v1";
const SYNC_TAG = "straynet-feed-flush";

const scope = self;

scope.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest"]))
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
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== scope.location.origin) return;
  if (url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(shellFirst(req));
});

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
    headers.set("X-StrayNet-Stale", "1");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
}

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
  if (req.mode === "navigate") {
    const root = await cache.match("/").catch(() => undefined);
    if (root) {
      void fresh;
      return root;
    }
  }
  return (await fresh) ?? Response.error();
}

/** Wake open tabs so they can replay the feed queue. */
async function wakeClientsToFlush() {
  const clients = await scope.clients.matchAll({ type: "window" });
  await Promise.all(
    clients.map((client) => client.postMessage({ type: "STRAYNET_FLUSH" })),
  );
}

scope.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    wakeClientsToFlush().catch(() => undefined),
  );
});

scope.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void scope.skipWaiting();
  }
});
