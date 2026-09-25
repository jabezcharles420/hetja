import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { deviceTokenSubject, issueDeviceToken } from "../lib/device.js";
import { signAccessToken } from "../lib/jwt.js";
import { reportStatusLimiter } from "./sos.js";
import { reportPerSubject, sosAckPerAccount } from "../lib/rate-limit.js";
import { photoGate } from "../lib/photo-gate.js";
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

const LOC_A = { lat: 18.9767, lng: 72.8214 };
const LOC_B = { lat: 19.05, lng: 72.88 };

/**
 * Creates a feeder with the given role and a signed access token. Rows are
 * registered in `createdFeeders` for afterEach cleanup, which deletes
 * attributing scans first, since wave 7 sos scans carry feeder_id.
 */
async function makeFeeder(
  displayName: string,
  role: "feeder" | "admin" = "feeder",
  opts: { trust?: number; sosOptIn?: boolean } = {},
): Promise<{
  id: string;
  accessToken: string;
}> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor, sos_opt_in)
     VALUES ($1, $2, $3, $4, 'v1', FALSE, $5) RETURNING id`,
    [randomUUID(), displayName, role, opts.trust ?? 40, opts.sosOptIn ?? false],
  );
  const id = res.rows[0].id;
  createdFeeders.push(id);
  return { id, accessToken: signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL) };
}

let dogId: string;
let dogSlug: string;
const createdFeeders: string[] = [];
const createdProviders: string[] = [];

/**
 * How the dog's corroboration column is stamped: the wave-7 fan-out gate.
 *
 *   "legacy" (default): sos_eligible_at = created_at. Every dog in production
 *     got exactly this from 0019's backfill, so it is what a normal dog looks
 *     like; the fan-out MUST page for these (regression guard against the
 *     gate silently switching the whole register off).
 *   false: sos_eligible_at IS NULL (reported but never corroborated). Paging
 *     must be suppressed while everything else (report acceptance,
 *     nearbyCare) still works.
 */
async function insertDog(
  geo = LOC_A,
  eligibility: "legacy" | false = "legacy",
): Promise<void> {
  dogSlug = randomSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, last_seen_geo)
     VALUES ($1, 'SosTest', 'K-West',
             ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
     RETURNING id`,
    [dogSlug, geo.lng, geo.lat],
  );
  dogId = res.rows[0].id;
  // "Legacy": stamp corroboration from the dog's OWN created_at, exactly as
  // 0019's backfill did, not from now(), which would make the fixture lie
  // about production's shape.
  if (eligibility === "legacy") {
    await query(`UPDATE dogs SET sos_eligible_at = created_at WHERE id = $1`, [dogId]);
  }
}

/**
 * An opted-in responder the fan-out can find. The proximity input is a
 * GEOTAGGED SCAN by this feeder near LOC_A within the last 30 days (the
 * wave-7 derivation), and deliberately NOT feeders.last_known_geo /
 * last_seen_at: those columns are dead (nothing writes them; migration 0020
 * documents why), so a fixture that still set them would prove nothing about
 * the query that actually runs.
 */
async function insertEligibleFeeder(phoneHmac: string, trustScore: number): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor, sos_opt_in)
     VALUES ($1, 'SOS Responder', 'feeder', $2, 'v1', FALSE, TRUE)
     RETURNING id`,
    [phoneHmac, trustScore],
  );
  const feederId = res.rows[0].id;
  await query(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, feeder_id, device_token, captured_at, received_at, review_status)
     SELECT d.id, $2, 'view', ST_SetSRID(ST_MakePoint(72.8214, 18.9767), 4326)::geography, $1, NULL, now(), now(), 'pending'
     FROM dogs d WHERE d.id = $3`,
    [feederId, randomUUID(), dogId],
  );
  createdFeeders.push(feederId);
  return feederId;
}

/** A listed care provider ~1 km from LOC_A, so `nearbyCare` is non-empty. */
async function insertNearbyProvider(): Promise<void> {
  const res = await query<{ id: string }>(
    `INSERT INTO care_providers (name, kind, cost_tier, phone_e164, geo, source, listed, geo_precision, locality)
     VALUES ('SosTest Care', 'ngo', 'free', '+912224137518',
             ST_SetSRID(ST_MakePoint(72.8300, 18.9830), 4326)::geography,
             'curated', TRUE, 'exact', NULL)
     RETURNING id`,
  );
  createdProviders.push(res.rows[0].id);
}

/**
 * A responder the ack route will accept on standing alone (hardening batch 1,
 * T1): opted in, and at the critical floor (60), so it may claim a case of any
 * severity without having been paged for it.
 */
function makeResponder(displayName: string) {
  return makeFeeder(displayName, "feeder", { trust: 60, sosOptIn: true });
}

beforeEach(async () => {
  // Module-level limiter singletons are shared by every test in this file.
  reportPerSubject.reset();
  sosAckPerAccount.reset();
  photoGate.reset();
  await insertDog();
});

afterEach(async () => {
  for (const id of createdProviders) {
    await query(`DELETE FROM care_providers WHERE id = $1`, [id]);
  }
  createdProviders.length = 0;
  await query(`DELETE FROM sos_notifications WHERE case_id IN (SELECT id FROM sos_cases WHERE dog_id = $1)`, [dogId]);
  await query(`DELETE FROM sos_cases WHERE dog_id = $1`, [dogId]);
  await query(`DELETE FROM scans WHERE dog_id = $1`, [dogId]);
  await query(`DELETE FROM jobs WHERE payload->>'dogId' = $1`, [dogId]);
  for (const id of createdFeeders) {
    // Scans attributing this feeder on OTHER dogs must go first, or the FK
    // keeps the feeder row alive.
    await query(`DELETE FROM scans WHERE feeder_id = $1`, [id]);
    await query(`DELETE FROM feeders WHERE id = $1`, [id]);
  }
  createdFeeders.length = 0;
  await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
});

