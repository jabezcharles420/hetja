/**
 * Hetja TRUST ENGINE (ships BEFORE gamification).
 *
 * Feeder trust is a DERIVED value, never hand-maintained:
 *
 *   trust_score = clamp(TRUST_BASELINE + Σ(trust_events.delta), 0, 100)
 *
 * Every score change is an append-only row in trust_events. recomputeScore()
 * replays the whole stream (idempotent by construction — a replay can never
 * double-count) and persists feeders.trust_recomputed_at so the marker proves
 * when the last recomputation happened.
 *
 * TRUST_EVENTS catalog (event_type -> delta):
 *   feed +1, sos_ack +20, verified_scan +10, photo_accepted +10,
 *   photo_rejected -5, serial_rejects -15, story_rejected -5.
 * Reversals are the delta NEGATED of the disputed event — see the catalog
 * comment for why `reversal` itself carries 0. auto_paused is a flag event
 * (delta 0) written by the INVARIANT 15 verification gate.
 *
 * DISPUTES split in two steps, only one of which a feeder can reach:
 *   openDispute()    — the event's owner marks dispute_state='open'; no
 *                      score change. A human reviews.
 *   resolveDispute() — an ADMIN adjudicates: the original delta is reversed
 *                      exactly and the score recomputed. A feeder can never
 *                      revoke their own penalty.
 *
 * INVARIANT 15 — verification gates: provisional feeders are gated. Rejected
 * /flagged scans accumulate; at >= 3 SERIAL rejects (consecutive, newest
 * first) the feeder is auto-paused: role is unchanged, and a flag
 * trust_event 'auto_paused' is written. The pause is observable via
 * applyVerificationGate()/getFeederTrust().
 */
import { query, withTx } from "@hetja/db";

export const TRUST_BASELINE = 30;
export const TRUST_MIN = 0;
export const TRUST_MAX = 100;
export const SERIAL_REJECT_PAUSE_THRESHOLD = 3;

/**
 * Catalog of event_type -> score delta. Reversals negate the original.
 *
 * GATE ARITHMETIC — why `feed` is +1. The trust gates must measure tenure in
 * ordinary, self-reported actions, so `feed` (one logged feed scan) is the
 * smallest positive unit and every gate is reachable only by a count of them.
 * With TRUST_BASELINE = 30 and feed = +1, counted in feeds from a
 * brand-new account:
 *
 *     trust 40 — SOS fan-out floor, minor/serious (sos.ts) → 10 feeds
 *     trust 50 — the re-tag gate (docs/INVARIANTS.md)      → 20 feeds
 *     trust 60 — SOS fan-out floor, critical (sos.ts)      → 30 feeds
 *
 * It used to be +60 — a 3× outlier against every neighbour (sos_ack +20,
 * verified_scan +10, photo_accepted +10), reading like a typo for 6 — but even
 * 6 leaves the critical-SOS floor five farmable requests deep, which is not
 * tenure. A feed is self-reported (review_status starts 'pending'), so it earns
 * less than any verification-backed event; a rescue ack stays worth twenty
 * routine feeds.
 *
 * Scores are DERIVED (recomputeScore replays this stream from TRUST_BASELINE),
 * so correcting a delta needs no migration: existing scores fall to their
 * honest value at the next recompute. Zero feeder rows existed in production
 * when feed went 60 → 1 (2026-08-22), so nothing rescaled mid-flight.
 *
 * `reversal` and `auto_paused` carry a catalog delta of 0 because neither ever
 * contributes its own value: a reversal's delta is always the negation of the
 * event it reverses (passed explicitly to logTrustEvent), and auto_paused is a
 * flag. They exist as keys so that every event_type this code writes IS a
 * catalog key — writer and catalog are not allowed to disagree; that exact
 * disagreement is how `feed` sat at 60 unnoticed while the docs reasoned from
 * +1-per-action economics.
 */
export const TRUST_EVENTS: Readonly<Record<string, number>> = {
  feed: 1,
  sos_ack: 20,
  verified_scan: 10,
  photo_accepted: 10,
  photo_rejected: -5,
  serial_rejects: -15,
  story_rejected: -5,
  auto_paused: 0,
  reversal: 0,
} as const;

export type TrustEventType = keyof typeof TRUST_EVENTS;

/** Structural view of the pg client so helpers avoid importing `pg`. */
export interface TxClient {
  query<T = any>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** Wraps the standalone pool query so it satisfies the TxClient shape. */
async function trustQuery<T = any>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const res = await query(text, params);
  return res as unknown as { rows: T[]; rowCount: number | null };
}

const trustDb: TxClient = { query: trustQuery };

