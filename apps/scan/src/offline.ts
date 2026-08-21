import { queueScan, listQueued } from "./idb";
import type { QueuedScan } from "./idb";
import { flushQueue } from "./flush";
import { getDeviceToken } from "./device";
import { recordDroppedFeed } from "./dropped";

const UUID_KEY = "hetja.clientUuid";
const SYNC_TAG = "log-feed";
const EVICT_WINDOW_MS = 7 * 24 * 3600 * 1000;
const WARN_BEFORE_MS = 24 * 3600 * 1000;

export interface LogFeedOutcome {
  ok: boolean;
  offline: boolean;
  syncing: boolean;
  message: string;
  queued?: QueuedScan;
  evictionSoon: boolean;
}

export function getClientUuid(): string {
  try {
    let u = localStorage.getItem(UUID_KEY);
    if (!u) {
      u = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ?? fallbackUuid();
      localStorage.setItem(UUID_KEY, u);
    }
    return u;
  } catch {
    return fallbackUuid();
  }
}

function fallbackUuid(): string {
  return "c0000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}

export async function hasBackgroundSync(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return typeof (reg as unknown as { sync?: unknown }).sync === "object";
  } catch {
    return false;
  }
}

async function registerSync(): Promise<boolean> {
  if (!(await hasBackgroundSync())) return false;
  const reg = await navigator.serviceWorker.ready;
  await (reg as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register(SYNC_TAG);
  return true;
}

/** Persist one captured feed. Exported for flush.test.ts, which pins the
 * capture-time attestation contract; logFeed is the UI-facing caller. */
export async function enqueueFeed(dogSlug: string, photoBlob: Blob, geo?: { lat: number; lng: number }): Promise<{ queued: QueuedScan; syncing: boolean }> {
  // Mint the device token NOW, at capture time, and persist it with the
  // queued record — not at flush time. This mirrors sheet.ts's SOS path (lazy
  // getDeviceToken() at the moment of the action) and fixes the shape apps/web's
  // api.ts flagged as "the wrong shape" for years: minting per queued record
  // during a flush re-solves a proof-of-work on every replay and still sends
  // nothing for records that predate it. getDeviceToken() caches in
  // localStorage after its first success, so this costs one challenge/PoW
  // round-trip ever, and it resolves undefined rather than throwing when it
  // cannot mint (offline capture with no cached token) — such a record is
  // queued anyway and flush.ts reports it through the dropped-feeds path
  // instead of retrying it forever.
  const deviceToken = await getDeviceToken();
  const queued = await queueScan({
    clientUuid: getClientUuid(),
    dogSlug,
    photoBlob,
    geo,
    capturedAt: new Date().toISOString(),
    deviceToken,
  });
  let syncing = false;
  if (navigator.onLine) {
    if (await hasBackgroundSync()) {
      syncing = await registerSync();
    } else {
      // recordDroppedFeed, not a bare flush(): a feed refused permanently here
      // is the one the visitor just tapped, so it is the LAST place that
      // should discard it without a word.
      syncing = (await flushQueue(recordDroppedFeed)) > 0;
    }
  }
  return { queued, syncing };
}

export async function logFeed(dogSlug: string): Promise<LogFeedOutcome> {
  const offline = !navigator.onLine;
  const photo = await capturePhoto();
  if (!photo) return { ok: false, offline, syncing: false, message: "No photo captured.", evictionSoon: false };
  const geo = await getGeo();
  const blob = await downscaleImage(photo, 1280, 0.8);
  const { queued, syncing } = await enqueueFeed(dogSlug, blob, geo);
  const evictionSoon = await evictionSoonCount() > 0;
  const message = offline
    ? "Feed saved offline — it will upload when you're back online."
    : syncing
      ? "Feed logged — syncing now."
      : "Feed logged.";
  return { ok: true, offline, syncing, message, queued, evictionSoon };
}

export async function flushOnOpen(): Promise<void> {
  try {
    if (!navigator.onLine) return;
    // recordDroppedFeed, not a bare flush(): permanently-undeliverable feeds
    // are removed AND reported, so main.ts can tell the visitor on this very
    // page open rather than the queue quietly shrinking.
    await flushQueue(recordDroppedFeed);
  } catch {
    /* offline / db error — retry next open */
  }
}

export async function evictionSoonCount(): Promise<number> {
  const cutoff = Date.now() - (EVICT_WINDOW_MS - WARN_BEFORE_MS);
  const items = await listQueued();
  return items.filter((i) => new Date(i.queuedAt).getTime() <= cutoff).length;
}

function capturePhoto(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const file = input.files ? input.files[0] ?? null : null;
        input.remove();
        resolve(file);
      },
      { once: true },
    );
    input.click();
  });
}

function getGeo(): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => resolve(undefined), 8000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  });
}

async function downscaleImage(blob: Blob, maxDim: number, quality: number): Promise<Blob> {
  if (blob.type === "image/gif") return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return blob;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b ?? blob), "image/jpeg", quality),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}
