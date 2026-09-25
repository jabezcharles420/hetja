/**
 * POST /api/v1/scans: hardening batch 1 (2026-09-25).
 *
 *   T2  feed trust: once per dog per Mumbai day, at most 8 a rolling day,
 *       active dogs only; streak and time badges ignore feeds received more
 *       than 72 h after capture
 *   T3  per-account/device scan limiter and the 40/day photo budget
 *   T4  a geotag outside Mumbai is treated as absent
 *   T5  auth before body, the photo gate, and the offline queue's 1.9 MB photo
 *
 * The limiter and gate singletons are module state shared by every test here,
 * so each test starts from reset.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { deviceTokenSubject, issueDeviceToken } from "../lib/device.js";
import { signAccessToken } from "../lib/jwt.js";
import { photoPerSubject, scanPerSubject, subjectKey } from "../lib/rate-limit.js";
import { photoGate, type Release } from "../lib/photo-gate.js";
import { MAX_PHOTO_BASE64_CHARS } from "@hetja/contracts";
import { query, generateSlug } from "@hetja/db";

const config = loadConfig();

const dogs: string[] = [];
const feeders: string[] = [];
let storageDir: string;

async function insertDog(status = "active"): Promise<{ id: string; slug: string }> {
  const slug = generateSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, status) VALUES ($1, 'HardeningTest', 'K-West', $2::dog_status) RETURNING id`,
    [slug, status],
  );
  dogs.push(res.rows[0].id);
  return { id: res.rows[0].id, slug };
}

async function insertFeeder(): Promise<{ id: string; auth: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, verification_tier, consent_version)
     VALUES ($1, 'HardeningTest', 'feeder', 30, 'provisional', 'v1.0') RETURNING id`,
    [`scan-h1-${randomUUID()}`],
  );
  feeders.push(res.rows[0].id);
  return {
    id: res.rows[0].id,
    auth: `Bearer ${signAccessToken(res.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL)}`,
  };
}

function server() {
  return buildServer({ ...config, STORAGE_BACKEND: "local" as const, STORAGE_LOCAL_DIR: storageDir });
}

async function trustOf(feederId: string): Promise<number> {
  const res = await query<{ trust_score: number }>(`SELECT trust_score FROM feeders WHERE id = $1`, [feederId]);
  return res.rows[0].trust_score;
}

beforeEach(async () => {
  scanPerSubject.reset();
  photoPerSubject.reset();
  photoGate.reset();
  storageDir = await mkdtemp(join(tmpdir(), "hetja-h1-"));
});

afterEach(async () => {
  for (const id of feeders) {
    await query(`DELETE FROM trust_events WHERE feeder_id = $1`, [id]);
    await query(`DELETE FROM scans WHERE feeder_id = $1`, [id]);
  }
  for (const id of dogs.splice(0)) {
    await query(`DELETE FROM scans WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM collars WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM dogs WHERE id = $1`, [id]);
  }
  for (const id of feeders.splice(0)) await query(`DELETE FROM feeders WHERE id = $1`, [id]);
  await rm(storageDir, { recursive: true, force: true });
});

// A structurally valid baseline JPEG of `entropyBytes` scan data at w x h.
function jpeg(width: number, height: number, entropyBytes: number): Buffer {
  const seg = (marker: number, payload: Buffer) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
  };
  const sof = Buffer.from([0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 0x10)])),
    seg(0xc0, sof),
    seg(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(16, 0x00), Buffer.from([0x00])])),
    seg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.alloc(entropyBytes, 0x31),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe("T5: body limits, auth before body, photo gate", () => {
  it("accepts a 1.9 MB photo from the offline queue (200, stored)", async () => {
    const app = server();
    const dog = await insertDog();
    const photo = jpeg(1600, 1200, 1_900_000);
    const photoBase64 = photo.toString("base64");
    expect(photoBase64.length).toBeLessThan(MAX_PHOTO_BASE64_CHARS);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": issueDeviceToken(config.HETJA_DEVICE_SECRET) },
      payload: { clientUuid: randomUUID(), dogSlug: dog.slug, type: "feed", capturedAt: new Date().toISOString(), photoBase64 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.created).toBe(true);
    expect(res.json().data.photoAccepted).toBeUndefined();
    const scanId = res.json().data.scanId as string;
    let key: string | null = null;
    for (let i = 0; i < 60 && !key; i++) {
      key = (await query<{ k: string | null }>(`SELECT photo_s3_key AS k FROM scans WHERE id = $1`, [scanId])).rows[0].k;
      if (!key) await new Promise((r) => setTimeout(r, 50));
    }
    expect(key).toMatch(/^photos\/.+\.jpg$/);
    expect((await readFile(join(storageDir, key!))).length).toBeGreaterThan(1_900_000);
    // The permit was released once the photo was on disk.
    expect(photoGate.inFlight).toBe(0);
    await app.close();
  });

  it("answers an unauthenticated 2 MB scan 401 before reading the body (not 413, no row)", async () => {
    const app = server();
    const clientUuid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      payload: { clientUuid, dogSlug: "x", type: "feed", capturedAt: new Date().toISOString(), photoBase64: "A".repeat(2_000_000) },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED_DEVICE");
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: "Bearer not-a-jwt" },
      payload: { clientUuid, dogSlug: "x", type: "feed", capturedAt: new Date().toISOString(), photoBase64: "A".repeat(2_000_000) },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().error.code).toBe("BAD_ACCESS_TOKEN");
    const rows = await query<{ n: number }>(`SELECT count(*)::int AS n FROM scans WHERE client_uuid = $1`, [clientUuid]);
    expect(rows.rows[0].n).toBe(0);
    await app.close();
  });

  it("refuses a body over the photo route limit with 413", async () => {
    const app = server();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": issueDeviceToken(config.HETJA_DEVICE_SECRET) },
      payload: { photoBase64: "A".repeat(MAX_PHOTO_BASE64_CHARS + 70 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  it("answers 503 PHOTO_BUSY with retry-after 5 when the photo gate is saturated", async () => {
    const app = server();
    const dog = await insertDog();
    const held: Release[] = [await photoGate.acquire(), await photoGate.acquire()];
    const waiting = Array.from({ length: 8 }, () => photoGate.acquire().then((r) => held.push(r)).catch(() => {}));
    expect(photoGate.queued).toBe(8);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": issueDeviceToken(config.HETJA_DEVICE_SECRET) },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: dog.slug,
        type: "feed",
        capturedAt: new Date().toISOString(),
        photoBase64: jpeg(16, 16, 32).toString("base64"),
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("PHOTO_BUSY");
    expect(res.headers["retry-after"]).toBe("5");
    // Drop the synthetic holders and waiters (their promises are left
    // pending; beforeEach resets the gate for the next test).
    photoGate.reset();
    void waiting;
    await app.close();
  });

  it("rejects a photo wider than 4096 px as INVALID_PHOTO", async () => {
    const app = server();
    const dog = await insertDog();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": issueDeviceToken(config.HETJA_DEVICE_SECRET) },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: dog.slug,
        type: "feed",
        capturedAt: new Date().toISOString(),
        photoBase64: jpeg(5000, 100, 32).toString("base64"),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_PHOTO");
    expect(photoGate.inFlight).toBe(0);
    await app.close();
  });
});

describe("T3: per-subject scan limiter and photo budget", () => {
  it("allows a burst of 30 per device, then 429 RATE_LIMITED with retry-after; another device is unaffected", async () => {
    const app = server();
    const dog = await insertDog();
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const post = (t: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/scans",
        headers: { "x-device-token": t },
        payload: { clientUuid: randomUUID(), dogSlug: dog.slug, type: "view", capturedAt: new Date().toISOString() },
      });
    for (let i = 0; i < 30; i++) expect((await post(token)).statusCode).toBe(200);
    const limited = await post(token);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect((await post(issueDeviceToken(config.HETJA_DEVICE_SECRET))).statusCode).toBe(200);
    await app.close();
  });

  it("over the 40/day photo budget: the scan is recorded with photoAccepted:false and no photo", async () => {
    const app = server();
    const dog = await insertDog();
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const subject = subjectKey(null, deviceTokenSubject(token, config.HETJA_DEVICE_SECRET));
    for (let i = 0; i < 40; i++) expect(photoPerSubject.consume(subject).allowed).toBe(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": token },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: dog.slug,
        type: "feed",
        capturedAt: new Date().toISOString(),
        photoBase64: jpeg(16, 16, 32).toString("base64"),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.created).toBe(true);
    expect(res.json().data.photoAccepted).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    const row = await query<{ k: string | null }>(`SELECT photo_s3_key AS k FROM scans WHERE id = $1`, [
      res.json().data.scanId,
    ]);
    expect(row.rows[0].k).toBeNull();
    await app.close();
  });
});

describe("T4: Mumbai-only geo", () => {
  it("a London geotag is treated as absent: no activation, no last_seen, no stored geo, geoAccepted:false", async () => {
    const app = server();
    const dog = await insertDog("pending_activation");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": issueDeviceToken(config.HETJA_DEVICE_SECRET) },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: dog.slug,
        type: "retag",
        geo: { lat: 51.5, lng: -0.12 },
        capturedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.created).toBe(true);
    expect(res.json().data.geoAccepted).toBe(false);
    const d = await query<{ status: string; last_seen_at: Date | null; has_geo: boolean; eligible: Date | null }>(
      `SELECT status::text AS status, last_seen_at, last_seen_geo IS NOT NULL AS has_geo, sos_eligible_at AS eligible
         FROM dogs WHERE id = $1`,
      [dog.id],
    );
    expect(d.rows[0]).toEqual({ status: "pending_activation", last_seen_at: null, has_geo: false, eligible: null });
    const scan = await query<{ has_geo: boolean }>(`SELECT geo IS NOT NULL AS has_geo FROM scans WHERE id = $1`, [
      res.json().data.scanId,
    ]);
    expect(scan.rows[0].has_geo).toBe(false);
    await app.close();
  });

  it("a Mumbai geotag is accepted: activates, moves last_seen, geoAccepted:true; no geo sent means no field", async () => {
    const app = server();
    const dog = await insertDog("pending_activation");
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": token },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: dog.slug,
        type: "retag",
        geo: { lat: 19.07, lng: 72.87 },
        capturedAt: new Date().toISOString(),
      },
    });
    expect(res.json().data.geoAccepted).toBe(true);
    const d = await query<{ status: string; has_geo: boolean }>(
      `SELECT status::text AS status, last_seen_geo IS NOT NULL AS has_geo FROM dogs WHERE id = $1`,
      [dog.id],
    );
    expect(d.rows[0]).toEqual({ status: "active", has_geo: true });

    const noGeo = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": token },
      payload: { clientUuid: randomUUID(), dogSlug: dog.slug, type: "view", capturedAt: new Date().toISOString() },
    });
    expect(noGeo.json().data).not.toHaveProperty("geoAccepted");
    await app.close();
  });
});

describe("T2: feed trust dedupe, daily cap and backdating guard", () => {
  function feed(app: ReturnType<typeof server>, auth: string, dogSlug: string, capturedAt = new Date()) {
    return app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: auth },
      payload: { clientUuid: randomUUID(), dogSlug, type: "feed", capturedAt: capturedAt.toISOString() },
    });
  }

  it("5 feeds of the same dog on one day earn +1 once (31)", async () => {
    const app = server();
    const dog = await insertDog();
    const f = await insertFeeder();
    for (let i = 0; i < 5; i++) expect((await feed(app, f.auth, dog.slug)).json().data.created).toBe(true);
    expect(await trustOf(f.id)).toBe(31);
    const scans = await query<{ n: number }>(`SELECT count(*)::int AS n FROM scans WHERE feeder_id = $1`, [f.id]);
    expect(scans.rows[0].n).toBe(5); // every scan is still recorded
    await app.close();
  });

  it("12 different dogs in a day are capped at 8 credits (38)", async () => {
    const app = server();
    const f = await insertFeeder();
    for (let i = 0; i < 12; i++) {
      const dog = await insertDog();
      expect((await feed(app, f.auth, dog.slug)).statusCode).toBe(200);
    }
    expect(await trustOf(f.id)).toBe(38);
    await app.close();
  });

  it("a feed of a pending (not yet active) dog earns nothing", async () => {
    const app = server();
    const dog = await insertDog("pending_activation");
    const f = await insertFeeder();
    expect((await feed(app, f.auth, dog.slug)).json().data.created).toBe(true);
    expect(await trustOf(f.id)).toBe(30);
    await app.close();
  });

  it("backdated feeds (older than 72 h on arrival) build no streak and no badge", async () => {
    const app = server();
    const f = await insertFeeder();
    const dog = await insertDog();
    const day = 86_400_000;
    // 26 consecutive days, 4 to 29 days ago, the last one at 23:00 IST
    // (17:30Z) to try for night_owl too.
    for (let d = 29; d >= 4; d--) {
      const t = new Date(Date.now() - d * day);
      t.setUTCHours(17, 30, 0, 0);
      const res = await feed(app, f.auth, dog.slug, t);
      expect(res.statusCode).toBe(200);
    }
    const before = await query<{ streak_days: number; last_feed_date: string | null }>(
      `SELECT streak_days, last_feed_date::text AS last_feed_date FROM feeders WHERE id = $1`,
      [f.id],
    );
    expect(before.rows[0]).toEqual({ streak_days: 0, last_feed_date: null });

    // The live feed at the latest 12:00 IST (06:30Z), not "now": run at night,
    // a feed captured now would earn night_owl honestly and fail this test.
    const noon = new Date();
    noon.setUTCHours(6, 30, 0, 0);
    if (noon.getTime() > Date.now()) noon.setTime(noon.getTime() - day);
    const live = await feed(app, f.auth, dog.slug, noon);
    expect(live.json().data.streak.streakDays).toBe(1);
    const badges = await app.inject({
      method: "POST",
      url: "/api/v1/feeders/me/badges/check",
      headers: { authorization: f.auth },
      payload: {},
    });
    expect(badges.statusCode).toBe(200);
    const earned = badges.json().data.awarded as string[];
    expect(earned).not.toContain("month_streak");
    expect(earned).not.toContain("week_streak");
    expect(earned).not.toContain("night_owl");
    await app.close();
  });

  it("a feed captured 10 h ago is credited and moves the streak", async () => {
    const app = server();
    const f = await insertFeeder();
    const dog = await insertDog();
    const res = await feed(app, f.auth, dog.slug, new Date(Date.now() - 10 * 3_600_000));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.streak.streakDays).toBe(1);
    expect(await trustOf(f.id)).toBe(31);
    await app.close();
  });
});
