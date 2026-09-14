/**
 * The retention job's table sweeps.
 *
 * Two migrations promised these and nothing delivered them: 0021 says
 * spent_challenges is "swept by worker retention", 0017 says "the worker's
 * retention job sweeps rows whose token expired more than seven days ago". The
 * handler deleted photo files only, and `return`ed before doing anything at all
 * on a non-local storage backend. spent_challenges survived on a best-effort
 * DELETE inside every mint; refresh_tokens grew by a row per login, forever.
 *
 * Rows are committed and then deleted by id in `finally`: the sweep opens its
 * own statements, so a rolled-back transaction cannot exercise it. Every fixture
 * row is unmistakably ours (a `retention-test-` prefix on the challenge hash, a
 * dedicated feeder for the tokens), and nothing else in these tables is touched
 * except rows that are genuinely expired — which is the job's whole contract.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, query } from "@hetja/db";
import {
  HANDLERS,
  REFRESH_TOKEN_SWEEP_GRACE_DAYS,
  enqueueRetentionJobIfDue,
  scheduleNextDailyRun,
  sweepExpiredChallengesAndTokens,
} from "./index.js";
import type { PoolClient } from "pg";

afterAll(async () => {
  await pool.end();
});

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
 * The daily cadence. `enqueueRetentionJobIfDue` reads "ran in the last 24h"
 * off the jobs table, and a completed job is DELETEd — so until the handler
 * left its own next run behind, the producer found nothing every five-minute
 * tick and enqueued again. The live worker journal showed the sweep running 288
 * times a day.
 */
describe("daily cadence (scheduleNextDailyRun)", () => {
  it("the handler books exactly one run 24h out, and the producer then stays quiet", async () => {
    // Start from a queue with no live retention rows, committed, so the
    // handler's own INSERT (which commits) is observed.
    await query(`DELETE FROM jobs WHERE kind = 'retention' AND failed_at IS NULL`);
    try {
      await HANDLERS.retention({});
      await HANDLERS.retention({}); // a retry must not book a second one
      const future = await query<{ n: number; soonest: Date }>(
        `SELECT count(*)::int AS n, min(run_after) AS soonest FROM jobs
          WHERE kind = 'retention' AND failed_at IS NULL AND run_after > now()`,
      );
      expect(future.rows[0].n).toBe(1);
      // ~24h out (allow the seconds the two handler runs took).
      const hoursOut = (future.rows[0].soonest.getTime() - Date.now()) / 3_600_000;
      expect(hoursOut).toBeGreaterThan(23.9);
      expect(hoursOut).toBeLessThanOrEqual(24);

      // The producer sees the booked run and does not enqueue on top of it.
      await inRolledBackTx(async (client) => {
        expect(await enqueueRetentionJobIfDue(client)).toBe(false);
      });

      // Without a booked run, the producer fires — this is the path a fresh
      // box (or a dead-lettered sweep) takes.
      await inRolledBackTx(async (client) => {
        await client.query(`DELETE FROM jobs WHERE kind = 'retention'`);
        expect(await enqueueRetentionJobIfDue(client)).toBe(true);
      });
    } finally {
      await query(`DELETE FROM jobs WHERE kind = 'retention' AND run_after > now()`);
    }
  });

  it("scheduleNextDailyRun is idempotent while a live future row exists", async () => {
    const kind = `test_daily_${Date.now()}`;
    try {
      expect(await scheduleNextDailyRun(kind)).toBe(true);
      expect(await scheduleNextDailyRun(kind)).toBe(false);
      // A dead-lettered future row does not count as "booked".
      await query(`UPDATE jobs SET failed_at = now() WHERE kind = $1`, [kind]);
      expect(await scheduleNextDailyRun(kind)).toBe(true);
    } finally {
      await query(`DELETE FROM jobs WHERE kind = $1`, [kind]);
    }
  });
});

describe("sweepExpiredChallengesAndTokens", () => {
  it("removes expired spent challenges and keeps live ones", async () => {
    const expired = `retention-test-${randomUUID()}`;
    const live = `retention-test-${randomUUID()}`;
    await query(
      `INSERT INTO spent_challenges (challenge_hash, spent_at, expires_at)
       VALUES ($1, now() - interval '10 minutes', now() - interval '5 minutes'),
              ($2, now(), now() + interval '2 minutes')`,
      [expired, live],
    );
    try {
      await sweepExpiredChallengesAndTokens();
      const left = await query<{ challenge_hash: string }>(
        `SELECT challenge_hash FROM spent_challenges WHERE challenge_hash IN ($1, $2)`,
        [expired, live],
      );
      expect(left.rows.map((r) => r.challenge_hash)).toEqual([live]);
    } finally {
      await query(`DELETE FROM spent_challenges WHERE challenge_hash IN ($1, $2)`, [expired, live]);
    }
  });

  it("removes refresh tokens expired past the grace window and keeps everything newer", async () => {
    const feeder = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, consent_version)
       VALUES ($1, 'RetentionTest', 'feeder', 'v1') RETURNING id`,
      [`retention-test-${randomUUID()}`],
    );
    const feederId = feeder.rows[0].id;
    const stale = randomUUID(); // expired 8 days ago: past the grace window
    const graced = randomUUID(); // expired yesterday: inside it, must survive
    const live = randomUUID(); // not expired at all
    try {
      await query(
        `INSERT INTO refresh_tokens (jti, feeder_id, expires_at, used_at)
         VALUES ($1, $2, now() - make_interval(days => $5 + 1), now() - interval '20 days'),
                ($3, $2, now() - interval '1 day', NULL),
                ($4, $2, now() + interval '20 days', NULL)`,
        [stale, feederId, graced, live, REFRESH_TOKEN_SWEEP_GRACE_DAYS],
      );
      const out = await sweepExpiredChallengesAndTokens();
      expect(out.refreshTokens).toBeGreaterThanOrEqual(1);
      const left = await query<{ jti: string }>(
        `SELECT jti FROM refresh_tokens WHERE feeder_id = $1 ORDER BY expires_at`,
        [feederId],
      );
      expect(left.rows.map((r) => r.jti)).toEqual([graced, live]);
    } finally {
      // refresh_tokens is ON DELETE CASCADE from feeders.
      await query(`DELETE FROM feeders WHERE id = $1`, [feederId]);
    }
  });
});
