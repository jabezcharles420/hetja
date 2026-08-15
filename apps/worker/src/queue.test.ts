/**
 * Job-queue retry semantics.
 *
 * These cover a defect that had no test and could not have had one in the old
 * shape: `claimNext`, the handler call and the `DELETE` all ran inside a single
 * `withTx`, so a handler throw rolled back the `attempts + 1` increment and the
 * `locked_until` lease together with the handler's own partial writes. The
 * consequences were all silent:
 *
 *   - `attempts` never advanced, so the `attempts >= MAX_ATTEMPTS` dead-letter
 *     branch was unreachable code.
 *   - the job kept its original `run_after`, so `ORDER BY run_after LIMIT 1`
 *     re-selected the same row every 2s, forever.
 *   - the throw escaped the per-job transaction into the batch loop, so one bad
 *     job stopped every job behind it — including the SOS escalations and push
 *     fan-outs this queue exists to deliver.
 *
 * Unlike `anchor.test.ts` these cannot run inside a rolled-back transaction:
 * the behaviour under test IS the transaction boundaries, and `processOneJob`
 * opens its own. So each test commits, then deletes exactly the rows it created
 * (tracked by id) in a `finally`. `jobs` is the one table here that is safe to
 * clean up — unlike `medical_records` it is not append-only.
 *
 * `POISON_KIND` is a job kind with no registered handler. That reaches the
 * failure path through `HANDLERS[kind]` being undefined, which needs no mocking
 * and no exported seam into the handler table.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, query } from "@hetja/db";
import { processOneJob } from "./index.js";

afterAll(async () => {
  await pool.end();
});

const POISON_KIND = "test_no_such_handler";
/** Has a handler, and that handler is a no-op DELETE that always succeeds. */
const GOOD_KIND = "retention";

/** Queue a job far enough in the past to be claimable immediately. */
async function enqueue(kind: string, opts: { attempts?: number; agoSeconds?: number } = {}) {
  const res = await query<{ id: string }>(
    `INSERT INTO jobs (kind, payload, run_after, attempts)
     VALUES ($1, '{}'::jsonb, now() - make_interval(secs => $2), $3)
     RETURNING id`,
    [kind, opts.agoSeconds ?? 10, opts.attempts ?? 0],
  );
  return res.rows[0].id;
}

async function readJob(id: string) {
  const res = await query<{
    attempts: number;
    locked_until: Date | null;
    failed_at: Date | null;
    last_error: string | null;
    run_after: Date;
  }>(
    `SELECT attempts, locked_until, failed_at, last_error, run_after FROM jobs WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

async function cleanup(ids: string[]) {
  if (ids.length) await query(`DELETE FROM jobs WHERE id = ANY($1::bigint[])`, [ids]);
}

/**
 * Park every job this database already holds so a test's `processOneJob()` can
 * only pick up the row the test just queued. Returns a restore function.
 *
 * Necessary because `processOneJob` claims by `ORDER BY run_after LIMIT 1`
 * across the whole table, and the suite shares a database with apps/api's.
 */
async function isolateQueue(): Promise<() => Promise<void>> {
  const res = await query<{ id: string }>(
    `UPDATE jobs SET locked_until = now() + interval '1 hour'
      WHERE (locked_until IS NULL OR locked_until < now()) AND failed_at IS NULL
      RETURNING id`,
  );
  const parked = res.rows.map((r) => r.id);
  return async () => {
    if (parked.length) {
      await query(`UPDATE jobs SET locked_until = NULL WHERE id = ANY($1::bigint[])`, [parked]);
    }
  };
}

describe("processOneJob", () => {
  it("counts a failed attempt and backs the job off instead of re-running it forever", async () => {
    const restore = await isolateQueue();
    const id = await enqueue(POISON_KIND);
    try {
      expect(await processOneJob()).toBe("failed");

      const job = await readJob(id);
      // The whole point: the increment SURVIVES the handler failing. Under the
      // old single-transaction code this read back 0.
      expect(job!.attempts).toBe(1);
      expect(job!.failed_at).toBeNull();
      expect(job!.last_error).toContain(POISON_KIND);
      // Released for a later attempt, but pushed into the future so the next
      // poll does not immediately pick the same row again.
      expect(job!.locked_until).toBeNull();
      expect(job!.run_after.getTime()).toBeGreaterThan(Date.now());

      // And it is genuinely not claimable right now.
      expect(await processOneJob()).toBe("idle");
    } finally {
      await cleanup([id]);
      await restore();
    }
  });

  it("does not let one failing job block the jobs queued behind it", async () => {
    const restore = await isolateQueue();
    const poison = await enqueue(POISON_KIND, { agoSeconds: 30 });
    const good = await enqueue(GOOD_KIND, { agoSeconds: 20 });
    try {
      // Ordered by run_after, so the poison job is claimed first.
      expect(await processOneJob()).toBe("failed");
      // Previously this threw out of the batch loop and the job below never ran.
      expect(await processOneJob()).toBe("done");

      expect(await readJob(good)).toBeNull(); // deleted on success
      expect((await readJob(poison))!.attempts).toBe(1);
    } finally {
      await cleanup([poison, good]);
      await restore();
    }
  });

  it("dead-letters a job that exhausts its attempts, keeping the row and the reason", async () => {
    const restore = await isolateQueue();
    // MAX_ATTEMPTS is 8, so a job already at 7 exhausts on this run.
    const id = await enqueue(POISON_KIND, { attempts: 7 });
    try {
      expect(await processOneJob()).toBe("failed");

      const job = await readJob(id);
      // Parked and marked, NOT deleted — these are SOS escalations, and a
      // life-safety job that vanishes after eight failures is exactly the
      // silent rejection INVARIANT 14 forbids.
      expect(job).not.toBeNull();
      expect(job!.attempts).toBe(8);
      expect(job!.failed_at).not.toBeNull();
      expect(job!.last_error).toContain(POISON_KIND);
      expect(job!.locked_until).toBeNull();

      // A dead letter is never claimed again, however long you wait.
      await query(`UPDATE jobs SET run_after = now() - interval '1 day' WHERE id = $1`, [id]);
      expect(await processOneJob()).toBe("idle");
    } finally {
      await cleanup([id]);
      await restore();
    }
  });

  it("reports an empty queue as idle rather than failing", async () => {
    const restore = await isolateQueue();
    try {
      expect(await processOneJob()).toBe("idle");
    } finally {
      await restore();
    }
  });
});
