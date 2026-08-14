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
import { api, ApiError } from "./api";

export const SYNC_TAG = "hetja-feed-flush";

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
 * Is this failure worth retrying, or will it fail identically forever?
 *
 * The queue used to re-queue on *any* thrown error, which made it a poison-pill
 * loop rather than a retry queue. That was not hypothetical:
 *
 *   - INVARIANT 4 clamps `capturedAt` clock skew to ±15 minutes
 *     (`packages/contracts` schemas). So **every feed queued offline for longer
 *     than fifteen minutes became a permanent 400** — which is precisely the
 *     case the offline queue exists to serve, a feeder out of signal for an
 *     afternoon. It then retried on every app open, forever.
 *   - `DOG_NOT_FOUND` (the collar was retired between queueing and syncing) is
 *     permanent in the same way.
 *   - `INVALID_PHOTO`, added when the API started rejecting undecodable images
 *     server-side, joins the same set.
 *
 * A stuck head-of-queue item is worse than a lost one here, because `flush` is
 * FIFO: one permanently-400ing record does not block the others (each is tried
 * independently) but it does mean every future flush re-uploads its photo bytes
 * over Mumbai 4G, forever, to be rejected again.
 *
 * Retry only what can plausibly change: transport failures, server faults,
 * throttling, and auth (the feeder may simply log in again — dropping a real
 * feed because an access token expired would destroy data the queue was built to
 * protect).
 */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true; // unknown failure: assume transient
  const s = err.status;
  if (s === 0) return true; // never reached the network
  if (s >= 500) return true; // server-side fault
  if (s === 401) return true; // token expired; a later login can fix it
  if (s === 408 || s === 425 || s === 429) return true; // timeout / too early / throttled
  return false; // every other 4xx is a statement about the request itself
}

/**
 * Replays the whole queue against POST /api/v1/scans (FIFO). Returns the number
 * of scans acknowledged (created or deduped).
 *
 * Records are removed on success, and also on a permanently-failing response —
 * see `isRetryable`. A permanent drop is reported through `onDrop` rather than
 * happening silently: the caller is the only layer that can tell the feeder
 * their feed did not count, and INVARIANT 14's reasoning ("a flag nobody looks
 * at is a silent rejection with extra steps") applies here too.
 */
export async function flush(
  onDrop?: (item: QueuedScan, err: ApiError) => void,
): Promise<number> {
  const items = await listQueued();
  let sent = 0;
  for (const item of items) {
    try {
      await api.createScan({
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
    } catch (err) {
      if (isRetryable(err)) continue; // keep queued — retried on the next flush
      await removeQueued(item.id);
      if (err instanceof ApiError) onDrop?.(item, err);
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
