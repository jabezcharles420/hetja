/**
 * Hetja ledger trust endpoints (INVARIANT 10).
 *
 * GET /api/v1/ledger/anchor        — latest published anchor (head hash, global
 *   Merkle root, record count, and the signature over them when one exists)
 * GET /api/v1/ledger/verify?n=…    — recompute the head from the last n
 *   medical_records and compare against the latest published anchor.
 *   Tamper-evidence anyone can run.
 * GET /api/v1/ledger/proof?hash=…  — RFC 6962 inclusion proof for one medical
 *   record, so an external auditor can check that record in O(log n) without
 *   being handed the table.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  merkleProof,
  recomputeHead,
  type LedgerRecord,
  type MerkleProof,
  type ProvenRecord,
} from "@hetja/ledger";
import { query, CHAIN_ORDER_ASC } from "@hetja/db";

/** hex SHA-256, the shape of every hash_curr and every Merkle node. */
const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Hard ceiling on how many records one proof request will read.
 *
 * Building a proof is O(n) in the ledger being proven over (the tree is rebuilt
 * to cut the audit path out of it), and this endpoint is deliberately
 * unauthenticated — see the note on the route. Unbounded O(n) work on an
 * anonymous endpoint is a denial-of-service primitive, so it gets a ceiling
 * rather than a promise that the data will stay small. 10 000 is ~3 orders of
 * magnitude above what one dog's ledger holds; hitting it means either
 * something is very wrong or the incremental-audit-path work mentioned in
 * medical.ts is now due, and either way a clear answer beats a slow one.
 */
const MAX_PROOF_LEDGER_ROWS = 10_000;

/**
 * Leaves of one dog's tree, in canonical chain order, plus the root each row
 * attested when it was written (0014_ledger_merkle_root.sql).
 *
 * `id` and `hash_curr` are the only columns a tree needs: a leaf is
 * `SHA256(0x00 || record.hash)` and `id` is used solely to locate the leaf's
 * index (packages/ledger/src/merkle.ts). Payloads are deliberately NOT read —
 * pulling every `payload` JSONB off disk to build a tree that never touches
 * them would be the most expensive part of this request.
 *
 * The WHERE and ORDER BY must stay identical to `DOG_LEDGER_SQL` in medical.ts:
 * the append path computes the stored root over those leaves in that order, so
 * any divergence here would recompute a different root over the same data and
 * report untampered records as tampered.
 *
 * Reading the rows and the attested root in ONE query is deliberate: two
 * queries would see two snapshots, and an append landing between them would
 * make the stored root (over n+1 leaves) disagree with the recomputed root
 * (over n) for no reason at all. One statement, one snapshot, one tree.
 */
const DOG_LEDGER_SQL = `
SELECT id, hash_curr AS hash, merkle_root AS "attestedRoot"
  FROM medical_records
 WHERE dog_id = $1
 ORDER BY ${CHAIN_ORDER_ASC}
 LIMIT $2`;

/**
 * Leaves of the GLOBAL tree — every dog — in the same canonical order the
 * chain and the daily anchor use. `LIMIT $1` is set to the anchor's own
 * `record_count`, not to "everything": see `anchoredGlobalProof`.
 */
const GLOBAL_LEDGER_SQL = `
SELECT id, hash_curr AS hash
  FROM medical_records
 ORDER BY ${CHAIN_ORDER_ASC}
 LIMIT $1`;

type DogLeafRow = ProvenRecord & { attestedRoot: string | null };

/**
 * `merkleRoot`/`merkleProof` are typed against the full `LedgerRecord` but read
 * only `id` and `hash` (`ProvenRecord`), which is what the queries above
 * select. The assertion is to a subtype and is safe for exactly that reason;
 * it is isolated here so the justification lives in one place rather than at
 * each call site.
 */
function asLeaves(rows: ProvenRecord[]): LedgerRecord[] {
  return rows as LedgerRecord[];
}

interface AnchorRow {
  head_hash: string;
  merkle_root: string | null;
  record_count: number;
  ledger_id: string | null;
  published_at: Date | string;
  signed: boolean;
}

