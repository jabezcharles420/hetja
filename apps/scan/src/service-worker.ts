import { flushQueue } from "./flush";

const CACHE = "scan-shell-v2";
const API_PREFIX = "/api/v1";
const SYNC_TAG = "log-feed";

const scope = self as unknown as ServiceWorkerGlobalScope;
const BASE = new URL("./", scope.location.href).href;

scope.addEventListener("install", (ev: ExtendableEvent) => {
  ev.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([BASE, BASE + "index.html", BASE + "main.js"]))
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
  ev.respondWith(shellFirst(req));
});

// INVARIANT: medical/vaccination fields travel through /api/v1/dogs/*, which
// is covered by API_PREFIX above and therefore always network-first. A
// cached vaccination status is only ever served when the network request
// itself fails, and even then it is tagged X-Hetja-Stale so the UI can
// say so — it must never be presented as current.
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
  if (req.mode === "navigate") {
    const root = await cache.match(BASE).catch(() => undefined);
    if (root) {
      void fresh;
      return root;
    }
  }
  return (await fresh) ?? Response.error();
}

scope.addEventListener("sync", (ev: Event) => {
  const syncEv = ev as ExtendableEvent & { tag?: string };
  if (syncEv.tag !== SYNC_TAG) return;
  syncEv.waitUntil(
    flushQueue()
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
