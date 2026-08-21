import { listQueued, removeQueued } from "./idb";
import type { QueuedScan } from "./idb";

const API_BASE = "/api/v1";

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
    if (await postScan(item)) {
      await removeQueued(item.id);
      sent++;
    }
  }
  return sent;
}

async function postScan(item: QueuedScan): Promise<boolean> {
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
    return res.ok;
  } catch {
    return false;
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