describe("POST /api/v1/reports (anon-attested)", () => {
  it("opens a tier-1 case and enqueues the 8-min escalation (serious waits for validation)", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "serious", note: "limping on left foreleg", deviceToken: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.created).toBe(true);
    expect(body.data.caseId).toBeTruthy();

    const caseRow = await query<{ state: string; tier: number; severity: string }>(
      `SELECT state, tier, severity FROM sos_cases WHERE id = $1`,
      [body.data.caseId],
    );
    expect(caseRow.rows[0].state).toBe("open");
    expect(caseRow.rows[0].tier).toBe(1);
    expect(caseRow.rows[0].severity).toBe("serious");
    // Serious defers responder paging to validation (out of scope), so the
    // escalation channel owns notification: fanout says so honestly rather
    // than implying responders were paged.
    expect(body.data.fanout).toBe("escalated");

    // Design v7 also queues the vets' turn (sos_open_to_vets); this test is about escalation.
    const job = await query<{ kind: string; run_after: Date }>(
      `SELECT kind, run_after FROM jobs WHERE payload->>'caseId' = $1 AND kind <> 'sos_open_to_vets'`,
      [body.data.caseId],
    );
    expect(job.rows[0].kind).toBe("escalate_sos");
    expect(job.rows[0].run_after.getTime()).toBeGreaterThan(Date.now() + 7 * 60 * 1000);

    const notifs = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sos_notifications WHERE case_id = $1`,
      [body.data.caseId],
    );
    expect(Number(notifs.rows[0].n)).toBe(0);

    await app.close();
  });

  it("replays the same report idempotently without double-opening", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const payload = { dogSlug, severity: "minor", note: "replay dedupe", deviceToken: token };

    const first = await app.inject({ method: "POST", url: "/api/v1/reports", payload });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.created).toBe(true);

    const replay = await app.inject({ method: "POST", url: "/api/v1/reports", payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.created).toBe(false);
    expect(replay.json().data.caseId).toBe(first.json().data.caseId);

    const count = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sos_cases WHERE dog_id = $1`,
      [dogId],
    );
    expect(Number(count.rows[0].n)).toBe(1);

    await app.close();
  });

  /**
   * The state `fanout` exists to disambiguate: the dog IS corroborated (the
   * responder path ran; fanout "responders") but nobody in the scan-history
   * set cleared the bar (tier 2). Distinct from suppression, where paging is
   * gated off entirely ("escalated"). Both used to be indistinguishable
   * tier-2 cases.
   */
  it("opens a critical case at tier 2 when no responder is eligible", async () => {
    await insertDog(LOC_B);
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "critical", note: "unconscious", deviceToken: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.created).toBe(true);
    expect(body.data.tier).toBe(2);
    expect(body.data.fanout).toBe("responders");

    const caseRow = await query<{ tier: number }>(`SELECT tier FROM sos_cases WHERE id = $1`, [body.data.caseId]);
    expect(caseRow.rows[0].tier).toBe(2);

    // Zero eligible responders must escalate IMMEDIATELY, not after a timer
    // whose only purpose was to wait for responders who were never paged
    // (HOW-IT-WORKS §3.2 promises this; sos.ts used to break it).
    const job = await query<{ run_after: Date }>(
      `SELECT run_after FROM jobs WHERE payload->>'caseId' = $1 AND kind = 'escalate_sos'`,
      [body.data.caseId],
    );
    expect(job.rows[0].run_after.getTime()).toBeLessThanOrEqual(Date.now());

    await app.close();
  });

  /**
   * Wave 7's core gate: corroboration suppresses RESPONDER PAGING and nothing
   * else. The report is accepted (200, not 404/403), nearbyCare still returns
   * phone numbers, but no responder rows exist, no push job is enqueued, and
   * escalation runs at now() because there is no responder to wait for.
   */
  it("accepts a critical report on an uncorroborated dog but pages nobody: tier 2, fanout escalated, immediate escalation, zero push rows", async () => {
    await insertDog(LOC_A, false); // uncorroborated: sos_eligible_at IS NULL
    await insertNearbyProvider();
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "critical", note: "uncorroborated emergency", deviceToken: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.created).toBe(true);
    expect(body.data.tier).toBe(2);
    expect(body.data.fanout).toBe("escalated");
    // Status-independent: the fastest useful thing is a phone number, with or
    // without corroboration.
    expect(Array.isArray(body.data.nearbyCare)).toBe(true);
    expect(body.data.nearbyCare.length).toBeGreaterThan(0);

    const notifs = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sos_notifications WHERE case_id = $1`,
      [body.data.caseId],
    );
    expect(Number(notifs.rows[0].n)).toBe(0);

    const pushJobs = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM jobs WHERE payload->>'caseId' = $1 AND kind = 'send_sos_push'`,
      [body.data.caseId],
    );
    expect(Number(pushJobs.rows[0].n)).toBe(0);

    const job = await query<{ kind: string; run_after: Date }>(
      `SELECT kind, run_after FROM jobs WHERE payload->>'caseId' = $1 AND kind = 'escalate_sos'`,
      [body.data.caseId],
    );
    expect(job.rows[0].kind).toBe("escalate_sos");
    expect(job.rows[0].run_after.getTime()).toBeLessThanOrEqual(Date.now());

    await app.close();
  });

  /** A pending_activation tag resolves fine: the report path never gated on
   * dog status, and wave 7 did not change that. */
  it("accepts an SOS report for a pending_activation dog (not 404/403)", async () => {
    await insertDog(LOC_A, false);
    await query(`UPDATE dogs SET status = 'pending_activation' WHERE id = $1`, [dogId]);
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "serious", note: "tag not yet activated", deviceToken: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.created).toBe(true);
    expect(res.json().data.caseId).toBeTruthy();

    await app.close();
  });

  it("caps anon reports at 2/day per device token (429)", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "cap one", deviceToken: token },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "cap two", deviceToken: token },
    });
    expect(second.statusCode).toBe(200);

    const third = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "cap three", deviceToken: token },
    });
    expect(third.statusCode).toBe(429);
    expect(third.json().ok).toBe(false);

    const count = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sos_cases WHERE dog_id = $1`,
      [dogId],
    );
    expect(Number(count.rows[0].n)).toBe(2);

    await app.close();
  });

  /**
   * INVARIANT 7 regression: the cap must not be resettable by rewriting the
   * token string.
   *
   * Node's base64 decoder ignores padding and any non-alphabet character, so
   * `tok`, `tok=`, `tok==`, `tok\n` and `tok!` all decoded to the same bytes
   * and so all recomputed the same HMAC -- every one of them verified. But the
   * cap query and the idempotency key were keyed on the submitted *string*, so
   * each variant was a different `scans.device_token` value with its own fresh
   * 2/day + 5/week budget. One proof-of-work solve therefore bought unbounded
   * anonymous SOS, at zero marginal cost, and every report pages real
   * responders' phones. The 429 below has to stay a 429 no matter how the
   * attacker re-encodes the token they already hold.
   */
  it("cannot reset the anon cap by re-encoding the device token (padding-variant bypass)", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    // Spend the legitimate 2/day budget.
    for (const note of ["reencode one", "reencode two"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/reports",
        payload: { dogSlug, severity: "minor", note, deviceToken: token },
      });
      expect(res.statusCode).toBe(200);
    }
    const capped = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "reencode three", deviceToken: token },
    });
    expect(capped.statusCode).toBe(429);

    const dot = token.indexOf(".");
    const base = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    for (const suffix of ["=", "==", "\n", " ", "!", "!!"]) {
      const label = JSON.stringify(suffix);
      // Premise: same decoded bytes, so the HMAC still matches and this used to
      // sail through as a valid attestation for a "new" device.
      expect(
        Buffer.from(base + suffix, "base64url").equals(Buffer.from(base, "base64url")),
        `premise: ${label} decodes to the same bytes`,
      ).toBe(true);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/reports",
        payload: {
          dogSlug,
          severity: "minor",
          note: `bypass ${label}`,
          deviceToken: `${base}${suffix}.${sig}`,
        },
      });
      // Refused outright rather than merely rate-limited: a non-canonical
      // token is not a token, so it never reaches the cap query at all.
      expect(res.statusCode, `variant ${label} must not mint a fresh budget`).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED_DEVICE");
    }

    // The two legitimate reports, and nothing the bypass added.
    const count = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sos_cases WHERE dog_id = $1`,
      [dogId],
    );
    expect(Number(count.rows[0].n)).toBe(2);

    await app.close();
  });

  it("records the canonical deviceId as the cap subject, not the bearer token", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "subject shape", deviceToken: token },
    });
    expect(res.statusCode).toBe(200);

    const row = await query<{ device_token: string }>(
      `SELECT s.device_token FROM scans s JOIN sos_cases c ON c.scan_id = s.id WHERE c.id = $1`,
      [res.json().data.caseId],
    );
    // The cap query and this column must agree on what names a device, or the
    // count counts something other than the rows it is meant to count. Storing
    // the deviceId rather than the whole token also means a leak of this column
    // cannot be replayed as an attested token -- the HMAC half is never stored.
    expect(row.rows[0].device_token).toBe(deviceTokenSubject(token, config.HETJA_DEVICE_SECRET));
    expect(row.rows[0].device_token).not.toBe(token);

    await app.close();
  });

  /**
   * Regression guard for the corroboration gate itself: this dog is created
   * the old way (sos_eligible_at = created_at via the "legacy" fixture
   * default, exactly what 0019's backfill stamped onto every production dog)
   * and MUST still fan out. If this ever fails, the gate has silently
   * switched the whole register off.
   */
  it("fans a critical report out immediately to eligible responders", async () => {
    const feederId = await insertEligibleFeeder("sos-test-feeder-critical", 70);
    await insertNearbyProvider();
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "critical", note: "hit by vehicle", deviceToken: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.created).toBe(true);
    expect(body.data.tier).toBe(1);
    expect(body.data.fanout).toBe("responders");
    expect(body.data.nearbyCare.length).toBeGreaterThan(0);

    const notifs = await query<{ feeder_id: string; channel: string }>(
      `SELECT feeder_id, channel FROM sos_notifications WHERE case_id = $1`,
      [body.data.caseId],
    );
    expect(notifs.rows.length).toBe(1);
    expect(notifs.rows[0].feeder_id).toBe(feederId);
    expect(notifs.rows[0].channel).toBe("push");

    // INVARIANT 10's lesson, applied: assert the push JOB ROW exists, not just
    // that the code path looks right. send_sos_push spent months as a handler
    // nothing ever enqueued behind a green check.
    const pushJob = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM jobs WHERE payload->>'caseId' = $1 AND kind = 'send_sos_push'`,
      [body.data.caseId],
    );
    expect(Number(pushJob.rows[0].n)).toBe(1);

    const jobs = await query<{ kind: string }>(
      `SELECT kind FROM jobs WHERE payload->>'caseId' = $1 ORDER BY kind`,
      [body.data.caseId],
    );
    // escalate_sos (every report) + send_sos_push (this fan-out had an
    // eligible responder, so the worker has a Web Push to send -- plan §3.4)
    // + sos_open_to_vets (design v7: every vet nearby after 15 minutes if
    // nobody has taken it).
    expect(jobs.rows.map((j) => j.kind)).toEqual(["escalate_sos", "send_sos_push", "sos_open_to_vets"]);
    // Responders WERE paged, so escalation keeps its normal 8-minute grace.
    const escalate = await query<{ run_after: Date }>(
      `SELECT run_after FROM jobs WHERE payload->>'caseId' = $1 AND kind = 'escalate_sos'`,
      [body.data.caseId],
    );
    expect(escalate.rows[0].run_after.getTime()).toBeGreaterThan(Date.now() + 7 * 60 * 1000);

    await app.close();
  });

  it("rejects a report without an attested device token", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "no token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);

    await app.close();
  });

  it("accepts a feeder-authed report past the anon cap", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "anon one", deviceToken: token },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "anon two", deviceToken: token },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const feederRes = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Feeder Reporter', 'feeder', 40, 'v1', FALSE) RETURNING id`,
      [randomUUID()],
    );
    const accessToken = signAccessToken(feederRes.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL);

    const third = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { dogSlug, severity: "critical", note: "feeder bypass", deviceToken: token },
    });
    expect(third.statusCode).toBe(200);
    expect(third.json().data.created).toBe(true);

    // Cleanup via createdFeeders: this report's scan row now ATTRIBUTES the
    // feeder (scans.feeder_id), so the feeder row cannot go before those
    // scans do; afterEach handles the ordering.
    createdFeeders.push(feederRes.rows[0].id);
    await app.close();
  });

  /**
   * Wave 7: INVARIANT 6 says limits bind an account OR a device, but
   * feeder-authed callers skipped every cap: a signed-in abuser could page
   * responders without bound. The same rolling 2/day + 5/week now keys on the
   * account (scans.feeder_id, written by the report insert).
   */
  it("caps feeder-authed reports at 2/day per account (429)", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const feederRes = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Capped Account', 'feeder', 40, 'v1', FALSE) RETURNING id`,
      [randomUUID()],
    );
    createdFeeders.push(feederRes.rows[0].id);
    const accessToken = signAccessToken(feederRes.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL);
    const auth = { authorization: `Bearer ${accessToken}` };

    for (const note of ["account cap one", "account cap two"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/reports",
        headers: auth,
        payload: { dogSlug, severity: "minor", note, deviceToken: token },
      });
      expect(res.statusCode).toBe(200);
    }
    const third = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: auth,
      payload: { dogSlug, severity: "minor", note: "account cap three", deviceToken: token },
    });
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe("SOS_RATE_LIMITED");

    // The cap counts rows attributed to the ACCOUNT. Prove attribution
    // actually happened, or the 429 above would only be reachable through
    // some other path's leakage.
    const attributed = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM scans WHERE scan_type = 'sos' AND feeder_id = $1`,
      [feederRes.rows[0].id],
    );
    expect(Number(attributed.rows[0].n)).toBe(2);

    await app.close();
  });
});

describe("GET /api/v1/sos/cases/:id (bound to the case's people)", () => {
  /**
   * Wave 7 bound this endpoint: the acker, someone paged for the case
   * (a sos_notifications row), or a moderator. This test exercises the
   * fan-out-set leg: the responder the critical case was opened FOR can
   * watch its state.
   */
  it("returns case state to a responder who was paged for it", async () => {
    const feederId = await insertEligibleFeeder("sos-get-paged-responder", 70);
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const report = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "critical", note: "for get", deviceToken: token },
    });
    const caseId = report.json().data.caseId;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sos/cases/${caseId}`,
      headers: { authorization: `Bearer ${signAccessToken(feederId, config.JWT_SECRET, config.JWT_ACCESS_TTL)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(caseId);
    expect(body.data.state).toBe("open");
    expect(body.data.tier).toBe(1);
    expect(body.data.severity).toBe("critical");

    await app.close();
  });

  /**
   * The binding itself: an authenticated feeder with no relation to the case
   * (not the acker, never fanned out, no moderate capability) reads
   * nothing. Before wave 7 any account could read any case.
   */
  it("403s a feeder with no relation to the case", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const report = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "not yours", deviceToken: token },
    });
    const caseId = report.json().data.caseId;

    const outsider = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Unrelated Feeder', 'feeder', 40, 'v1', FALSE) RETURNING id`,
      [randomUUID()],
    );
    createdFeeders.push(outsider.rows[0].id);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sos/cases/${caseId}`,
      headers: {
        authorization: `Bearer ${signAccessToken(outsider.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL)}`,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SOS_CASE_FORBIDDEN");

    await app.close();
  });

  /**
   * The acker leg, and specifically of a SUPPRESSED case: an uncorroborated
   * dog never had responders fanned out, yet whoever claimed the case still
   * owns reading it.
   */
  it("returns a suppressed case to the feeder who acknowledged it", async () => {
    await insertDog(LOC_A, false); // uncorroborated → paging suppressed
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const report = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "critical", note: "suppressed then acked", deviceToken: token },
    });
    const caseId = report.json().data.caseId;
    expect(report.json().data.fanout).toBe("escalated");

    const claimer = await makeResponder("Suppressed Claimer");
    const ack = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${claimer.accessToken}` },
    });
    expect(ack.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sos/cases/${caseId}`,
      headers: { authorization: `Bearer ${claimer.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.state).toBe("acked");

    await app.close();
  });

  it("401s without feeder auth", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: `/api/v1/sos/cases/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);

    await app.close();
  });

  it("answers a non-UUID case id with 400, not a 500 from a raw 22P02", async () => {
    // sos_cases.id is a uuid column; binding `abc` into it used to raise
    // PostgreSQL 22P02 and render as "internal server error". (Checked before
    // the visibility binding runs, so any authenticated feeder gets the 400.)
    const app = buildServer(config);
    const feederRes = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Param Probe', 'feeder', 40, 'v1', FALSE) RETURNING id`,
      [randomUUID()],
    );
    createdFeeders.push(feederRes.rows[0].id);
    const accessToken = signAccessToken(feederRes.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sos/cases/not-a-uuid",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_CASE_ID");

    await app.close();
  });
});

