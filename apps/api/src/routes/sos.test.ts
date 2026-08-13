import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { issueDeviceToken } from "../lib/device.js";
import { signAccessToken } from "../lib/jwt.js";
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

let dogId: string;
let dogSlug: string;
const createdFeeders: string[] = [];

async function insertDog(geo = LOC_A): Promise<void> {
  dogSlug = randomSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, last_seen_geo)
     VALUES ($1, 'SosTest', 'K-West',
             ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
     RETURNING id`,
    [dogSlug, geo.lng, geo.lat],
  );
  dogId = res.rows[0].id;
}

async function insertEligibleFeeder(phoneHmac: string, trustScore: number): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor,
                          last_known_geo, last_seen_at, sos_opt_in)
     VALUES ($1, 'SOS Responder', 'feeder', $2, 'v1', FALSE,
             ST_SetSRID(ST_MakePoint(72.8214, 18.9767), 4326)::geography, now(), TRUE)
     RETURNING id`,
    [phoneHmac, trustScore],
  );
  createdFeeders.push(res.rows[0].id);
  return res.rows[0].id;
}

beforeEach(async () => {
  await insertDog();
});

afterEach(async () => {
  await query(`DELETE FROM sos_notifications WHERE case_id IN (SELECT id FROM sos_cases WHERE dog_id = $1)`, [dogId]);
  await query(`DELETE FROM sos_cases WHERE dog_id = $1`, [dogId]);
  await query(`DELETE FROM scans WHERE dog_id = $1`, [dogId]);
  await query(`DELETE FROM jobs WHERE payload->>'dogId' = $1`, [dogId]);
  for (const id of createdFeeders) {
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

    const job = await query<{ kind: string; run_after: Date }>(
      `SELECT kind, run_after FROM jobs WHERE payload->>'caseId' = $1`,
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

    const caseRow = await query<{ tier: number }>(`SELECT tier FROM sos_cases WHERE id = $1`, [body.data.caseId]);
    expect(caseRow.rows[0].tier).toBe(2);

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

  it("fans a critical report out immediately to eligible responders", async () => {
    const feederId = await insertEligibleFeeder("sos-test-feeder-critical", 70);
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

    const notifs = await query<{ feeder_id: string; channel: string }>(
      `SELECT feeder_id, channel FROM sos_notifications WHERE case_id = $1`,
      [body.data.caseId],
    );
    expect(notifs.rows.length).toBe(1);
    expect(notifs.rows[0].feeder_id).toBe(feederId);
    expect(notifs.rows[0].channel).toBe("push");

    const jobs = await query<{ kind: string }>(
      `SELECT kind FROM jobs WHERE payload->>'caseId' = $1 ORDER BY kind`,
      [body.data.caseId],
    );
    // escalate_sos (every report) + send_sos_push (this fan-out had an
    // eligible responder, so the worker has a Web Push to send -- plan §3.4).
    expect(jobs.rows.map((j) => j.kind)).toEqual(["escalate_sos", "send_sos_push"]);

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

    await query(`DELETE FROM feeders WHERE id = $1`, [feederRes.rows[0].id]);
    await app.close();
  });
});

describe("GET /api/v1/sos/cases/:id (feeder auth)", () => {
  it("returns case state to an authenticated feeder", async () => {
    const app = buildServer(config);
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    const report = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "for get", deviceToken: token },
    });
    const caseId = report.json().data.caseId;

    const feederRes = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Case Viewer', 'feeder', 40, 'v1', FALSE) RETURNING id`,
      [randomUUID()],
    );
    const accessToken = signAccessToken(feederRes.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sos/cases/${caseId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(caseId);
    expect(body.data.state).toBe("open");
    expect(body.data.tier).toBe(1);
    expect(body.data.severity).toBe("minor");

    await query(`DELETE FROM feeders WHERE id = $1`, [feederRes.rows[0].id]);
    await app.close();
  });

  it("401s without feeder auth", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: `/api/v1/sos/cases/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);

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

  async function makeFeeder(displayName: string): Promise<{ id: string; accessToken: string }> {
    const res = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, $2, 'feeder', 40, 'v1', FALSE) RETURNING id`,
      [randomUUID(), displayName],
    );
    const id = res.rows[0].id;
    createdFeeders.push(id);
    return { id, accessToken: signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL) };
  }

  it("first ack claims the case: sets acked_by and acked_at, and ack latency is computable from sos_cases alone", async () => {
    const caseId = await openCase();
    const feeder = await makeFeeder("Ack Responder");
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
    const first = await makeFeeder("First Claimant");
    const second = await makeFeeder("Second Claimant");
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
    const feeder = await makeFeeder("Retry Claimant");
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

  it("401s without feeder auth", async () => {
    const caseId = await openCase();
    const app = buildServer(config);
    const res = await app.inject({ method: "POST", url: `/api/v1/sos/cases/${caseId}/ack` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
