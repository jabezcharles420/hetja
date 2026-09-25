/**
 * Who may respond to an SOS case: ONE definition, shared by the three places
 * that used to carry their own copy of it.
 *
 *   routes/sos.ts  dispatchFanout   who gets paged for a critical case
 *   routes/sos.ts  POST .../ack     who may claim a case (hardening-1, A-01)
 *   routes/map.ts  ward detail      who is handed a case id on the map
 *
 * WHY THIS EXISTS (audit A-01, 2026-09-25). The ack route checked only that
 * the caller was signed in. The map handed claimable case ids to any opted-in
 * feeder at the fan-out floor, the worker's escalate_sos job promotes only
 * state = 'open', and the acker can later close the case as a false alarm. So
 * a fresh account that reached a case id could claim it and silently stop its
 * escalation to vets and BMC. The fan-out floors below were already the rule
 * for "who is trusted enough to be paged"; they are now also the rule for "who
 * is trusted enough to claim", and a single constant keeps the two from
 * drifting apart.
 *
 * The floors are counted in ordinary feeds from the 30 baseline (see
 * docs/INVARIANTS.md, the trust table): 40 is 10 credited feeds, 60 is 30.
 */
import type { SosSeverity } from "@hetja/contracts";

/** Trust floor per severity for paging AND for claiming a case. */
export const TRUST_FLOOR: Readonly<Record<SosSeverity, number>> = {
  minor: 40,
  serious: 40,
  critical: 60,
} as const;

/**
 * A non-moderator may hold at most this many acknowledged, unresolved cases at
 * once. A third ack answers 409 SOS_TOO_MANY_OPEN_ACKS. One responder cannot be
 * at three emergencies; an account trying to is hoarding them.
 */
export const MAX_OPEN_ACKS = 2;

export interface ResponderStanding {
  sosOptIn: boolean;
  trustScore: number;
  /**
   * Design v5: the wards the feeder chose (feeders.wards). Empty or absent
   * means "no ward preference", which is every account older than 0026.
   */
  wards?: readonly string[];
  /**
   * Design v6 (L1): feeders.sos_paused_until. While it is in the future the
   * feeder has no STANDING: not paged, not handed case ids on the map, not
   * admitted to a case page by standing. A feeder who was already PAGED for a
   * case keeps that ground (mayAck's `notified`): pausing stops new pages; it
   * does not take away a case they deliberately open from a page they already
   * had.
   */
  pausedUntil?: Date | string | null;
}

export function isPaused(pausedUntil: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!pausedUntil) return false;
  const t = pausedUntil instanceof Date ? pausedUntil.getTime() : Date.parse(pausedUntil);
  return Number.isFinite(t) && t > now;
}

/**
 * The ward half of the rule (design v5, N1 "We only alert you about dogs in
 * these wards."). A feeder with no wards set is not restricted; one with wards
 * set is a responder only for dogs in them. `dogWard` null (a caller with no
 * ward context) leaves the standing rule as it was.
 */
export function wardAllows(wards: readonly string[] | undefined, dogWard: string | null | undefined): boolean {
  if (!wards || wards.length === 0) return true;
  if (dogWard == null) return true;
  return wards.includes(dogWard);
}

/**
 * Opted in to being paged AND at or above the floor for this severity AND (v5)
 * the dog is in one of the feeder's wards when they chose any. This is the
 * whole standing rule; being notified for a specific case or holding the
 * `moderate` capability are separate grounds the ack route adds on top.
 *
 * The trust floors are unchanged by the ward rule: a ward makes a feeder
 * eligible without recent-scan proximity (routes/sos.ts dispatchFanout), never
 * without the floor.
 */
export function canRespond(
  viewer: ResponderStanding | null | undefined,
  severity: SosSeverity,
  dogWard?: string | null,
): boolean {
  return (
    !!viewer &&
    viewer.sosOptIn &&
    viewer.trustScore >= TRUST_FLOOR[severity] &&
    !isPaused(viewer.pausedUntil) &&
    wardAllows(viewer.wards, dogWard)
  );
}

export interface AckGrounds extends ResponderStanding {
  /** A sos_notifications row exists for this feeder and this case. */
  notified: boolean;
  /** The caller holds the `moderate` capability. */
  moderator: boolean;
}

/**
 * May this caller claim a case of this severity? Paged for it, a moderator, or
 * standing that would have got them paged.
 */
export function mayAck(grounds: AckGrounds, severity: SosSeverity, dogWard?: string | null): boolean {
  return grounds.notified || grounds.moderator || canRespond(grounds, severity, dogWard);
}
