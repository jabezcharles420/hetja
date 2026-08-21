/**
 * Trust engine route tests (INVARIANT 15 + trust-before-gamification).
 *
 * 1. new feeders start at the 30 baseline
 * 2. a feed scan grants the catalog delta (+1) exactly once per client_uuid
 * 3. >= 3 serial rejects auto-pause a PROVISIONAL feeder (role unchanged)
 * 4. disputes split in two: OPENING changes nothing but dispute_state;
 *    RESOLVING requires an admin and reverses the delta exactly — a feeder
 *    can no longer revoke their own penalty
 * 5. there is no self-serve way to mint trust events: POST /trust/events is
 *    deliberately gone, because an HTTP write path whose only legitimate
 *    producers are all server-side had only illegitimate callers
 * 6. score clamps at 100 and never drops below 0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { query, generateSlug } from "@hetja/db";
import { signAccessToken } from "../lib/jwt.js";
import { issueDeviceToken } from "../lib/device.js";
import { TRUST_BASELINE, TRUST_EVENTS, recomputeScore } from "../lib/trust.js";

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

interface Fixture {
  app: FastifyInstance;
  feederId: string;
  feederToken: string;
  adminId: string;
  adminToken: string;
  dogId: string;
  dogSlug: string;
}

async function insertFeeder(verificationTier = "provisional", role = "feeder"): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, verification_tier, consent_version)
     VALUES ($1, 'TrustTest', $3, 30, $2, 'v1.0')
     RETURNING id`,
    [`trust-test-${randomUUID()}`, verificationTier, role],
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
  await query(`DELETE FROM trust_events WHERE feeder_id = ANY($1::uuid[])`, [
    [fixture.feederId, fixture.adminId],
  ]);
  await query(`DELETE FROM scans WHERE dog_id = $1`, [fixture.dogId]);
  await query(`DELETE FROM dogs WHERE id = $1`, [fixture.dogId]);
  await query(`DELETE FROM feeders WHERE id = ANY($1::uuid[])`, [
    [fixture.feederId, fixture.adminId],
  ]);
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

/** The one legitimate way a feeder's own event appears: a real feed scan. */
async function submitFeedScan(fixture: Fixture): Promise<void> {
  const res = await fixture.app.inject({
    method: "POST",
    url: "/api/v1/scans",
    headers: { authorization: bearerToken(fixture.feederId) },
    payload: { clientUuid: randomUUID(), dogSlug: fixture.dogSlug, type: "feed", capturedAt: new Date().toISOString() },
  });
  expect(res.statusCode).toBe(200);
}

let fixture: Fixture;

beforeEach(async () => {
  const dog = await insertDog();
  const feederId = await insertFeeder();
  fixture = {
    app: buildServer(config),
    feederId,
    feederToken: bearerToken(feederId),
    adminId: await insertFeeder("provisional", "admin"),
    adminToken: "",
    dogId: dog.id,
    dogSlug: dog.slug,
  };
  fixture.adminToken = bearerToken(fixture.adminId);
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
  it("grants the catalog delta (+1) exactly once per client_uuid (never double-counts)", async () => {
    // The +1 is pinned deliberately: it is what makes the 40/50/60 gates mean
    // ten/twenty/thirty feeds of tenure (arithmetic in lib/trust.ts). The old
    // value, +60, cleared every gate in one request.
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
    expect(data.score).toBe(30 + TRUST_EVENTS.feed);

    const feedEvents = data.events.filter((e: { eventType: string }) => e.eventType === "feed");
    expect(feedEvents).toHaveLength(1);
    expect(feedEvents[0].delta).toBe(TRUST_EVENTS.feed);
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

    // More rejects after the pause change nothing: the count is capped at the
    // threshold (the query reads at most 3 rows back) and the flag is written
    // once — a second auto_paused event would be a second claim that
    // something new happened when it had not.
    await insertScan(fixture.feederId, fixture.dogId, "rejected");
    await insertScan(fixture.feederId, fixture.dogId, "rejected");
    const still = await getTrust(fixture);
    expect(still.statusCode).toBe(200);
    expect(still.json().data.paused).toBe(true);
    expect(still.json().data.serialRejects).toBe(3);
    expect(still.json().data.autoPausedEventId).toBe(paused.json().data.autoPausedEventId);
    const stillFlags = still
      .json()
      .data.events.filter((e: { eventType: string }) => e.eventType === "auto_paused");
    expect(stillFlags).toHaveLength(1);
  });

  it("does not pause a non-provisional feeder", async () => {
    await cleanup(fixture);
    const dog = await insertDog();
    fixture = {
      ...fixture,
      feederId: await insertFeeder("verified"),
      dogId: dog.id,
      dogSlug: dog.slug,
    };

    await insertScan(fixture.feederId, fixture.dogId, "rejected");
    await insertScan(fixture.feederId, fixture.dogId, "rejected");
    await insertScan(fixture.feederId, fixture.dogId, "rejected");

    const res = await getTrust(fixture);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.paused).toBe(false);
  });
});

