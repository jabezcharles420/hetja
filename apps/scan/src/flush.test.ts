/**
 * Tests for the anonymous feed pipeline: capture-time attestation
 * (offline.enqueueFeed) and replay (flush.flushQueue).
 *
 * Why this file exists: POST /api/v1/scans requires a feeder Bearer OR an
 * x-device-token (routes/scans.ts), and this page has no accounts. flush used
 * to send NO credential at all, so every queued feed was refused with 401
 * UNAUTHENTICATED_DEVICE and — postScan branching on res.ok — never removed
 * from IndexedDB: each one re-uploaded its photo bytes on every page open,
 * forever, over mobile data. The fix mints the token at CAPTURE time, persists
 * it with the queued record (schema v2), and replays it on flush; records
 * queued before that cannot be retroactively attested and are dropped through
 * the onDrop/dropped-feeds path so the visitor is told, rather than retried
 * forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedScan } from "./idb";

const idbMock = vi.hoisted(() => {
  const store = new Map<string, QueuedScan>();
  let seq = 0;
  return {
    store,
    queueScan: async (record: Omit<QueuedScan, "id" | "queuedAt">): Promise<QueuedScan> => {
      const full: QueuedScan = { ...record, id: `q${++seq}`, queuedAt: new Date().toISOString() };
      store.set(full.id, full);
      return full;
    },
    listQueued: async (): Promise<QueuedScan[]> =>
      [...store.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)),
    removeQueued: async (id: string): Promise<void> => {
      store.delete(id);
    },
  };
});

vi.mock("./idb", () => ({
  queueScan: idbMock.queueScan,
  listQueued: idbMock.listQueued,
  removeQueued: idbMock.removeQueued,
}));

// getDeviceToken resolves undefined on failure and never throws — mirrored
// here so both the success and the cannot-mint capture paths are exercised.
const deviceMock = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("./device", () => ({
  getDeviceToken: async (): Promise<string | undefined> => deviceMock.token,
}));

import { flushQueue, blobToBase64 } from "./flush.js";
import { enqueueFeed } from "./offline.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function seedItem(overrides: Partial<QueuedScan> = {}): QueuedScan {
  const item: QueuedScan = {
    id: `seed-${idbMock.store.size + 1}`,
    clientUuid: `uuid-${idbMock.store.size + 1}`,
    dogSlug: "c3di5esh8",
    photoBlob: new Blob(["jpeg-bytes"]),
    capturedAt: "2026-08-21T10:00:00.000Z",
    queuedAt: "2026-08-21T10:00:01.000Z",
    ...overrides,
  };
  idbMock.store.set(item.id, item);
  return item;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function fetchCalls(fetchMock: ReturnType<typeof vi.fn>): FetchCall[] {
  return fetchMock.mock.calls.map(([url, init]) => ({ url: url as string, init: init as RequestInit }));
}

describe("flushQueue", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    idbMock.store.clear();
    fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: { created: true } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replays the capture-time token as x-device-token and clears the record", async () => {
    seedItem({ deviceToken: "tok-capture" });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    const calls = fetchCalls(fetchMock);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("/api/v1/scans");
    const headers = calls[0]!.init.headers as Record<string, string>;
    // THE regression: this header used to be missing entirely, which made
    // every flush a guaranteed 401 and the queue a leaky bucket of photo
    // bytes that could never drain.
    expect(headers["x-device-token"]).toBe("tok-capture");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ clientUuid: "uuid-1", dogSlug: "c3di5esh8", type: "feed" });
    expect(idbMock.store.size).toBe(0);
  });

  it("drops a tokenless schema-v1 record through onDrop instead of retrying it forever", async () => {
    const legacy = seedItem(); // no deviceToken — pre-v2 record

    const drops: Array<{ item: QueuedScan; reason: string }> = [];
    const sent = await flushQueue((item, reason) => drops.push({ item, reason }));

    // Nothing was uploaded — the record cannot be retroactively attested.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent).toBe(0);
    // …but it is gone from the queue, ending the re-upload-on-every-open loop.
    expect(idbMock.store.has(legacy.id)).toBe(false);
    expect(drops.length).toBe(1);
    expect(drops[0]!.item.clientUuid).toBe(legacy.clientUuid);
    expect(drops[0]!.reason).toBe("no-device-token");
  });

  it("keeps a tokened record queued when the upload fails transiently", async () => {
    seedItem({ deviceToken: "tok-capture" });
    fetchMock = vi.fn(async () => jsonResponse({ ok: false }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const sent = await flushQueue();

    expect(sent).toBe(0);
    expect(idbMock.store.size).toBe(1);
  });

  it("handles a mixed queue: tokenless dropped, tokened sent", async () => {
    seedItem(); // legacy, tokenless
    seedItem({ deviceToken: "tok-capture" });
    const drops: string[] = [];

    const sent = await flushQueue((_item, reason) => drops.push(reason));

    expect(sent).toBe(1);
    expect(drops).toEqual(["no-device-token"]);
    expect(idbMock.store.size).toBe(0);
  });
});

describe("enqueueFeed (capture-time attestation)", () => {
  beforeEach(() => {
    idbMock.store.clear();
    // Report ourselves OFFLINE so enqueue skips its eager flush and the test
    // can assert purely on what got persisted.
    vi.stubGlobal("navigator", { onLine: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints and persists the device token when the feed is captured", async () => {
    deviceMock.token = "tok-at-capture";

    await enqueueFeed("c3di5esh8", new Blob(["photo-bytes"]), { lat: 18.97, lng: 72.82 });

    expect(idbMock.store.size).toBe(1);
    const [record] = [...idbMock.store.values()];
    // THE fix: the token rides with the record, so a flush days later still
    // presents a credential minted in the capture's context.
    expect(record!.deviceToken).toBe("tok-at-capture");
    expect(record!.dogSlug).toBe("c3di5esh8");
    expect(record!.geo).toEqual({ lat: 18.97, lng: 72.82 });
  });

  it("still queues the feed when no token could be minted (flush will report it)", async () => {
    deviceMock.token = undefined;

    await enqueueFeed("c3di5esh8", new Blob(["photo-bytes"]));

    expect(idbMock.store.size).toBe(1);
    const [record] = [...idbMock.store.values()];
    expect(record!.deviceToken).toBeUndefined();
  });
});

describe("blobToBase64", () => {
  it("round-trips bytes to base64", async () => {
    const out = await blobToBase64(new Blob([new Uint8Array([104, 105])])); // "hi"
    expect(out).toBe(btoa("hi"));
  });
});