/** The per-dog half of the answer: proof + the root the write attested. */
interface DogProof {
  proof: MerkleProof;
  /**
   * The root the dog's most recent record committed to when it was written.
   * `null` for a ledger whose latest row predates 0014 — reported as null,
   * never as agreement. A null is not a pass.
   */
  attestedRoot: string | null;
  /**
   * `proof.root === attestedRoot`, or null when there is nothing to compare
   * against. false is the interesting case: the tree recomputed from today's
   * rows is not the tree that was committed to at write time.
   */
  rootMatchesAttested: boolean | null;
  /**
   * What this half is and is not worth. Stated in the response because an
   * auditor should not have to read our source to find the weak link:
   * `merkle_root` is NOT covered by the hash chain (INVARIANT 9 hashes
   * `hash_prev‖payload‖vet_id‖ts` and nothing else) and NOT covered by the
   * published anchor. It is protected by `medical_records` being append-only
   * (INVARIANT 8), which stops the application role — the role an attacker who
   * gets the API's credentials would hold — but not someone with direct
   * superuser access to the cluster. The `global` half below is the one that
   * chains to a value published outside this database.
   */
  attestation: string;
}

/** The global half: proof against the root published in the daily anchor. */
interface GlobalProof {
  /** Anchor metadata, so the caller knows which published value this is about. */
  publishedRoot: string;
  publishedAt: string;
  recordCount: number;
  ledgerId: string | null;
  signed: boolean;
  /**
   * Whether the record was already in the ledger when that anchor was
   * published. RFC 6962 trees are prefix-consistent, so a record at index i is
   * provable against the anchor's root iff i < the anchor's record count; the
   * proof below is therefore cut over exactly the anchor's first
   * `recordCount` leaves, not over the table as it stands now.
   */
  anchored: boolean;
  proof: MerkleProof | null;
  rootMatchesPublished: boolean | null;
  note?: string;
}

interface ProofResponse {
  /**
   * Exactly what `verifyInclusion(record, proof, root)` needs as its first
   * argument (`ProvenRecord`). Returned separately from the proofs on purpose:
   * an auditor should be holding this record from somewhere else (a court
   * exhibit, the public profile endpoint) and comparing, not trusting a proof's
   * own account of what it proves.
   */
  record: ProvenRecord;
  dog: DogProof;
  global: GlobalProof | null;
  verify: string;
}

const VERIFY_HINT =
  "verifyInclusion(record, proof, proof.root) from @hetja/ledger, or any RFC 6962 audit-path " +
  "verifier: leaf = SHA256(0x00 || record.hash), node = SHA256(0x01 || left || right). Then " +
  "compare the root against one obtained independently: global.publishedRoot is the value in " +
  "GET /api/v1/ledger/anchor, which the daily job also signs when a key is configured.";

