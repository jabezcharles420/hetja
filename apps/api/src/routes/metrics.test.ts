import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { query } from "@hetja/db";

const config = loadConfig();

const createdFeeders: string[] = [];
const createdVitals: number[] = [];

async function makeFeeder(): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, $2, 'feeder', 40, 'v1', FALSE) RETURNING id`,
    [randomUUID(), `vitals-test-${randomUUID()}`],
  );
  const id = res.rows[0].id;
  createdFeeders.push(id);
  return signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL);
}

afterEach(async () => {
  if (createdVitals.length > 0) {
    await query(`DELETE FROM web_vitals WHERE id = ANY($1::bigint[])`, [createdVitals]);
    createdVitals.length = 0;
  }
  if (createdFeeders.length > 0) {
    await query(`DELETE FROM feeders WHERE id = ANY($1::uuid[])`, [createdFeeders]);
    createdFeeders.length = 0;
  }
});

describe("POST /api/v1/metrics/web-vitals (enhancement stack §M.16)", () => {
  it("records a valid anonymous sample", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: "/d/:slug", name: "LCP", value: 1234.5, rating: "good" },
    });
    expect(res.statusCode).toBe(200);
    const rows = await query<{ id: number; path: string; name: string }>(
      `SELECT id, path, name FROM web_vitals WHERE name = 'LCP' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows.rows[0].path).toBe("/d/:slug");
    createdVitals.push(rows.rows[0].id);
    await app.close();
  });

  it("rejects an invalid metric name with 400", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: "/d/:slug", name: "FID", value: 100, rating: "good" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects a negative value with 400", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: "/d/:slug", name: "CLS", value: -0.1, rating: "poor" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects a slug-bearing path (privacy: slug must be stripped)", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: "/d/abc123def?s=xyz", name: "INP", value: 50, rating: "good" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/v1/metrics/web-vitals (enhancement stack §M.16)", () => {
  it("requires feeder auth", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: "/api/v1/metrics/web-vitals?days=7" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns per-name/rating counts for an authenticated feeder", async () => {
    const token = await makeFeeder();
    const app = buildServer(config);
    await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: "/d/:slug", name: "INP", value: 100, rating: "good" },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/web-vitals?days=7",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const inp = body.data.counts.find((c: { name: string; rating: string }) => c.name === "INP" && c.rating === "good");
    expect(inp.count).toBeGreaterThanOrEqual(1);
    await app.close();
  });
});
