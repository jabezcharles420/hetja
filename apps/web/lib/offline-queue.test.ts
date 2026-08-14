/**
 * @vitest-environment jsdom
 *
 * This module is browser code -- IndexedDB queue, navigator.onLine,
 * localStorage, CustomEvent -- so it is tested in a browser-like environment
 * rather than the `environment: "node"` default this project sets for .ts files.
 *
 * Not cosmetic. Under node, `window` does not exist and Node's own
 * `localStorage` is a lazy global that vitest's `unstubAllGlobals()` (called in
 * afterEach here) leaves unreadable from inside the module under test for every
 * test after the first. That produced a failure indistinguishable from a real
 * bug: "the dropped feed was not recorded", in a test whose drop path was
 * verifiably working -- the warning fired, the queue entry was removed, and the
 * JSON did land in storage when the same test ran alone. jsdom gives a stable
 * localStorage and a real window, so the suite measures the code instead of the
 * harness.
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
    uuid: (): string => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
  };
});

vi.mock("./idb", () => ({
  queueScan: idbMock.queueScan,
  listQueued: idbMock.listQueued,
  removeQueued: idbMock.removeQueued,
  uuid: idbMock.uuid,
}));

import {
  enqueueFeed,
  flush,
  flushOnOpen,
  listDroppedFeeds,
  clearDroppedFeeds,
  DROPPED_FEEDS_KEY,
} from "./offline-queue";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface PostedBody {
  clientUuid: string;
  dogSlug: string;
  type: string;
}

function postedBodies(fetchMock: ReturnType<typeof vi.fn>): PostedBody[] {
  return fetchMock.mock.calls.map(([url, init]) => {
    expect(url).toMatch(/\/scans$/);
    return JSON.parse((init as RequestInit).body as string) as PostedBody;
  });
}

/**
 * Queue a feed while the browser reports itself OFFLINE, so nothing is sent yet
 * and the test can drive `flush()` explicitly.
 *
 * Needed because `enqueueFeed` flushes immediately when online. These tests used
 * to get that for free: `isOnLine()` returned `navigator.onLine` directly, and
 * under the `environment: "node"` these files ran in, that property is
 * `undefined` — so every enqueue looked offline and the eager-flush path was
 * never exercised at all. `isOnLine` now
 * treats unknown as online (a wasted request is cheaper than a queue that never
 * drains), which is correct and which made that accident visible. Being explicit
 * about the offline state is also the more honest fixture — queueing is what
 * happens when a feeder is out of signal.
 *
 * Implementation note: this overrides ONLY the `onLine` property, via
 * defineProperty on the existing navigator, rather than replacing the whole
 * global with `vi.stubGlobal("navigator", …)`. The latter works but poisons
 * later tests in the same file — swapping and restoring the global object left
 * `localStorage` unreadable from inside the module under test, which showed up as
 * "the dropped feed was not recorded" in a completely unrelated test while the
 * drop path was actually working. Touch the smallest thing that produces the
 * behaviour you need.
 */
async function enqueueOffline(input: Parameters<typeof enqueueFeed>[0]) {
  const had = Object.prototype.hasOwnProperty.call(globalThis.navigator, "onLine");
  const prior = had ? Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine") : undefined;
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: false,
    configurable: true,
    writable: true,
  });
  try {
    return await enqueueFeed(input);
  } finally {
    if (prior) Object.defineProperty(globalThis.navigator, "onLine", prior);
    else delete (globalThis.navigator as { onLine?: boolean }).onLine;
  }
}

