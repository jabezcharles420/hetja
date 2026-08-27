/**
 * Wave 9 — expire_stale_registrations sweep and registration reminder jobs.
 *
 * Covers the three defects this file guards:
 *   1. The producer must carry `failed_at IS NULL` — otherwise one
 *      dead-lettered sweep parks the guard forever and expiry silently stops.
 *   2. Each reminder pass is idempotent via `activation_reminders_sent = N-1`
 *      so a job that runs twice reminds once.
 *   3. Every handler must have a producer entry in JOB_PRODUCERS, including
 *      the honest NONE for validate_scan.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool, query } from "@hetja/db";
import type { PoolClient } from "pg";
import {
  HANDLERS,
  JOB_PRODUCERS,
  enqueueRegistrationSweepIfDue,
  processOneJob,
} from "./index.js";

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

describe("JOB_PRODUCERS mechanical guard", () => {
  it("every handler has a producer entry", () => {
    for (const kind of Object.keys(HANDLERS)) {
      expect(JOB_PRODUCERS[kind], `missing producer for handler '${kind}'`).toBeTruthy();
    }
  });

  it("validate_scan is honestly marked as having no producer", () => {
    expect(JOB_PRODUCERS["validate_scan"]).toMatch(/NONE/);
  });
});

describe("enqueueRegistrationSweepIfDue", () => {
  it("enqueues once when no sweep in last 24h, then not again", async () => {
    await inRolledBackTx(async (client) => {
      await client.query(`DELETE FROM jobs WHERE kind = 'expire_stale_registrations'`);
      expect(await enqueueRegistrationSweepIfDue(client)).toBe(true);
      const queued = await client.query(`SELECT id FROM jobs WHERE kind = 'expire_stale_registrations'`);
      expect(queued.rows.length).toBe(1);
      // Jobs are DELETEd on success, so existence means "not done yet" — second pass must not duplicate.
      expect(await enqueueRegistrationSweepIfDue(client)).toBe(false);
      const stillOne = await client.query(`SELECT id FROM jobs WHERE kind = 'expire_stale_registrations'`);
      expect(stillOne.rows.length).toBe(1);
    });
  });

  it("dead-lettered sweep does NOT satisfy the guard (failed_at IS NULL)", async () => {
    await inRolledBackTx(async (client) => {
      await client.query(`DELETE FROM jobs WHERE kind = 'expire_stale_registrations'`);
      // Park a dead-lettered sweep — this must NOT block the next enqueue.
      await client.query(
        `INSERT INTO jobs (kind, payload, run_after, attempts, failed_at, last_error)
         VALUES ('expire_stale_registrations', '{}'::jsonb, now(), 8, now(), 'test dead letter')`,
      );
      // The guard filters failed_at IS NULL, so a dead letter is invisible and a fresh job must enqueue.
      expect(await enqueueRegistrationSweepIfDue(client)).toBe(true);
      const live = await client.query(
        `SELECT id FROM jobs WHERE kind = 'expire_stale_registrations' AND failed_at IS NULL`,
      );
      expect(live.rows.length).toBe(1);
    });
  });

  it("a live job within 24h blocks re-enqueue", async () => {
    await inRolledBackTx(async (client) => {
      await client.query(`DELETE FROM jobs WHERE kind = 'expire_stale_registrations'`);
      await client.query(
        `INSERT INTO jobs (kind, payload, run_after) VALUES ('expire_stale_registrations', '{}'::jsonb, now())`,
      );
      expect(await enqueueRegistrationSweepIfDue(client)).toBe(false);
    });
  });
});

describe("expire_stale_registrations handler", () => {
  async function makePendingDog(opts: {
    registeredAt: string;
    remindersSent?: number;
    registeredBy?: string | null;
    registeredDeviceId?: string | null;
  }): Promise<{ dogId: string; slug: string; collarId: string }> {
    // Feeder for FK
    const feeder = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, consent_version, is_minor) VALUES ('hmac-' || md5(random()::text), 'ExpiryTest', 'feeder', '1', false) RETURNING id`,
    );
    const feederId = feeder.rows[0].id;
    // opts.registeredAt is an SQL expression like "now() - interval '8 days'" — embed it directly,
    // not as a parameter, so PostgreSQL evaluates the interval.
    const dog = await query<{ id: string; slug: string }>(
      `INSERT INTO dogs (slug, name, ward_id, status, registered_by, registered_at, activation_reminders_sent, registered_device_id)
       VALUES ('ex' || substr(md5(random()::text),1,7), 'ExpiryDog', 'A', 'pending_activation', $1, ${opts.registeredAt}, $2, $3)
       RETURNING id, slug`,
      [opts.registeredBy ?? feederId, opts.remindersSent ?? 0, opts.registeredDeviceId ?? "dev:test123"],
    );
    const collar = await query<{ id: string }>(
      `INSERT INTO collars (dog_id, qr_code, hmac_sig, batch_no, material) VALUES ($1, $2, 'sig', 'b1', 'TPU') RETURNING id`,
      [dog.rows[0].id, dog.rows[0].slug],
    );
    // If caller wants NULL registered_by, update after insert
    if (opts.registeredBy === null) {
      await query(`UPDATE dogs SET registered_by = NULL WHERE id = $1`, [dog.rows[0].id]);
    }
    return { dogId: dog.rows[0].id, slug: dog.rows[0].slug, collarId: collar.rows[0].id };
  }

  it("sends day-7 reminder exactly once and enqueues send_registration_reminder", async () => {
    const restore = await isolateQueue();
    const { dogId, slug } = await makePendingDog({ registeredAt: "now() - interval '8 days'" });
    let reminderJobIds: string[] = [];
    try {
      // Enqueue and run the sweep via the queue (so withTx boundaries are real)
      await query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('expire_stale_registrations', '{}'::jsonb, now())`);
      expect(await processOneJob()).toBe("done");
      const dog = await query<{ activation_reminders_sent: number }>(`SELECT activation_reminders_sent FROM dogs WHERE id = $1`, [dogId]);
      expect(dog.rows[0].activation_reminders_sent).toBe(1);
      const reminders = await query<{ kind: string; payload: unknown }>(
        `SELECT kind, payload FROM jobs WHERE kind = 'send_registration_reminder' AND payload->>'dogId' = $1`,
        [dogId],
      );
      expect(reminders.rows.length).toBe(1);
      expect((reminders.rows[0].payload as { reminder: number }).reminder).toBe(1);
      reminderJobIds = (await query<{ id: string }>(`SELECT id FROM jobs WHERE payload->>'dogId' = $1`, [dogId])).rows.map(
        (r) => r.id,
      );

      // Running the sweep again must NOT re-remind (activation_reminders_sent guard)
      // Clear the reminder job first so the second sweep's queue position is deterministic
      // (otherwise processOneJob would consume the pending reminder before the new sweep).
      await query(`DELETE FROM jobs WHERE kind = 'send_registration_reminder' AND payload->>'dogId' = $1`, [dogId]);
      await query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('expire_stale_registrations', '{}'::jsonb, now())`);
      expect(await processOneJob()).toBe("done");
      const dog2 = await query<{ activation_reminders_sent: number }>(`SELECT activation_reminders_sent FROM dogs WHERE id = $1`, [dogId]);
      expect(dog2.rows[0].activation_reminders_sent).toBe(1);
      const reminders2 = await query(`SELECT id FROM jobs WHERE kind = 'send_registration_reminder' AND payload->>'dogId' = $1`, [dogId]);
      // No new reminder should have been enqueued; the sweep is idempotent.
      expect(reminders2.rows.length).toBe(0);
      // Preserve ids for cleanup — there is no reminder left, but keep variable consistent
      reminderJobIds = [];
    } finally {
      await query(`DELETE FROM collars WHERE dog_id = $1`, [dogId]);
      await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
      if (reminderJobIds.length) await query(`DELETE FROM jobs WHERE id = ANY($1::bigint[])`, [reminderJobIds]);
      await query(`DELETE FROM jobs WHERE payload->>'dogId' = $1`, [dogId]);
      await restore();
    }
    void slug;
  });

  it("sends day-21 reminder when activation_reminders_sent=1 and age >=21d", async () => {
    const restore = await isolateQueue();
    const { dogId } = await makePendingDog({
      registeredAt: "now() - interval '22 days'",
      remindersSent: 1,
    });
    let reminderIds: string[] = [];
    try {
      await query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('expire_stale_registrations', '{}'::jsonb, now())`);
      expect(await processOneJob()).toBe("done");
      const dog = await query<{ activation_reminders_sent: number }>(`SELECT activation_reminders_sent FROM dogs WHERE id = $1`, [dogId]);
      expect(dog.rows[0].activation_reminders_sent).toBe(2);
      const reminders = await query<{ id: string }>(`SELECT id FROM jobs WHERE kind = 'send_registration_reminder' AND payload->>'dogId' = $1`, [dogId]);
      expect(reminders.rows.length).toBe(1);
      reminderIds = reminders.rows.map((r) => r.id);
    } finally {
      await query(`DELETE FROM collars WHERE dog_id = $1`, [dogId]);
      await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
      if (reminderIds.length) await query(`DELETE FROM jobs WHERE id = ANY($1::bigint[])`, [reminderIds]);
      await query(`DELETE FROM jobs WHERE payload->>'dogId' = $1`, [dogId]);
      await restore();
    }
  });

  it("expires registrations older than 30d, clears device id and retires collar", async () => {
    const restore = await isolateQueue();
    const { dogId } = await makePendingDog({
      registeredAt: "now() - interval '31 days'",
      remindersSent: 2,
    });
    try {
      await query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('expire_stale_registrations', '{}'::jsonb, now())`);
      expect(await processOneJob()).toBe("done");
      const dog = await query<{ status: string; registered_device_id: string | null }>(
        `SELECT status, registered_device_id FROM dogs WHERE id = $1`,
        [dogId],
      );
      expect(dog.rows[0].status).toBe("expired");
      expect(dog.rows[0].registered_device_id).toBeNull();
      const collar = await query<{ retired_at: Date | null; status: string }>(
        `SELECT retired_at, status FROM collars WHERE dog_id = $1`,
        [dogId],
      );
      expect(collar.rows[0].retired_at).not.toBeNull();
      expect(collar.rows[0].status).toBe("retired");
    } finally {
      await query(`DELETE FROM collars WHERE dog_id = $1`, [dogId]);
      await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
      await query(`DELETE FROM jobs WHERE payload->>'dogId' = $1`, [dogId]);
      await restore();
    }
  });

  it("reminders before expiry: a 31-day pending gets both reminders then expires in one run", async () => {
    const restore = await isolateQueue();
    const { dogId } = await makePendingDog({
      registeredAt: "now() - interval '31 days'",
      remindersSent: 0,
    });
    try {
      await query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('expire_stale_registrations', '{}'::jsonb, now())`);
      expect(await processOneJob()).toBe("done");
      // Both reminders should have been handed off before expiry
      const reminders = await query(`SELECT payload FROM jobs WHERE kind = 'send_registration_reminder' AND payload->>'dogId' = $1 ORDER BY payload->>'reminder'`, [dogId]);
      expect(reminders.rows.length).toBe(2);
      const dog = await query<{ status: string }>(`SELECT status FROM dogs WHERE id = $1`, [dogId]);
      expect(dog.rows[0].status).toBe("expired");
    } finally {
      await query(`DELETE FROM collars WHERE dog_id = $1`, [dogId]);
      await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
      await query(`DELETE FROM jobs WHERE payload->>'dogId' = $1`, [dogId]);
      await restore();
    }
  });

  it("send_registration_reminder honours PUSH_ENABLED degrade (no VAPID -> no crash)", async () => {
    // In CI VAPID is not set, so PUSH_ENABLED is false — handler should return without throwing.
    const restore = await isolateQueue();
    const { dogId } = await makePendingDog({ registeredAt: "now() - interval '8 days'" });
    try {
      await query(
        `INSERT INTO jobs (kind, payload, run_after) VALUES ('send_registration_reminder', $1::jsonb, now())`,
        [JSON.stringify({ dogId, reminder: 1 })],
      );
      expect(await processOneJob()).toBe("done");
      // Job should be deleted on success even when pushes were degraded — no retry loop.
      const job = await query(`SELECT id FROM jobs WHERE payload->>'dogId' = $1`, [dogId]);
      expect(job.rows.length).toBe(0);
    } finally {
      await query(`DELETE FROM collars WHERE dog_id = $1`, [dogId]);
      await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
      await restore();
    }
  });
});
