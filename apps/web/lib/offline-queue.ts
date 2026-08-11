/**
 * Offline-first feed queue.
 *
 * `enqueueFeed` persists a scan to IndexedDB immediately (survives reloads)
 * and then either registers a Background Sync task (Chromium) or flushes the
 * queue right away when online.
 *
 * `flush` replays the queue via POST /api/v1/scans in FIFO order. The API is
 * idempotent by clientUuid (ON CONFLICT DO NOTHING), so a replay that returns
 * `created: false` is treated as already-handled and dropped — it is never
 * re-queued. Transport failures keep the record for a later retry.
 */

import { queueScan, listQueued, removeQueued, uuid } from "./idb";
import type { QueuedScan } from "./idb";
import { api } from "./api";

export const SYNC_TAG = "straynet-feed-flush";

export interface EnqueueInput {
  dogSlug: string;
  photo?: string;
  geo?: { lat: number; lng: number };
}

export interface FeedOutcome {
  queued: QueuedScan;
  syncing: boolean;
  offline: boolean;
}

function isOnLine(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.onLine;
  } catch {
    return false;
  }
}

export async function hasBackgroundSync(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return typeof (reg as unknown as { sync?: unknown }).sync === "object";
  } catch {
    return false;
  }
}

export async function requestSync(): Promise<boolean> {
  if (!(await hasBackgroundSync())) return false;
  const reg = await navigator.serviceWorker.ready;
  await (reg as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register(SYNC_TAG);
  return true;
}

export async function enqueueFeed(input: EnqueueInput): Promise<FeedOutcome> {
  const queued = await queueScan({
    clientUuid: uuid(),
    dogSlug: input.dogSlug,
    photo: input.photo,
    geo: input.geo,
    capturedAt: new Date().toISOString(),
  });

  const offline = !isOnLine();
  let syncing = false;
  if (!offline) {
    if (await hasBackgroundSync()) {
      syncing = await requestSync();
    } else {
      syncing = (await flush()) > 0;
    }
  }

  return { queued, syncing, offline };
}

/**
 * Replays the whole queue against POST /api/v1/scans (FIFO). Returns the
 * number of scans acknowledged (created or deduped). Records are removed only
 * on success — a network/API failure leaves them queued for the next flush.
 */
export async function flush(): Promise<number> {
  const items = await listQueued();
  let sent = 0;
  for (const item of items) {
    try {
      const result = await api.createScan({
        clientUuid: item.clientUuid,
        dogSlug: item.dogSlug,
        type: "feed",
        geo: item.geo,
        photoBase64: item.photo,
        capturedAt: item.capturedAt,
      });
      // `created: false` = already recorded server-side (idempotent replay).
      // Either way the record is handled and must not be re-queued.
      await removeQueued(item.id);
      sent++;
    } catch {
      // keep queued — retried on the next flush
    }
  }
  return sent;
}

/** iOS / no-Background-Sync fallback: flush on app open (or reconnect). */
export async function flushOnOpen(): Promise<number> {
  if (!isOnLine()) return 0;
  try {
    return await flush();
  } catch {
    return 0;
  }
}

/** Total records waiting to upload. */
export async function queuedCount(): Promise<number> {
  try {
    return (await listQueued()).length;
  } catch {
    return 0;
  }
}

/** Best-effort geolocation capture with a hard timeout. */
export function captureGeo(timeoutMs = 8000): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Strip a `data:image/...;base64,` prefix, leaving raw base64. */
export function stripDataPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:[a-z0-9/+-]+;base64,/, "");
}