describe("lib/offline-queue", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    idbMock.store.clear();
    clearDroppedFeeds();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enqueues and flushes scans in FIFO order", async () => {
    const a = await enqueueOffline({ dogSlug: "abc234567" });
    const b = await enqueueOffline({ dogSlug: "cde345678" });

    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true, data: { created: true } }));

    const sent = await flush();

    expect(sent).toBe(2);
    const bodies = postedBodies(fetchMock);
    expect(bodies.map((x) => x.dogSlug)).toEqual(["abc234567", "cde345678"]);
    expect(bodies.map((x) => x.clientUuid)).toEqual([a.queued.clientUuid, b.queued.clientUuid]);
    expect(bodies.every((x) => x.type === "feed")).toBe(true);
    expect(idbMock.store.size).toBe(0);
  });

  it("drops a replay that returns created:false — it is not re-queued", async () => {
    await enqueueOffline({ dogSlug: "abc234567" });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { created: false } }));

    expect(await flush()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(idbMock.store.size).toBe(0);

    // Second flush must not re-queue or re-post the deduped scan.
    expect(await flush()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(idbMock.store.size).toBe(0);
  });

  it("keeps records queued on failure, then sends them on a later flush", async () => {
    await enqueueOffline({ dogSlug: "abc234567", geo: { lat: 19.07, lng: 72.88 } });

    fetchMock.mockRejectedValueOnce(new TypeError("offline"));

    expect(await flush()).toBe(0);
    expect(idbMock.store.size).toBe(1);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { created: true } }));

    expect(await flush()).toBe(1);
    expect(idbMock.store.size).toBe(0);
    const [body] = postedBodies(fetchMock);
    expect(body).toMatchObject({ dogSlug: "abc234567", geo: { lat: 19.07, lng: 72.88 } });
  });

  // This test used to assert the opposite — that a 400 keeps the record queued —
  // which is what made the queue a poison-pill loop rather than a retry queue.
  // INVARIANT 4 clamps `capturedAt` skew to ±15 minutes, so every feed queued
  // offline for longer than that becomes a permanent 400: exactly the case the
  // offline queue exists to serve. It then re-uploaded its photo bytes over
  // Mumbai 4G on every app open, forever, to be rejected again every time.
  it("drops a permanently-rejected record instead of retrying it forever", async () => {
    await enqueueOffline({ dogSlug: "abc234567" });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { ok: false, error: { message: "invalid scan payload", code: "INVALID_SCAN" } }),
    );

    const dropped: { code?: string; status: number }[] = [];
    expect(await flush((_item, err) => dropped.push({ code: err.code, status: err.status }))).toBe(0);
    expect(idbMock.store.size).toBe(0);
    // Dropped, but not silently: the caller is the only layer that can tell the
    // feeder their feed did not count.
    expect(dropped).toEqual([{ code: "INVALID_SCAN", status: 400 }]);
  });

  // The point of the onDrop parameter is that a drop is OBSERVABLE. For a while
  // `flush` documented that and the only caller passed nothing, so every
  // permanently-refused feed vanished without trace -- the claim was in the
  // comment and not in the code. These two tests are what make it true.
  // These seed the queue directly instead of going through `enqueueOffline`. That
  // is not laziness: `enqueueOffline` replaces the global `navigator` via
  // vi.stubGlobal, and under this project's `environment: "node"` for .ts files
  // that interacts badly enough with the surrounding global bookkeeping to make
  // localStorage unreadable inside the module under test — which produced a
  // failure that looked like "the drop was not recorded" when the drop path was
  // in fact running correctly (verified separately: the warning fires, the queue
  // entry is removed, and the JSON lands in localStorage). Seeding the store
  // keeps the test about the thing it is testing.
  function seedQueued(dogSlug: string): void {
    const now = new Date().toISOString();
    idbMock.store.set(dogSlug + now, {
      id: dogSlug + now,
      clientUuid: `c-${dogSlug}-${now}`,
      dogSlug,
      capturedAt: now,
      queuedAt: now,
    } as QueuedScan);
  }

  it("flushOnOpen records a dropped feed instead of discarding it silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    seedQueued("abc234567");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { ok: false, error: { message: "nope", code: "INVALID_PHOTO" } }),
    );

    expect(await flushOnOpen()).toBe(0);
    expect(idbMock.store.size).toBe(0); // not retried forever

    const dropped = listDroppedFeeds();
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ dogSlug: "abc234567", code: "INVALID_PHOTO", status: 400 });
    // Metadata only -- the photo bytes must NOT be copied into localStorage.
    expect(JSON.stringify(dropped[0])).not.toContain("data:image");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("bounds the dropped-feed list so it cannot grow without limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 25; i++) {
      seedQueued(`abc23456${i % 10}`);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, { ok: false, error: { message: "nope", code: "INVALID_SCAN" } }),
      );
      await flushOnOpen();
    }
    // Proves the cap, and that it capped something rather than never recording.
    expect(warn).toHaveBeenCalledTimes(25);
    expect(listDroppedFeeds()).toHaveLength(20);
    warn.mockRestore();
  });

  it.each([
    ["a server fault", 500, "INTERNAL"],
    ["throttling", 429, "RATE_LIMITED"],
    ["an expired session", 401, "UNAUTHENTICATED"],
  ])("keeps the record queued on %s, which can still succeed later", async (_label, status, code) => {
    await enqueueOffline({ dogSlug: "abc234567" });

    fetchMock.mockResolvedValueOnce(jsonResponse(status, { ok: false, error: { message: "nope", code } }));

    const dropped: unknown[] = [];
    expect(await flush(() => dropped.push(1))).toBe(0);
    expect(idbMock.store.size).toBe(1);
    expect(dropped).toEqual([]);
  });
});