describe("disputes", () => {
  interface DisputeFixture {
    eventId: string;
    originalDelta: number;
  }

  /** Opens a dispute over the feed event a real scan produced. */
  async function openDisputeOverFeed(fixture: Fixture): Promise<DisputeFixture> {
    await submitFeedScan(fixture);
    const view = await getTrust(fixture);
    const feed = view.json().data.events.find((e: { eventType: string }) => e.eventType === "feed");
    expect(feed).toBeTruthy();

    const dispute = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/trust/disputes",
      headers: { authorization: bearerToken(fixture.feederId) },
      payload: { eventId: feed.id, reason: "this feed did not happen" },
    });
    expect(dispute.statusCode).toBe(200);
    return { eventId: feed.id, originalDelta: feed.delta };
  }

  it("opening a dispute writes no reversal and moves no score", async () => {
    // The regression this pins used to be one HTTP call away from a clean
    // record: disputing an event immediately reversed its delta. A feeder
    // under a penalty could therefore lift it themselves.
    const { eventId, originalDelta } = await openDisputeOverFeed(fixture);

    const res = await getTrust(fixture);
    expect(res.json().data.score).toBe(30 + originalDelta); // unchanged

    const reversals = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM trust_events WHERE reverses_event_id = $1`,
      [eventId],
    );
    expect(Number(reversals.rows[0].n)).toBe(0);

    // And the dispute cannot simply be re-opened to keep a human looking.
    const again = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/trust/disputes",
      headers: { authorization: bearerToken(fixture.feederId) },
      payload: { eventId, reason: "insisting does not help either" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("only an admin can resolve, and resolution reverses exactly once", async () => {
    const { eventId, originalDelta } = await openDisputeOverFeed(fixture);

    // The event's own owner — the exact caller who could previously reverse
    // their penalty — must not be able to adjudicate their own dispute.
    const asFeeder = await fixture.app.inject({
      method: "POST",
      url: `/api/v1/trust/disputes/${eventId}/resolve`,
      headers: { authorization: bearerToken(fixture.feederId) },
      payload: { reason: "self-service adjudication" },
    });
    expect(asFeeder.statusCode).toBe(403);
    expect(asFeeder.json().error.code).toBe("TRUST_DISPUTE_FORBIDDEN");

    const resolved = await fixture.app.inject({
      method: "POST",
      url: `/api/v1/trust/disputes/${eventId}/resolve`,
      headers: { authorization: bearerToken(fixture.adminId) },
      payload: { reason: "upheld: the feed did not happen" },
    });
    expect(resolved.statusCode).toBe(200);
    const d = resolved.json().data;
    expect(d.event.disputeState).toBe("resolved");
    expect(d.reversal.delta).toBe(-originalDelta);
    expect(d.reversal.reversesEventId).toBe(eventId);
    expect(d.score).toBe(30); // exactly restored

    const rows = await query<{ dispute_state: string }>(
      `SELECT dispute_state FROM trust_events WHERE id = $1`,
      [eventId],
    );
    expect(rows.rows[0].dispute_state).toBe("resolved");

    // Resolution restores; it does not award. One reversal row per disputed
    // event and nothing else beyond the original delta coming back.
    const res = await getTrust(fixture);
    const reversals = res
      .json()
      .data.events.filter((e: { eventType: string }) => e.eventType === "reversal");
    expect(reversals).toHaveLength(1);
    expect(reversals[0].delta).toBe(-originalDelta);

    // …and a resolved dispute cannot be resolved again for a double refund.
    const twice = await fixture.app.inject({
      method: "POST",
      url: `/api/v1/trust/disputes/${eventId}/resolve`,
      headers: { authorization: bearerToken(fixture.adminId) },
      payload: { reason: "double refund attempt" },
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe("TRUST_NO_OPEN_DISPUTE");
  });

  it("refuses to resolve anything that is not an open dispute", async () => {
    // Never-disputed event: opening is the feeder's step; resolving skips it.
    await submitFeedScan(fixture);
    const view = await getTrust(fixture);
    const feed = view.json().data.events.find((e: { eventType: string }) => e.eventType === "feed");
    const undisputed = await fixture.app.inject({
      method: "POST",
      url: `/api/v1/trust/disputes/${feed.id}/resolve`,
      headers: { authorization: bearerToken(fixture.adminId) },
      payload: { reason: "no dispute was ever opened" },
    });
    expect(undisputed.statusCode).toBe(409);
    expect(undisputed.json().error.code).toBe("TRUST_NO_OPEN_DISPUTE");

    // Well-formed id that belongs to no event at all.
    const ghost = await fixture.app.inject({
      method: "POST",
      url: `/api/v1/trust/disputes/${randomUUID()}/resolve`,
      headers: { authorization: bearerToken(fixture.adminId) },
      payload: { reason: "nothing to resolve" },
    });
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().error.code).toBe("TRUST_EVENT_NOT_FOUND");
  });
});

describe("no self-serve trust writes", () => {
  it("POST /api/v1/trust/events is gone", async () => {
    // This route took {eventType} from the body and applied the catalog delta
    // to the CALLER'S OWN feeder id — two requests reached the clamp of 100
    // with no admin check, no rate limit, and no relation to any real scan.
    // It must not come back quietly, so its absence is asserted, not assumed:
    // a re-introduction (or a routing typo that shadows it) fails here.
    const res = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/trust/events",
      headers: { authorization: bearerToken(fixture.feederId) },
      payload: { eventType: "feed", reason: "self-serve trust" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("score bounds", () => {
  it("clamps at 100 and never drops below 0", async () => {
    // Seeded in bulk with the real catalog deltas rather than through N route
    // calls — the route that used to write these is gone on purpose. The math:
    // 30 baseline + 80 feeds (+1) clamps at 100; then 10 serial rejects
    // (-15) sink it to -40, which clamps at 0.
    await query(
      `INSERT INTO trust_events (feeder_id, event_type, delta, reason)
       SELECT $1, 'feed', $2, 'bounds seed' FROM generate_series(1, 80)`,
      [fixture.feederId, TRUST_EVENTS.feed],
    );
    await recomputeScore(fixture.feederId);
    const atTop = await getTrust(fixture);
    expect(atTop.statusCode).toBe(200);
    expect(atTop.json().data.score).toBe(100);

    await query(
      `INSERT INTO trust_events (feeder_id, event_type, delta, reason)
       SELECT $1, 'serial_rejects', $2, 'bounds sink' FROM generate_series(1, 10)`,
      [fixture.feederId, TRUST_EVENTS.serial_rejects],
    );
    await recomputeScore(fixture.feederId);
    const atBottom = await getTrust(fixture);
    expect(atBottom.statusCode).toBe(200);
    expect(atBottom.json().data.score).toBe(0);
  });

  it("keeps the catalog proportionate to the gate arithmetic", () => {
    // The gate arithmetic in lib/trust.ts and docs/INVARIANTS.md counts feeds
    // from the baseline: 40 → 10, 50 → 20, 60 → 30. If `feed` moves, those
    // numbers move and both documents must be re-derived — deliberately loud,
    // because a quiet constant edit is exactly how +60 shipped.
    expect(TRUST_BASELINE + 10 * TRUST_EVENTS.feed).toBe(40);
    expect(TRUST_BASELINE + 20 * TRUST_EVENTS.feed).toBe(50);
    expect(TRUST_BASELINE + 30 * TRUST_EVENTS.feed).toBe(60);
    // A rescue ack is worth twenty routine feeds, never fewer.
    expect(TRUST_EVENTS.sos_ack).toBeGreaterThan(TRUST_EVENTS.feed);
  });
});
