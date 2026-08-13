/**
 * Trust engine route tests (INVARIANT 15 + trust-before-gamification).
 *
 * 1. new feeders start at the 30 baseline
 * 2. a feed scan grants +60 exactly once per client_uuid (no double count)
 * 3. >= 3 serial rejects auto-pause a PROVISIONAL feeder (role unchanged)
 * 4. a dispute reverses the delta exactly (reversal event, negated delta)
 * 5. score clamps at 100 and never drops below 0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { query, generateSlug } from "@straynet/db";
import { signAccessToken } from "../lib/jwt.js";
import { issueDeviceToken } from "../lib/device.js";

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

interface Fixture {
  app: FastifyInstance;
  feederId: string;
  dogId: string;
  dogSlug: string;
}

async function insertFeeder(verificationTier = "provisional"): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (phone_hmac, display_name, role, trust_score, verification_tier, consent_version)
     VALUES ($1, 'TrustTest', 'feeder', 30, $2, 'v1.0')
     RETURNING id`,
    [`trust-test-${randomUUID()}`, verificationTier],
  );
  return res.rows[0].id;
}

async function insertDog(): Promise<{ id: string; slug: string }> {
  const slug = randomSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id) VALUES ($1, 'TrustTestDog', 'G/North') RETURNING id`,
    [slug],
  );
  return { id: res.rows[0].id, slug };
}

async function insertScan(feederId: string, dogId: string, reviewStatus: string): Promise<void> {
  await query(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, feeder_id, captured_at, received_at, review_status)
     VALUES ($1, $2, 'view', $3, now(), now(), $4)`,
    [dogId, randomUUID(), feederId, reviewStatus],
  );
}

async function cleanup(fixture: Fixture): Promise<void> {
  await query(`DELETE FROM trust_events WHERE feeder_id = $1`, [fixture.feederId]);
  await query(`DELETE FROM scans WHERE dog_id = $1`, [fixture.dogId]);
  await query(`DELETE FROM dogs WHERE id = $1`, [fixture.dogId]);
  await query(`DELETE FROM feeders WHERE id = $1`, [fixture.feederId]);
}

function bearerToken(feederId: string): string {
  return `Bearer ${signAccessToken(feederId, config.JWT_SECRET, config.JWT_ACCESS_TTL)}`;
}

async function getTrust(fixture: Fixture) {
  return fixture.app.inject({
    method: "GET",
    url: `/api/v1/feeders/${fixture.feederId}/trust`,
    headers: { authorization: bearerToken(fixture.feederId) },
  });
}

let fixture: Fixture;

beforeEach(async () => {
  const dog = await insertDog();
  fixture = {
    app: buildServer(config),
    feederId: await insertFeeder(),
    dogId: dog.id,
    dogSlug: dog.slug,
  };
  await fixture.app.ready();
});

afterEach(async () => {
  await cleanup(fixture);
  await fixture.app.close();
});

describe("trust baseline", () => {
  it("a new feeder starts at the 30 baseline with no events", async () => {
    const res = await getTrust(fixture);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.score).toBe(30);
    expect(data.verificationTier).toBe("provisional");
    expect(data.paused).toBe(false);
    expect(data.events).toEqual([]);
  });
});

describe("trust feed scan callback", () => {
  it("grants +60 exactly once per client_uuid (never double-counts)", async () => {
    const clientUuid = randomUUID();
    const payload = { clientUuid, dogSlug: fixture.dogSlug, type: "feed", capturedAt: new Date().toISOString() };

    const first = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: bearerToken(fixture.feederId) },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.created).toBe(true);

    const replay = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: bearerToken(fixture.feederId) },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.created).toBe(false);

    const res = await getTrust(fixture);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.score).toBe(90);

    const feedEvents = data.events.filter((e: { eventType: string }) => e.eventType === "feed");
    expect(feedEvents).toHaveLength(1);
    expect(feedEvents[0].delta).toBe(60);
  });

  it("does not award trust without feeder auth (device-token scans)", async () => {
    const res = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": issueDeviceToken(config.HETJA_DEVICE_SECRET) },
      payload: { clientUuid: randomUUID(), dogSlug: fixture.dogSlug, type: "feed", capturedAt: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.created).toBe(true);
    const trust = await getTrust(fixture);
    expect(trust.json().data.score).toBe(30);
  });
});

describe("INVARIANT 15 — verification gates", () => {
  it("auto-pauses a provisional feeder after 3 serial rejects, role unchanged", async () => {
    await insertScan(fixture.feederId, fixture.dogId, "rejected");
    await insertScan(fixture.feederId, fixture.dogId, "rejected");

    const before = await getTrust(fixture);
    expect(before.statusCode).toBe(200);
    expect(before.json().data.paused).toBe(false);

    await insertScan(fixture.feederId, fixture.dogId, "flagged");
    const paused = await getTrust(fixture);
    expect(paused.statusCode).toBe(200);
    expect(paused.json().data.paused).toBe(true);
    expect(paused.json().data.serialRejects).toBe(3);
    expect(paused.json().data.autoPausedEventId).toBeTruthy();

    const flagEvents = paused
      .json()
      .data.events.filter((e: { eventType: string }) => e.eventType === "auto_paused");
    expect(flagEvents).toHaveLength(1);

    const role = await query<{ role: string; verification_tier: string }>(
      `SELECT role, verification_tier FROM feeders WHERE id = $1`,
      [fixture.feederId],
    );
    expect(role.rows[0].role).toBe("feeder");
    expect(role.rows[0].verification_tier).toBe("provisional");
  });

  it("does not pause a non-provisional feeder", async () => {
    await cleanup(fixture);
    const dog = await insertDog();
    fixture = { app: fixture.app, feederId: await insertFeeder("verified"), dogId: dog.id, dogSlug: dog.slug };

    await insertScan(fixture.feederId, fixture.dogId, "rejected");
    await insertScan(fixture.feederId, fixture.dogId, "rejected");
    await insertScan(fixture.feederId, fixture.dogId, "rejected");

    const res = await getTrust(fixture);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.paused).toBe(false);
  });
});

describe("disputes", () => {
  it("reverses the delta exactly via a negated reversing event", async () => {
    const logged = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/trust/events",
      headers: { authorization: bearerToken(fixture.feederId) },
      payload: { eventType: "feed", reason: "logged a feed" },
    });
    expect(logged.statusCode).toBe(200);
    expect(logged.json().data.score).toBe(90);
    const eventId = logged.json().data.event.id;

    const dispute = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/trust/disputes",
      headers: { authorization: bearerToken(fixture.feederId) },
      payload: { eventId, reason: "this feed did not happen" },
    });
    expect(dispute.statusCode).toBe(200);
    const d = dispute.json().data;
    expect(d.event.id).toBe(eventId);
    expect(d.event.disputeState).toBe("open");
    expect(d.reversal.delta).toBe(-60);
    expect(d.reversal.reversesEventId).toBe(eventId);
    expect(d.score).toBe(30);

    const rows = await query<{ dispute_state: string }>(
      `SELECT dispute_state FROM trust_events WHERE id = $1`,
      [eventId],
    );
    expect(rows.rows[0].dispute_state).toBe("open");

    const res = await getTrust(fixture);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.score).toBe(30);
    const reversals = res
      .json()
      .data.events.filter((e: { eventType: string }) => e.eventType === "reversal");
    expect(reversals).toHaveLength(1);
    expect(reversals[0].delta).toBe(-60);
  });
});

describe("score bounds", () => {
  it("clamps at 100 and never drops below 0", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await fixture.app.inject({
        method: "POST",
        url: "/api/v1/trust/events",
        headers: { authorization: bearerToken(fixture.feederId) },
        payload: { eventType: "feed", reason: `feed ${i}` },
      });
      expect(res.statusCode).toBe(200);
    }
    const atTop = await getTrust(fixture);
    expect(atTop.json().data.score).toBe(100);

    for (let i = 0; i < 30; i++) {
      await fixture.app.inject({
        method: "POST",
        url: "/api/v1/trust/events",
        headers: { authorization: bearerToken(fixture.feederId) },
        payload: { eventType: "serial_rejects", reason: `reject ${i}` },
      });
    }
    const atBottom = await getTrust(fixture);
    expect(atBottom.json().data.score).toBe(0);
  });
});
