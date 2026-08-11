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

import { enqueueFeed, flush } from "./offline-queue";

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

describe("lib/offline-queue", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    idbMock.store.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enqueues and flushes scans in FIFO order", async () => {
    const a = await enqueueFeed({ dogSlug: "abc234567" });
    const b = await enqueueFeed({ dogSlug: "cde345678" });

    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, data: { created: true } }));

    const sent = await flush();

    expect(sent).toBe(2);
    const bodies = postedBodies(fetchMock);
    expect(bodies.map((x) => x.dogSlug)).toEqual(["abc234567", "cde345678"]);
    expect(bodies.map((x) => x.clientUuid)).toEqual([a.queued.clientUuid, b.queued.clientUuid]);
    expect(bodies.every((x) => x.type === "feed")).toBe(true);
    expect(idbMock.store.size).toBe(0);
  });

  it("drops a replay that returns created:false — it is not re-queued", async () => {
    await enqueueFeed({ dogSlug: "abc234567" });

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
    await enqueueFeed({ dogSlug: "abc234567", geo: { lat: 19.07, lng: 72.88 } });

    fetchMock.mockRejectedValueOnce(new TypeError("offline"));

    expect(await flush()).toBe(0);
    expect(idbMock.store.size).toBe(1);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: { created: true } }));

    expect(await flush()).toBe(1);
    expect(idbMock.store.size).toBe(0);
    const [body] = postedBodies(fetchMock);
    expect(body).toMatchObject({ dogSlug: "abc234567", geo: { lat: 19.07, lng: 72.88 } });
  });

  it("treats an API error envelope as a failure and keeps the record", async () => {
    await enqueueFeed({ dogSlug: "abc234567" });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { ok: false, error: { message: "invalid scan payload", code: "INVALID_SCAN" } }),
    );

    expect(await flush()).toBe(0);
    expect(idbMock.store.size).toBe(1);
  });
});
