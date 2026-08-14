import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { issueDeviceToken } from "../lib/device.js";
import { query, generateSlug } from "@hetja/db";

const config = loadConfig();

// Slugs come from the real generator in @hetja/db, not a local alphabet.
// Eight test files each kept their own copy reading
// "abcdefghijklmnopqrstuvwxyz234567" -- which includes the confusable `l` that
// the generator never emits, and excludes 8/9 which it does. Those fixtures
// produced slugs that cannot exist, so once slug validation was corrected about
// one run in four failed on a random `l`. Using the generator keeps the tests
// honest and removes the ninth copy of this alphabet.
function randomSlug(): string {
  return generateSlug();
}

let dogId: string;
let dogSlug: string;

beforeEach(async () => {
  dogSlug = randomSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id) VALUES ($1, 'ScanTest', 'G/North') RETURNING id`,
    [dogSlug],
  );
  dogId = res.rows[0].id;
});

afterEach(async () => {
  await query(`DELETE FROM scans WHERE dog_id = $1`, [dogId]);
  await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
});

// ---------------------------------------------------------------------------
// Photo fixtures
//
// One realistic GPS-bearing JPEG and one WebP, built here rather than imported:
// the exhaustive container coverage (progressive scans, RIFF padding, PNG CRCs,
// every rejection path) lives in lib/exif-strip.test.ts, and importing one test
// file from another would register that whole suite a second time. What these
// two need to prove is different and route-level: that the bytes which actually
// land on disk are metadata-free, and that the key's extension matches the
// container that was uploaded.
// ---------------------------------------------------------------------------

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
}

/**
 * An Exif APP1 with a GPS IFD carrying GPSLatitude/GPSLongitude — what an
 * unmodified iPhone JPEG hands over. TIFF offsets are relative to the TIFF
 * header, which begins 6 bytes into the APP1 payload (after "Exif\0\0").
 */
function exifApp1WithGps(): Buffer {
  const long = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
  };
  const rational = (num: number, den: number): Buffer => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(num, 0);
    b.writeUInt32LE(den, 4);
    return b;
  };
  const entry = (tag: number, type: number, count: number, value: Buffer): Buffer => {
    const b = Buffer.alloc(12);
    b.writeUInt16LE(tag, 0);
    b.writeUInt16LE(type, 2);
    b.writeUInt32LE(count, 4);
    value.copy(b, 8);
    return b;
  };

  const GPS_IFD_OFFSET = 8 + 18;
  const LAT_OFFSET = GPS_IFD_OFFSET + 54;
  const LNG_OFFSET = LAT_OFFSET + 24;

  return jpegSegment(
    0xe1,
    Buffer.concat([
      Buffer.from("Exif", "latin1"),
      Buffer.from([0x00, 0x00]),
      Buffer.from("II", "latin1"),
      Buffer.from([0x2a, 0x00]),
      long(8),
      Buffer.from([0x01, 0x00]),
      entry(0x8825, 4, 1, long(GPS_IFD_OFFSET)), // GPSInfoIFDPointer
      long(0),
      Buffer.from([0x04, 0x00]),
      entry(0x0001, 2, 2, Buffer.from("N ", "latin1")), // GPSLatitudeRef
      entry(0x0002, 5, 3, long(LAT_OFFSET)), // GPSLatitude
      entry(0x0003, 2, 2, Buffer.from("E ", "latin1")), // GPSLongitudeRef
      entry(0x0004, 5, 3, long(LNG_OFFSET)), // GPSLongitude
      long(0),
      // 19 deg 4' 34" N, 72 deg 52' 39" E — a real point in Mumbai. If this
      // reaches disk, so does the feeder's feeding spot.
      rational(19, 1),
      rational(4, 1),
      rational(34, 1),
      rational(72, 1),
      rational(52, 1),
      rational(39, 1),
    ]),
  );
}

const APP1_EXIF_GPS = exifApp1WithGps();
const JPEG_ENTROPY = Buffer.from([0x31, 0x41, 0xff, 0x00, 0x59, 0x26, 0x53, 0x58, 0x97, 0x93]);

const JPEG_WITH_GPS = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  APP1_EXIF_GPS,
  jpegSegment(0xfe, Buffer.from("shot at home", "latin1")), // COM
  jpegSegment(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 0x10)])), // DQT
  jpegSegment(0xc0, Buffer.from([0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00])), // SOF0
  jpegSegment(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(16, 0x00), Buffer.from([0x00])])), // DHT
  jpegSegment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])), // SOS
  JPEG_ENTROPY,
  Buffer.from([0xff, 0xd9]), // EOI
]);

/** A minimal WebP: the container the browser pipeline emits for most feeders. */
function buildWebpWithExif(): Buffer {
  const chunk = (fourcc: string, payload: Buffer): Buffer => {
    const header = Buffer.alloc(8);
    header.write(fourcc, 0, "latin1");
    header.writeUInt32LE(payload.length, 4);
    const pad = payload.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
    return Buffer.concat([header, payload, pad]);
  };
  const body = Buffer.concat([
    chunk("VP8 ", Buffer.from([0x9d, 0x01, 0x2a, 0x10, 0x00, 0x10, 0x00, 0x33])),
    chunk("EXIF", Buffer.concat([Buffer.from("Exif", "latin1"), Buffer.alloc(12, 0x77)])),
  ]);
  const out = Buffer.alloc(12 + body.length);
  out.write("RIFF", 0, "latin1");
  out.writeUInt32LE(4 + body.length, 4);
  out.write("WEBP", 8, "latin1");
  body.copy(out, 12);
  return out;
}

const WEBP_WITH_EXIF = buildWebpWithExif();

/**
 * The photo write is deliberately backgrounded (`void persistScanAssets`) so it
 * never delays the scan response, so the key appears a moment after the 200.
 * Poll rather than sleep a fixed amount.
 */
async function waitForPhotoKey(scanId: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await query<{ photo_s3_key: string | null }>(
      `SELECT photo_s3_key FROM scans WHERE id = $1`,
      [scanId],
    );
    const key = res.rows[0]?.photo_s3_key;
    if (key) return key;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`photo_s3_key never appeared for scan ${scanId}`);
}

describe("POST /api/v1/scans", () => {
  it("creates a scan and replays idempotently for the same client_uuid", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const clientUuid = randomUUID();
    const payload = {
      clientUuid,
      dogSlug,
      type: "view",
      capturedAt: new Date().toISOString(),
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": token },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.created).toBe(true);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": token },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.created).toBe(false);

    const count = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM scans WHERE client_uuid = $1`,
      [clientUuid],
    );
    expect(Number(count.rows[0].n)).toBe(1);

    await app.close();
  });

  it("requires an attested device token", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      payload: {
        clientUuid: randomUUID(),
        dogSlug,
        type: "view",
        capturedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);

    await app.close();
  });

  it("applies LWW on dogs.last_seen_geo by captured_at", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const base = Date.now();
    const scans = [
      { capturedAt: new Date(base).toISOString(), lat: 19.1, lng: 72.9 },
      { capturedAt: new Date(base - 5 * 60 * 1000).toISOString(), lat: 19.2, lng: 72.8 },
      { capturedAt: new Date(base + 2 * 60 * 1000).toISOString(), lat: 19.3, lng: 72.7 },
    ];
    for (const s of scans) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/scans",
        headers: { "x-device-token": token },
        payload: {
          clientUuid: randomUUID(),
          dogSlug,
          type: "feed",
          geo: { lat: s.lat, lng: s.lng },
          capturedAt: s.capturedAt,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.created).toBe(true);
    }

    const row = await query<{ last_seen_at: string; lat: number | null }>(
      `SELECT last_seen_at, ST_Y(last_seen_geo::geometry) AS lat FROM dogs WHERE id = $1`,
      [dogId],
    );
    expect(new Date(row.rows[0].last_seen_at).getTime()).toBe(base + 2 * 60 * 1000);
    expect(row.rows[0].lat).toBeCloseTo(19.3, 5);

    await app.close();
  });
});