describe("POST /api/v1/sos/cases/:id/ack (feeder auth)", () => {
  async function openCase(severity: "minor" | "serious" | "critical" = "minor"): Promise<string> {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity, note: "ack test", deviceToken: token },
    });
    await app.close();
    return res.json().data.caseId;
  }

  // `makeFeeder` is the shared module-level helper (feeder rows land in
  // createdFeeders for afterEach cleanup).

  it("first ack claims the case: sets acked_by and acked_at, and ack latency is computable from sos_cases alone", async () => {
    const caseId = await openCase();
    const feeder = await makeResponder("Ack Responder");
    const app = buildServer(config);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${feeder.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.ackedBy).toBe(feeder.id);
    expect(body.data.ackedAt).toBeTruthy();

    const row = await query<{ acked_by: string; acked_at: Date; opened_at: Date; state: string }>(
      `SELECT acked_by, acked_at, opened_at, state FROM sos_cases WHERE id = $1`,
      [caseId],
    );
    expect(row.rows[0].acked_by).toBe(feeder.id);
    expect(row.rows[0].acked_at).toBeTruthy();
    expect(row.rows[0].state).toBe("acked");
    // The programme's headline metric (ack p50 < 5min / p90 < 8min) is a
    // function of these two columns alone -- prove the subtraction works.
    const latencyMs = row.rows[0].acked_at.getTime() - row.rows[0].opened_at.getTime();
    expect(latencyMs).toBeGreaterThanOrEqual(0);

    await app.close();
  });

  it("a second ack from a different feeder does not steal the case -- the first claimant still owns it", async () => {
    const caseId = await openCase();
    const first = await makeResponder("First Claimant");
    const second = await makeResponder("Second Claimant");
    const app = buildServer(config);

    const firstAck = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${first.accessToken}` },
    });
    expect(firstAck.statusCode).toBe(200);

    const secondAck = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${second.accessToken}` },
    });
    expect(secondAck.statusCode).toBe(409);
    expect(secondAck.json().ok).toBe(false);
    expect(secondAck.json().error.code).toBe("SOS_ALREADY_ACKED");

    const row = await query<{ acked_by: string }>(`SELECT acked_by FROM sos_cases WHERE id = $1`, [caseId]);
    expect(row.rows[0].acked_by).toBe(first.id);

    await app.close();
  });

  it("stands down the losing responder's own notification without touching the claimant's", async () => {
    const first = await insertEligibleFeeder("sos-ack-first", 70);
    const second = await insertEligibleFeeder("sos-ack-second", 65);
    const caseId = await openCase("critical");
    const app = buildServer(config);
    const firstToken = signAccessToken(first, config.JWT_SECRET, config.JWT_ACCESS_TTL);
    const secondToken = signAccessToken(second, config.JWT_SECRET, config.JWT_ACCESS_TTL);

    await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const secondAck = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${secondToken}` },
    });
    expect(secondAck.statusCode).toBe(409);

    const notifs = await query<{ feeder_id: string; stood_down: boolean }>(
      `SELECT feeder_id, stood_down FROM sos_notifications WHERE case_id = $1`,
      [caseId],
    );
    const firstNotif = notifs.rows.find((n) => n.feeder_id === first);
    const secondNotif = notifs.rows.find((n) => n.feeder_id === second);
    expect(firstNotif?.stood_down).toBe(false);
    expect(secondNotif?.stood_down).toBe(true);

    await app.close();
  });

  it("treats a retry from the same claimant as idempotent, not a steal against themselves", async () => {
    const caseId = await openCase();
    const feeder = await makeResponder("Retry Claimant");
    const app = buildServer(config);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${feeder.accessToken}` },
    });
    expect(first.statusCode).toBe(200);

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${feeder.accessToken}` },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.ackedBy).toBe(feeder.id);

    const notifs = await query<{ stood_down: boolean }>(
      `SELECT stood_down FROM sos_notifications WHERE case_id = $1 AND feeder_id = $2`,
      [caseId, feeder.id],
    );
    expect(notifs.rows.every((n) => n.stood_down === false)).toBe(true);

    await app.close();
  });

  it("404s for a case that does not exist", async () => {
    const feeder = await makeFeeder("Nobody Home");
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${randomUUID()}/ack`,
      headers: { authorization: `Bearer ${feeder.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("answers a non-UUID case id with 400, not a 500 from a raw 22P02", async () => {
    const feeder = await makeFeeder("Param Probe");
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sos/cases/not-a-uuid/ack",
      headers: { authorization: `Bearer ${feeder.accessToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_CASE_ID");
    await app.close();
  });

  it("401s without feeder auth", async () => {
    const caseId = await openCase();
    const app = buildServer(config);
    const res = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /api/v1/sos/cases/:id/resolve (acker or moderator)", () => {
  async function openCase(severity: "minor" | "serious" | "critical" = "minor"): Promise<string> {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity, note: "resolve test", deviceToken: token },
    });
    await app.close();
    return res.json().data.caseId;
  }

  /**
   * resolved_at/resolution/state were columns nothing wrote, so no case could
   * ever close. The acker is the person who went out to the dog; their word
   * is what closes the case.
   */
  it("the acking responder resolves the case and stamps resolved_at + resolution", async () => {
    const caseId = await openCase();
    const acker = await makeResponder("Resolving Acker");
    const app = buildServer(config);

    await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${acker.accessToken}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/resolve`,
      headers: { authorization: `Bearer ${acker.accessToken}` },
      payload: { resolution: "treated on site by the feeder" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.state).toBe("resolved");
    expect(body.data.resolution).toBe("treated on site by the feeder");
    expect(body.data.resolvedAt).toBeTruthy();

    const row = await query<{ state: string; resolved_at: Date; resolution: string }>(
      `SELECT state, resolved_at, resolution FROM sos_cases WHERE id = $1`,
      [caseId],
    );
    expect(row.rows[0].state).toBe("resolved");
    expect(row.rows[0].resolved_at).toBeTruthy();
    expect(row.rows[0].resolution).toBe("treated on site by the feeder");

    // Idempotent retry (flaky-network resend): same truth again, not a 409.
    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/resolve`,
      headers: { authorization: `Bearer ${acker.accessToken}` },
      payload: { resolution: "treated on site by the feeder" },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.state).toBe("resolved");

    await app.close();
  });

  /** A moderator may close a case nobody has claimed, e.g. ruling it a false
   * alarm after the escalation channel reported back. */
  it("a moderator resolves an unclaimed case as a false alarm", async () => {
    const caseId = await openCase("critical");
    const admin = await makeFeeder("Modifying Admin", "admin");
    const app = buildServer(config);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/resolve`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { resolution: "no dog found at the location", outcome: "false_alarm" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.state).toBe("false_alarm");

    const row = await query<{ state: string; resolved_at: Date | null }>(
      `SELECT state, resolved_at FROM sos_cases WHERE id = $1`,
      [caseId],
    );
    expect(row.rows[0].state).toBe("false_alarm");
    expect(row.rows[0].resolved_at).toBeTruthy();

    await app.close();
  });

  it("refuses a feeder who neither acknowledged nor moderates (403)", async () => {
    const caseId = await openCase();
    const bystander = await makeFeeder("Uninvolved Bystander");
    const app = buildServer(config);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/resolve`,
      headers: { authorization: `Bearer ${bystander.accessToken}` },
      payload: { resolution: "seems fine now" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SOS_RESOLVE_FORBIDDEN");

    const row = await query<{ resolved_at: Date | null; state: string }>(
      `SELECT resolved_at, state FROM sos_cases WHERE id = $1`,
      [caseId],
    );
    // And the refusal must have left the case untouched.
    expect(row.rows[0].resolved_at).toBeNull();
    expect(row.rows[0].state).toBe("open");

    await app.close();
  });

  it("answers a missing resolution with 400, not a silent close", async () => {
    const caseId = await openCase();
    const acker = await makeResponder("Acker Without Words");
    const app = buildServer(config);
    await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${acker.accessToken}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/resolve`,
      headers: { authorization: `Bearer ${acker.accessToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_SOS_RESOLUTION");

    await app.close();
  });

  it("404s for a case that does not exist", async () => {
    const feeder = await makeFeeder("Resolve Nobody");
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${randomUUID()}/resolve`,
      headers: { authorization: `Bearer ${feeder.accessToken}` },
      payload: { resolution: "nothing there" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  /**
   * The ack predicate used to be `acked_by IS NULL` alone. A case a moderator
   * closed without anyone claiming it has acked_by NULL and resolved_at set, so
   * a later ack matched, wrote acked_by/acked_at and flipped `state` back to
   * 'acked': a terminal state silently reopened by a responder who never went
   * anywhere.
   */
  it("an ack cannot reopen a case a moderator already resolved (409 SOS_CASE_CLOSED)", async () => {
    const caseId = await openCase("critical");
    const admin = await makeFeeder("Closing Admin", "admin");
    const late = await makeResponder("Late Responder");
    const app = buildServer(config);

    const closed = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/resolve`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { resolution: "handled by the clinic directly", outcome: "false_alarm" },
    });
    expect(closed.statusCode).toBe(200);

    const ack = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${caseId}/ack`,
      headers: { authorization: `Bearer ${late.accessToken}` },
    });
    expect(ack.statusCode).toBe(409);
    expect(ack.json().error.code).toBe("SOS_CASE_CLOSED");

    const row = await query<{ state: string; acked_by: string | null; resolved_at: Date | null }>(
      `SELECT state, acked_by, resolved_at FROM sos_cases WHERE id = $1`,
      [caseId],
    );
    // Terminal state untouched: nobody owns it, and it stays closed.
    expect(row.rows[0].state).toBe("false_alarm");
    expect(row.rows[0].acked_by).toBeNull();
    expect(row.rows[0].resolved_at).toBeTruthy();

    await app.close();
  });

  /**
   * INVARIANT 7 is a cap on what pages people (cases), not on scans rows. The
   * dedupe key is deterministic, so re-filing a report after its case closed
   * reuses the scans row and opens a NEW case; counting scans let that path open
   * a fresh case every time the last one was resolved, without ever touching the
   * 2/day budget.
   */
  it("counts re-filed reports against the cap once their earlier case is resolved", async () => {
    const admin = await makeFeeder("Cap Admin", "admin");
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const report = (note: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/reports",
        payload: { dogSlug, severity: "serious", note, deviceToken: token },
      });

    const first = await report("same words");
    expect(first.statusCode).toBe(200);
    const firstCase = first.json().data.caseId as string;

    const resolved = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${firstCase}/resolve`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { resolution: "dog seen, fine" },
    });
    expect(resolved.statusCode).toBe(200);

    // Same subject, same words: not a replay of an OPEN case, so a new case,
    // and the second of this device's two for the day.
    const refiled = await report("same words");
    expect(refiled.statusCode).toBe(200);
    expect(refiled.json().data.created).toBe(true);
    expect(refiled.json().data.caseId).not.toBe(firstCase);

    const third = await report("different words");
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe("SOS_RATE_LIMITED");

    const cases = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sos_cases c JOIN scans s ON s.id = c.scan_id
        WHERE s.device_token = $1`,
      [deviceTokenSubject(token, config.HETJA_DEVICE_SECRET)],
    );
    expect(cases.rows[0].n).toBe(2);

    await app.close();
  });
});

describe("PATCH /api/v1/feeders/me: SOS responder consent (wave 7)", () => {
  /**
   * The consent surface is what makes the fan-out reachable at all: before
   * wave 7 NOTHING wrote feeders.sos_opt_in, so every feeder answered FALSE
   * forever and the responder query returned zero rows on every call. This
   * test walks the whole chain: PATCH flips the bit, the GET readout reports
   * it, and a subsequent critical case pages exactly that feeder.
   */
  it("flips sos_opt_in, reports it on /me, and makes the feeder paged by the next fan-out", async () => {
    const feeder = await makeFeeder("Consenting Responder");

    // Give the feeder a qualifying nearby scan BEFORE consenting: proximity
    // alone must not be enough; paging requires the explicit yes.
    const scan = await query(
      `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, feeder_id, device_token, captured_at, received_at, review_status)
       SELECT d.id, $2, 'view', ST_SetSRID(ST_MakePoint(72.8214, 18.9767), 4326)::geography, $1, NULL, now(), now(), 'pending'
       FROM dogs d WHERE d.id = $3`,
      [feeder.id, randomUUID(), dogId],
    );
    expect(scan.rowCount).toBe(1);

    const app = buildServer(config);
    const auth = { authorization: `Bearer ${feeder.accessToken}` };

    // Before consent: opted-out responders are skipped even with scans at the
    // dog's doorstep.
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const suppressedReport = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "critical", note: "before consent", deviceToken: token },
    });
    expect(suppressedReport.json().data.fanout).toBe("responders");
    expect(suppressedReport.json().data.tier).toBe(2); // ran, found nobody eligible
    const beforeCaseId = suppressedReport.json().data.caseId;
    const notifsBefore = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sos_notifications WHERE case_id = $1`,
      [beforeCaseId],
    );
    expect(Number(notifsBefore.rows[0].n)).toBe(0);

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/feeders/me",
      headers: auth,
      payload: { sosOptIn: true },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.sosOptIn).toBe(true);

    const me = await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.sosOptIn).toBe(true);

    // Trust floor for critical is 60; the shared makeFeeder stamps 40.
    await query(`UPDATE feeders SET trust_score = 60 WHERE id = $1`, [feeder.id]);

    const report = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "critical", note: "after consent", deviceToken: token },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().data.tier).toBe(1);
    const notifsAfter = await query<{ feeder_id: string }>(
      `SELECT feeder_id FROM sos_notifications WHERE case_id = $1`,
      [report.json().data.caseId],
    );
    expect(notifsAfter.rows.map((r) => r.feeder_id)).toEqual([feeder.id]);

    await app.close();
  });

  /** A consent endpoint that silently ignored extra fields would let a client
   * believe it had updated something this route does not handle. */
  it("rejects bodies that carry anything besides sosOptIn (400)", async () => {
    const feeder = await makeFeeder("Strict Consent");
    const app = buildServer(config);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/feeders/me",
      headers: { authorization: `Bearer ${feeder.accessToken}` },
      payload: { sosOptIn: true, lastKnownGeo: { lat: 18.97, lng: 72.82 } },
    });
    expect(res.statusCode).toBe(400);
    // B-11: an unknown field is a PATCH error, not a consent error. The old
    // code survives only for a bad `sosOptIn` value (below).
    expect(res.json().error.code).toBe("INVALID_FEEDER_PATCH");

    // And nothing was written.
    const row = await query<{ sos_opt_in: boolean }>(
      `SELECT sos_opt_in FROM feeders WHERE id = $1`,
      [feeder.id],
    );
    expect(row.rows[0].sos_opt_in).toBe(false);

    await app.close();
  });

  it("401s without feeder auth", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/feeders/me",
      payload: { sosOptIn: true },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("sos_notifications uniqueness (migration 0020)", () => {
  /**
   * Both producers write `ON CONFLICT DO NOTHING`: routes/sos.ts for push
   * rows, the worker's escalate_sos for vet sms rows and the bmc row. Before
   * wave 7 there was NO unique constraint, so that clause was a NO-OP and
   * every repeated escalation inserted duplicates. This pins the contract
   * those call sites rely on: a bare ON CONFLICT DO NOTHING arbitrates against
   * the new partial unique indexes (case + recipient + channel), so a replayed
   * fan-out or a retried escalation job cannot multiply rows.
   */
  it("makes ON CONFLICT DO NOTHING actually deduplicate, for all three recipient shapes", async () => {
    const feederId = await insertEligibleFeeder("sos-dedupe-responder", 70);
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const report = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "critical", note: "dedupe", deviceToken: token },
    });
    expect(report.json().data.tier).toBe(1); // fan-out ran, push row exists
    const caseId = report.json().data.caseId;

    // Same responder, same case, same channel again (a re-run fan-out):
    const repeatPush = await query(
      `INSERT INTO sos_notifications (case_id, feeder_id, channel) VALUES ($1, $2, 'push')
       ON CONFLICT DO NOTHING`,
      [caseId, feederId],
    );
    expect(repeatPush.rowCount).toBe(0);

    // Vet sms row twice (a retried escalation job):
    const vetRes = await query<{ id: string }>(
      `INSERT INTO vets (clinic_name, geo, signing_key_pub)
       VALUES ('Dedupe Vet', ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 'k')
       RETURNING id`,
    );
    const vetId = vetRes.rows[0].id;
    try {
      const firstVetRow = await query(
        `INSERT INTO sos_notifications (case_id, vet_id, channel) VALUES ($1, $2, 'sms')
         ON CONFLICT DO NOTHING`,
        [caseId, vetId],
      );
      expect(firstVetRow.rowCount).toBe(1);
      const secondVetRow = await query(
        `INSERT INTO sos_notifications (case_id, vet_id, channel) VALUES ($1, $2, 'sms')
         ON CONFLICT DO NOTHING`,
        [caseId, vetId],
      );
      expect(secondVetRow.rowCount).toBe(0);

      // The recipient-less bmc row, the shape a plain UNIQUE could never
      // police (NULLs are never equal), which is why the indexes are partial:
      const firstBmc = await query(
        `INSERT INTO sos_notifications (case_id, channel) VALUES ($1, 'bmc') ON CONFLICT DO NOTHING`,
        [caseId],
      );
      expect(firstBmc.rowCount).toBe(1);
      const secondBmc = await query(
        `INSERT INTO sos_notifications (case_id, channel) VALUES ($1, 'bmc') ON CONFLICT DO NOTHING`,
        [caseId],
      );
      expect(secondBmc.rowCount).toBe(0);
    } finally {
      // The sms rows reference the vet, so they go first (afterEach only
      // sweeps this case's rows later).
      await query(
        `DELETE FROM sos_notifications WHERE case_id = $1 AND vet_id = $2`,
        [caseId, vetId],
      );
      await query(`DELETE FROM vets WHERE id = $1`, [vetId]);
    }

    // And distinct recipients still coexist: a second push to another
    // responder is NOT swallowed by the index.
    const other = await insertEligibleFeeder("sos-dedupe-responder-2", 65);
    const otherPush = await query(
      `INSERT INTO sos_notifications (case_id, feeder_id, channel) VALUES ($1, $2, 'push')
       ON CONFLICT DO NOTHING`,
      [caseId, other],
    );
    expect(otherPush.rowCount).toBe(1);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Design-v4: report photo + the reporter's own status view.
// ---------------------------------------------------------------------------

function jpegSegmentForSos(marker: number, payload: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
}

/** A minimal baseline JPEG carrying a COM segment the strip must remove. */
const SOS_JPEG_ENTROPY = Buffer.from([0x31, 0x41, 0xff, 0x00, 0x59, 0x26, 0x53, 0x58, 0x97, 0x93]);
const SOS_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  jpegSegmentForSos(0xfe, Buffer.from("reporter home address", "latin1")), // COM
  jpegSegmentForSos(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 0x10)])), // DQT
  jpegSegmentForSos(0xc0, Buffer.from([0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00])), // SOF0
  jpegSegmentForSos(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(16, 0x00), Buffer.from([0x00])])), // DHT
  jpegSegmentForSos(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])), // SOS
  SOS_JPEG_ENTROPY,
  Buffer.from([0xff, 0xd9]),
]);

