import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { query } from "@hetja/db";
import { canonicalPayload } from "@hetja/ledger";
import type { FastifyInstance } from "fastify";

const config = loadConfig();
let app: FastifyInstance;
let dogId: string;
let vetFeederId: string;
let feederFeederId: string;
let vetSigningPub: string;
let vetSigningPriv: string;
let vetAccessToken: string;
let feederAccessToken: string;

beforeAll(async () => {
  app = buildServer(config);
  await app.ready();

  const dog = await query("SELECT id FROM dogs ORDER BY created_at LIMIT 1");
  dogId = dog.rows[0].id as string;

  // vet feeder + vets registry row with a real Ed25519 keypair
  const kp = generateKeyPairSync("ed25519");
  vetSigningPriv = kp.privateKey.export({ type: "pkcs8", format: "pem" });
  vetSigningPub = kp.publicKey.export({ type: "spki", format: "pem" });
  const vf = await query(
    `INSERT INTO feeders (identity_hmac, display_name, role, consent_version)
     VALUES ($1, 'Test Clinic Vet', 'vet', 'v1.0') RETURNING id`,
    [`hmac-test-vet-${randomUUID()}`],
  );
  vetFeederId = vf.rows[0].id as string;
  await query(
    `INSERT INTO vets (clinic_name, geo, signing_key_pub, feeder_id)
     VALUES ($1, ST_SetSRID(ST_MakePoint(72.87, 19.07), 4326)::geography, $2, $3)`,
    ["Test Clinic", vetSigningPub, vetFeederId],
  );
  vetAccessToken = signAccessToken(vetFeederId, config.JWT_SECRET, config.JWT_ACCESS_TTL);

  // plain feeder
  const ff = await query(
    `INSERT INTO feeders (identity_hmac, display_name, role, consent_version)
     VALUES ($1, 'Test Feeder', 'feeder', 'v1.0') RETURNING id`,
    [`hmac-test-feeder-${randomUUID()}`],
  );
  feederFeederId = ff.rows[0].id as string;
  feederAccessToken = signAccessToken(feederFeederId, config.JWT_SECRET, config.JWT_ACCESS_TTL);
});

afterAll(async () => {
  // Best-effort cleanup only: medical_records rows are intentionally NOT
  // deleted here — app_user cannot DELETE them (INVARIANT 8 working) and the
  // FK keeps the vet row alive. Test rows linger in the dev DB; harmless.
  try {
    await query("DELETE FROM vets WHERE feeder_id = $1", [vetFeederId]);
  } catch {
    /* FK keeps it — fine */
  }
  try {
    await query("DELETE FROM feeders WHERE id IN ($1, $2)", [vetFeederId, feederFeederId]);
  } catch {
    /* fine */
  }
  await app.close();
});

function vetRecordPayload(overrides: Record<string, unknown> = {}) {
  return {
    dogId,
    recordType: "vaccination",
    vaccineName: "ARV",
    vaccineDate: "2026-08-12",
    ...overrides,
  };
}

describe("POST /api/v1/medical_records", () => {
  it("appends a verified row chained to the previous head (INVARIANT 9)", async () => {
    const payloadText = canonicalPayload(vetRecordPayload());
    const sig = sign(null, Buffer.from(payloadText, "utf8"), vetSigningPriv).toString("base64");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { authorization: `Bearer ${vetAccessToken}` },
      payload: { ...vetRecordPayload(), signature: sig },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data as { hashCurr: string; isVerified: boolean; prev: string };
    expect(body.isVerified).toBe(true);
    expect(body.hashCurr).toMatch(/^[0-9a-f]{64}$/);

    const row = await query(
      "SELECT hash_curr, hash_prev, is_verified, payload_len FROM medical_records WHERE id = $1",
      [res.json().data.id],
    );
    expect(row.rows[0].is_verified).toBe(true);
    expect(row.rows[0].hash_prev).toBe(body.prev);
    expect(Number(row.rows[0].payload_len)).toBeGreaterThan(0);
  });

  it("rejects a vet write with a bad signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { authorization: `Bearer ${vetAccessToken}` },
      payload: { ...vetRecordPayload(), signature: Buffer.from("bad").toString("base64") },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_SIGNATURE");
  });

  it("accepts a feeder self-report with is_verified=false", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { authorization: `Bearer ${feederAccessToken}` },
      payload: { dogId, recordType: "feeding_observation", treatment: "regular feeding spot" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.isVerified).toBe(false);
  });

  it("refuses anonymous writes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      payload: vetRecordPayload(),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("append-only enforcement (INVARIANT 8)", () => {
  it("app_user cannot UPDATE medical_records", async () => {
    await expect(
      query("UPDATE medical_records SET treatment = 'tampered' WHERE treatment IS NOT NULL"),
    ).rejects.toThrow();
  });

  it("app_user cannot DELETE medical_records", async () => {
    await expect(query("DELETE FROM medical_records")).rejects.toThrow();
  });
});

describe("GET /api/v1/dogs/:slug/medical", () => {
  it("returns verified records only for anonymous clients", async () => {
    const dog = await query("SELECT slug FROM dogs WHERE id = $1", [dogId]);
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${dog.rows[0].slug}/medical` });
    expect(res.statusCode).toBe(200);
    const records = res.json().data.records as Array<{ record_type: string; is_verified?: boolean }>;
    expect(Array.isArray(records)).toBe(true);
    for (const r of records) {
      expect(r.is_verified).not.toBe(false); // verified only
      expect(r.record_type).toBe("vaccination");
    }
  });
});