export interface TrustEventRow {
  id: string;
  feeder_id: string;
  event_type: string;
  delta: number;
  reason: string;
  ref_scan_id: string | null;
  reverses_event_id: string | null;
  dispute_state: string;
  created_at: Date;
}

const TRUST_EVENT_COLUMNS = `
  id, feeder_id, event_type, delta, reason,
  ref_scan_id, reverses_event_id, dispute_state, created_at`;

export function clampScore(value: number): number {
  return Math.min(TRUST_MAX, Math.max(TRUST_MIN, value));
}

export class TrustError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "TrustError";
    this.code = code;
    this.status = status;
  }
}

export interface LogTrustEventInput {
  feederId: string;
  eventType: string;
  reason: string;
  delta?: number;
  refScanId?: string | null;
  reversesEventId?: string | null;
  disputeState?: string;
}

/** Append a trust event (delta from the catalog unless overridden). */
export async function logTrustEvent(
  input: LogTrustEventInput,
  client?: TxClient,
): Promise<TrustEventRow> {
  const c = client ?? trustDb;
  const delta = input.delta ?? TRUST_EVENTS[input.eventType] ?? 0;
  const res = await c.query<TrustEventRow>(
    `INSERT INTO trust_events
       (feeder_id, event_type, delta, reason, ref_scan_id, reverses_event_id, dispute_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${TRUST_EVENT_COLUMNS}`,
    [
      input.feederId,
      input.eventType,
      delta,
      input.reason,
      input.refScanId ?? null,
      input.reversesEventId ?? null,
      input.disputeState ?? "none",
    ],
  );
  return res.rows[0];
}

/**
 * Recompute feeders.trust_score = clamp(30 + Σ delta) from trust_events and
 * persist the recomputed_at marker. Idempotent: a full replay of the stream,
 * so running it N times (or after a dispute reversal) never double-counts.
 * The feeder row is locked so concurrent recomputes serialize cleanly.
 */
export async function recomputeScore(feederId: string, client?: TxClient): Promise<number> {
  const c = client ?? trustDb;
  await c.query(`SELECT id FROM feeders WHERE id = $1 FOR UPDATE`, [feederId]);
  const res = await c.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(delta), 0) AS total FROM trust_events WHERE feeder_id = $1`,
    [feederId],
  );
  const score = clampScore(TRUST_BASELINE + Number(res.rows[0].total));
  await c.query(
    `UPDATE feeders SET trust_score = $2, trust_recomputed_at = now() WHERE id = $1`,
    [feederId, score],
  );
  return score;
}

export interface OpenDisputeResult {
  original: TrustEventRow;
}

/**
 * DISPUTE flow, step 1 — the only step a feeder can reach.
 *
 * Marks the target event dispute_state='open' and NOTHING else. This used to
 * reverse the delta in the same call, which made INVARIANT 15's penalty
 * self-revocable: exactly the feeder a `photo_rejected`/`serial_rejects`
 * penalty constrains could negate it with one more HTTP call, no human in the
 * loop. The score change now lives exclusively in resolveDispute(), which
 * requires an admin.
 */
export async function openDispute(
  eventId: string,
  feederId: string,
  reason: string,
  client?: TxClient,
): Promise<OpenDisputeResult> {
  const c = client ?? trustDb;
  const origRes = await c.query<TrustEventRow>(
    `SELECT ${TRUST_EVENT_COLUMNS} FROM trust_events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  const original = origRes.rows[0];
  if (!original) throw new TrustError("trust event not found", "TRUST_EVENT_NOT_FOUND", 404);
  if (original.feeder_id !== feederId) {
    throw new TrustError("you can only dispute your own trust events", "TRUST_DISPUTE_FORBIDDEN", 403);
  }
  if (original.reverses_event_id) {
    throw new TrustError("reversal events cannot be disputed", "TRUST_REVERSAL_NOT_DISPUTABLE", 409);
  }
  if (original.dispute_state === "open") {
    throw new TrustError("dispute already open for this event", "TRUST_DISPUTE_ALREADY_OPEN", 409);
  }

  await c.query(`UPDATE trust_events SET dispute_state = 'open' WHERE id = $1`, [eventId]);

  return { original: { ...original, dispute_state: "open" } };
}

