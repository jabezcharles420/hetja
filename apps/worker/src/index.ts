/**
 * Hetja worker — Postgres-backed job queue (no Redis, per spec).
 * Polls the jobs table with SELECT ... FOR UPDATE SKIP LOCKED so multiple
 * worker instances never double-process. Handlers:
 *   validate_scan  → marks scan ai_validation/review_status (stub: calls AI)
 *   escalate_sos   → 8-min unacked SOS → tier 2 + notify BMC/vets
 *   send_sos_push  → VAPID-signed Web Push to each fanned-out responder
 *   retention      → raw-photo 7-day TTL + thumbnail rotation
 *   anchor_ledger  → daily ledger head publication, Merkle root and signature
 *                    (INVARIANT 10; see src/sign-anchor.ts for the key config)
 */
import { pool, query, withTx } from "@hetja/db";
import type { PoolClient } from "pg";
import webpush from "web-push";
import {
  HETJA_GLOBAL_LEDGER_ID,
  globalMerkleRoot,
  signAnchor,
  type MerkleLeaf,
} from "./sign-anchor.js";

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

  /**
   * Daily published anchor (INVARIANT 10): the chain head, the global Merkle
   * root over every record, the record count, and a signature over all three
   * when a key is configured (apps/worker/src/sign-anchor.ts).
   *
   * THE PREVIOUS VERSION OF THIS HANDLER COULD NOT RUN. It was:
   *
   *     SELECT hash_curr AS hash, count(*)::int AS n
   *       FROM medical_records ORDER BY created_at DESC LIMIT 1
   *
   * which mixes an aggregate with a bare column and no GROUP BY, so PostgreSQL
   * rejects it outright: `column "medical_records.hash_curr" must appear in the
   * GROUP BY clause or be used in an aggregate function`. Every anchor run threw
   * before writing anything, the job retried to MAX_ATTEMPTS and stayed there.
   * docs/INVARIANTS.md marks invariant 10 "✅ (API)" — the parenthesis was
   * doing more work than it looked like: the endpoints were real, the thing that
   * was supposed to feed them was not. Any `ledger_anchors` row predating this
   * fix came from somewhere else (a test fixture, a hand-run INSERT) and its
   * `record_count` should not be trusted — which is also why the proof endpoint
   * ignores anchors with a NULL merkle_root.
   *
   * `head_hash` is the STORED hash of the last row, deliberately not
   * `recomputeHead(records)`. Publishing a freshly recomputed head would make
   * GET /api/v1/ledger/verify — which recomputes and compares — tautologically
   * agree with the anchor forever, including over doctored rows. Publishing what
   * the database actually recorded is what lets that comparison fail.
   *
   * Cost: one index-free ordered scan of `medical_records` per run, two columns
   * wide (no payloads), plus O(n) hashing for the root. Once a day, at pilot
   * scale, this is nothing. It is O(n) in the whole table rather than one dog's
   * history though, so if the ledger ever reaches millions of rows this becomes
   * the job's dominant cost and wants an incremental tree.
   */
  anchor_ledger: async () => {
    await withTx(publishLedgerAnchor);
  },
};

/** What one anchor run published, for logs and tests. */
export interface PublishedAnchor {
  head: string;
  merkleRoot: string | null;
  recordCount: number;
  signed: boolean;
}

/**
 * Publishes one anchor. Takes the client rather than reaching for the pool so
 * the whole thing is one transaction — and so a test can drive it inside a
 * transaction it rolls back, instead of committing an anchor row into a database
 * other suites are reading the latest anchor from.
 *
 * Returns null when there is nothing to anchor (an empty ledger has no head; an
 * anchor over zero records would be a published claim about nothing).
 */
export async function publishLedgerAnchor(client: PoolClient): Promise<PublishedAnchor | null> {
  // Canonical chain order — identical to the ordering used by the chain write
  // (medical.ts), GET /api/v1/ledger/verify and the proof endpoint. A different
  // order here would produce a root nothing else can reproduce.
  const rows = await client.query<MerkleLeaf>(
    `SELECT id, hash_curr AS hash
       FROM medical_records
      ORDER BY created_at ASC, id ASC`,
  );
  if (rows.rows.length === 0) return null;

  const recordCount = rows.rows.length;
  const head = rows.rows[recordCount - 1].hash;
  const merkleRoot = await globalMerkleRoot(rows.rows);

  // One timestamp for both the row and the signature's `iat`, so an auditor
  // comparing them never sees unexplained drift.
  const publishedAt = new Date();
  const headSignature =
    merkleRoot === null
      ? null
      : await signAnchor(
          { ledgerId: HETJA_GLOBAL_LEDGER_ID, head, merkleRoot, recordCount },
          publishedAt,
        );

  await client.query(
    `INSERT INTO ledger_anchors
       (head_hash, merkle_root, record_count, ledger_id, published_at,
        head_signature, published_url)
     VALUES ($1, $2, $3, $4, $5, $6, '')`,
    [head, merkleRoot, recordCount, HETJA_GLOBAL_LEDGER_ID, publishedAt, headSignature],
  );

  // published_url is still '' — INVARIANT 10 wants the head somewhere the
  // operator does not solely control, and a row in the operator's own database
  // is not that. The signature makes the anchor attributable; it does not make
  // it externally held. Publishing to a third party (a notarisation service, a
  // public gist, an OTS timestamp) is the remaining half, and anchorMessage() in
  // @hetja/ledger exists to give it a deterministic payload.
  console.log(
    `anchor_ledger: published head ${head.slice(0, 12)}… over ${recordCount} record(s), ` +
      `merkleRoot=${merkleRoot ? "yes" : "unavailable"}, signed=${headSignature ? "yes" : "no"}`,
  );
  return { head, merkleRoot, recordCount, signed: headSignature !== null };
}

