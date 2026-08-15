/**
 * Hetja medical ledger routes (INVARIANT 8/9/10).
 *
 * POST /api/v1/medical_records — feeder self-report (is_verified=false) or
 *   vet write (is_verified=true, clinic signature verified against
 *   vets.signing_key_pub). Every row is chained: hash_prev = previous head,
 *   hash_curr = SHA256(length-prefixed concat), computed under
 *   pg_advisory_xact_lock so concurrent writers can't fork the chain. The same
 *   INSERT persists the dog's Merkle root as of this row (see
 *   0014_ledger_merkle_root.sql), which is what makes
 *   GET /api/v1/ledger/proof (ledger.ts) an attestation rather than a
 *   recomputation. Corrections APPEND (corrects_record_id) — the DB refuses
 *   UPDATE/DELETE.
 * GET  /api/v1/dogs/:slug/medical — anon: verified records only.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createPublicKey, verify } from "node:crypto";
import {
  GENESIS_PREV_HASH,
  canonicalPayload,
  computeHash,
  merkleRoot,
  type LedgerRecord,
  type ProvenRecord,
} from "@hetja/ledger";
import { MedicalRecordInput } from "@hetja/contracts";
import { pool, query } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";

const CHAIN_LOCK_KEY = 420_001; // arbitrary, stable advisory lock for the chain

/**
 * One dog's Merkle leaves, in canonical chain order. The WHERE and ORDER BY are
 * shared verbatim with the proof endpoint in ledger.ts (`DOG_LEDGER_SQL`
 * there) — the two MUST agree, because a proof is only checkable against a root
 * computed over the same leaves in the same order, and a divergence between
 * these two queries would show up as "tampered" on untampered data.
 *
 * Only `id` and `hash_curr` are selected. A leaf is `SHA256(0x00 ||
 * record.hash)` and `id` is used solely to locate a leaf's index
 * (packages/ledger/src/merkle.ts), so reading every `payload` JSONB here would
 * be pure I/O — paid on every append, while holding the chain lock, for bytes
 * that are never hashed.
 *
 * (created_at, id) is the ordering the chain itself already uses — the head
 * SELECT below is its `DESC` twin — and 0014 adds the matching
 * (dog_id, created_at, id) index so this is an index-ordered range scan rather
 * than a seq scan plus sort under the chain lock.
 *
 * Known limitation, inherited rather than introduced: `created_at` defaults to
 * `now()`, which in PostgreSQL is the TRANSACTION start time, so two appends
 * that overlap in time can be committed by the advisory lock in one order and
 * ordered by `created_at` in the other. The chain's own verification
 * (`recomputeHead`, ledger.ts) already depends on this ordering, so the Merkle
 * tree is no more exposed to it than the chain is — but it is why the ordering
 * is spelled out identically in both files instead of being left to each
 * query's convenience.
 */
const DOG_LEDGER_SQL = `
SELECT id, hash_curr AS hash
  FROM medical_records
 WHERE dog_id = $1
 ORDER BY created_at ASC, id ASC`;

/**
 * Placeholder id for the row being appended, which does not have one yet:
 * `id` is `gen_random_uuid()` on INSERT, and the root has to be computed
 * BEFORE the INSERT so it can be written in the same statement (INVARIANT 8
 * leaves no second chance — there is no UPDATE to add it afterwards).
 *
 * Safe because the record id is deliberately not in the tree: a leaf is
 * `SHA256(0x00 || record.hash)` and nothing else (packages/ledger/src/merkle.ts,
 * `leafHash`), matching INVARIANT 9's hash over
 * `hash_prev‖payload‖vet_id‖ts`. `merkleProof` uses ids only to FIND a leaf's
 * index, never to hash it, and `verifyInclusion` documents `proof.recordId` as
 * a label checked for agreement, not a committed value. This string is
 * therefore never hashed, never stored and never returned.
 */
