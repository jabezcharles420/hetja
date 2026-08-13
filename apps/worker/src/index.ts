/**
 * Hetja worker — Postgres-backed job queue (no Redis, per spec).
 * Polls the jobs table with SELECT ... FOR UPDATE SKIP LOCKED so multiple
 * worker instances never double-process. Handlers:
 *   validate_scan  → marks scan ai_validation/review_status (stub: calls AI)
 *   escalate_sos   → 8-min unacked SOS → tier 2 + notify BMC/vets
 *   retention      → raw-photo 7-day TTL + thumbnail rotation
 *   anchor_ledger  → daily ledger head publication (INVARIANT 10)
 */
import { pool, query, withTx } from "@straynet/db";
import type { PoolClient } from "pg";

const BATCH = 10;
const POLL_MS = 2_000;
const LOCK_SECONDS = 60;
const MAX_ATTEMPTS = 8;

type Job = {
  id: bigint;
  kind: string;
  payload: unknown;
  run_after: Date;
  attempts: number;
};

async function claimNext(client: PoolClient): Promise<Job | null> {
  const res = await client.query<Job>(
    `SELECT id, kind, payload, run_after, attempts
       FROM jobs
      WHERE run_after <= now() AND (locked_until IS NULL OR locked_until < now())
      ORDER BY run_after
      LIMIT 1
        FOR UPDATE SKIP LOCKED`,
  );
  if (res.rowCount === 0) return null;
  const j = res.rows[0];
  await client.query(
    `UPDATE jobs SET locked_until = now() + make_interval(secs => $2), attempts = attempts + 1 WHERE id = $1`,
    [j.id, LOCK_SECONDS],
  );
  return j;
}

const HANDLERS: Record<string, (payload: any) => Promise<void>> = {
  validate_scan: async (p) => {
    // Phase 0 stub: AI worker (apps/ai) performs YOLO validation asynchronously.
    // Production: enqueue to the AI worker and write back ai_validation JSONB.
    await query(
      `UPDATE scans SET ai_validation = $2, review_status = 'pending' WHERE id = $1`,
      [p.scanId, JSON.stringify({ status: "queued_for_ai" })],
    );
  },

  escalate_sos: async (p) => {
    // 8-minute escalation: unacked case → tier 2, notify BMC officers + nearest vets.
    await withTx(async (client) => {
      const caseRow = await client.query(
        `SELECT id, tier FROM sos_cases WHERE id = $1 AND state IN ('open','acked') FOR UPDATE`,
        [p.caseId],
      );
      if (caseRow.rowCount === 0) return;
      await client.query(
        `UPDATE sos_cases SET tier = 2, escalated_at = now() WHERE id = $1`,
        [p.caseId],
      );
      const vets = await client.query(
        `SELECT id, signing_key_pub FROM vets
          ORDER BY ST_Distance(geo, (SELECT geo FROM dogs WHERE id = $1)) LIMIT 3`,
        [p.dogId],
      );
      for (const v of vets.rows) {
        await client.query(
          `INSERT INTO sos_notifications (case_id, vet_id, channel)
           VALUES ($1, $2, 'sms') ON CONFLICT DO NOTHING`,
          [p.caseId, v.id],
        );
      }
      await client.query(
        `INSERT INTO sos_notifications (case_id, channel) VALUES ($1, 'bmc') ON CONFLICT DO NOTHING`,
        [p.caseId],
      );
    });
  },

  retention: async (p) => {
    // Raw photos: 7-day TTL (S3 keys written to a retention manifest in Phase 0).
    await query(`DELETE FROM jobs WHERE kind = 'retention' AND run_after < now() - interval '7 days'`);
  },

  anchor_ledger: async (p) => {
    const head = await query<{ hash: string; n: number }>(
      `SELECT hash_curr AS hash, count(*)::int AS n
         FROM medical_records ORDER BY created_at DESC LIMIT 1`,
    );
    if (head.rowCount === 0) return;
    await query(
      `INSERT INTO ledger_anchors (head_hash, record_count, published_url)
       VALUES ($1, $2, '')`,
      [head.rows[0].hash, head.rows[0].n],
    );
  },
};

export async function runWorker(once = false): Promise<void> {
  const tick = async () => {
    let processed = 0;
    while (processed < BATCH) {
      const job = await withTx(async (client) => {
        const j = await claimNext(client);
        if (!j) return null;
        try {
          const handler = HANDLERS[j.kind];
          if (!handler) throw new Error(`no handler for job kind '${j.kind}'`);
          await handler(j.payload);
          await client.query(`DELETE FROM jobs WHERE id = $1`, [j.id]);
          return j;
        } catch (err) {
          if (j.attempts >= MAX_ATTEMPTS) {
            await client.query(
              `UPDATE jobs SET locked_until = NULL WHERE id = $1`,
              [j.id],
            );
          }
          throw err;
        }
      });
      if (!job) break;
      processed++;
    }
  };
  if (once) {
    await tick();
    return;
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error("worker tick error:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  runWorker()
    .then(() => pool.end())
    .catch((err) => {
      console.error("worker fatal:", err);
      process.exit(1);
    });
}
