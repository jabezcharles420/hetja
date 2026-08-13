/**
 * PWA bootstrap: service-worker registration + web app manifest.
 *
 * The static `public/sw.js` caches the app shell, serves cached dog profiles
 * offline, and wakes the tab to flush the feed queue on Background Sync.
 * `public/manifest.webmanifest` declares the standalone install experience
 * (Hetja).
 *
 * Also: Web Push subscribe (plan §3.3). `Notification.requestPermission()`
 * is only ever called from `maybeSubscribeAfterFeed`, wired up in
 * PwaBootstrap to fire on the service worker's HETJA_FEED_LOGGED signal
 * (public/sw.js observing a successful POST /api/v1/scans) -- never on page
 * load. An unprompted permission dialog on first visit is the thing users
 * reflexively deny, and once denied it is hard to recover (see
 * ops/RUNBOOK.md for the responders this still cannot reach at all, notably
 * on iOS without Add-to-Home-Screen).
 */

import { API_BASE, getAccessToken } from "./api";

export const SW_PATH = "/sw.js";
export const MANIFEST_PATH = "/manifest.webmanifest";

const PUSH_PROMPT_KEY = "hetja.pushPromptAsked";

export interface PwaManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

export function getManifest(): PwaManifest {
  return {
    name: "Hetja",
    short_name: "Hetja",
    description: "Feed logs, profiles and SOS for Mumbai's stray dogs.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}

/** Inject the `<link rel="manifest">` if not already present. */
export function linkManifest(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = MANIFEST_PATH;
  document.head.appendChild(link);
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch {
    return null;
  }
}

export function isStandalone(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function isInstallable(): boolean {
  if (typeof window === "undefined") return false;
  return "BeforeInstallPromptEvent" in window;
}

/**
 * Full bootstrap for the layout: ensure the manifest link exists and register
 * the service worker (production). Returns whether a SW is active.
 */
export async function initPwa(): Promise<boolean> {
  linkManifest();
  const reg = await registerServiceWorker();
  return reg !== null;
}

// ---------------------------------------------------------------------------
// Web Push (plan §3)
// ---------------------------------------------------------------------------

function hasPushSupport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** VAPID public keys are base64url; pushManager.subscribe() wants raw bytes. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/push/vapid-public-key`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const key = (body as { data?: { publicKey?: string } } | null)?.data?.publicKey;
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  try {
    const res = await fetch(`${API_BASE}/push/subscribe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Requests Notification permission and, if granted, subscribes this
 * browser to Web Push and registers the subscription with the API. Safe to
 * call more than once (an existing subscription is reused). Callers should
 * gate *when* this runs -- see maybeSubscribeAfterFeed -- this function
 * itself does not decide the right moment.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!hasPushSupport()) return false;
  if (Notification.permission === "denied") return false;

  let permission: NotificationPermission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return false;
    }
  }
  if (permission !== "granted") return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const publicKey = await fetchVapidPublicKey();
      if (!publicKey) return false;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    return await postSubscription(sub);
  } catch {
    return false;
  }
}

/**
 * The earned-moment gate (plan §3.3): call this when the service worker
 * signals HETJA_FEED_LOGGED (a feeder's feed log just succeeded), never on
 * page load. Asks at most once per browser regardless of outcome -- a
 * denial should not be re-prompted (the browser blocks it anyway), and a
 * grant only needs to happen the one time.
 */
export async function maybeSubscribeAfterFeed(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  try {
    if (localStorage.getItem(PUSH_PROMPT_KEY)) return;
  } catch {
    return;
  }
  if (!getAccessToken()) return; // subscribing requires a logged-in feeder
  await subscribeToPush();
  try {
    localStorage.setItem(PUSH_PROMPT_KEY, "1");
  } catch {
    /* storage unavailable (private mode / quota) -- worst case we ask again
     * on the next logged feed instead of remembering we already asked. */
  }
}