async function caseScanPhotoKey(caseId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await query<{ photo_s3_key: string | null }>(
      `SELECT s.photo_s3_key FROM sos_cases c JOIN scans s ON s.id = c.scan_id WHERE c.id = $1`,
      [caseId],
    );
    const key = res.rows[0]?.photo_s3_key ?? null;
    if (key) return key;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

describe("POST /api/v1/reports: optional photo", () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "hetja-sos-photo-"));
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  const server = () => buildServer({ ...config, STORAGE_BACKEND: "local" as const, STORAGE_LOCAL_DIR: storageDir });

  it("stores the photo metadata-stripped on the case's scan row", async () => {
    const app = server();
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "serious", deviceToken: token, photoBase64: SOS_JPEG.toString("base64") },
    });
    expect(res.statusCode).toBe(200);
    const key = await caseScanPhotoKey(res.json().data.caseId);
    expect(key).toMatch(/^photos\/.+\.jpg$/);
    const stored = await readFile(join(storageDir, key!));
    expect(stored.includes(Buffer.from("reporter home address", "latin1"))).toBe(false);
    expect(stored.includes(SOS_JPEG_ENTROPY)).toBe(true);
    await app.close();
  });

  it("rejects an undecodable photo with 400 and opens no case", async () => {
    const app = server();
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "serious", deviceToken: token, photoBase64: Buffer.from("not an image at all").toString("base64") },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_PHOTO");
    const cases = await query<{ n: number }>(`SELECT count(*)::int AS n FROM sos_cases WHERE dog_id = $1`, [dogId]);
    expect(cases.rows[0].n).toBe(0);
    await app.close();
  });

  it("does not bypass the dedupe or the INVARIANT 7 cap: a new photo is the same report", async () => {
    const app = server();
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const photoBase64 = SOS_JPEG.toString("base64");
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "same words", deviceToken: token, photoBase64 },
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "same words", deviceToken: token, photoBase64 },
    });
    expect(replay.json().data.created).toBe(false);
    expect(replay.json().data.caseId).toBe(first.json().data.caseId);

    await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "second", deviceToken: token, photoBase64 },
    });
    const capped = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "third", deviceToken: token, photoBase64 },
    });
    expect(capped.statusCode).toBe(429);
    const cases = await query<{ n: number }>(`SELECT count(*)::int AS n FROM sos_cases WHERE dog_id = $1`, [dogId]);
    expect(cases.rows[0].n).toBe(2);
    await app.close();
  });
});

