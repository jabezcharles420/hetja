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
  /**
   * Design v7 (D13): feeders.suspended_at is set. A suspended account has no
   * standing and no other ground either: it is not paged, cannot take a case
   * and is not handed case ids.
   */
  suspended?: boolean;
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
    !viewer.suspended &&
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
  /**
   * Design v7 (V2 "SOS near you · I'll take it"): the caller is a VERIFIED vet
   * (never a suspended one) who takes SOS and covers the case's ward. A vet's
   * standing does not come from feed trust; it comes from an admin checking
   * their registration.
   */
  vetCoversWard?: boolean;
}

/**
 * May this caller claim a case of this severity? Paged for it, a moderator, or
 * standing that would have got them paged.
 */
export function mayAck(grounds: AckGrounds, severity: SosSeverity, dogWard?: string | null): boolean {
  if (grounds.suspended) return false;
  return grounds.notified || grounds.moderator || grounds.vetCoversWard === true || canRespond(grounds, severity, dogWard);
}

/** SQL: account `$feeder` is a verified vet taking SOS in ward `$ward` (AckGrounds.vetCoversWard). */
export function vetCoversWardSql(feederExpr: string, wardExpr: string): string {
  return `EXISTS (SELECT 1 FROM vet_profiles vp WHERE vp.feeder_id = ${feederExpr} AND vp.status = 'verified'
                  AND vp.sos_available AND ${wardExpr} IS NOT NULL AND vp.wards @> ARRAY[${wardExpr}]::text[])`;
}

// ---------------------------------------------------------------------------
// Design v7: professional routing (docs/design/v7-portals/CONTRACT.md "Data").
//
//   1. feeders nearby, exactly as above (the fan-out and the dog's own
//      feeders), at filing;
//   2. the NGO covering the ward (status active, not paused): its
//      coordinators are paged (route ngo_coordinator) and can "Send someone"
//      (route ngo_dispatch); the member who accepts takes the case as
//      themselves;
//   3. after NGO_WINDOW_MINUTES with nobody taking it (or at once when the NGO
//      passes, or when no one at all could be paged), every verified vet
//      covering the ward who takes SOS (route vet_escalation);
//   4. an admin can "Assign a vet" at any time (route admin_assign).
//
// A professional page is a GROUND to take the case, like a feeder page, so
// it flows through mayAck's `notified` unchanged: with one exception, which
// is written down here so it stays one rule. A SUSPENDED VET's vet pages
// (vet_escalation, admin_assign) are no ground: "Suspending hides their
// Accept SOS button" (A2). pageIsGround is what the ack route and the case
// page ask.
//
// "Told" (the v6 rule) still means told: a feeder page counts once it is in
// the account's alerts; a vet or NGO page counts only once DELIVERED.
// ---------------------------------------------------------------------------

export type PageRoute = "ngo_coordinator" | "ngo_dispatch" | "vet_escalation" | "admin_assign";

/** N3: "If nobody accepts in 15 min, the case opens to all vets nearby." */
export const NGO_WINDOW_MINUTES = 15;

/** At most this many vets are paged when a case opens to vets. */
export const MAX_VETS_PAGED = 15;

export const VET_ROUTES: readonly PageRoute[] = ["vet_escalation", "admin_assign"];
export const NGO_ROUTES: readonly PageRoute[] = ["ngo_coordinator", "ngo_dispatch"];

/** Is this notification row a ground to take the case? */
export function pageIsGround(row: { notifyOnly: boolean; route: string | null }, vetSuspended: boolean): boolean {
  if (row.notifyOnly) return false;
  if (vetSuspended && row.route !== null && (VET_ROUTES as readonly string[]).includes(row.route)) return false;
  return true;
}

/** SQL twin of pageIsGround for a notification row `n` (a boolean `$vetSuspended` is spliced in by the caller). */
export function pageIsGroundSql(vetSuspendedParam: string): string {
  return `(NOT n.notify_only AND NOT (${vetSuspendedParam} AND COALESCE(n.route, '') IN ('vet_escalation', 'admin_assign')))`;
}

/** Does this row count toward the case page's feedersTold? (Professionals are counted separately, once delivered.) */
export function isFeederPage(route: string | null): boolean {
  return route === null;
}

/** SQL: the account on notification row `n` is a SUSPENDED vet. */
export const N_VET_SUSPENDED_SQL = `COALESCE((SELECT vp.status = 'suspended' FROM vet_profiles vp WHERE vp.feeder_id = n.feeder_id), FALSE)`;

/** SQL: notification row `n` is a ground to take the case (pageIsGround). */
export const N_IS_GROUND_SQL = pageIsGroundSql(N_VET_SUSPENDED_SQL);
