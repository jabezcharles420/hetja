/**
 * Public hunger heatmap route tests.
 *
 * 1. a ward with a cluster of active dogs + feed scans returns exactly one
 *    cell: centroid only (≤2 decimals), correct fedRatio, and a lone dog's
 *    cell is dropped (k-anonymity floor of 3 active dogs, RESEARCH-1 E2).
 * 2. a ward with no feed scans returns empty cells.
 * 3. invalid query params are rejected.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { query } from "@straynet/db";

const config = loadConfig();
const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function randomSlug(): string {
  let slug = "";
  for (let i = 0; i < 9; i++) slug += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  return slug;
}

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

interface Fixture {
  app: FastifyInstance;
  wardId: string;
  dogIds: string[];
}

async function insertDog(wardId: string): Promise<{ id: string; slug: string }> {
  const slug = randomSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id) VALUES ($1, 'HeatmapTestDog', $2) RETURNING id`,
    [slug, wardId],
  );
  return { id: res.rows[0].id, slug };
}

async function insertFeedScan(dogId: string, lat: number, lng: number): Promise<void> {
  await query(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, captured_at, received_at, review_status)
     VALUES ($1, $2, 'feed', $3::geography, now() - interval '1 day', now(), 'pending')`,
    [dogId, randomUUID(), geoWkt(lat, lng)],
  );
}

async function cleanup(fixture: Fixture): Promise<void> {
  for (const dogId of fixture.dogIds) {
    await query(`DELETE FROM scans WHERE dog_id = $1`, [dogId]);
    await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
  }
}

function atMostTwoDecimals(x: number): boolean {
  return Number(x.toFixed(2)) === x;
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = {
    app: buildServer(config),
    wardId: `H${randomUUID().slice(0, 8)}`,
    dogIds: [],
  };
  await fixture.app.ready();
});

afterEach(async () => {
  await cleanup(fixture);
  await fixture.app.close();
});

describe("GET /api/v1/heatmap", () => {
  it("returns only cell centroids with correct fedRatio and k-anonymity floor", async () => {
    const cluster: Array<[number, number]> = [
      [19.08, 72.87],
      [19.0802, 72.8702],
      [19.0798, 72.8698],
    ];
    for (const [lat, lng] of cluster) {
      const dog = await insertDog(fixture.wardId);
      fixture.dogIds.push(dog.id);
      await insertFeedScan(dog.id, lat, lng);
    }

    const lone = await insertDog(fixture.wardId);
    fixture.dogIds.push(lone.id);
    await insertFeedScan(lone.id, 19.08, 72.9);

    const res = await fixture.app.inject({
      method: "GET",
      url: `/api/v1/heatmap?ward=${fixture.wardId}&days=7`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");

    const cells = res.json().data.cells as Array<{
      lat: number;
      lng: number;
      fedRatio: number;
      feedCount: number;
      dogCount: number;
    }>;
    expect(cells).toHaveLength(1);

    const cell = cells[0];
    expect(atMostTwoDecimals(cell.lat)).toBe(true);
    expect(atMostTwoDecimals(cell.lng)).toBe(true);
    expect(cell.feedCount).toBe(3);
    expect(cell.dogCount).toBe(3);
    expect(cell.fedRatio).toBe(1);
  });

  it("returns empty cells for a ward with no feed scans", async () => {
    const res = await fixture.app.inject({
      method: "GET",
      url: `/api/v1/heatmap?ward=${fixture.wardId}&days=7`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.cells).toEqual([]);
  });

  it("rejects an invalid days parameter", async () => {
    const res = await fixture.app.inject({
      method: "GET",
      url: `/api/v1/heatmap?ward=${fixture.wardId}&days=999`,
    });

    expect(res.statusCode).toBe(400);
  });
});
