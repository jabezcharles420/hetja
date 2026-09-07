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
import { REFRESH_TOKEN_SWEEP_GRACE_DAYS, sweepExpiredChallengesAndTokens } from "./index.js";

afterAll(async () => {
  await pool.end();
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
