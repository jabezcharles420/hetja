/**
 * StrayNet medical ledger routes (INVARIANT 8/9/10).
 *
 * POST /api/v1/medical_records — feeder self-report (is_verified=false) or
 *   vet write (is_verified=true, clinic signature verified against
 *   vets.signing_key_pub). Every row is chained: hash_prev = previous head,
 *   hash_curr = SHA256(length-prefixed concat), computed under
 *   pg_advisory_xact_lock so concurrent writers can't fork the chain.
 *   Corrections APPEND (corrects_record_id) — the DB refuses UPDATE/DELETE.
 * GET  /api/v1/dogs/:slug/medical — anon: verified records only.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  GENESIS_PREV_HASH,
  canonicalPayload,
  computeHash,
} from "@straynet/ledger";
import { MedicalRecordInput } from "@straynet/contracts";
import { pool, query } from "@straynet/db";
import { verifyAccessToken } from "../lib/jwt.js";

const CHAIN_LOCK_KEY = 420_001; // arbitrary, stable advisory lock for the chain

interface FeederRow {
  id: string;
  role: string;
}

interface HeadRow {
  hash_curr: string;
}

interface DogRow {
  id: string;
}

function requireFeeder(
  req: FastifyRequest,
  reply: FastifyReply,
): { feederId: string } | null {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "authentication required", code: "UNAUTHENTICATED" } });
    return null;
  }
  const payload = verifyAccessToken(token, req.server.config.JWT_SECRET);
  if (!payload) {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "invalid token", code: "BAD_TOKEN" } });
    return null;
  }
  return { feederId: payload.sub as string };
}

async function loadFeederRole(feederId: string): Promise<string | null> {
  const res = await query<FeederRow>("SELECT id, role FROM feeders WHERE id = $1", [feederId]);
  return res.rows[0]?.role ?? null;
}

function verifyVetSignature(
  signature: string | undefined,
  payloadText: string,
  signingKeyPub: string | null | undefined,
): boolean {
  if (!signature || !signingKeyPub) return false;
  try {
    const pub = createPublicKey(signingKeyPub);
    return verify(null, Buffer.from(payloadText, "utf8"), pub, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export default async function medicalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/medical_records", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireFeeder(req, reply);
    if (!auth) return reply;
    const role = await loadFeederRole(auth.feederId);
    if (!role || (role !== "feeder" && role !== "vet")) {
      return reply
        .status(403)
        .send({ ok: false, error: { message: "feeder or vet role required", code: "FORBIDDEN" } });
    }

    const parsed = MedicalRecordInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid medical record", code: "INVALID_RECORD" } });
    }
    const input = parsed.data;
    const payloadText = canonicalPayload({ ...input });
    const ts = new Date().toISOString();

    let vetId: string | null = null;
    let isVerified = false;
    let vetSignature: string | null = null;
    if (role === "vet") {
      const vet = await query<{ id: string; signing_key_pub: string | null }>(
        `SELECT v.id, v.signing_key_pub
           FROM vets v
          WHERE v.feeder_id = $1 LIMIT 1`,
        [auth.feederId],
      );
      if (vet.rowCount === 0) {
        return reply
          .status(403)
          .send({ ok: false, error: { message: "vet registry entry missing", code: "VET_NOT_REGISTERED" } });
      }
      const signature = (req.body as { signature?: string }).signature;
      if (!verifyVetSignature(signature, payloadText, vet.rows[0].signing_key_pub)) {
        return reply
          .status(400)
          .send({ ok: false, error: { message: "clinic signature invalid", code: "BAD_SIGNATURE" } });
      }
      vetId = vet.rows[0].id;
      isVerified = true;
      vetSignature = signature ?? null;
    }

    // Chain write under an advisory lock (no forks, ever).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [CHAIN_LOCK_KEY]);
      const head = await client.query<HeadRow>(
        `SELECT hash_curr FROM medical_records ORDER BY created_at DESC, id DESC LIMIT 1`,
      );
      const prev = head.rows[0]?.hash_curr ?? GENESIS_PREV_HASH;
      const hashCurr = computeHash(prev, { ...input }, vetId ?? "feeder", ts);
      const ins = await client.query(
        `INSERT INTO medical_records
           (dog_id, vet_id, record_type, vaccine_name, vaccine_date, abc_date,
            diagnosis, treatment, severity, is_verified, vet_signature,
            corrects_record_id, payload_len, hash_prev, hash_curr,
            payload, hash_vet_id, hash_ts)
         SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13, $14, $15,
                $16::jsonb, $17, $18
         RETURNING id`,
        [
          input.dogId,
          vetId,
          input.recordType,
          input.vaccineName ?? null,
          input.vaccineDate ?? null,
          input.abcDate ?? null,
          input.diagnosis ?? null,
          input.treatment ?? null,
          input.severity ?? null,
          isVerified,
          vetSignature,
          input.correctsRecordId ?? null,
          Buffer.byteLength(payloadText, "utf8"),
          prev,
          hashCurr,
          payloadText,
          vetId ?? "feeder",
          ts,
        ],
      );
      await client.query("COMMIT");
      return { ok: true, data: { id: ins.rows[0].id, hashCurr, isVerified, prev } };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/dogs/:slug/medical", async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const dog = await query<DogRow>("SELECT id FROM dogs WHERE slug = $1", [req.params.slug]);
    if (dog.rowCount === 0) {
      return reply.status(404).send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
    }
    // Anon profile: VERIFIED records only (a cached vaccination must never be
    // presented as current).
    const rows = await query(
      `SELECT record_type, vaccine_name, vaccine_date, abc_date, diagnosis, treatment,
              severity, created_at, hash_curr
         FROM medical_records
        WHERE dog_id = $1 AND is_verified
        ORDER BY created_at DESC`,
      [dog.rows[0].id],
    );
    return { ok: true, data: { records: rows.rows } };
  });
}