describe("POST /api/v1/scans — photo handling", () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "hetja-photo-test-"));
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  function serverWithTempStorage() {
    return buildServer({ ...config, STORAGE_BACKEND: "local" as const, STORAGE_LOCAL_DIR: storageDir });
  }

  it("stores a GPS-bearing JPEG with the GPS stripped (asserted on the bytes on disk)", async () => {
    const app = serverWithTempStorage();
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": token },
      payload: {
        clientUuid: randomUUID(),
        dogSlug,
        type: "feed",
        photoBase64: JPEG_WITH_GPS.toString("base64"),
        capturedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(200);
    const scanId = res.json().data.scanId as string;

    const key = await waitForPhotoKey(scanId);
    const stored = await readFile(join(storageDir, key));

    // The assertion is on the file that a public GET /api/v1/dogs/:slug would
    // hand to dogPhotoUrl(), not on any intermediate value: this is the only
    // place the browser-side strip could have been bypassed and the only bytes
    // a stranger can download.
    expect(stored.includes(Buffer.from("Exif", "latin1"))).toBe(false);
    expect(stored.includes(Buffer.from([0x25, 0x88]))).toBe(false); // GPSInfoIFDPointer tag, LE
    expect(stored.includes(APP1_EXIF_GPS)).toBe(false);
    expect(stored.includes(Buffer.from("shot at home", "latin1"))).toBe(false);

    // ...and the photo itself is intact: SOI/EOI in place and the entropy-coded
    // pixel data byte-identical to what was uploaded.
    expect(stored.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(stored.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(stored.includes(JPEG_ENTROPY)).toBe(true);
    expect(stored.length).toBeLessThan(JPEG_WITH_GPS.length);

    await app.close();
  });

  it("names the key after the container that was actually uploaded, not .jpg", async () => {
    // The browser pipeline emits WebP for every browser that can encode it, so a
    // hardcoded .jpg key made a static server label those bytes image/jpeg —
    // which helmet's X-Content-Type-Options: nosniff then refuses to sniff past,
    // so the <img> never renders.
    const app = serverWithTempStorage();
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": token },
      payload: {
        clientUuid: randomUUID(),
        dogSlug,
        type: "feed",
        photoBase64: WEBP_WITH_EXIF.toString("base64"),
        capturedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(200);

    const key = await waitForPhotoKey(res.json().data.scanId as string);
    expect(key).toMatch(/^photos\/[0-9a-f-]{36}\.webp$/);

    const stored = await readFile(join(storageDir, key));
    expect(stored.toString("latin1", 0, 4)).toBe("RIFF");
    expect(stored.toString("latin1", 8, 12)).toBe("WEBP");
    expect(stored.includes(Buffer.from("EXIF", "latin1"))).toBe(false);
    // The RIFF size field has to be corrected after dropping the EXIF chunk.
    expect(stored.readUInt32LE(4)).toBe(stored.length - 8);

    await app.close();
  });

  it("rejects a non-image payload instead of storing unknown bytes", async () => {
    const app = serverWithTempStorage();
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const clientUuid = randomUUID();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": token },
      payload: {
        clientUuid,
        dogSlug,
        type: "feed",
        photoBase64: Buffer.from("<?php system($_GET['c']); ?>".padEnd(64, " "), "latin1").toString("base64"),
        capturedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_PHOTO");

    // Rejected before the row exists, so there is nothing half-written to
    // reconcile later.
    const count = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM scans WHERE client_uuid = $1`,
      [clientUuid],
    );
    expect(Number(count.rows[0].n)).toBe(0);

    await app.close();
  });
});
