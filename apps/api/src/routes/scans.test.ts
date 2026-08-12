import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { issueDeviceToken } from "../lib/device.js";
import { query, generateSlug } from "@straynet/db";

const config = loadConfig();

// Slugs come from the real generator in @straynet/db, not a local alphabet.
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

describe("POST /api/v1/scans", () => {
  it("creates a scan and replays idempotently for the same client_uuid", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);
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
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);
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