/**
 * Advisory lock so two worker instances cannot both decide to enqueue today's
 * anchor. Distinct from apps/api's CHAIN_LOCK_KEY (420_001) — same numbering
 * block, different purpose.
 */
const ANCHOR_SCHEDULE_LOCK_KEY = 420_010;

/** How often the scheduler below bothers to look. See `ensureDailyAnchorJob`. */
const ANCHOR_SCHEDULE_CHECK_MS = 5 * 60_000;
let lastAnchorScheduleCheck = 0;

/**
 * Enqueues `anchor_ledger` when the last published anchor is over a day old.
 * Returns whether a job was actually enqueued.
 *
 * INVARIANT 10 is "publish the ledger head DAILY", and nothing in this repo was
 * making that happen. The handler existed, `ledger.ts` served the endpoints, and
 * docs/INVARIANTS.md recorded the invariant as implemented — but no cron entry,
 * no systemd timer (ops/systemd has units for the four services and a restic
 * timer, none for this) and no code anywhere ever inserted a row with
 * `kind = 'anchor_ledger'`. A job handler nobody triggers publishes nothing, so
 * the anchor was never actually published: there was no schedule to be late.
 *
 * Scheduled from inside the worker rather than by a new timer unit because the
 * worker is already the thing that runs continuously and already owns the job
 * table, and because a timer would be one more piece of ops/ wiring that can be
 * forgotten on a rebuild — which is the failure that produced this comment.
 *
 * Idempotent by construction, with no scheduler state to keep:
 *   * skip if an `anchor_ledger` job is already queued (jobs are DELETEd on
 *     success, so a row's existence means "not done yet");
 *   * skip if `ledger_anchors` already has a row from the last 24 hours — the
 *     published anchor IS the record of the last run, so the schedule cannot
 *     drift out of sync with reality;
 *   * `pg_try_advisory_xact_lock` so a second worker instance evaluating the
 *     same condition at the same moment does not double-enqueue. Try, not wait:
 *     if another instance holds it, it is about to make the identical decision
 *     and there is nothing to wait for.
 *
 * The 5-minute throttle keeps this off the 2-second poll loop — two extra
 * queries every tick, forever, to answer a once-a-day question.
 */
export async function enqueueAnchorJobIfDue(client: PoolClient): Promise<boolean> {
  const lock = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_xact_lock($1) AS locked",
    [ANCHOR_SCHEDULE_LOCK_KEY],
  );
  if (!lock.rows[0].locked) return false;
  const res = await client.query(
    `INSERT INTO jobs (kind, payload, run_after)
     SELECT 'anchor_ledger', '{}'::jsonb, now()
      WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'anchor_ledger')
        AND NOT EXISTS (
              SELECT 1 FROM ledger_anchors
               WHERE published_at > now() - interval '24 hours'
            )`,
  );
  const enqueued = (res.rowCount ?? 0) > 0;
  if (enqueued) {
    console.log("anchor_ledger: enqueued (no anchor published in the last 24h)");
  }
  return enqueued;
}

/** `enqueueAnchorJobIfDue`, throttled, on its own transaction. */
async function ensureDailyAnchorJob(): Promise<void> {
  const now = Date.now();
  if (now - lastAnchorScheduleCheck < ANCHOR_SCHEDULE_CHECK_MS) return;
  lastAnchorScheduleCheck = now;
  await withTx(enqueueAnchorJobIfDue);
}

export async function runWorker(once = false): Promise<void> {
  const tick = async () => {
    // Before claiming work, make sure the daily anchor is on the queue. Errors
    // here must not stop the tick: a missed anchor is bad, an SOS escalation
    // that never runs because the scheduler threw is worse.
    try {
      await ensureDailyAnchorJob();
    } catch (err) {
      console.error("anchor_ledger: could not evaluate the daily schedule:", err);
    }
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
