import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { generateSlug, query } from "@hetja/db";
import {
  canonicalPayload,
  merkleRoot,
  type LedgerRecord,
  type ProvenRecord,
} from "@hetja/ledger";
import type { FastifyInstance } from "fastify";

/**
 * `merkleRoot` reads only `hash` off each record (packages/ledger/src/merkle.ts),
 * so a two-column projection is a complete leaf set. Same assertion, and same
 * reason, as `asLeaves` in ledger.ts.
 */
const asLeaves = (rows: ProvenRecord[]): LedgerRecord[] => rows as LedgerRecord[];

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

  it("returns the dog's Merkle root alongside the chain hash", async () => {
    const payloadText = canonicalPayload(vetRecordPayload({ vaccineDate: "2026-08-13" }));
    const sig = sign(null, Buffer.from(payloadText, "utf8"), vetSigningPriv).toString("base64");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { authorization: `Bearer ${vetAccessToken}` },
      payload: { ...vetRecordPayload({ vaccineDate: "2026-08-13" }), signature: sig },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
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

describe("persisted Merkle root (enhancement stack §D.1, Top-25 #15)", () => {
  /**
   * A dedicated dog, because the assertions are about the leaf SET and its
   * ORDER: on a shared dog another suite's append would change both. The dog
   * outlives the test — medical_records references it and cannot be deleted
   * (INVARIANT 8).
   */
  let merkleDogId: string;

  beforeAll(async () => {
    const dog = await query<{ id: string }>(
      `INSERT INTO dogs (slug, name, ward_id) VALUES ($1, 'MerkleTest', 'A') RETURNING id`,
      [generateSlug()],
    );
    merkleDogId = dog.rows[0].id;
  });

  async function appendSelfReport(treatment: string): Promise<{ id: string; hashCurr: string; merkleRoot: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { authorization: `Bearer ${feederAccessToken}` },
      payload: { dogId: merkleDogId, recordType: "feeding_observation", treatment },
    });
    expect(res.statusCode).toBe(200);
    return res.json().data;
  }

  it("stores a root over the dog's whole ledger, including the row being written", async () => {
    const first = await appendSelfReport("merkle one");
    const rows = await query<ProvenRecord>(
      `SELECT id, hash_curr AS hash FROM medical_records
        WHERE dog_id = $1 ORDER BY created_at ASC, id ASC`,
      [merkleDogId],
    );
    expect(rows.rows).toHaveLength(1);
    // A single-leaf tree is SHA256(0x00 || hash) — NOT the record hash itself.
    // That inequality is RFC 6962's domain separation, and it is the whole
    // defence against an internal node being replayed as a leaf.
    expect(first.merkleRoot).not.toBe(first.hashCurr);
    expect(first.merkleRoot).toBe(merkleRoot(asLeaves(rows.rows)));

    const stored = await query<{ merkle_root: string }>(
      `SELECT merkle_root FROM medical_records WHERE id = $1`,
      [first.id],
    );
    expect(stored.rows[0].merkle_root).toBe(first.merkleRoot);
  });

  it("moves the root on every append, and each row keeps the root of its own moment", async () => {
    const second = await appendSelfReport("merkle two");
    const third = await appendSelfReport("merkle three");
    expect(second.merkleRoot).not.toBe(third.merkleRoot);

    const rows = await query<ProvenRecord & { merkle_root: string }>(
      `SELECT id, hash_curr AS hash, merkle_root FROM medical_records
        WHERE dog_id = $1 ORDER BY created_at ASC, id ASC`,
      [merkleDogId],
    );
    expect(rows.rows).toHaveLength(3);
    // Every row's stored root is the root over the prefix ENDING at that row —
    // which is what makes an old row's root an attestation about that moment
    // rather than a stale copy of the current one.
    for (let i = 0; i < rows.rows.length; i++) {
      expect(rows.rows[i].merkle_root).toBe(merkleRoot(asLeaves(rows.rows.slice(0, i + 1))));
    }
    // 3 leaves is the RFC 6962 case a Bitcoin-style tree gets wrong: it must
    // NOT equal the root of the same 3 leaves with the last one duplicated.
    expect(rows.rows[2].merkle_root).not.toBe(
      merkleRoot(asLeaves([...rows.rows, rows.rows[2]])),
    );
  });

  it("keeps one dog's tree independent of another dog's records", async () => {
    const other = await query<{ id: string }>(
      `INSERT INTO dogs (slug, name, ward_id) VALUES ($1, 'MerkleTestOther', 'A') RETURNING id`,
      [generateSlug()],
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { authorization: `Bearer ${feederAccessToken}` },
      payload: { dogId: other.rows[0].id, recordType: "feeding_observation", treatment: "other dog" },
    });
    expect(res.statusCode).toBe(200);

    // The first dog's stored roots are untouched by an append for a different
    // dog — the tree is per-dog (§D.1: "over each dog's medical_records rows").
    const rows = await query<ProvenRecord & { merkle_root: string }>(
      `SELECT id, hash_curr AS hash, merkle_root FROM medical_records
        WHERE dog_id = $1 ORDER BY created_at ASC, id ASC`,
      [merkleDogId],
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows[2].merkle_root).toBe(merkleRoot(asLeaves(rows.rows)));
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
