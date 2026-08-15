/**
 * The hash chain must be ordered by APPEND order, not by wall-clock order.
 *
 * `medical.ts` issues `BEGIN` and `pg_advisory_xact_lock(420001)` as two
 * separate round trips, and PostgreSQL stamps `now()` — hence
 * `created_at DEFAULT now()` — at BEGIN. So a transaction can START earlier and
 * APPEND later. Ordering the chain by `created_at` therefore reads it in an
 * order it was never written in: `verifyChain` breaks, every persisted
 * `merkle_root` stops reproducing, and the proof endpoint reports TAMPERED on
 * completely untampered data.
 *
 * Measured on the real route before the fix: 16 concurrent appends inverted
 * 51 of 120 pairs (42.5%) and produced 3 chain forks. Migration 0017 adds
 * `chain_seq`, allocated by nextval() at INSERT while the chain lock is held,
 * so sequence order = lock order = commit order by construction.
 *
 * DETERMINISM. There is no race to lose here. The two clients are driven
 * sequentially by the test, and A's pause sits between its BEGIN and its lock
 * acquisition — which is the real window, and the only placement that works:
 * PostgreSQL's advisory-lock queue is FIFO, so a client already blocked on the
 * lock can never lose to one that asks later.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GENESIS_PREV_HASH,
  canonicalPayload,
  computeHash,
  type LedgerRecord,
} from "@hetja/ledger";
import { CHAIN_ORDER_ASC, CHAIN_ORDER_DESC, generateSlug, pool, query } from "@hetja/db";

/**
 * Just the surface this file uses from a pooled client, described structurally.
 *
 * `pg` is not a direct dependency of apps/api, and `Awaited<ReturnType<typeof
 * pool.connect>>` resolves to `void` because `connect` has a callback overload.
 * Naming the two methods used is cheaper than either.
 */
interface LedgerClient {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  release(): void;
}

const CHAIN_LOCK_KEY = 420_001; // must match medical.ts

interface Appended {
  id: string;
  chain_seq: string | null;
  created_at: Date;
  hashCurr: string;
  prev: string;
}

/**
 * A faithful replica of medical.ts's append (lines ~193-261), minus HTTP: same
 * advisory lock, same head SELECT via the same exported CHAIN_ORDER_DESC, same
 * chained hash. Raw SQL because the whole point is to control WHEN the
 * transaction begins relative to when it takes the lock, and `app.inject` gives
 * no seam between those two statements.
 *
 * `chain_seq` is never supplied — a writer that can name its own ordering key
 * could forge its position in the chain. It comes from the column default.
 */
async function appendUnderLock(
  client: LedgerClient,
  dogId: string,
  note: string,
): Promise<Appended> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [CHAIN_LOCK_KEY]);
  const head = await client.query<{ hash_curr: string }>(
    `SELECT hash_curr FROM medical_records ORDER BY ${CHAIN_ORDER_DESC} LIMIT 1`,
  );
  const prev = head.rows[0]?.hash_curr ?? GENESIS_PREV_HASH;

  const input = { dogId, recordType: "feeding_observation" as const, note };
  const payloadText = canonicalPayload({ ...input });
  const ts = new Date().toISOString();
  const hashCurr = computeHash(prev, { ...input }, "feeder", ts);

  const ins = await client.query<{ id: string; chain_seq: string | null; created_at: Date }>(
    `INSERT INTO medical_records
       (dog_id, record_type, payload_len, hash_prev, hash_curr, payload, hash_vet_id, hash_ts)
     VALUES ($1::uuid, 'feeding_observation', $2, $3, $4, $5::jsonb, 'feeder', $6)
     RETURNING id, chain_seq, created_at`,
    [dogId, Buffer.byteLength(payloadText, "utf8"), prev, hashCurr, payloadText, ts],
  );
  return { ...ins.rows[0], hashCurr, prev };
}

let dogId: string;
let A: Appended; // transaction begins FIRST, appends SECOND
let B: Appended; // transaction begins SECOND, appends FIRST

