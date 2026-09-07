import { listQueued, removeQueued } from "./idb";
import type { QueuedScan } from "./idb";
import { DEVICE_TOKEN_KEY } from "./token-key";

const API_BASE = "/api/v1";

/**
 * Is this failure worth retrying, or will it fail identically forever?
 *
 * Mirrors apps/web/lib/offline-queue.ts's isRetryable. `postScan` used to
 * return `res.ok` and the loop kept anything falsy, so a permanent 4xx —
 * INVALID_PHOTO (undecodable bytes), DOG_NOT_FOUND (tag retired between
 * capture and sync), a 413, a capturedAt outside INVARIANT 4's window — was
 * re-uploaded with its photo bytes on every page open, forever, over mobile
 * data, to be refused again. Transport failures, 5xx and throttling (408/425/
 * 429) can plausibly change and stay queued. 401 is the one 4xx with a side
 * effect: see `postScan`.
 */
function isRetryableStatus(status: number): boolean {
  if (status === 0) return true; // never reached the network
  if (status >= 500) return true;
  return status === 408 || status === 425 || status === 429;
}

type PostOutcome = { ok: true } | { ok: false; retry: true } | { ok: false; retry: false; reason: string };

/**
 * Forget the cached device token. Called on a 401: the token the record
 * carries is not one the server accepts any more (HETJA_DEVICE_SECRET was
 * rotated, or the row was minted under an old secret), and the same cached
 * value would be attached to every FUTURE capture too. The queued record
 * itself is dropped — attaching a token minted now would attest this device at
 * flush time, not when the photo was taken, which is exactly the retroactive
 * attestation this pipeline refuses.
 */
function forgetCachedDeviceToken(): void {
  try {
    (globalThis as { localStorage?: { removeItem(key: string): void } }).localStorage?.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* no storage here (service worker) — the page will fail closed on its next mint */
  }
}

/**
 * Replays the queue against POST /api/v1/scans (FIFO). Returns the number of
 * scans acknowledged.
 *
 * `onDrop` receives records that can never be accepted so the caller can tell
 * the visitor — a permanent drop must never be silent (INVARIANT 14's
 * reasoning: "a flag nobody looks at is a silent rejection with extra steps").
 * The page-open path passes recordDroppedFeed; the background-sync handler
 * passes it too, where it degrades to a console warning (no DOM there).
 */
export async function flushQueue(onDrop?: (item: QueuedScan, reason: string) => void): Promise<number> {
  const items = await listQueued();
  let sent = 0;
  for (const item of items) {
    // Schema-v1 leftovers: queued before feed captures minted a device token.
    // A token minted NOW would attest this device at flush time, not when the
    // photo was taken — retroactive attestation of exactly the kind this
    // pipeline exists to avoid — so these cannot be fixed, only reported.
    // Removing them is what ends the old behaviour: re-uploading their photo
    // bytes on every page open, forever, to be refused with 401 again.
    if (!item.deviceToken) {
      await removeQueued(item.id);
      onDrop?.(item, "no-device-token");
      continue;
    }
    const outcome = await postScan(item);
    if (outcome.ok) {
      await removeQueued(item.id);
      sent++;
    } else if (!outcome.retry) {
      // Permanently refused: remove it so it stops re-uploading its photo on
      // every open, and say so — a silent drop is the failure INVARIANT 14's
      // reasoning forbids.
      await removeQueued(item.id);
      onDrop?.(item, outcome.reason);
    }
  }
  return sent;
}

async function postScan(item: QueuedScan): Promise<PostOutcome> {
  try {
    const res = await fetch(`${API_BASE}/scans`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The API accepts a feeder Bearer token OR an attested device token
        // (routes/scans.ts). This page has no accounts, so the capture-time
        // token persisted with the record is the only credential the replay
        // can present. flush used to send NO credential at all, get 401
        // UNAUTHENTICATED_DEVICE every time, and treat res.ok === false as
        // "keep queued" — which is where the forever-retry came from.
        ...(item.deviceToken ? { "x-device-token": item.deviceToken } : {}),
      },
      body: JSON.stringify({
        clientUuid: item.clientUuid,
        dogSlug: item.dogSlug,
        type: "feed",
        geo: item.geo,
        photoBase64: await blobToBase64(item.photoBlob),
        capturedAt: item.capturedAt,
      }),
    });
    // A 200 with `created: false` is the idempotent replay answer (INVARIANT
    // 5): the feed is already recorded server-side, so this is success.
    if (res.ok) return { ok: true };
    if (isRetryableStatus(res.status)) return { ok: false, retry: true };
    if (res.status === 401) forgetCachedDeviceToken();
    return { ok: false, retry: false, reason: `http-${res.status}` };
  } catch {
    return { ok: false, retry: true };
  }
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
