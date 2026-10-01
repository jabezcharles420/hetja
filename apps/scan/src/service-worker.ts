import { flushQueue } from "./flush";
import { recordDroppedFeed } from "./dropped";

// The build (scripts/build.mjs) replaces __SCAN_VERSION__ with a hash of
// the page and its scripts, so every deploy is a new worker with a new cache,
// and the page asks for /d/main.js?v=<that hash>. Until 2026-10-01 the cache
// name was bumped by hand and the page and main.js were served cache-first,
// so a returning visitor got the previous build once after every deploy, and
// could get old HTML with a new main.js.
const VERSION = "__SCAN_VERSION__";
const CACHE = `scan-shell-${VERSION}`;
/** How long a page load waits for the network before the cached page is shown. */
const PAGE_WAIT_MS = 3000;
const API_PREFIX = "/api/v1";
const SYNC_TAG = "log-feed";

const scope = self as unknown as ServiceWorkerGlobalScope;
const BASE = new URL("./", scope.location.href).href;

scope.addEventListener("install", (ev: ExtendableEvent) => {
  ev.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([BASE, `${BASE}main.js?v=${VERSION}`]))
      .then(() => scope.skipWaiting()),
  );
});

scope.addEventListener("activate", (ev: ExtendableEvent) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => scope.clients.claim()),
  );
});

scope.addEventListener("fetch", (ev: FetchEvent) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== scope.location.origin) return;
  if (url.pathname.startsWith(API_PREFIX)) {
    ev.respondWith(networkFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    ev.respondWith(pageFirst(req));
    return;
  }
  // A versioned script never changes at its URL; anything else (the font).
  ev.respondWith(url.search.includes("v=") ? cacheFirst(req) : shellFirst(req));
});

/**
 * The page: the network's when it answers within PAGE_WAIT_MS, else the
 * cached one (a weak signal on a street must not mean a blank screen), and
 * the cached one offline. The page is one file for every /d/<slug>, so it is
 * kept once, under BASE. A cached page asks for its own versioned main.js,
 * which is in the same cache: old and new never mix.
 */
async function pageFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const fresh = fetch(req).then((res) => {
    if (res.ok) void cache.put(BASE, res.clone());
    return res;
  });
  const cached = await cache.match(BASE).catch(() => undefined);
  if (!cached) return fresh.catch(() => Response.error());
  const late = new Promise<Response>((r) => setTimeout(() => r(cached), PAGE_WAIT_MS));
  return Promise.race([fresh.catch(() => cached), late]);
}

async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req).catch(() => undefined);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) void cache.put(req, res.clone());
  return res;
}

// INVARIANT: medical/vaccination fields travel through /api/v1/dogs/*, which
// is covered by API_PREFIX above and therefore always network-first. A
// cached vaccination status is only ever served when the network request
// itself fails, and even then it is tagged X-Hetja-Stale so the UI can
// say so: it must never be presented as current.
async function networkFirst(req: Request): Promise<Response> {
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

async function shellFirst(req: Request): Promise<Response> {
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

scope.addEventListener("sync", (ev: Event) => {
  const syncEv = ev as ExtendableEvent & { tag?: string };
  if (syncEv.tag !== SYNC_TAG) return;
  syncEv.waitUntil(
    flushQueue(recordDroppedFeed)
      .then((n) => {
        if (n > 0) {
          void scope.registration.showNotification("Hetja", {
            body: `${n} feed log${n === 1 ? "" : "s"} synced. Thank you!`,
          });
        }
      })
      .catch(() => undefined),
  );
});

// Web Push (plan §3.4). Neither listener existed before -- a push arriving
// at this service worker had nothing to display it and no click behavior.
// Payload is JSON: { title, body, caseId, url }; `url` may point at a case
// page that does not exist yet, but the click handling below is correct
// today regardless.
interface SosPushPayload {
  title?: string;
  body?: string;
  caseId?: string;
  url?: string;
}

scope.addEventListener("push", (ev: PushEvent) => {
  let data: SosPushPayload = {};
  try {
    data = ev.data ? (ev.data.json() as SosPushPayload) : {};
  } catch {
    data = {};
  }
  const title = data.title ?? "Hetja SOS";
  ev.waitUntil(
    scope.registration.showNotification(title, {
      body: data.body ?? "A nearby dog needs help.",
      tag: data.caseId ? `sos-${data.caseId}` : undefined,
      data: { url: data.url ?? BASE },
    }),
  );
});

scope.addEventListener("notificationclick", (ev: NotificationEvent) => {
  ev.notification.close();
  const targetUrl: string = (ev.notification.data && ev.notification.data.url) || BASE;
  ev.waitUntil(
    scope.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(targetUrl) && "focus" in c) return (c as WindowClient).focus();
      }
      return scope.clients.openWindow(targetUrl);
    }),
  );
});