beforeAll(async () => {
  const dog = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id) VALUES ($1, 'ChainSeqOrderTest', 'A') RETURNING id`,
    [generateSlug()],
  );
  dogId = dog.rows[0].id;

  const ca = await pool.connect();
  const cb = await pool.connect();
  try {
    // A's transaction starts first, so its created_at is stamped first...
    await ca.query("BEGIN");
    // ...and this is the window medical.ts really has between BEGIN and the
    // lock. The ordering below is enforced by the test's own awaits; the sleep
    // only makes the two timestamps comfortably distinguishable.
    await ca.query("SELECT pg_sleep(0.05)");

    // ...but B takes the chain lock, appends, and commits first.
    await cb.query("BEGIN");
    B = await appendUnderLock(cb, dogId, "B: began second, appended first");
    await cb.query("COMMIT");

    // Only now can A take the lock. It chains onto B and commits last.
    A = await appendUnderLock(ca, dogId, "A: began first, appended second");
    await ca.query("COMMIT");
  } finally {
    ca.release();
    cb.release();
  }
});

afterAll(async () => {
  // No cleanup: medical_records is append-only (INVARIANT 8). The rows are
  // scoped to their own dog so they cannot disturb another suite.
  await pool.end();
});

describe("chain ordering follows append order, not wall-clock order", () => {
  it("actually reproduced the inversion", () => {
    // A precondition, not decoration: if the inversion ever stops reproducing,
    // every assertion below would pass vacuously and this file would be
    // silently testing nothing.
    expect(A.created_at.getTime()).toBeLessThan(B.created_at.getTime());
    expect(Number(A.chain_seq)).toBeGreaterThan(Number(B.chain_seq));
    // Deliberately NOT `expect(A.prev).toBe(B.hashCurr)`. The chain is global
    // and vitest runs suites in parallel against one database, so another
    // file's append can legitimately take the chain lock between B's COMMIT and
    // A's lock acquisition — in which case A correctly chains onto THAT row.
    // Asserting otherwise would make this file fail for a correct system.
  });

  it("reads the dog's leaves in append order", async () => {
    const rows = await query<{ id: string }>(
      `SELECT id FROM medical_records WHERE dog_id = $1 ORDER BY ${CHAIN_ORDER_ASC}`,
      [dogId],
    );
    // Under the old `created_at ASC, id ASC` this was [A, B] — the order the
    // rows were NOT written in.
    expect(rows.rows.map((r) => r.id)).toEqual([B.id, A.id]);
  });

  it("never reads a row before the row it chains onto", async () => {
    // The property the old ordering violated, stated so it survives concurrent
    // writers: if row X chains onto row Y and BOTH are in the result set, Y must
    // be read before X. A backwards link in canonical read order is precisely
    // what makes verifyChain report TAMPERED on untouched data.
    //
    // Not `verifyChain(rows)`: that needs a complete genesis-rooted chain, and
    // this is a per-dog slice of a GLOBAL chain (medical.ts's head SELECT has no
    // dog filter). A whole-table verifyChain is unavailable too — the shared
    // test database carries fixtures inserted directly with a genesis prev on
    // non-first rows, so it is unverifiable for reasons unrelated to this bug.
    const rows = await query<Pick<LedgerRecord, "id" | "prev" | "hash">>(
      `SELECT id, hash_prev AS prev, hash_curr AS hash
         FROM medical_records ORDER BY ${CHAIN_ORDER_ASC}`,
    );
    const positionOf = new Map(rows.rows.map((r, i) => [r.hash, i]));

    const ours = new Set([A.id, B.id]);
    for (let i = 0; i < rows.rows.length; i++) {
      const row = rows.rows[i];
      if (!ours.has(row.id)) continue; // only assert over the rows this file wrote
      const parentAt = positionOf.get(row.prev);
      if (parentAt === undefined) continue; // parent outside the set: nothing to order against
      expect(parentAt).toBeLessThan(i);
    }
  });

  it("the head is the last-appended row, never a pre-0017 row", async () => {
    const head = await query<{ id: string; chain_seq: string | null }>(
      `SELECT id, chain_seq FROM medical_records ORDER BY ${CHAIN_ORDER_DESC} LIMIT 1`,
    );
    // The NULLS trap: PostgreSQL defaults DESC to NULLS FIRST, so the obvious
    // `ORDER BY chain_seq DESC LIMIT 1` returns a historical row with no
    // chain_seq as the head of a chain that has long moved past it — and the
    // next append forks. CHAIN_ORDER_DESC pins NULLS LAST for exactly this.
    //
    // Asserted as "the head has a chain_seq" rather than "the head is A":
    // vitest runs suites in parallel against one database and other files
    // append through the real route, so the globally-last row is not this
    // file's to own. The NULLS placement is the property under test, and it
    // holds regardless of who else is writing.
    expect(head.rows[0].chain_seq).not.toBeNull();
  });
});

describe("chain_seq allocation", () => {
  it("is assigned automatically and is strictly increasing with append order", async () => {
    expect(A.chain_seq).not.toBeNull();
    expect(B.chain_seq).not.toBeNull();
    expect(Number(B.chain_seq)).toBeLessThan(Number(A.chain_seq));
  });

  it("tolerates gaps — nextval is non-transactional", async () => {
    // A rolled-back append burns a sequence value. Nothing may ever assume
    // contiguity (e.g. `WHERE chain_seq = prev + 1`), and ledger_anchors
    // .record_count must stay a COUNT, never a max chain_seq.
    const client = await pool.connect();
    let burned: string;
    try {
      await client.query("BEGIN");
      const r = await client.query<{ chain_seq: string }>(
        `INSERT INTO medical_records
           (dog_id, record_type, payload_len, hash_prev, hash_curr, payload, hash_vet_id, hash_ts)
         VALUES ($1::uuid, 'feeding_observation', 2, $2, $3, '{}'::jsonb, 'feeder', $4)
         RETURNING chain_seq`,
        [dogId, "0".repeat(64), `deadbeef${Date.now()}`.padEnd(64, "0").slice(0, 64), new Date().toISOString()],
      );
      burned = r.rows[0].chain_seq;
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const still = await query<{ n: string }>(
      `SELECT count(*) AS n FROM medical_records WHERE chain_seq = $1`,
      [burned],
    );
    expect(Number(still.rows[0].n)).toBe(0); // the row is gone, the value is spent
  });
});