/**
 * Resolve a previously open dispute, adjudicating it in the feeder's favour:
 * the event is marked 'resolved' and its delta reversed EXACTLY via a
 * reversing event (delta negated, reverses_event_id set), then recomputed.
 *
 * ADMIN-only, and the check lives here rather than only in the route because
 * lib functions are callable from anywhere — a future caller must not be able
 * to skip the human-review requirement by forgetting a gate (the same class of
 * hole this file closed when the self-serve POST /trust/events route died).
 *
 * Resolution RESTORES; it does not award. An earlier dead-code version of this
 * function also granted a dispute_resolved +5 credit on top of the reversal,
 * which would have paid a wrongly-penalised feeder more than they lost and
 * rewards collecting penalties to dispute them. The credit and its catalog key
 * are gone.
 */
export async function resolveDispute(
  eventId: string,
  adminId: string,
  reason: string,
  client?: TxClient,
): Promise<{ original: TrustEventRow; reversal: TrustEventRow; score: number }> {
  const c = client ?? trustDb;
  const adminRes = await c.query<{ role: string }>(`SELECT role FROM feeders WHERE id = $1`, [
    adminId,
  ]);
  if ((adminRes.rowCount ?? 0) === 0 || adminRes.rows[0].role !== "admin") {
    throw new TrustError("admin role required to resolve a dispute", "TRUST_DISPUTE_FORBIDDEN", 403);
  }

  const origRes = await c.query<TrustEventRow>(
    `SELECT ${TRUST_EVENT_COLUMNS} FROM trust_events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  const original = origRes.rows[0];
  if (!original) throw new TrustError("trust event not found", "TRUST_EVENT_NOT_FOUND", 404);
  if (original.reverses_event_id) {
    throw new TrustError("reversal events cannot be disputed", "TRUST_REVERSAL_NOT_DISPUTABLE", 409);
  }
  if (original.dispute_state !== "open") {
    throw new TrustError("event is not under an open dispute", "TRUST_NO_OPEN_DISPUTE", 409);
  }

  await c.query(`UPDATE trust_events SET dispute_state = 'resolved' WHERE id = $1`, [eventId]);

  // The reversal's event_type is a real catalog key (`reversal`, delta 0 — the
  // actual delta is always the negation passed explicitly). It used to write
  // the bare string "reversal" while no such key existed, so the catalog and
  // the writer disagreed about what the row meant.
  const reversal = await logTrustEvent(
    {
      feederId: original.feeder_id,
      eventType: "reversal",
      delta: -original.delta,
      reason,
      reversesEventId: eventId,
    },
    c,
  );
  const score = await recomputeScore(original.feeder_id, c);

  return { original: { ...original, dispute_state: "resolved" }, reversal, score };
}

export interface GateStatus {
  paused: boolean;
  serialRejects: number;
  autoPausedEventId: string | null;
}

/**
 * Count consecutive rejected/flagged scans (newest first) for a feeder.
 *
 * LIMIT 3 because SERIAL_REJECT_PAUSE_THRESHOLD is 3 — only a leading run of
 * at most three can ever change the outcome, so reading further back is waste
 * on a query that runs on every trust-profile read. The loop below still
 * stops at the first non-reject; the limit just bounds how far it can look.
 */
export async function countSerialRejects(feederId: string, client?: TxClient): Promise<number> {
  const c = client ?? trustDb;
  const res = await c.query<{ review_status: string }>(
    `SELECT review_status
       FROM scans
      WHERE feeder_id = $1
      ORDER BY received_at DESC, id DESC
      LIMIT 3`,
    [feederId],
  );
  let count = 0;
  for (const row of res.rows) {
    if (row.review_status === "rejected" || row.review_status === "flagged") count += 1;
    else break;
  }
  return count;
}

/**
 * INVARIANT 15: provisional feeders with >= 3 serial rejects get auto-paused
 * (role unchanged; a flag trust_event 'auto_paused' written once). Idempotent.
 *
 * Takes `FOR UPDATE` on the feeder row first so that two concurrent
 * evaluations serialize before the check-then-insert below: both reading "no
 * flag yet" and each writing one would otherwise produce duplicate
 * auto_paused rows.
 */
export async function applyVerificationGate(feederId: string, client?: TxClient): Promise<GateStatus> {
  const c = client ?? trustDb;
  const feeder = await c.query<{ verification_tier: string }>(
    `SELECT verification_tier FROM feeders WHERE id = $1 FOR UPDATE`,
    [feederId],
  );
  if (feeder.rowCount === 0) {
    throw new TrustError("feeder not found", "FEEDER_NOT_FOUND", 404);
  }
  if (feeder.rows[0].verification_tier !== "provisional") {
    return { paused: false, serialRejects: 0, autoPausedEventId: null };
  }

  const serialRejects = await countSerialRejects(feederId, c);
  if (serialRejects < SERIAL_REJECT_PAUSE_THRESHOLD) {
    return { paused: false, serialRejects, autoPausedEventId: null };
  }

  const existing = await c.query<{ id: string }>(
    `SELECT id FROM trust_events
      WHERE feeder_id = $1 AND event_type = 'auto_paused'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [feederId],
  );
  if ((existing.rowCount ?? 0) > 0) {
    return { paused: true, serialRejects, autoPausedEventId: existing.rows[0].id };
  }

  const flag = await logTrustEvent(
    {
      feederId,
      eventType: "auto_paused",
      reason: `auto-paused: ${serialRejects} serial rejected/flagged scans while provisional`,
    },
    c,
  );
  return { paused: true, serialRejects, autoPausedEventId: flag.id };
}

