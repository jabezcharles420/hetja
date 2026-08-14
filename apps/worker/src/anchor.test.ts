/**
 * Daily-anchor tests (INVARIANT 10).
 *
 * This file exists because the two defects it covers were both invisible:
 *
 *   1. `anchor_ledger`'s query could not run at all. It selected `hash_curr`
 *      alongside `count(*)` with no GROUP BY, which PostgreSQL rejects, so every
 *      anchor run threw before writing anything. apps/worker had no tests, so
 *      nothing noticed, and docs/INVARIANTS.md recorded the invariant as done.
 *      A single execution of the real handler against a real database is the
 *      whole guard.
 *   2. Nothing enqueued the job. No cron, no timer, no INSERT anywhere with
 *      `kind = 'anchor_ledger'` — so "daily" had no schedule to be late from.
 *
 * Both suites run inside a transaction they ROLL BACK. That is not tidiness: the
 * API suite (apps/api/src/routes/ledger.test.ts) asserts on the LATEST row of
 * `ledger_anchors`, `pnpm -r test` can run the two packages concurrently, and an
 * anchor committed from here would win that race and fail an unrelated suite.
 * Rolling back also means the "no anchor in the last 24 hours" branch can be set
 * up by deleting every anchor without changing what another suite sees.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@hetja/db";
import type { PoolClient } from "pg";
import { enqueueAnchorJobIfDue, publishLedgerAnchor } from "./index.js";

afterAll(async () => {
  await pool.end();
});

/**
 * Runs `fn` in a transaction that is always rolled back, so nothing this file
 * writes is ever visible to another suite or left behind in the database.
 */
async function inRolledBackTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/**
 * A unique, well-formed 64-hex value for a fixture row's `hash_curr`.
 *
 * NOT a chain-valid hash: computing one means `computeHash` from
 * `@hetja/ledger`, which is not a declared dependency of apps/worker (see the
 * header of src/sign-anchor.ts). Nothing here needs chain validity — the anchor
 * job reads `hash_curr` as an opaque leaf and never verifies the chain, and the
 * row is rolled back — but it does need to satisfy the UNIQUE index on
 * `hash_curr`, which is what the random input is for.
 */
function fixtureHash(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

describe("publishLedgerAnchor", () => {
  it("publishes a well-formed anchor over the whole ledger", async () => {
    await inRolledBackTx(async (client) => {
      // A dog and one record, so the ledger is non-empty regardless of what else
      // this database holds. Written directly rather than through the API because
      // the worker has no HTTP surface.
      const dog = await client.query<{ id: string }>(
        `INSERT INTO dogs (slug, name, ward_id)
         VALUES ('anch' || substr(md5(random()::text), 1, 5), 'AnchorTest', 'A')
         RETURNING id`,
      );
      const ts = new Date().toISOString();
      const payload = { dogId: dog.rows[0].id, recordType: "feeding_observation", note: ts };
      const payloadText = JSON.stringify(payload);
      await client.query(
        `INSERT INTO medical_records
           (dog_id, record_type, payload_len, hash_prev, hash_curr, payload, hash_vet_id, hash_ts)
         VALUES ($1, 'feeding_observation', $2, $3, $4, $5::jsonb, 'feeder', $6)`,
        [
          dog.rows[0].id,
          Buffer.byteLength(payloadText, "utf8"),
          "0".repeat(64),
          fixtureHash(),
          payloadText,
          ts,
        ],
      );

      // The regression guard: before the fix this line threw
      // `column "medical_records.hash_curr" must appear in the GROUP BY clause`.
      const published = await publishLedgerAnchor(client);
      expect(published).not.toBeNull();
      expect(published!.recordCount).toBeGreaterThanOrEqual(1);
      expect(published!.head).toMatch(/^[0-9a-f]{64}$/);

      const row = await client.query<{
        head_hash: string;
        merkle_root: string | null;
        record_count: number;
        ledger_id: string;
        head_signature: string | null;
      }>(`SELECT head_hash, merkle_root, record_count, ledger_id, head_signature
            FROM ledger_anchors ORDER BY published_at DESC LIMIT 1`);
      const anchor = row.rows[0];
      expect(anchor.head_hash).toBe(published!.head);
      expect(Number(anchor.record_count)).toBe(published!.recordCount);
      expect(anchor.ledger_id).toBe("hetja:medical:global");

      // head_hash must be the STORED head of the last row, not a recomputation:
      // publishing a freshly recomputed head would make GET /api/v1/ledger/verify
      // agree with the anchor by construction, including over doctored rows.
      const all = await client.query<{ hash_curr: string }>(
        `SELECT hash_curr FROM medical_records ORDER BY created_at ASC, id ASC`,
      );
      expect(anchor.head_hash).toBe(all.rows[all.rows.length - 1].hash_curr);
      expect(Number(anchor.record_count)).toBe(all.rows.length);

      // merkle_root is a hex root when @hetja/ledger resolves and NULL when it
      // does not (it is not yet a declared dependency of apps/worker — see
      // src/sign-anchor.ts). Asserted as "either" on purpose: pinning it to null
      // would turn adding the dependency into a test failure.
      expect(anchor.merkle_root === null || /^[0-9a-f]{64}$/.test(anchor.merkle_root)).toBe(true);
      // No signing key is configured in CI, so the anchor is unsigned — the
      // documented degradation, not a failure. `signed: false` is how
      // GET /api/v1/ledger/anchor tells a caller which kind it is holding.
      expect(anchor.head_signature).toBeNull();
      expect(published!.signed).toBe(false);
    });
  });
});

describe("enqueueAnchorJobIfDue", () => {
  it("enqueues once when no anchor was published in the last 24h, then not again", async () => {
    await inRolledBackTx(async (client) => {
      await client.query("DELETE FROM ledger_anchors");
      await client.query("DELETE FROM jobs WHERE kind = 'anchor_ledger'");

      expect(await enqueueAnchorJobIfDue(client)).toBe(true);
      const queued = await client.query(`SELECT id FROM jobs WHERE kind = 'anchor_ledger'`);
      expect(queued.rows.length).toBe(1);

      // A queued job means "not done yet" (jobs are DELETEd on success), so a
      // second pass must not pile up a duplicate.
      expect(await enqueueAnchorJobIfDue(client)).toBe(false);
      const stillOne = await client.query(`SELECT id FROM jobs WHERE kind = 'anchor_ledger'`);
      expect(stillOne.rows.length).toBe(1);
    });
  });

  it("waits while a published anchor is fresh, and fires once it ages out", async () => {
    await inRolledBackTx(async (client) => {
      await client.query("DELETE FROM ledger_anchors");
      await client.query("DELETE FROM jobs WHERE kind = 'anchor_ledger'");
      await client.query(
        `INSERT INTO ledger_anchors (head_hash, record_count, published_at)
         VALUES ($1, 1, now() - interval '1 hour')`,
        ["c".repeat(64)],
      );
      expect(await enqueueAnchorJobIfDue(client)).toBe(false);

      // The published anchor IS the record of the last run, so the schedule
      // cannot drift away from what was actually published.
      await client.query(`UPDATE ledger_anchors SET published_at = now() - interval '25 hours'`);
      expect(await enqueueAnchorJobIfDue(client)).toBe(true);
    });
  });
});
