/**
 * Hardening batch 1 (2026-09-25): the server-level and library pieces.
 *
 *   T5   global 64 KiB body limit; the photo gate semaphore
 *   T6   image dimension / animation limits; the photo-volume free-space guard
 *   T1   the shared responder rule
 *   T16  /readyz; the rate_limited log line carries no subject
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";
import { GLOBAL_BODY_LIMIT, PHOTO_ROUTE_BODY_LIMIT } from "./lib/body-limits.js";
import { PhotoBusyError, PhotoGate } from "./lib/photo-gate.js";
import {
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
  UnsupportedImageError,
  inspectImage,
  stripImageMetadata,
} from "./lib/exif-strip.js";
import { MIN_FREE_BYTES, StorageFullError, assertFreeSpace, setFreeSpaceProbeForTests, storePhoto } from "./lib/storage.js";
import { MAX_OPEN_ACKS, TRUST_FLOOR, canRespond, mayAck } from "./lib/sos-eligibility.js";
import { logRateLimited } from "./lib/rate-limit.js";
import { MAX_PHOTO_BASE64_CHARS } from "@hetja/contracts";

const config = loadConfig();

describe("T5: body limits", () => {
  it("sizes the two limits as documented", () => {
    expect(GLOBAL_BODY_LIMIT).toBe(64 * 1024);
    expect(PHOTO_ROUTE_BODY_LIMIT).toBe(MAX_PHOTO_BASE64_CHARS + 64 * 1024);
  });

  it("refuses a 100 KiB body on /auth/otp with 413 before any handler logic", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email: `${"a".repeat(100 * 1024)}@example.com` },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("FST_ERR_CTP_BODY_TOO_LARGE");
    await app.close();
  });

  it("refuses a 100 KiB body on /devices/token with 413", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { payload: "x".repeat(100 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });
});

describe("T5: photo gate semaphore", () => {
  it("admits 2 at once, queues 8, refuses the 11th immediately, and hands slots over in order", async () => {
    const gate = new PhotoGate(2, 8, 10_000);
    const a = await gate.acquire();
    await gate.acquire();
    expect(gate.inFlight).toBe(2);
    const order: number[] = [];
    const waiters = Array.from({ length: 8 }, (_, i) => gate.acquire().then((release) => ({ i, release })));
    expect(gate.queued).toBe(8);
    await expect(gate.acquire()).rejects.toBeInstanceOf(PhotoBusyError);

    a();
    a(); // idempotent: frees one slot, not two
    const first = await waiters[0];
    order.push(first.i);
    expect(gate.queued).toBe(7);
    expect(gate.inFlight).toBe(2);
    first.release();
    const second = await waiters[1];
    order.push(second.i);
    expect(order).toEqual([0, 1]);
    gate.reset();
  });

  it("a waiter that waits too long is refused with PhotoBusyError", async () => {
    const gate = new PhotoGate(1, 1, 20);
    await gate.acquire();
    await expect(gate.acquire()).rejects.toBeInstanceOf(PhotoBusyError);
    expect(gate.queued).toBe(0);
    gate.reset();
  });
});

// ---------------------------------------------------------------------------
// T6: synthetic headers
// ---------------------------------------------------------------------------

function jpeg(width: number, height: number): Buffer {
  const seg = (marker: number, payload: Buffer) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 0x10)])),
    seg(0xc2, Buffer.from([0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00])),
    seg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.from([0x31, 0x41, 0x59, 0x26, 0x53, 0x58]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(width: number, height: number, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...extra,
    pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function riff(chunks: Array<[string, Buffer]>): Buffer {
  const body = Buffer.concat(
    chunks.map(([fourcc, payload]) => {
      const h = Buffer.alloc(8);
      h.write(fourcc, 0, "latin1");
      h.writeUInt32LE(payload.length, 4);
      return Buffer.concat([h, payload, payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
    }),
  );
  const out = Buffer.alloc(12);
  out.write("RIFF", 0, "latin1");
  out.writeUInt32LE(4 + body.length, 4);
  out.write("WEBP", 8, "latin1");
  return Buffer.concat([out, body]);
}

function vp8x(flags: number, width: number, height: number): Buffer {
  const b = Buffer.alloc(10);
  b[0] = flags;
  b.writeUIntLE(width - 1, 4, 3);
  b.writeUIntLE(height - 1, 7, 3);
  return b;
}

function vp8(width: number, height: number): Buffer {
  const b = Buffer.alloc(12);
  b[3] = 0x9d;
  b[4] = 0x01;
  b[5] = 0x2a;
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function vp8l(width: number, height: number): Buffer {
  const b = Buffer.alloc(6);
  b[0] = 0x2f;
  b.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  return b;
}

describe("T6: image dimension and animation limits", () => {
  it("reads dimensions from JPEG SOFn, PNG IHDR and WebP VP8X / VP8 / VP8L", () => {
    expect(inspectImage("jpeg", jpeg(1600, 1200))).toEqual({ width: 1600, height: 1200, animated: false });
    expect(inspectImage("png", png(640, 480))).toEqual({ width: 640, height: 480, animated: false });
    expect(inspectImage("webp", riff([["VP8X", vp8x(0, 800, 600)], ["VP8 ", vp8(800, 600)]]))).toMatchObject({
      width: 800,
      height: 600,
    });
    expect(inspectImage("webp", riff([["VP8 ", vp8(1024, 768)]]))).toMatchObject({ width: 1024, height: 768 });
    expect(inspectImage("webp", riff([["VP8L", vp8l(300, 200)]]))).toMatchObject({ width: 300, height: 200 });
  });

  it("accepts the limit exactly and refuses one pixel past it, per side and in total", () => {
    expect(() => stripImageMetadata(jpeg(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))).not.toThrow();
    expect(MAX_IMAGE_SIDE * MAX_IMAGE_SIDE).toBe(MAX_IMAGE_PIXELS);
    expect(() => stripImageMetadata(jpeg(MAX_IMAGE_SIDE + 1, 10))).toThrow(UnsupportedImageError);
    expect(() => stripImageMetadata(png(10, MAX_IMAGE_SIDE + 1))).toThrow(/tall/);
    expect(() => stripImageMetadata(png(30000, 30000))).toThrow(UnsupportedImageError);
    expect(() => stripImageMetadata(riff([["VP8X", vp8x(0, 5000, 100)], ["VP8 ", vp8(5000, 100)]]))).toThrow(/wide/);
    expect(() => stripImageMetadata(riff([["VP8L", vp8l(9000, 10)]]))).toThrow(UnsupportedImageError);
  });

  it("refuses an animated WebP (VP8X flag or ANMF frame) and an APNG (acTL)", () => {
    expect(() => stripImageMetadata(riff([["VP8X", vp8x(0x02, 100, 100)], ["VP8 ", vp8(100, 100)]]))).toThrow(
      /animated/,
    );
    expect(() => stripImageMetadata(riff([["VP8X", vp8x(0, 100, 100)], ["ANMF", Buffer.alloc(24)]]))).toThrow(
      /animated/,
    );
    expect(() => stripImageMetadata(png(100, 100, [pngChunk("acTL", Buffer.alloc(8))]))).toThrow(/animated/);
    // A still PNG and a still WebP of the same size pass.
    expect(stripImageMetadata(png(100, 100)).format).toBe("png");
    expect(stripImageMetadata(riff([["VP8X", vp8x(0, 100, 100)], ["VP8 ", vp8(100, 100)]])).format).toBe("webp");
  });
});

describe("T6: photo volume free-space guard", () => {
  let dir: string | null = null;
  afterEach(async () => {
    setFreeSpaceProbeForTests(null);
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("refuses to store a photo with StorageFullError under 1 GiB free, and caches the probe for 60 s", async () => {
    dir = await mkdtemp(join(tmpdir(), "hetja-disk-"));
    let calls = 0;
    let free = MIN_FREE_BYTES - 1;
    setFreeSpaceProbeForTests(async () => {
      calls += 1;
      return free;
    });
    const image = stripImageMetadata(jpeg(16, 16));
    await expect(
      storePhoto(image, { STORAGE_BACKEND: "local", STORAGE_LOCAL_DIR: dir }),
    ).rejects.toBeInstanceOf(StorageFullError);

    // Cached: more space appearing is not noticed inside the 60 s window...
    free = MIN_FREE_BYTES * 10;
    const t0 = Date.now();
    await expect(assertFreeSpace(dir, t0)).rejects.toBeInstanceOf(StorageFullError);
    expect(calls).toBe(1);
    // ...and is after it.
    await expect(assertFreeSpace(dir, t0 + 61_000)).resolves.toBeUndefined();
    expect(calls).toBe(2);
    const key = await storePhoto(image, { STORAGE_BACKEND: "local", STORAGE_LOCAL_DIR: dir });
    expect(key).toMatch(/^photos\/.+\.jpg$/);
  });
});

describe("T1: the shared responder rule", () => {
  it("floors are 40 / 40 / 60 and opt-in is required", () => {
    expect(TRUST_FLOOR).toEqual({ minor: 40, serious: 40, critical: 60 });
    expect(MAX_OPEN_ACKS).toBe(2);
    expect(canRespond({ sosOptIn: true, trustScore: 40 }, "minor")).toBe(true);
    expect(canRespond({ sosOptIn: true, trustScore: 45 }, "critical")).toBe(false);
    expect(canRespond({ sosOptIn: false, trustScore: 99 }, "minor")).toBe(false);
    expect(canRespond(null, "minor")).toBe(false);
  });

  it("paged or moderator is enough on its own", () => {
    const low = { sosOptIn: false, trustScore: 0 };
    expect(mayAck({ ...low, notified: true, moderator: false }, "critical")).toBe(true);
    expect(mayAck({ ...low, notified: false, moderator: true }, "critical")).toBe(true);
    expect(mayAck({ ...low, notified: false, moderator: false }, "minor")).toBe(false);
  });
});

describe("T16: readiness and the rate_limited log line", () => {
  it("/readyz answers 200 with the database up; /healthz is unchanged", async () => {
    const app = buildServer(config);
    const ready = await app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ ok: true, db: "ok" });
    expect(ready.headers["cache-control"]).toBe("no-store");
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(Object.keys(health.json()).sort()).toEqual(["ok", "service", "time"]);
    await app.close();
  });

  it("logs { event, limiter, subjectKind } and nothing that identifies the subject", () => {
    const lines: Array<{ obj: object; msg?: string }> = [];
    logRateLimited({ warn: (obj, msg) => lines.push({ obj, msg }) }, "scanPerSubject", "device");
    expect(lines).toEqual([
      { obj: { event: "rate_limited", limiter: "scanPerSubject", subjectKind: "device" }, msg: "rate limited" },
    ]);
  });
});