export interface ScanReviewStatus {
  paused: boolean;
  serialRejects: number;
  autoPausedEventId: string | null;
}

/**
 * Called when a scan is marked rejected/flagged: provisional feeders accrue
 * a serial_rejects event (deduped per scan) and the gate is re-evaluated.
 */
export async function onScanReject(scanId: string, client?: TxClient): Promise<ScanReviewStatus> {
  const c = client ?? trustDb;
  const scan = await c.query<{ feeder_id: string | null; review_status: string }>(
    `SELECT feeder_id, review_status FROM scans WHERE id = $1`,
    [scanId],
  );
  if (scan.rowCount === 0) throw new TrustError("scan not found", "SCAN_NOT_FOUND", 404);

  const { feeder_id, review_status } = scan.rows[0];
  if (!feeder_id || (review_status !== "rejected" && review_status !== "flagged")) {
    return { paused: false, serialRejects: 0, autoPausedEventId: null };
  }

  const feeder = await c.query<{ verification_tier: string }>(
    `SELECT verification_tier FROM feeders WHERE id = $1`,
    [feeder_id],
  );
  if (feeder.rowCount === 0 || feeder.rows[0].verification_tier !== "provisional") {
    return { paused: false, serialRejects: 0, autoPausedEventId: null };
  }

  const dup = await c.query<{ id: string }>(
    `SELECT id FROM trust_events WHERE ref_scan_id = $1 AND event_type = 'serial_rejects' LIMIT 1`,
    [scanId],
  );
  if (dup.rowCount === 0) {
    await logTrustEvent(
      {
        feederId: feeder_id,
        eventType: "serial_rejects",
        reason: `scan ${review_status} (provisional feeder)`,
        refScanId: scanId,
      },
      c,
    );
  }
  return applyVerificationGate(feeder_id, c);
}

export interface FeederTrustView {
  feederId: string;
  score: number;
  verificationTier: string;
  paused: boolean;
  serialRejects: number;
  autoPausedEventId: string | null;
  events: TrustEventRow[];
}

/**
 * Score + verification tier + pause state + recent events (self-service).
 *
 * This is a read endpoint that can WRITE once: the INVARIANT 15 gate runs
 * here and may insert the auto_paused flag event. That is deliberate, and it
 * is worth recording why rather than leaving it looking like an accident:
 *
 *   No scan-review transition exists in this codebase yet — scans are created
 *   'pending', and the worker's validate_scan stub keeps them 'pending'
 *   (INVARIANT 14's human-review queue is unbuilt), so `onScanReject()` has no
 *   caller and nothing else ever observes accumulated rejects. Until a review
 *   path exists to call the gate where a scan is actually judged, this read is
 *   the only enforcement point INVARIANT 15 has.
 *
 * The write is therefore explicit and safe rather than incidental: it happens
 * inside one transaction (with a feeder-row lock in applyVerificationGate) so
 * concurrent readers cannot double-insert the flag, and the flag itself is a
 * delta-0 event — idempotent by construction.
 */
export async function getFeederTrust(feederId: string): Promise<FeederTrustView> {
  const feeder = await query<{ trust_score: number; verification_tier: string }>(
    `SELECT trust_score, verification_tier FROM feeders WHERE id = $1`,
    [feederId],
  );
  if (feeder.rowCount === 0) {
    throw new TrustError("feeder not found", "FEEDER_NOT_FOUND", 404);
  }
  const gate = await withTx((client) => applyVerificationGate(feederId, client));
  const events = await query<TrustEventRow>(
    `SELECT ${TRUST_EVENT_COLUMNS}
       FROM trust_events
      WHERE feeder_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 50`,
    [feederId],
  );
  return {
    feederId,
    score: feeder.rows[0].trust_score,
    verificationTier: feeder.rows[0].verification_tier,
    paused: gate.paused,
    serialRejects: gate.serialRejects,
    autoPausedEventId: gate.autoPausedEventId,
    events: events.rows,
  };
}
