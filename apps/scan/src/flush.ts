import { listQueued, removeQueued } from "./idb";
import type { QueuedScan } from "./idb";

const API_BASE = "/api/v1";

export async function flushQueue(): Promise<number> {
  const items = await listQueued();
  let sent = 0;
  for (const item of items) {
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
      headers: { "content-type": "application/json" },
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