export default async function ledgerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/ledger/anchor", async () => {
    const res = await query(
      `SELECT head_hash, merkle_root, record_count, ledger_id,
              published_at, published_url,
              (head_signature IS NOT NULL) AS signed, head_signature
         FROM ledger_anchors ORDER BY published_at DESC LIMIT 1`,
    );
    if (res.rowCount === 0) {
      return { ok: true, data: { anchor: null, note: "no anchor published yet (daily job pending)" } };
    }
    // head_signature is returned in full: it is a signature over values that
    // are themselves published here, and its whole purpose is to be checked by
    // someone who does not trust this server. `signed: false` says plainly that
    // an anchor is unattributed rather than leaving the caller to infer it from
    // a null — an unsigned head is still comparable, it just does not say who
    // computed it (see apps/worker/src/sign-anchor.ts).
    return { ok: true, data: { anchor: res.rows[0] } };
  });

  app.get<{ Querystring: { n?: string } }>("/api/v1/ledger/verify", async (req) => {
    const n = Math.min(Math.max(Number(req.query.n ?? 1000) || 1000, 1), 50_000);
    const rows = await query<LedgerRecord>(
      `SELECT hash_prev AS prev, payload, hash_vet_id AS "vetId",
              hash_ts AS ts, hash_curr AS hash
         FROM medical_records
        ORDER BY ${CHAIN_ORDER_ASC}
        LIMIT $1`,
      [n],
    );
    const anchor = await query<{ head_hash: string }>(
      `SELECT head_hash FROM ledger_anchors ORDER BY published_at DESC LIMIT 1`,
    );
    if (rows.rowCount === 0 || anchor.rowCount === 0) {
      return { ok: true, data: { records: rows.rowCount, verdict: "insufficient_data" } };
    }
    const head = recomputeHead(rows.rows);
    const valid = head === anchor.rows[0].head_hash;
    return {
      ok: true,
      data: {
        records: rows.rowCount,
        recomputedHead: head,
        publishedHead: anchor.rows[0].head_hash,
        verdict: valid ? "valid" : "TAMPERED",
      },
    };
  });

  /**
   * GET /api/v1/ledger/proof?hash=<hash_curr>
   *
   * The auditor-facing half of enhancement stack §D.1 / Top-25 #15: "an
   * external auditor (court, municipal vet office) can verify a specific
   * record's inclusion in O(log n) without seeing the whole table." Returns the
   * record's RFC 6962 audit path plus the root it was cut against, which the
   * caller feeds into `verifyInclusion` — or into any independent RFC 6962
   * implementation, which is the point of having adopted a published standard
   * instead of a bespoke tree.
   *
   * TWO SCOPES, because one alone answers only half the question:
   *
   *   `dog`    — the per-dog tree §D.1 actually specifies, and the one whose
   *              root is persisted on every append. Cheap, always available,
   *              but attested only by a column in this database.
   *   `global` — the tree the daily anchor publishes and signs. This is the one
   *              that reaches a value the operator does not solely control,
   *              which is the whole of INVARIANT 10. Cut over the anchor's
   *              first `record_count` leaves, so it verifies against the exact
   *              root that was published rather than against the table as it
   *              stands now (RFC 6962 trees are prefix-consistent, so that is
   *              a valid tree, not a truncation).
   *
   * KEYED BY THE RECORD HASH, NOT ITS UUID. `hash_curr` is already public: the
   * anonymous dog profile (`GET /api/v1/dogs/:slug/medical`) returns it for
   * every verified record, and it is the value the auditor has to check anyway.
   * Keying on it means this endpoint introduces no new identifier and no new
   * enumeration surface, and it is a UNIQUE column (0001_init.sql) so the
   * lookup is an index probe.
   *
   * WHY THIS IS UNAUTHENTICATED, deliberately.
   *
   * INVARIANT 10's reasoning is that "a hash chain that is computed and stored
   * by the same party that could tamper with it proves nothing about tampering
   * by that party". A proof endpoint that requires a credential issued by that
   * same party inherits exactly that defect: the auditor's ability to check us
   * would be ours to revoke, at the moment it mattered. `GET /verify` above is
   * anonymous for the same reason.
   *
   * INVARIANT 2 is the rule that governs anonymous reads here, and it is about
   * coordinates — dog and feeder locations coarsened to ward or a ≥500 m cell.
   * A proof contains no geo, no payload, no name, no contact data: it is a list
   * of 32-byte digests, an index and a leaf count. The digests are not
   * invertible to a treatment record (SHA-256 over length-prefixed
   * `hash_prev‖payload‖vet_id‖ts`, INVARIANT 9), and the ones it exposes are
   * the same kind already published by the profile endpoint.
   *
   * What it does leak, stated rather than glossed over: `leafCount` on the dog
   * proof is that dog's TOTAL record count, including unverified feeder
   * self-reports which the public profile hides (it filters `is_verified`). So
   * an anonymous caller holding one public record hash can learn "this dog has
   * 7 ledger entries" while seeing only 2. That is a count, not content — it
   * reveals that self-reports exist, not what any of them says — and it is
   * unavoidable in an inclusion proof, because an RFC 6962 tree's shape IS a
   * function of (index, leafCount) and a verifier cannot decide left-vs-right
   * at each level without it. Withholding it would not protect the count, it
   * would only make the proof unverifiable, which is a worse trade on an
   * endpoint whose entire purpose is external verification.
   */
  app.get<{ Querystring: { hash?: string } }>(
    "/api/v1/ledger/proof",
    async (req: FastifyRequest<{ Querystring: { hash?: string } }>, reply: FastifyReply) => {
      const hash = (req.query.hash ?? "").trim().toLowerCase();
      if (!HASH_RE.test(hash)) {
        return reply.status(400).send({
          ok: false,
          error: {
            message: "hash must be a 64-character hex record hash (medical_records.hash_curr)",
            code: "INVALID_RECORD_HASH",
          },
        });
      }

      const rec = await query<{ id: string; dog_id: string }>(
        `SELECT id, dog_id FROM medical_records WHERE hash_curr = $1`,
        [hash],
      );
      if (rec.rowCount === 0) {
        // 404 on a well-formed but unknown hash is itself an audit answer:
        // this record is not in the ledger. Not an information leak — the
        // caller already had to hold a 256-bit value to ask the question.
        return reply.status(404).send({
          ok: false,
          error: { message: "no ledger record with that hash", code: "RECORD_NOT_FOUND" },
        });
      }
      const { id: recordId, dog_id: dogId } = rec.rows[0];

      // LIMIT is MAX+1 so an over-large ledger is detected rather than silently
      // proven against a truncated tree — a proof cut from the first 10 000 of
      // 10 001 leaves would verify against a root nobody ever published.
      const dogRows = await query<DogLeafRow>(DOG_LEDGER_SQL, [dogId, MAX_PROOF_LEDGER_ROWS + 1]);
      if (dogRows.rows.length > MAX_PROOF_LEDGER_ROWS) {
        return reply.status(413).send({
          ok: false,
          error: {
            message: `this dog's ledger exceeds ${MAX_PROOF_LEDGER_ROWS} records; inline proofs are capped`,
            code: "LEDGER_TOO_LARGE",
          },
        });
      }

      // Cannot fire in practice — the record was just located by its UNIQUE
      // hash and this is its own dog's ledger, capped above. Checked anyway so
      // an impossible state is a diagnosable 500 rather than `merkleProof`
      // throwing from inside a library.
      const record = dogRows.rows.find((r) => r.id === recordId);
      if (!record) {
        return reply.status(500).send({
          ok: false,
          error: {
            message: "record is not present in its own dog's ledger",
            code: "LEDGER_INCONSISTENT",
          },
        });
      }
      const dogProof = merkleProof(asLeaves(dogRows.rows), recordId);
      // The attested root lives on the dog's LATEST row, because that is the
      // row whose tree covers every leaf this proof was cut from.
      const attestedRoot = dogRows.rows[dogRows.rows.length - 1].attestedRoot;

      const data: ProofResponse = {
        record: { id: record.id, hash: record.hash },
        dog: {
          proof: dogProof,
          attestedRoot,
          rootMatchesAttested: attestedRoot === null ? null : dogProof.root === attestedRoot,
          attestation:
            "attestedRoot is medical_records.merkle_root, written in the same append as the " +
            "record and immutable because medical_records is append-only (INVARIANT 8). It is " +
            "NOT part of the hash chain and NOT covered by the published anchor: trust it only " +
            "as far as you trust that nobody had superuser access to this cluster. The global " +
            "proof is the one that reaches a published, signed value.",
        },
        global: await anchoredGlobalProof(recordId),
        verify: VERIFY_HINT,
      };
      return { ok: true, data };
    },
  );
}

