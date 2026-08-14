import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { generateSlug, query } from "@hetja/db";
import {
  INGEST_BURST,
  INGEST_REFILL_PER_SEC,
  admitVitalsSample,
  drainVitalsIngestBucket,
  pathCarriesDogIdentity,
  resetVitalsIngestBucket,
} from "./metrics.js";

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

/** Register whatever row the last POST created so afterEach can remove it. */
async function trackLatestVital(path: string, name: string): Promise<void> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM web_vitals WHERE path = $1 AND name = $2 ORDER BY id DESC LIMIT 1`,
    [path, name],
  );
  const row = rows.rows[0];
  if (row) createdVitals.push(row.id);
}

// The ingest bucket is module state that persists across `buildServer` calls, so
// every test starts from a known budget. Without this the first suite to run
// would silently change the outcome of the ones after it.
beforeEach(() => {
  resetVitalsIngestBucket();
});

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

describe("POST /api/v1/metrics/web-vitals — ingest cap", () => {
  it("accepts a normal beacon while the budget is intact", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: "/scan", name: "TTFB", value: 210, rating: "good" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.recorded).toBe(true);
    await trackLatestVital("/scan", "TTFB");
    await app.close();
  });

  it("drops silently with 204 and writes nothing once the cap is spent", async () => {
    const app = buildServer(config);
    // A distinctive path so "no row was written" is checkable directly.
    const path = `/flood-${randomUUID()}`;
    drainVitalsIngestBucket();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path, name: "LCP", value: 900, rating: "poor" },
    });
    // 204, not 429: sendBeacon neither reads the response nor retries, so an
    // error status would communicate with nobody and would make a working cap
    // look like a client failure in every proxy log in front of us.
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");

    const count = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM web_vitals WHERE path = $1`,
      [path],
    );
    expect(Number(count.rows[0].n)).toBe(0);

    await app.close();
  });

  it("accepts again once the bucket refills", async () => {
    const app = buildServer(config);
    drainVitalsIngestBucket();
    const dropped = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: "/scan", name: "LCP", value: 900, rating: "poor" },
    });
    expect(dropped.statusCode).toBe(204);

    resetVitalsIngestBucket();
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: "/scan", name: "LCP", value: 900, rating: "poor" },
    });
    expect(accepted.statusCode).toBe(200);
    await trackLatestVital("/scan", "LCP");
    await app.close();
  });
});

describe("admitVitalsSample (token bucket)", () => {
  // Tested with an injected clock rather than by firing INGEST_BURST+1 real
  // requests: proving where the ceiling is should not cost 600 INSERTs.
  it("admits exactly INGEST_BURST samples from a full bucket, then drops", () => {
    // The injected clock has to be AHEAD of the reset's own Date.now(), or the
    // refill arithmetic sees negative elapsed time and the test would be
    // asserting against a code path that never runs in production.
    const now = Date.now() + 60_000;
    resetVitalsIngestBucket();
    for (let i = 0; i < INGEST_BURST; i++) {
      expect(admitVitalsSample(now)).toBe(true);
    }
    expect(admitVitalsSample(now)).toBe(false);
    expect(admitVitalsSample(now)).toBe(false);
  });

  it("refills at INGEST_REFILL_PER_SEC and never past the burst ceiling", () => {
    const now = Date.now() + 60_000;
    resetVitalsIngestBucket();
    for (let i = 0; i < INGEST_BURST; i++) admitVitalsSample(now);
    expect(admitVitalsSample(now)).toBe(false);

    // One second later exactly INGEST_REFILL_PER_SEC samples are available.
    const oneSecondLater = now + 1000;
    for (let i = 0; i < INGEST_REFILL_PER_SEC; i++) {
      expect(admitVitalsSample(oneSecondLater)).toBe(true);
    }
    expect(admitVitalsSample(oneSecondLater)).toBe(false);

    // An hour of quiet does not bank an hour of budget.
    const muchLater = oneSecondLater + 3_600_000;
    for (let i = 0; i < INGEST_BURST; i++) {
      expect(admitVitalsSample(muchLater)).toBe(true);
    }
    expect(admitVitalsSample(muchLater)).toBe(false);
  });
});

describe("pathCarriesDogIdentity (INVARIANT 2 for telemetry)", () => {
  it("accepts ordinary route paths, including nine-letter ones", () => {
    // The old guard was an unanchored /[a-km-z2-9]{9}/, so every one of these
    // 400'd: "dashboard" is nine characters and every one of them is in the
    // collar alphabet, "leaderboard" contains "eaderboard", and so on. No route
    // in the app trips it today, which is the only reason this was latent — the
    // first nine-letter route added would have silently lost all its telemetry.
    for (const path of [
      "/",
      "/dashboard",
      "/leaderboard",
      "/gamification",
      "/territories",
      "/how-it-works",
      "/scan",
      "/me",
      "/d/:slug",
      "/dog/:slug",
      "/settings/notifications",
    ]) {
      expect(pathCarriesDogIdentity(path)).toBe(false);
    }
  });

  it("still rejects a real collar slug at a real slug position", () => {
    const slug = generateSlug();
    expect(pathCarriesDogIdentity(`/d/${slug}`)).toBe(true);
    expect(pathCarriesDogIdentity(`/dog/${slug}`)).toBe(true);
    expect(pathCarriesDogIdentity(`/dog/${slug}/`)).toBe(true);
    expect(pathCarriesDogIdentity(`/dog/${slug}/medical`)).toBe(true);
    // A slug-shaped segment at a slug position is per-dog identity whether or
    // not its check character is valid, so it goes too. ("abc234567" is nine
    // in-alphabet characters whose check character does not verify — a mistyped
    // collar, not a real one. Note that "abc123def" is NOT slug-shaped at all:
    // "1" is one of the confusables the alphabet excludes.)
    expect(pathCarriesDogIdentity("/d/abc234567")).toBe(true);
    // And a genuine slug anywhere at all is rejected on its check character,
    // which is what keeps the guard strict against URL shapes we have not
    // anchored yet.
    expect(pathCarriesDogIdentity(`/${slug}`)).toBe(true);
    expect(pathCarriesDogIdentity(`/share/v2/${slug}`)).toBe(true);
  });

  it("rejects a collar signature wherever it appears", () => {
    expect(pathCarriesDogIdentity("/d/:slug?s=abc")).toBe(true);
    expect(pathCarriesDogIdentity("/d/:slug?utm=x&s=abc")).toBe(true);
  });
});

describe("POST /api/v1/metrics/web-vitals — slug guard at the route", () => {
  it("accepts /dashboard and /leaderboard", async () => {
    const app = buildServer(config);
    for (const path of ["/dashboard", "/leaderboard"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/metrics/web-vitals",
        payload: { path, name: "LCP", value: 800, rating: "good" },
      });
      expect(res.statusCode, `path ${path} must be accepted`).toBe(200);
      await trackLatestVital(path, "LCP");
    }
    await app.close();
  });

  it("still rejects a real collar slug with 400", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/metrics/web-vitals",
      payload: { path: `/dog/${generateSlug()}`, name: "LCP", value: 800, rating: "good" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_WEB_VITALS");
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
    // This row used to be inserted and never registered for cleanup, so the
    // suite leaked one web_vitals row on every run.
    await trackLatestVital("/d/:slug", "INP");

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