describe("GET /api/v1/reports/:caseId/status", () => {
  beforeEach(() => {
    reportStatusLimiter.reset();
  });

  async function fileReport(app: ReturnType<typeof buildServer>, token: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "serious", note: `status ${randomUUID()}`, deviceToken: token },
    });
    expect(res.statusCode).toBe(200);
    return res.json().data.caseId as string;
  }

  it("answers the reporting device with exactly four fields", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const caseId = await fileReport(app, token);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/${caseId}/status`,
      headers: { "x-device-token": token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const data = res.json().data;
    // Design v6 widened this (N10, N11, V19, L7): lifecycle times, the
    // responder's and paged feeders' FIRST names (opt-out respected), counts,
    // the outcome, and the reporter's own updates. Still nothing that
    // identifies anyone beyond a first name, and no position.
    expect(Object.keys(data).sort()).toEqual([
      "ackedAt", "arrivedAt", "closeByAt", "escalatedAt", "feedersNotified", "feedersNotifiedNames", "leftAt",
      "outcome", "resolvedAt", "responderFirstName", "state", "takenAt", "updates", "vetName", "vetsNotified",
    ]);
    expect(data).toMatchObject({ state: "open", ackedAt: null, escalatedAt: null, resolvedAt: null, responderFirstName: null });

    // After an ack, the reporter learns THAT it was acknowledged, not by whom.
    const responder = await makeFeeder("Status Acker");
    await query(`UPDATE sos_cases SET acked_by = $2, acked_at = now(), state = 'acked' WHERE id = $1`, [
      caseId,
      responder.id,
    ]);
    const acked = await app.inject({
      method: "GET",
      url: `/api/v1/reports/${caseId}/status`,
      headers: { "x-device-token": token },
    });
    expect(acked.json().data.state).toBe("acked");
    expect(acked.json().data.ackedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(acked.body).not.toContain(responder.id);
    await app.close();
  });

  it("404s any other device, a malformed id and an unknown id alike (no existence leak)", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const caseId = await fileReport(app, token);
    const otherDevice = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    for (const url of [
      `/api/v1/reports/${caseId}/status`,
      `/api/v1/reports/${randomUUID()}/status`,
      `/api/v1/reports/not-a-uuid/status`,
    ]) {
      const res = await app.inject({ method: "GET", url, headers: { "x-device-token": otherDevice } });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    }

    // No credential at all is a 401, before any lookup.
    const none = await app.inject({ method: "GET", url: `/api/v1/reports/${caseId}/status` });
    expect(none.statusCode).toBe(401);

    // A feeder account that did not file it gets the same 404.
    const stranger = await makeFeeder("Status Stranger");
    const byStranger = await app.inject({
      method: "GET",
      url: `/api/v1/reports/${caseId}/status`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    });
    expect(byStranger.statusCode).toBe(404);
    await app.close();
  });

  it("is keyed on the canonical device id, so a re-encoded token string is the same device", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const caseId = await fileReport(app, token);
    const stored = await query<{ device_token: string }>(
      `SELECT s.device_token FROM sos_cases c JOIN scans s ON s.id = c.scan_id WHERE c.id = $1`,
      [caseId],
    );
    expect(stored.rows[0].device_token).toBe(deviceTokenSubject(token, config.HETJA_DEVICE_SECRET));
    await app.close();
  });

  it("answers the signed-in account that filed it", async () => {
    const app = buildServer(config);
    const reporter = await makeFeeder("Status Reporter");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: { authorization: `Bearer ${reporter.accessToken}` },
      payload: { dogSlug, severity: "serious" },
    });
    const caseId = res.json().data.caseId as string;
    const status = await app.inject({
      method: "GET",
      url: `/api/v1/reports/${caseId}/status`,
      headers: { authorization: `Bearer ${reporter.accessToken}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.state).toBe("open");
    await app.close();
  });

  it("rate-limits per device (INVARIANT 6), not globally", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const caseId = await fileReport(app, token);
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/reports/${caseId}/status`,
        headers: { "x-device-token": token },
      });
      if (res.statusCode === 429) {
        limited++;
        expect(res.headers["retry-after"]).toBeTruthy();
      }
    }
    expect(limited).toBeGreaterThan(0);

    // A different device is unaffected by the first one's budget.
    const other = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/${caseId}/status`,
      headers: { "x-device-token": other },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Hardening batch 1 (2026-09-25)
// ---------------------------------------------------------------------------

async function fileCase(app: ReturnType<typeof buildServer>, severity: "minor" | "serious" | "critical"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/reports",
    payload: { dogSlug, severity, note: `h1 ${randomUUID()}`, deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET) },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.caseId as string;
}

