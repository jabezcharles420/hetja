import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { issueDeviceToken } from "../lib/device.js";
import { signAccessToken } from "../lib/jwt.js";
import { query } from "@straynet/db";

const config = loadConfig();

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function randomSlug(): string {
  let slug = "";
  for (let i = 0; i < 9; i++) {
    slug += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return slug;
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
    `INSERT INTO feeders (phone_hmac, display_name, role, trust_score, consent_version, is_minor,
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
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);

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
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);
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
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);

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
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);

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
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);

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

    const job = await query<{ kind: string }>(
      `SELECT kind FROM jobs WHERE payload->>'caseId' = $1`,
      [body.data.caseId],
    );
    expect(job.rows[0].kind).toBe("escalate_sos");

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
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);

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
      `INSERT INTO feeders (phone_hmac, display_name, role, trust_score, consent_version, is_minor)
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
    const token = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);

    const report = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { dogSlug, severity: "minor", note: "for get", deviceToken: token },
    });
    const caseId = report.json().data.caseId;

    const feederRes = await query<{ id: string }>(
      `INSERT INTO feeders (phone_hmac, display_name, role, trust_score, consent_version, is_minor)
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
