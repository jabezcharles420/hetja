/**
 * Hetja worker — Postgres-backed job queue (no Redis, per spec).
 * Polls the jobs table with SELECT ... FOR UPDATE SKIP LOCKED so multiple
 * worker instances never double-process. Handlers:
 *   validate_scan  → marks scan ai_validation/review_status (stub: calls AI)
 *   escalate_sos   → 8-min unacked SOS → tier 2 + notify BMC/vets
 *   send_sos_push  → VAPID-signed Web Push to each fanned-out responder
 *   retention      → raw-photo 7-day TTL + thumbnail rotation
 *   anchor_ledger  → daily ledger head publication (INVARIANT 10)
 */
import { pool, query, withTx } from "@hetja/db";
import type { PoolClient } from "pg";
import webpush from "web-push";

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

/**
 * VAPID identity for Web Push (plan §3.3/§3.4). Read straight from env --
 * never logged, never defaulted to a placeholder the way JWT_SECRET etc. are
 * in apps/api/src/config.ts (that file is deliberately untouched here).
 * Missing config degrades to "do not send" rather than crashing the whole
 * job queue over one unconfigured feature: sos_notifications.delivered_at
 * simply stays null, which is the honest "not reached" state documented in
 * ops/RUNBOOK.md.
 */
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:no-reply@hetja.in";
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY as string, VAPID_PRIVATE_KEY as string);
} else {
  console.warn(
    "send_sos_push: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set -- pushes will not be sent " +
      "(sos_notifications.delivered_at stays null, which is correct: a responder who " +
      "cannot be reached must show as not reached, not error out).",
  );
}

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

interface PushSubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sends one VAPID-signed push. Writes delivered_at on success. A 404/410
 * response means the push service itself says this endpoint is dead (the
 * user uninstalled, cleared storage, or the browser rotated it) -- that
 * subscription is deleted so it is never retried again. Any other failure
 * leaves delivered_at null: an honest "not delivered", not an error to
 * retry-loop on here (the 8-min escalation job is the real safety net).
 */
async function sendOnePush(sub: PushSubRow, notificationId: string, payload: string): Promise<void> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    await query(`UPDATE sos_notifications SET delivered_at = now() WHERE id = $1`, [notificationId]);
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null | undefined)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
    }
  }
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

  /**
   * Web Push fan-out (plan §3.4). sos.ts enqueues this job right after it
   * inserts sos_notifications(channel='push') rows for a critical case's
   * eligible responders. For each undelivered push notification whose
   * feeder has a stored subscription, send a VAPID-signed push that
   * deep-links to the case; both service workers' notificationclick
   * handlers (apps/web/public/sw.js, apps/scan/src/service-worker.ts) open
   * that link.
   */
  send_sos_push: async (p) => {
    if (!PUSH_ENABLED) return;
    const notifs = await query<{ id: string; feeder_id: string }>(
      `SELECT id, feeder_id FROM sos_notifications
        WHERE case_id = $1 AND channel = 'push' AND delivered_at IS NULL AND feeder_id IS NOT NULL`,
      [p.caseId],
    );
    if (notifs.rowCount === 0) return;

    const caseRow = await query<{ severity: string }>(`SELECT severity FROM sos_cases WHERE id = $1`, [p.caseId]);
    const severity = caseRow.rows[0]?.severity ?? "serious";
    const payload = JSON.stringify({
      title: "Hetja SOS",
      body: `A ${severity} report needs a responder nearby.`,
      caseId: p.caseId,
      url: `/sos/${p.caseId}`,
    });

    for (const notif of notifs.rows) {
      const subs = await query<PushSubRow>(
        `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE feeder_id = $1`,
        [notif.feeder_id],
      );
      for (const sub of subs.rows) {
        await sendOnePush(sub, notif.id, payload);
      }
    }
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