function ackAs(app: ReturnType<typeof buildServer>, accessToken: string, caseId: string) {
  return app.inject({
    method: "POST",
    url: `/api/v1/sos/cases/${caseId}/ack`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

describe("POST /api/v1/sos/cases/:id/ack: eligibility (T1, audit A-01)", () => {
  it("403s SOS_ACK_FORBIDDEN for a signed-in feeder with trust 30 who was never paged", async () => {
    const app = buildServer(config);
    const caseId = await fileCase(app, "minor");
    const newbie = await makeFeeder("Newbie", "feeder", { trust: 30, sosOptIn: true });
    const res = await ackAs(app, newbie.accessToken, caseId);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SOS_ACK_FORBIDDEN");
    const row = await query<{ acked_by: string | null; state: string }>(
      `SELECT acked_by, state FROM sos_cases WHERE id = $1`,
      [caseId],
    );
    expect(row.rows[0]).toEqual({ acked_by: null, state: "open" });
    await app.close();
  });

  it("accepts a responder who was paged for the case, whatever their standing", async () => {
    const app = buildServer(config);
    const caseId = await fileCase(app, "critical");
    const paged = await makeFeeder("Paged Low Trust", "feeder", { trust: 30, sosOptIn: false });
    await query(`INSERT INTO sos_notifications (case_id, feeder_id, channel) VALUES ($1, $2, 'push')`, [caseId, paged.id]);
    const res = await ackAs(app, paged.accessToken, caseId);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.ackedBy).toBe(paged.id);
    await app.close();
  });

  it("trust 45 and opted in may claim a minor case but not a critical one", async () => {
    const app = buildServer(config);
    const minor = await fileCase(app, "minor");
    const critical = await fileCase(app, "critical");
    const mid = await makeFeeder("Mid Trust", "feeder", { trust: 45, sosOptIn: true });
    expect((await ackAs(app, mid.accessToken, minor)).statusCode).toBe(200);
    const res = await ackAs(app, mid.accessToken, critical);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SOS_ACK_FORBIDDEN");
    await app.close();
  });

  it("a moderator may claim any case without opting in", async () => {
    const app = buildServer(config);
    const caseId = await fileCase(app, "critical");
    const admin = await makeFeeder("Claiming Admin", "admin");
    expect((await ackAs(app, admin.accessToken, caseId)).statusCode).toBe(200);
    await app.close();
  });

  it("409s SOS_TOO_MANY_OPEN_ACKS on a third open case, while a re-ack of a held case stays 200", async () => {
    const app = buildServer(config);
    const cases = [await fileCase(app, "minor"), await fileCase(app, "minor"), await fileCase(app, "minor")];
    const responder = await makeResponder("Hoarder");
    expect((await ackAs(app, responder.accessToken, cases[0])).statusCode).toBe(200);
    expect((await ackAs(app, responder.accessToken, cases[1])).statusCode).toBe(200);
    const third = await ackAs(app, responder.accessToken, cases[2]);
    expect(third.statusCode).toBe(409);
    expect(third.json().error.code).toBe("SOS_TOO_MANY_OPEN_ACKS");
    expect((await ackAs(app, responder.accessToken, cases[0])).statusCode).toBe(200);

    // Resolving one frees a slot.
    const resolved = await app.inject({
      method: "POST",
      url: `/api/v1/sos/cases/${cases[0]}/resolve`,
      headers: { authorization: `Bearer ${responder.accessToken}` },
      payload: { resolution: "handled" },
    });
    expect(resolved.statusCode).toBe(200);
    expect((await ackAs(app, responder.accessToken, cases[2])).statusCode).toBe(200);
    await app.close();
  });

  it("rate-limits acks per account: the 6th in a burst is 429 RATE_LIMITED with retry-after", async () => {
    const app = buildServer(config);
    const responder = await makeResponder("Prober");
    for (let i = 0; i < 5; i++) {
      expect((await ackAs(app, responder.accessToken, randomUUID())).statusCode).toBe(404);
    }
    const sixth = await ackAs(app, responder.accessToken, randomUUID());
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe("RATE_LIMITED");
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);

    // Another account is unaffected.
    const other = await makeResponder("Other Prober");
    expect((await ackAs(app, other.accessToken, randomUUID())).statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /api/v1/reports: hardening batch 1 (T3, T5, T11)", () => {
  it("accepts the device token in the X-Device-Token header", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: { "x-device-token": token },
      payload: { dogSlug, severity: "minor", note: "header token" },
    });
    expect(res.statusCode).toBe(200);
    const row = await query<{ device_token: string }>(
      `SELECT s.device_token FROM scans s JOIN sos_cases c ON c.scan_id = s.id WHERE c.id = $1`,
      [res.json().data.caseId],
    );
    expect(row.rows[0].device_token).toBe(deviceTokenSubject(token, config.HETJA_DEVICE_SECRET));
    await app.close();
  });

  it("the INVARIANT 7 cap's 429 still carries nearbyCare", async () => {
    await insertNearbyProvider();
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    for (const note of ["one", "two"]) {
      const ok = await app.inject({
        method: "POST",
        url: "/api/v1/reports",
        payload: { dogSlug, severity: "minor", note, deviceToken: token },
      });
      expect(ok.statusCode).toBe(200);
    }
    const capped = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "three", deviceToken: token },
    });
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error.code).toBe("SOS_RATE_LIMITED");
    expect(capped.json().data.nearbyCare.length).toBeGreaterThan(0);
    await app.close();
  });

  it("rate-limits the route per device (burst 6): the 7th request is 429 RATE_LIMITED with nearbyCare", async () => {
    await insertNearbyProvider();
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const payload = { dogSlug, severity: "minor", note: "same report", deviceToken: token };
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: "POST", url: "/api/v1/reports", payload });
      expect(res.statusCode).toBe(200); // the first opens, the rest are replays
    }
    const seventh = await app.inject({ method: "POST", url: "/api/v1/reports", payload });
    expect(seventh.statusCode).toBe(429);
    expect(seventh.json().error.code).toBe("RATE_LIMITED");
    expect(Number(seventh.headers["retry-after"])).toBeGreaterThan(0);
    expect(seventh.json().data.nearbyCare.length).toBeGreaterThan(0);

    // Another device is unaffected.
    const other = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { ...payload, deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET) },
    });
    expect(other.statusCode).toBe(200);
    await app.close();
  });

  it("omits data on a 429 when the dog has no position", async () => {
    await query(`UPDATE dogs SET last_seen_geo = NULL WHERE id = $1`, [dogId]);
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const payload = { dogSlug, severity: "minor", note: "no geo", deviceToken: token };
    for (let i = 0; i < 6; i++) await app.inject({ method: "POST", url: "/api/v1/reports", payload });
    const limited = await app.inject({ method: "POST", url: "/api/v1/reports", payload });
    expect(limited.statusCode).toBe(429);
    // No nearbyCare without a position. (Since v6 the 429 may carry the
    // reporter's openCase instead, L7.)
    expect(limited.json().data?.nearbyCare).toBeUndefined();
    await app.close();
  });
});

