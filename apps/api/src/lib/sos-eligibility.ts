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
}

/**
 * Opted in to being paged AND at or above the floor for this severity. This is
 * the whole standing rule; being notified for a specific case or holding the
 * `moderate` capability are separate grounds the ack route adds on top.
 */
export function canRespond(viewer: ResponderStanding | null | undefined, severity: SosSeverity): boolean {
  return !!viewer && viewer.sosOptIn && viewer.trustScore >= TRUST_FLOOR[severity];
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
export function mayAck(grounds: AckGrounds, severity: SosSeverity): boolean {
  return grounds.notified || grounds.moderator || canRespond(grounds, severity);
}