/**
 * Inclusion proof for `recordId` against the root of the most recent PUBLISHED
 * anchor, or null when there is no anchor able to support one.
 *
 * The subtlety worth being explicit about: the tree is cut at the anchor's own
 * `record_count`, not at "all rows now". A record appended after the anchor was
 * published cannot be proven against it — not because anything is wrong, but
 * because it genuinely was not in that tree — and saying "no match" there would
 * be a false alarm on healthy data. So that case returns `anchored: false` with
 * no proof and an explanation, and the honest answer is "wait for the next
 * daily anchor".
 *
 * Returns null (rather than a half-filled object) when the newest anchor
 * predates 0014 and therefore has no `merkle_root`, or when its record_count is
 * above the inline-proof ceiling. Anchors written by the pre-0014 worker also
 * carry a `record_count` that was never correct — its query mixed `count(*)`
 * with a bare column — which is a second reason not to build a proof around
 * one: see the anchor_ledger handler in apps/worker/src/index.ts.
 */
async function anchoredGlobalProof(recordId: string): Promise<GlobalProof | null> {
  const anchorRes = await query<AnchorRow>(
    `SELECT head_hash, merkle_root, record_count, ledger_id, published_at,
            (head_signature IS NOT NULL) AS signed
       FROM ledger_anchors
      WHERE merkle_root IS NOT NULL
      ORDER BY published_at DESC
      LIMIT 1`,
  );
  if (anchorRes.rowCount === 0) return null;
  const anchor = anchorRes.rows[0];
  if (anchor.record_count < 1 || anchor.record_count > MAX_PROOF_LEDGER_ROWS) return null;

  const publishedAt = new Date(anchor.published_at).toISOString();
  const base: Omit<GlobalProof, "anchored" | "proof" | "rootMatchesPublished"> = {
    publishedRoot: anchor.merkle_root as string,
    publishedAt,
    recordCount: anchor.record_count,
    ledgerId: anchor.ledger_id,
    signed: anchor.signed,
  };

  const rows = await query<ProvenRecord>(GLOBAL_LEDGER_SQL, [anchor.record_count]);
  const index = rows.rows.findIndex((r) => r.id === recordId);
  if (index === -1) {
    return {
      ...base,
      anchored: false,
      proof: null,
      rootMatchesPublished: null,
      note:
        "this record was not among the first " +
        `${anchor.record_count} ledger entries covered by the anchor published at ${publishedAt}` +
        " — it was appended afterwards. It becomes provable against the next daily anchor.",
    };
  }

  const proof = merkleProof(asLeaves(rows.rows), recordId);
  return {
    ...base,
    anchored: true,
    proof,
    rootMatchesPublished: proof.root === base.publishedRoot,
  };
}