describe("GET /api/v1/sos/cases/:id: ward (T15)", () => {
  it("adds the dog's wardId and wardName, and nothing finer", async () => {
    const app = buildServer(config);
    const caseId = await fileCase(app, "minor");
    const admin = await makeFeeder("Ward Reader", "admin");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sos/cases/${caseId}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.wardId).toBe("K-West");
    expect(res.json().data.wardName).toBe("Andheri West");
    expect(res.body).not.toMatch(/"lat"|"lng"/);
    expect(res.json().data.mine).toBe(false);
    await app.close();
  });

  it("reports mine: true to the acker and false to a paged responder who did not take it", async () => {
    const app = buildServer(config);
    const caseId = await fileCase(app, "minor");
    const acker = await makeResponder("Mine Acker");
    const paged = await makeResponder("Mine Bystander");
    await query(`INSERT INTO sos_notifications (case_id, feeder_id, channel) VALUES ($1, $2, 'push')`, [caseId, paged.id]);
    expect((await ackAs(app, acker.accessToken, caseId)).statusCode).toBe(200);
    const read = (token: string) =>
      app.inject({ method: "GET", url: `/api/v1/sos/cases/${caseId}`, headers: { authorization: `Bearer ${token}` } });
    expect((await read(acker.accessToken)).json().data.mine).toBe(true);
    const other = await read(paged.accessToken);
    expect(other.statusCode).toBe(200);
    expect(other.json().data.mine).toBe(false);
    await app.close();
  });
});

describe("PATCH /api/v1/feeders/me error codes (B-11)", () => {
  it("keeps INVALID_SOS_OPT_IN for a bad sosOptIn and uses INVALID_FEEDER_PATCH otherwise", async () => {
    const feeder = await makeFeeder("Patch Codes");
    const app = buildServer(config);
    const patch = (payload: object) =>
      app.inject({
        method: "PATCH",
        url: "/api/v1/feeders/me",
        headers: { authorization: `Bearer ${feeder.accessToken}` },
        payload,
      });
    expect((await patch({ sosOptIn: "yes" })).json().error.code).toBe("INVALID_SOS_OPT_IN");
    expect((await patch({ displayName: "" })).json().error.code).toBe("INVALID_FEEDER_PATCH");
    expect((await patch({ homeWard: "K/W" })).json().error.code).toBe("INVALID_FEEDER_PATCH");
    expect((await patch({})).json().error.code).toBe("INVALID_FEEDER_PATCH");
    await app.close();
  });
});