const PENDING_LEAF_ID = "(pending-insert)";

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
  // `verifyAccessToken` THROWS (JwtError) on a malformed, mis-signed, wrong-type
  // or expired token — it never returns a falsy payload. So the `if (!payload)`
  // guard that used to stand here was unreachable, the throw escaped the handler,
  // and with no `setErrorHandler` registered Fastify's default turned it into a
  // 500 whose body echoed the internal message ("malformed token", "bad
  // signature"). Every other authenticated route — stories.ts, trust.ts, push.ts,
  // territories.ts, metrics.ts — wraps this call in try/catch; medical.ts was the
  // one that did not, and it guards the append-only ledger write.
  try {
    const payload = verifyAccessToken(token, req.server.config.JWT_SECRET);
    return { feederId: payload.sub as string };
  } catch {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "invalid token", code: "BAD_TOKEN" } });
    return null;
  }
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

      // Merkle root over THIS DOG's whole ledger including the row about to be
      // written (enhancement stack §D.1, Top-25 #15). Computed here, inside the
      // same transaction and under the same advisory lock as the chain write,
      // for two reasons: the root has to include the new leaf, and no concurrent
      // append may land between "read the dog's rows" and "insert" or the stored
      // root would describe a tree that never existed.
      //
      // The cost is real and worth stating plainly: this is O(n) rows read plus
      // O(n) SHA-256 over one dog's history on EVERY insert, and it is paid
      // while holding CHAIN_LOCK_KEY, which serialises all medical appends
      // system-wide — so it is not just this writer's latency, it is everyone's.
      // At pilot scale that is fine: a dog carries a handful of records (a
      // vaccination, an ABC, the odd treatment), so n is single digits and the
      // hashing is microseconds. It stops being fine somewhere in the low
      // thousands of records for a single dog, which no dog will reach; if one
      // ever does, the fix is to store each row's audit path incrementally
      // rather than rebuilding the tree, not to drop the persistence.
      const prior = await client.query<ProvenRecord>(DOG_LEDGER_SQL, [input.dogId]);
      // `merkleRoot` is typed against the full `LedgerRecord` but reads only
      // `hash` (and `merkleProof` additionally `id`), which is what the query
      // above selects — so this asserts to a subtype whose extra fields are
      // provably unused. See ledger.ts's `asLeaves` for the same note.
      const leaves = [
        ...prior.rows,
        { id: PENDING_LEAF_ID, hash: hashCurr },
      ] as LedgerRecord[];
      const dogMerkleRoot = merkleRoot(leaves);

      const ins = await client.query(
        `INSERT INTO medical_records
           (dog_id, vet_id, record_type, vaccine_name, vaccine_date, abc_date,
            diagnosis, treatment, severity, is_verified, vet_signature,
            corrects_record_id, payload_len, hash_prev, hash_curr,
            payload, hash_vet_id, hash_ts, merkle_root)
         SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13, $14, $15,
                $16::jsonb, $17, $18, $19
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
          dogMerkleRoot,
        ],
      );
      await client.query("COMMIT");
      return {
        ok: true,
        data: {
          id: ins.rows[0].id,
          hashCurr,
          isVerified,
          prev,
          // The dog's root as of this row, returned so the writer can record
          // what was attested without a second round trip. Verifiable against
          // GET /api/v1/ledger/proof?hash=<hashCurr>.
          merkleRoot: dogMerkleRoot,
        },
      };
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
    // hash_curr is the handle for GET /api/v1/ledger/proof?hash=… and
    // merkle_root is the root this row attested when it was written, so the
    // pair is everything an auditor needs to start from a public profile and
    // finish at an inclusion proof without asking us for anything else.
    // Neither is sensitive: both are digests, and INVARIANT 2's concern here
    // (coordinates) does not appear in this projection at all.
    const rows = await query(
      `SELECT record_type, vaccine_name, vaccine_date, abc_date, diagnosis, treatment,
              severity, created_at, hash_curr, merkle_root
         FROM medical_records
        WHERE dog_id = $1 AND is_verified
        ORDER BY created_at DESC`,
      [dog.rows[0].id],
    );
    return { ok: true, data: { records: rows.rows } };
  });
}
