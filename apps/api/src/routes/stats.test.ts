/**
 * Impact stats route tests.
 *
 * GET /api/v1/stats/impact — public, no auth, Cache-Control 60s.
 * Counts are coarsened per INVARIANT 2 (integers only, no geo).
 *
 * 1. returns three integer fields, Cache-Control public max-age=60
 * 2. counts active dogs (not pending_activation), total feeds, distinct livesTouched
 * 3. requires no auth
 * 4. in-process cache holds value for 60s (clearable for tests)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { query, generateSlug } from "@hetja/db";
import { impactCache } from "./stats.js";

const config = loadConfig();

function randomSlug(): string {
  return generateSlug();
}

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

let app: FastifyInstance;
const dogIds: string[] = [];

async function insertDog(status: string, wardId: string): Promise<string> {
  const slug = randomSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, ward_id, status) VALUES ($1, $2, $3::dog_status) RETURNING id`,
    [slug, wardId, status],
  );
  const id = res.rows[0].id;
  dogIds.push(id);
  return id;
}

async function insertFeedScan(dogId: string): Promise<void> {
  await query(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, captured_at, received_at, review_status)
     VALUES ($1, $2, 'feed', $3::geography, now(), now(), 'pending')`,
    [dogId, randomUUID(), geoWkt(19.07, 72.87)],
  );
}

async function cleanup(): Promise<void> {
  for (const id of dogIds) {
    await query(`DELETE FROM scans WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM dogs WHERE id = $1`, [id]);
  }
  dogIds.length = 0;
}

beforeEach(async () => {
  impactCache.clear();
  app = buildServer(config);
  await app.ready();
});

afterEach(async () => {
  await cleanup();
  await app.close();
  impactCache.clear();
});

describe("GET /api/v1/stats/impact", () => {
  it("returns three integer fields with Cache-Control public max-age=60 and no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/stats/impact" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.dogsTracked).toBe("number");
    expect(typeof body.data.feedsLogged).toBe("number");
    expect(typeof body.data.livesTouched).toBe("number");
    expect(Number.isInteger(body.data.dogsTracked)).toBe(true);
    expect(Number.isInteger(body.data.feedsLogged)).toBe(true);
    expect(Number.isInteger(body.data.livesTouched)).toBe(true);
  });

  it("counts active dogs, total feed scans, and distinct dogs fed", async () => {
    // Snapshot before our fixtures so test does not assume empty DB
    const before = await app.inject({ method: "GET", url: "/api/v1/stats/impact" });
    const beforeDogs = before.json().data.dogsTracked as number;
    const beforeFeeds = before.json().data.feedsLogged as number;
    const beforeLives = before.json().data.livesTouched as number;
    impactCache.clear();

    const ward = `W${randomUUID().slice(0, 6)}`;
    const active1 = await insertDog("active", ward);
    const active2 = await insertDog("active", ward);
    await insertDog("pending_activation", ward);

    // 3 feeds: 2 for active1, 1 for active2 => distinct livesTouched should increase by 2
    await insertFeedScan(active1);
    await insertFeedScan(active1);
    await insertFeedScan(active2);

    // Clear cache so next GET reads fresh rows
    impactCache.clear();

    const res = await app.inject({ method: "GET", url: "/api/v1/stats/impact" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { dogsTracked: number; feedsLogged: number; livesTouched: number };
    expect(data.dogsTracked).toBe(beforeDogs + 2);
    expect(data.feedsLogged).toBe(beforeFeeds + 3);
    expect(data.livesTouched).toBe(beforeLives + 2);
  });

  it("serves cached value until cache is cleared", async () => {
    const first = await app.inject({ method: "GET", url: "/api/v1/stats/impact" });
    const firstDogs = first.json().data.dogsTracked as number;

    // Insert a new active dog behind the cache
    const ward = `W${randomUUID().slice(0, 6)}`;
    await insertDog("active", ward);

    // Second GET should still return cached first value
    const second = await app.inject({ method: "GET", url: "/api/v1/stats/impact" });
    expect(second.json().data.dogsTracked).toBe(firstDogs);

    // After clearing, fresh count includes the new dog
    impactCache.clear();
    const third = await app.inject({ method: "GET", url: "/api/v1/stats/impact" });
    expect(third.json().data.dogsTracked).toBe(firstDogs + 1);
  });

  it("returns only counts — no geo or per-dog identity", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/stats/impact" });
    const data = res.json().data as Record<string, unknown>;
    // Coarsened per INVARIANT 2: integers only
    expect(Object.keys(data).sort()).toEqual(["dogsTracked", "feedsLogged", "livesTouched"]);
    for (const v of Object.values(data)) {
      expect(typeof v).toBe("number");
    }
    // No geo leakage
    expect("lat" in data).toBe(false);
    expect("lng" in data).toBe(false);
    expect("geo" in data).toBe(false);
  });
});
