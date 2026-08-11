/**
 * StrayNet TRUST ENGINE (ships BEFORE gamification).
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
 *   feed 60, sos_ack +20, verified_scan +10, photo_accepted +10,
 *   photo_rejected -5, serial_rejects -15, dispute_resolved +5.
 * Reversals are the delta NEGATED of the disputed event. auto_paused is a
 * flag event (delta 0) written by the INVARIANT 15 verification gate.
 *
 * INVARIANT 15 — verification gates: provisional feeders are gated. Rejected
 * /flagged scans accumulate; at >= 3 SERIAL rejects (consecutive, newest
 * first) the feeder is auto-paused: role is unchanged, and a flag
 * trust_event 'auto_paused' is written. The pause is observable via
 * applyVerificationGate()/getFeederTrust().
 */
import { query } from "@straynet/db";

export const TRUST_BASELINE = 30;
export const TRUST_MIN = 0;
export const TRUST_MAX = 100;
export const SERIAL_REJECT_PAUSE_THRESHOLD = 3;

/** Catalog of event_type -> score delta. Reversals negate the original. */
export const TRUST_EVENTS: Readonly<Record<string, number>> = {
  feed: 60,
  sos_ack: 20,
  verified_scan: 10,
  photo_accepted: 10,
  photo_rejected: -5,
  serial_rejects: -15,
  dispute_resolved: 5,
  auto_paused: 0,
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

export interface ResolveReversalInput {
  feederId: string;
  reason: string;
}

export interface DisputeResult {
  original: TrustEventRow;
  reversal: TrustEventRow;
  score: number;
}

/**
 * DISPUTE flow: mark the target event dispute_state='open' and reverse its
 * delta exactly via a reversing event (delta negated, reverses_event_id set).
 * Returns the updated original + the reversal + the new score.
 */
export async function openDispute(
  eventId: string,
  feederId: string,
  reason: string,
  client?: TxClient,
): Promise<DisputeResult> {
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

  const reversal = await logTrustEvent(
    {
      feederId,
      eventType: "reversal",
      delta: -original.delta,
      reason,
      reversesEventId: eventId,
    },
    c,
  );
  const score = await recomputeScore(feederId, c);

  return {
    original: { ...original, dispute_state: "open" },
    reversal,
    score,
  };
}

/**
 * Resolve a previously open dispute in the feeder's favour: the event is
 * marked 'resolved' and the feeder earns the catalog dispute_resolved +5.
 */
export async function resolveDispute(
  eventId: string,
  feederId: string,
  reason: string,
  client?: TxClient,
): Promise<{ original: TrustEventRow; credit: TrustEventRow; score: number }> {
  const c = client ?? trustDb;
  const origRes = await c.query<TrustEventRow>(
    `SELECT ${TRUST_EVENT_COLUMNS} FROM trust_events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  const original = origRes.rows[0];
  if (!original) throw new TrustError("trust event not found", "TRUST_EVENT_NOT_FOUND", 404);
  if (original.feeder_id !== feederId) {
    throw new TrustError("you can only resolve your own trust events", "TRUST_DISPUTE_FORBIDDEN", 403);
  }
  if (original.dispute_state !== "open") {
    throw new TrustError("event is not under an open dispute", "TRUST_NO_OPEN_DISPUTE", 409);
  }
  await c.query(`UPDATE trust_events SET dispute_state = 'resolved' WHERE id = $1`, [eventId]);
  const credit = await logTrustEvent(
    {
      feederId,
      eventType: "dispute_resolved",
      reason,
      refScanId: original.ref_scan_id,
    },
    c,
  );
  const score = await recomputeScore(feederId, c);
  return { original: { ...original, dispute_state: "resolved" }, credit, score };
}

export interface GateStatus {
  paused: boolean;
  serialRejects: number;
  autoPausedEventId: string | null;
}

/** Count consecutive rejected/flagged scans (newest first) for a feeder. */
export async function countSerialRejects(feederId: string, client?: TxClient): Promise<number> {
  const c = client ?? trustDb;
  const res = await c.query<{ review_status: string }>(
    `SELECT review_status
       FROM scans
      WHERE feeder_id = $1
      ORDER BY received_at DESC, id DESC`,
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
 */
export async function applyVerificationGate(feederId: string, client?: TxClient): Promise<GateStatus> {
  const c = client ?? trustDb;
  const feeder = await c.query<{ verification_tier: string }>(
    `SELECT verification_tier FROM feeders WHERE id = $1`,
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

/** Score + verification tier + pause state + recent events (self-service). */
export async function getFeederTrust(feederId: string): Promise<FeederTrustView> {
  const feeder = await query<{ trust_score: number; verification_tier: string }>(
    `SELECT trust_score, verification_tier FROM feeders WHERE id = $1`,
    [feederId],
  );
  if (feeder.rowCount === 0) {
    throw new TrustError("feeder not found", "FEEDER_NOT_FOUND", 404);
  }
  const gate = await applyVerificationGate(feederId);
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
