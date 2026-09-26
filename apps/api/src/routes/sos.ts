/**
 * Hetja SOS: report + case state routes.
 *
 * POST /api/v1/reports:         anon-attested (device token, INVARIANT 7 caps)
 *                                OR feeder-authed (Bearer access token). Opens a
 *                                sos_case at tier 1. Severity routing:
 *                                every severity TELLS the dog's own feeders at
 *                                filing (notifyOwnFeeders; below the trust floor
 *                                as notify_only, never a ground to take it);
 *                                minor/serious page nobody else (dogless: the
 *                                ward's feeders at the floor);
 *                                critical fans out immediately via the canonical
 *                                query in docs/queries/sos_fanout.sql, but ONLY
 *                                when dogs.sos_eligible_at IS NOT NULL (wave 7:
 *                                corroboration gates responder paging, never the
 *                                report itself or nearbyCare). Every response
 *                carries `fanout`: "responders" when the responder fan-out is
 *                what owns this case's notification, "escalated" when it is not.
 *                The escalate_sos job runs at now() instead of +8 min whenever
 *                responders were NOT paged at report time on a critical case:
 *                there is no one to wait eight minutes for.
 * GET  /api/v1/reports/:caseId/status: the REPORTER's own view of a case they
 *                filed: { state, ackedAt, escalatedAt, resolvedAt } and nothing
 *                else, authorised only by the device (or account) that filed it.
 * GET  /api/v1/sos/cases/:id:    feeder-authed case state, visible only to the
 *                acker, the responders paged for it, or a moderator.
 * POST /api/v1/sos/cases/:id/ack:      first writer wins (below).
 * POST /api/v1/sos/cases/:id/resolve:  closes a case (acker or moderator).
 * POST /api/v1/sos/cases/:id/decline:  design v5, "I can't go right now".
 * POST /api/v1/sos/cases/:id/release | arrived | close-by: design v6 lifecycle.
 * POST /api/v1/reports/:caseId/updates | left: design v6, the reporter's side.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { MAX_PHOTO_BASE64_CHARS, SLUG_REGEX, isInMumbai, nearestWard, wardDisplay, wardName, type SosSeverity } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { deviceTokenSubject } from "../lib/device.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { parseUuidParam } from "../lib/params.js";
import {
  RateLimiter,
  enforceLimits,
  feederWritePerAccount,
  doglessReportPerIp,
  doglessReportPerSubject,
  ipBucketKey,
  logRateLimited,
  reportPerSubject,
  sosAckPerAccount,
  subjectKey,
} from "../lib/rate-limit.js";
import { PHOTO_ROUTE_BODY_LIMIT } from "../lib/body-limits.js";
import { PHOTO_BUSY_RETRY_AFTER_SEC, PhotoBusyError, photoGate, type Release } from "../lib/photo-gate.js";
import {
  MAX_OPEN_ACKS,
  NGO_WINDOW_MINUTES,
  N_IS_GROUND_SQL,
  TRUST_FLOOR,
  canRespond,
  mayAck,
  vetCoversWardSql,
} from "../lib/sos-eligibility.js";
import { routeCaseToNgo, scheduleOpenToVets } from "@hetja/db";
import { isDeviceBlocked, isSuspended } from "../lib/moderation-state.js";
import { wardProfessionals } from "../lib/professionals.js";
import { decodePhotoUpload, storePhoto, type StorageConfig } from "../lib/storage.js";
import { UnsupportedImageError, type StrippedImage } from "../lib/exif-strip.js";
import { capabilitiesFor, requireFeeder } from "../lib/require-role.js";
import { getNearbyCare, type NearbyCareProvider } from "./care.js";
import { AVATAR_SQL, PORTRAIT_SQL, photoUrlFor } from "../lib/photo-url.js";
import { firstName, publicName } from "../lib/public-name.js";
import { dogSex } from "../lib/dog-feeders.js";

// INVARIANT 7: anonymous SOS is capped per attested device token.
const SOS_DAILY_CAP = 2;
const SOS_WEEKLY_CAP = 5;

const SosReportInput = z.object({
  // Optional since design v6 (P8, F1): without it the report is DOGLESS and
  // `geo` is required, inside Mumbai (checked in the handler).
  dogSlug: z.string().regex(SLUG_REGEX).optional(),
  geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  severity: z.enum(["minor", "serious", "critical"]),
  note: z.string().max(500).optional(),
  deviceToken: z.string().min(1).max(256).optional(),
  // Optional photo of the dog. Same cap and same decode/EXIF-strip path as a
  // scan's photo (routes/scans.ts). Deliberately NOT part of the dedupe key
  // below: a re-submit with a different photo is still the same report, so a
  // photo can never be used to mint a "new" case around the INVARIANT 7 cap.
  photoBase64: z.string().max(MAX_PHOTO_BASE64_CHARS).optional(),
});

/**
 * Reporter status polls, per device (or per account for a signed-in
 * reporter). INVARIANT 6: keyed on the canonical subject, never the IP. A
 * stranger's page polling every 15 s stays well inside 20 burst + 1 per 5 s;
 * a script hammering case ids to probe for existence does not.
 */
export const reportStatusLimiter = new RateLimiter({ refillPerSec: 1 / 5, burst: 20 });

/** Reporter updates and "I had to leave" (design v6, L7), per device or account: burst 5, then 20 a day. */
export const reportUpdatePerSubject = new RateLimiter({ refillPerSec: 20 / 86_400, burst: 5 });

class SosRateLimitError extends Error {
  constructor() {
    super("sos report rate cap exceeded");
    this.name = "SosRateLimitError";
  }
}

/**
 * Design v6 (L7): this reporter already has an open case on this dog (or, for
 * a dogless report, in this ward). One open case per reporter per dog: the
 * reporter adds to it ("Add an update") instead of opening another.
 */
class SosOpenCaseError extends Error {
  constructor(public readonly openCase: OpenCaseRef) {
    super("reporter already has an open case here");
    this.name = "SosOpenCaseError";
  }
}

export interface OpenCaseRef {
  caseId: string;
  raisedAt: string;
  responderFirstName: string | null;
  takenAt: string | null;
}

/**
 * The reporter's open case on a dog (or, dogless, in a ward), if any. Keyed on
 * the same subject as the INVARIANT 7 cap: the account, else the canonical
 * device id. Never the IP.
 */
async function openCaseOf(
  client: TxClient,
  feederId: string | null,
  deviceSubject: string | null,
  dogId: string | null,
  wardId: string | null,
): Promise<OpenCaseRef | null> {
  const res = await client.query<{
    id: string;
    opened_at: Date;
    acked_at: Date | null;
    display_name: string | null;
    show_first_name: boolean | null;
    deleted_at: Date | null;
  }>(
    `SELECT c.id, c.opened_at, c.acked_at, f.display_name, f.show_first_name, f.deleted_at
       FROM sos_cases c
       JOIN scans s ON s.id = c.scan_id
       LEFT JOIN feeders f ON f.id = c.acked_by
      WHERE s.scan_type = 'sos'
        AND c.resolved_at IS NULL AND c.state IN ('open', 'acked', 'escalated')
        AND (($1::uuid IS NOT NULL AND s.feeder_id = $1::uuid)
             OR ($1::uuid IS NULL AND s.device_token = $2::text))
        AND (($3::uuid IS NOT NULL AND c.dog_id = $3::uuid)
             OR ($3::uuid IS NULL AND c.dog_id IS NULL AND c.ward_id = $4::text))
      ORDER BY c.opened_at DESC LIMIT 1`,
    [feederId, deviceSubject, dogId, wardId],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    caseId: r.id,
    raisedAt: new Date(r.opened_at).toISOString(),
    responderFirstName: r.acked_at ? firstName(r.display_name, r.show_first_name, r.deleted_at) : null,
    takenAt: r.acked_at ? new Date(r.acked_at).toISOString() : null,
  };
}

class SosDogNotFoundError extends Error {
  constructor() {
    super("dog not found");
    this.name = "SosDogNotFoundError";
  }
}

interface DogRow {
  id: string;
  lat: number | null;
  lng: number | null;
  sos_eligible_at: Date | null;
  ward_id: string | null;
}

/**
 * What owns this case's responder notification, reported as `fanout` in every
 * POST /api/v1/reports response:
 *
 *   "responders":  the responder fan-out ran for this case (it was critical
 *                  AND the dog was corroborated). `tier` then says whether it
 *                  found anyone: 1 = responders paged, 2 = the set came back
 *                  empty and escalation took over immediately.
 *   "escalated":   responder paging did NOT run at report time: the dog is
 *                  uncorroborated (paging gated off), or the severity defers
 *                  to validation. The escalation channel owns notification.
 *
 * The field exists because tier alone cannot distinguish "paging was gated
 * off" from "paging ran and found nobody nearby": two states that need
 * opposite operator responses.
 */
type FanoutDisposition = "responders" | "escalated";

interface CaseRow {
  id: string;
  severity: string;
  state: string;
  tier: number;
  opened_at: Date;
  acked_at: Date | null;
  escalated_at: Date | null;
  resolved_at: Date | null;
  resolution: string | null;
}

/** Minimal structural view of the pg client so helpers avoid a `pg` import. */
interface TxClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

async function poolQuery<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
  return (await query(text, params)) as unknown as { rows: T[]; rowCount: number | null };
}

/** The pool, as a TxClient, for helpers shared with transactions. */
const poolClient: TxClient = { query: poolQuery };

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/** Deterministic UUID (v5-style) for offline replay idempotency of a report. */
function deterministicUuid(namespace: string, input: string): string {
  const hex = createHash("sha256").update(`${namespace}:${input}`).digest("hex");
  const bytes = hex.slice(0, 32).match(/.{2}/g)!.map((b) => parseInt(b, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return [bytes.slice(0, 4), bytes.slice(4, 6), bytes.slice(6, 8), bytes.slice(8, 10), bytes.slice(10, 16)]
    .map((part) => part.map(toHex).join(""))
    .join("-");
}

/**
 * Canonical SOS fan-out (docs/queries/sos_fanout.sql): eligible responders
 * within 2000m with sos_opt_in and trust >= floor (40 minor/serious, 60
 * critical), best-trust first, up to 15. Zero eligible → the case opens at
 * tier 2 immediately. Returns true when responders were notified.
 *
 * WHERE PROXIMITY COMES FROM (wave 7). This query used to filter on
 * feeders.last_known_geo, a column NOTHING ever wrote, so it returned zero
 * rows on every call, every case silently took the tier-2 branch, and no
 * responder was ever paged while every log line looked healthy. It now
 * derives proximity from where a feeder has actually SCANNED: at least one
 * geotagged scan within 2000 m in the last 30 days. That uses data already
 * collected for a stated purpose instead of tracking anyone's live position,
 * and needs no new PII column.
 *
 * THE STATED COST: a feeder who has moved is stale until their next geotagged
 * scan. Accepted deliberately, in exchange for not keeping a rolling record
 * of where account holders are. Do NOT "fix" this by populating
 * feeders.last_known_geo / feeders.last_seen_at: both are dead by decision,
 * documented in migration 0020's column comments, and feeders_sos_gix (the
 * partial GIST index over last_known_geo) is dead weight for the same reason:
 * left in place rather than dropped, because dropping it trips the destructive
 * gate for no benefit.
 *
 * Consent (`sos_opt_in`) is written only by PATCH /api/v1/feeders/me; paging
 * someone without it is not an option this code has.
 */
async function dispatchFanout(
  client: TxClient,
  caseId: string,
  lat: number | null,
  lng: number | null,
  severity: SosSeverity,
  dogWard: string | null,
): Promise<boolean> {
  // The floors live in lib/sos-eligibility.ts, shared with the ack route and
  // the map, so "who gets paged" and "who may claim" cannot drift apart.
  //
  // DESIGN V5 WARD RULE (lib/sos-eligibility.ts wardAllows, CONTRACT.md
  // "Profile"). A feeder who chose wards is paged ONLY for dogs in those
  // wards, and for ANY dog in them, with or without a recent nearby scan. A
  // feeder with no wards is paged exactly as before: by a geotagged scan
  // within 2000 m in the last 30 days. The trust floor and consent apply to
  // both branches unchanged. A dog with no recorded position can therefore
  // still reach the feeders of its ward (the proximity branch simply matches
  // nothing: ST_DWithin against NULL is never true), where before it went
  // straight to tier 2. A feeder who paused alerts (L1, design v6,
  // feeders.sos_paused_until) is not paged until the pause ends. A dogless
  // case (design v6) is paged exactly like a dog at the reporter's point.
  const trustFloor = TRUST_FLOOR[severity];
  const res = await client.query<{ id: string }>(
    `SELECT f.id
     FROM feeders f
     CROSS JOIN LATERAL (
       SELECT max(s.received_at) AS last_nearby_scan
         FROM scans s
        WHERE s.feeder_id = f.id
          AND s.geo IS NOT NULL
          AND s.received_at >= now() - interval '30 days'
          AND ST_DWithin(s.geo, $1::geography, 2000)
     ) recent
     WHERE f.sos_opt_in
       AND f.deleted_at IS NULL
       AND f.suspended_at IS NULL
       AND (f.sos_paused_until IS NULL OR f.sos_paused_until <= now())
       AND f.trust_score >= $2
       AND ((cardinality(f.wards) = 0 AND recent.last_nearby_scan IS NOT NULL)
            OR ($3::text IS NOT NULL AND f.wards @> ARRAY[$3::text]))
     ORDER BY f.trust_score DESC, recent.last_nearby_scan DESC NULLS LAST
     LIMIT 15`,
    [lat != null && lng != null ? geoWkt(lat, lng) : null, trustFloor, dogWard],
  );
  if (res.rows.length === 0) {
    await client.query(`UPDATE sos_cases SET tier = 2 WHERE id = $1`, [caseId]);
    return false;
  }
  for (const row of res.rows) {
    // ON CONFLICT means something as of migration 0020 (unique partial indexes
    // on case + recipient + channel). Before that it was a no-op and repeated
    // fan-outs inserted duplicates.
    await client.query(
      `INSERT INTO sos_notifications (case_id, feeder_id, channel) VALUES ($1, $2, 'push') ON CONFLICT DO NOTHING`,
      [caseId, row.id],
    );
  }
  return true;
}

/**
 * The dog's OWN feeders, told about every SOS on their dog (pre-deploy
 * review): the registrator and anyone with a non-rejected feed in the last 60
 * days, opted in, not paused, live account, WHATEVER their trust. Quiet hours
 * never apply to SOS. Those at the severity's trust floor get an ordinary
 * responder page (a ground to take the case); those below it get a
 * notify_only row (migration 0028): a push and an Alerts entry, counted as
 * told, and NOT a ground to take the case, so it cannot stop escalation.
 *
 * A dogless case has no own feeders; for minor/serious it pages the feeders
 * who chose its ward, at the floor, as responders (critical dogless cases go
 * through dispatchFanout's ward branch instead). Rows already written by the
 * responder fan-out are left as they are (ON CONFLICT DO NOTHING).
 */
async function notifyOwnFeeders(
  client: TxClient,
  caseId: string,
  dogId: string | null,
  wardId: string | null,
  severity: SosSeverity,
): Promise<{ responders: number; told: number }> {
  const floor = TRUST_FLOOR[severity];
  const res = await client.query<{ id: string; trust_score: number }>(
    `SELECT f.id, f.trust_score FROM feeders f
      WHERE f.sos_opt_in AND f.deleted_at IS NULL AND f.suspended_at IS NULL
        AND (f.sos_paused_until IS NULL OR f.sos_paused_until <= now())
        AND (($1::uuid IS NOT NULL
              AND (f.id IN (SELECT registered_by FROM dogs WHERE id = $1::uuid OR merged_into = $1::uuid)
                   OR EXISTS (SELECT 1 FROM scans s
                               WHERE s.dog_id = $1::uuid AND s.feeder_id = f.id AND s.scan_type = 'feed'
                                 AND s.review_status <> 'rejected'
                                 AND s.received_at >= now() - interval '60 days')))
             OR ($1::uuid IS NULL AND $2::text IS NOT NULL AND f.wards @> ARRAY[$2::text]
                 AND f.trust_score >= $3))
      ORDER BY f.trust_score DESC
      LIMIT 30`,
    [dogId, wardId, floor],
  );
  let responders = 0;
  let told = 0;
  for (const row of res.rows) {
    const notifyOnly = row.trust_score < floor;
    const ins = await client.query(
      `INSERT INTO sos_notifications (case_id, feeder_id, channel, notify_only)
       VALUES ($1, $2, 'push', $3) ON CONFLICT DO NOTHING`,
      [caseId, row.id, notifyOnly],
    );
    if ((ins.rowCount ?? 0) === 1) {
      told++;
      if (!notifyOnly) responders++;
    }
  }
  return { responders, told };
}

async function persistReportPhoto(
  app: FastifyInstance,
  scanId: string,
  photo: StrippedImage,
  release: Release,
): Promise<void> {
  try {
    const photoKey = await storePhoto(photo, app.config as unknown as StorageConfig);
    await query(`UPDATE scans SET photo_s3_key = $1 WHERE id = $2 AND photo_s3_key IS NULL`, [photoKey, scanId]);
  } catch (err) {
    app.log.warn({ err, scanId }, "sos report photo persist failed");
  } finally {
    release();
  }
}

/**
 * Nearby care for the dog behind a report, or null when the dog is unknown or
 * has no position. Shared by the success path and both 429s (hardening batch
 * 1, T11): a reporter who is rate-limited is still standing over a hurt dog,
 * and the fastest useful thing is still a phone number.
 */
async function nearbyCareForSlug(dogSlug: string): Promise<NearbyCareProvider[] | null> {
  // SECURITY-GATE: public-coordinates -- internal only. Used to rank nearby
  // care providers by distance; the dog's own position is not echoed back.
  // Only the resulting provider list (published clinic addresses) is returned.
  const dogGeoRes = await query<{ lat: number | null; lng: number | null }>(
    `SELECT ST_Y(last_seen_geo::geometry) AS lat, ST_X(last_seen_geo::geometry) AS lng
       FROM dogs WHERE slug = $1`,
    [dogSlug],
  );
  const dogGeo = dogGeoRes.rows[0];
  if (dogGeo?.lat == null || dogGeo?.lng == null) return null;
  return getNearbyCare(dogGeo.lat, dogGeo.lng);
}

/**
 * Release a held case back to 'open' (design v6). ONE path, used by
 * POST /sos/cases/:id/release ("I can't make it after all") and by
 * DELETE /api/v1/feeders/me for every case the leaving account held, so a
 * deleted account's cases get the same 'released' event, re-page and
 * escalation handling. The caller holds the case row lock and has checked
 * that `feederId` is the acker and the case is not resolved.
 */
export async function releaseCase(client: TxClient, id: string, feederId: string): Promise<void> {
  await client.query(
    `UPDATE sos_cases
        SET acked_by = NULL, acked_at = NULL, state = 'open', close_by_at = NULL, arrived_at = NULL
      WHERE id = $1`,
    [id],
  );
  await client.query(`UPDATE sos_notifications SET acked_at = NULL WHERE case_id = $1 AND feeder_id = $2`, [
    id,
    feederId,
  ]);
  await client.query(`INSERT INTO sos_case_events (case_id, kind, feeder_id) VALUES ($1, 'released', $2)`, [
    id,
    feederId,
  ]);
  // Escalation, on the ORIGINAL clock. If the job is still queued it
  // stands as it is; if it already ran while the case was held (and did
  // nothing, the case being acked), it is queued again for the original
  // due time, or now if that is past.
  await client.query(
    `INSERT INTO jobs (kind, payload, run_after)
     SELECT 'escalate_sos', jsonb_build_object('caseId', c.id, 'dogId', c.dog_id),
            GREATEST(now(), c.opened_at + interval '8 minutes')
       FROM sos_cases c
      WHERE c.id = $1 AND c.escalated_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM jobs j
                         WHERE j.kind = 'escalate_sos' AND j.failed_at IS NULL
                           AND j.payload->>'caseId' = c.id::text)`,
    [id],
  );
  await client.query(
    `INSERT INTO jobs (kind, payload, run_after)
     SELECT 'send_sos_push', $2::jsonb, now()
      WHERE EXISTS (SELECT 1 FROM sos_notifications
                     WHERE case_id = $1 AND channel = 'push' AND feeder_id IS NOT NULL AND feeder_id <> $3)`,
    [id, JSON.stringify({ caseId: id, repage: true, exclude: feederId }), feederId],
  );
}

export default async function sosRoutes(app: FastifyInstance): Promise<void> {
  // bodyLimit: one of the two photo routes (lib/body-limits.ts). The rest of
  // the API accepts 64 KiB.
  app.post("/api/v1/reports", { bodyLimit: PHOTO_ROUTE_BODY_LIMIT }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SosReportInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid sos report", code: "INVALID_SOS_REPORT" } });
    }
    const { dogSlug, severity, note, photoBase64 } = parsed.data;
    // DOGLESS SOS (design v6, P8 / F1). No known dog: the report must carry a
    // point inside Mumbai, and the case is located to the ward whose centre is
    // nearest (nearestWard; an approximation near ward edges). The point is
    // stored on the case, handed only to the responder who takes it, and never
    // logged (the request serializer already drops bodies; nothing below logs
    // it). Strict limits, below, on top of every rule a dog report has.
    const dogless = dogSlug === undefined;
    const reportGeo = parsed.data.geo ?? null;
    const doglessWard = dogless && reportGeo ? nearestWard(reportGeo.lat, reportGeo.lng) : null;
    if (dogless && (!reportGeo || !isInMumbai(reportGeo.lat, reportGeo.lng) || !doglessWard)) {
      return reply.status(400).send({
        ok: false,
        error: {
          message: "a report without a dog needs your location, inside Mumbai",
          code: reportGeo ? "GEO_OUTSIDE_MUMBAI" : "GEO_REQUIRED",
        },
      });
    }
    // L7: on any 429, the reporter's open case here, so the page can show it.
    const openCaseNow = async (): Promise<OpenCaseRef | null> => {
      const dogId = dogSlug
        ? ((await query<{ id: string }>(`SELECT id FROM dogs WHERE slug = $1`, [dogSlug])).rows[0]?.id ?? null)
        : null;
      if (dogSlug && !dogId) return null;
      return openCaseOf(poolClient, feederId, deviceSubject, dogId, doglessWard);
    };
    // Numbers to call, for every outcome including the refusals below.
    const careNow = async (): Promise<NearbyCareProvider[] | null> =>
      dogless ? getNearbyCare(reportGeo!.lat, reportGeo!.lng) : nearbyCareForSlug(dogSlug!);
    // The token may arrive in the body (the original contract, apps/scan) or in
    // the X-Device-Token header every other device-attested route uses
    // (hardening batch 1, T5). The body wins when both are present, so an
    // existing client's behaviour cannot change.
    const headerToken = req.headers["x-device-token"];
    const deviceToken =
      parsed.data.deviceToken ?? (typeof headerToken === "string" && headerToken.length > 0 ? headerToken : undefined);

    // INVARIANT 6/7: `deviceSubject` (the canonical deviceId the token
    // attests) is the rate-limit subject, and the ONLY device-derived value
    // this route is allowed to key on. Never `deviceToken` as submitted: the
    // token string is not a canonical name for a device (Node's base64 decoder
    // ignores padding and non-alphabet bytes, so `tok`, `tok=` and `tok!` all
    // authenticate as the same device while being different strings). Keying
    // the cap query and the dedupe key on the string handed each variant its
    // own fresh 2/day + 5/week budget off a single proof-of-work solve, and
    // each of those reports pages real responders. `deviceTokenSubject` now
    // also refuses non-canonical encodings outright, so both halves are shut.
    const deviceSubject = deviceToken ? deviceTokenSubject(deviceToken, app.config.HETJA_DEVICE_SECRET) : null;

    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    let feederId: string | null = null;
    if (rawAuth.startsWith("Bearer ")) {
      try {
        feederId = verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub;
      } catch {
        return reply
          .status(401)
          .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
      }
    } else if (!deviceSubject) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
    }

    // Design v7 (D13): a device a moderator blocked, or a suspended account,
    // may still file (an emergency is an emergency, and the answer still
    // carries every number to call) but its report pages NOBODY: no feeder,
    // NGO or vet. It escalates to the tier-2 record at once.
    const silenced = feederId ? await isSuspended(feederId) : await isDeviceBlocked(deviceSubject);

    // Request-rate limit per account or device (hardening batch 1, T3),
    // never per IP (INVARIANT 6). Before any photo decode or database work.
    // It does not replace INVARIANT 7's case cap below; it bounds how often a
    // subject can hit this route at all (replays and photo re-uploads
    // included). The 429 still carries nearbyCare (T11).
    // Dogless reports (design v6) are limited much more tightly, per account
    // or device AND per IP (lib/rate-limit.ts, docs/INVARIANTS.md #6): a report
    // that names no dog is the cheapest way to page a whole ward's feeders.
    if (dogless) {
      const d1 = doglessReportPerSubject.peek(subjectKey(feederId, deviceSubject));
      const d2 = doglessReportPerIp.peek(ipBucketKey(req.ip));
      if (!d1.allowed || !d2.allowed) {
        logRateLimited(req.log, !d1.allowed ? "doglessReportPerSubject" : "doglessReportPerIp", !d1.allowed ? (feederId ? "account" : "device") : "ip");
        const nearbyCare = await careNow();
        return reply
          .status(429)
          .header("retry-after", String(Math.max(d1.retryAfterSec, d2.retryAfterSec)))
          .send({
            ok: false,
            error: { message: "too many reports; try again later", code: "RATE_LIMITED" },
            ...(nearbyCare ? { data: { nearbyCare } } : {}),
          });
      }
      doglessReportPerSubject.consume(subjectKey(feederId, deviceSubject));
      doglessReportPerIp.consume(ipBucketKey(req.ip));
    }

    const reportBudget = reportPerSubject.consume(subjectKey(feederId, deviceSubject));
    if (!reportBudget.allowed) {
      logRateLimited(req.log, "reportPerSubject", feederId ? "account" : "device");
      const nearbyCare = await careNow();
      const openCase = await openCaseNow();
      return reply
        .status(429)
        .header("retry-after", String(reportBudget.retryAfterSec))
        .send({
          ok: false,
          error: { message: "too many reports; try again shortly", code: "RATE_LIMITED" },
          ...(nearbyCare || openCase ? { data: { ...(nearbyCare ? { nearbyCare } : {}), ...(openCase ? { openCase } : {}) } } : {}),
        });
    }

    // Photo: validated and metadata-stripped HERE, on the request path, for
    // the same two reasons as routes/scans.ts (unstripped bytes would publish
    // the camera's GPS, INVARIANT 2; and "rejected" must mean a 400, not a
    // background warning). After auth, so an unauthenticated caller cannot
    // make the server decode images. The bytes are only WRITTEN after the
    // transaction below has passed the INVARIANT 7 cap and opened a new case.
    // The photo gate (lib/photo-gate.ts) bounds how many decoded photos are
    // alive at once; saturated, it answers 503 PHOTO_BUSY with retry-after.
    let photo: StrippedImage | null = null;
    let release: Release | null = null;
    let handedOff = false;
    if (photoBase64) {
      try {
        release = await photoGate.acquire();
      } catch (err) {
        if (!(err instanceof PhotoBusyError)) throw err;
        return reply
          .status(503)
          .header("retry-after", String(PHOTO_BUSY_RETRY_AFTER_SEC))
          .send({ ok: false, error: { message: "photo processing is busy; try again shortly", code: "PHOTO_BUSY" } });
      }
      try {
        photo = decodePhotoUpload(photoBase64);
      } catch (err) {
        release();
        if (!(err instanceof UnsupportedImageError)) throw err;
        return reply.status(400).send({
          ok: false,
          error: { message: `photo rejected: ${err.message}`, code: "INVALID_PHOTO" },
        });
      }
    }

    try {

    // INVARIANT 5: deterministic client_uuid → replay of the same report is
    // idempotent (a re-submit while a case is open/acked never double-opens).
    // Keyed on `deviceSubject`, not the token string, for the same reason the
    // cap below is: otherwise re-encoding the token also defeats the dedupe,
    // and one held report re-submits as an unbounded family of new cases.
    // Feeder-authed reports key on the ACCOUNT instead. Before wave 7 two
    // different feeders reporting the same dog with the same words produced
    // the same key, and the second feeder was silently handed the first one's
    // live case as a "replay".
    const dedupeKey = deterministicUuid(
      "sos-report",
      // Feeder identity wins over device deliberately: accounts sharing one
      // phone (an NGO field phone, say) must not collide into each other's
      // cases, while one account reporting from two devices SHOULD collapse:
      // it is the account that holds the cap and the standing.
      [feederId ?? deviceSubject ?? "", dogSlug ?? `ward:${doglessWard}`, severity, note ?? ""].join("|"),
    );

    interface ReportOutcome {
      created: boolean;
      caseId: string;
      tier: number;
      fanout: FanoutDisposition;
      wardId: string | null;
    }
    // The scan row a NEW case hangs off, kept out of ReportOutcome so the
    // response shape is unchanged. Only set when a case was created.
    const opened: { scanId: string | null } = { scanId: null };
    let result: ReportOutcome;
    try {
      result = await withTx(async (client): Promise<ReportOutcome> => {
        const existing = await client.query<{ id: string; state: string; tier: number }>(
          `SELECT c.id, c.state, c.tier
           FROM scans s
           JOIN sos_cases c ON c.scan_id = s.id
           WHERE s.client_uuid = $1
           ORDER BY c.opened_at DESC
           LIMIT 1`,
          [dedupeKey],
        );
        const replay = existing.rows[0];
        if (replay && (replay.state === "open" || replay.state === "acked")) {
          // The disposition is reconstructed from what actually happened to
          // this case rather than remembered: push notification rows exist ⇔
          // the responder fan-out ran for it. Channel matters: escalated
          // cases accumulate sms/bmc rows from the worker, which say nothing
          // about responder paging.
          const paged = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM sos_notifications
             WHERE case_id = $1 AND channel = 'push'`,
            [replay.id],
          );
          const w = await client.query<{ ward_id: string | null }>(`SELECT ward_id FROM sos_cases WHERE id = $1`, [
            replay.id,
          ]);
          return {
            created: false,
            caseId: replay.id,
            tier: replay.tier,
            fanout: paged.rows[0].n > 0 ? "responders" : "escalated",
            wardId: w.rows[0]?.ward_id ?? null,
          };
        }

        // Design v6 dogless dedupe: one open dogless case per reporter per
        // WARD. A second one from the same device in the same ward is the same
        // emergency; the reporter adds an update to it (L7) instead. 429
        // SOS_CASE_OPEN with data.openCase, below. (Reports on a dog keep
        // their v5 rules; their 429s carry openCase too.)
        if (dogless) {
          const open = await openCaseOf(client, feederId, deviceSubject, null, doglessWard);
          if (open) throw new SosOpenCaseError(open);
        }

        // INVARIANT 7: SOS caps, rolling windows. `$1`/subject differs by
        // caller kind and NEVER derives from the IP (INVARIANT 6):
        //
        //   anon:    the canonical deviceId the token attests (`deviceSubject`).
        //            Not `deviceToken` as submitted: the token string is not a
        //            canonical name for a device (see the comment above), so
        //            keying on it let each re-encoding mint a fresh budget.
        //   authed:  the feeder account. Wave 7: authenticated callers were
        //            previously exempt from every cap, which INVARIANT 6 does
        //            not license ("per account OR per device"), so a signed-in
        //            abuser could page responders without bound.
        //
        // Both are ROLLING windows (now() - interval), matching the comment
        // this code carried for months before it matched the code. The old
        // date_trunc('day'|'week') versions were calendar buckets: 2 reports
        // at 23:58 plus 2 more at 00:01 stayed within them.
        //
        // COUNTED IN sos_cases, NOT scans. A case is what pages people, and the
        // two are not one-to-one: the dedupe key below is deterministic, so a
        // report re-filed after its case was resolved reuses the existing scans
        // row (ON CONFLICT DO NOTHING) and opens a NEW case. Counting scans let
        // that path open cases without ever touching the cap: one held report
        // could re-open a fresh case every time a moderator closed the last
        // one. Counting the cases opened by this subject in the window is the
        // thing INVARIANT 7 actually bounds. Indexed by 0023.
        const sosCapCounts = !feederId
          ? (
              await client.query<{ today: number; week: number }>(
                `SELECT count(*) FILTER (WHERE c.opened_at >= now() - interval '1 day')::int AS today,
                        count(*) FILTER (WHERE c.opened_at >= now() - interval '7 days')::int AS week
                 FROM sos_cases c
                 JOIN scans s ON s.id = c.scan_id
                 WHERE s.scan_type = 'sos' AND s.device_token = $1`,
                [deviceSubject],
              )
            ).rows[0]
          : (
              await client.query<{ today: number; week: number }>(
                `SELECT count(*) FILTER (WHERE c.opened_at >= now() - interval '1 day')::int AS today,
                        count(*) FILTER (WHERE c.opened_at >= now() - interval '7 days')::int AS week
                 FROM sos_cases c
                 JOIN scans s ON s.id = c.scan_id
                 WHERE s.scan_type = 'sos' AND s.feeder_id = $1`,
                [feederId],
              )
            ).rows[0];
        if (sosCapCounts.today >= SOS_DAILY_CAP || sosCapCounts.week >= SOS_WEEKLY_CAP) {
          throw new SosRateLimitError();
        }

        // SECURITY-GATE: public-coordinates -- read for internal use only. This
        // exact position feeds the ST_DWithin fan-out radius and is never placed
        // in a response body, so INVARIANT 2's coarsening requirement (which
        // governs what an anonymous caller RECEIVES) does not apply. Coarsening
        // here would silently widen the 2km responder radius.
        const dogRes = dogSlug
          ? await client.query<DogRow>(
              `SELECT id, ST_Y(last_seen_geo::geometry) AS lat, ST_X(last_seen_geo::geometry) AS lng,
                      sos_eligible_at, ward_id
               FROM dogs WHERE slug = $1`,
              [dogSlug],
            )
          : null;
        const found = dogRes?.rows[0];
        if (dogSlug && !found) throw new SosDogNotFoundError();
        // A dogless case behaves as a "dog" at the reporter's point in the
        // nearest ward: eligible for paging (there is no tag to corroborate;
        // the strict limits above are what stand in for corroboration).
        const dog: DogRow & { dogless: boolean } = found
          ? { ...found, dogless: false }
          : {
              id: "",
              lat: reportGeo!.lat,
              lng: reportGeo!.lng,
              sos_eligible_at: new Date(),
              ward_id: doglessWard,
              dogless: true,
            };

        // scans.device_token stores the canonical deviceId, NOT the bearer
        // token. Two consequences worth stating: the cap query above can no
        // longer be defeated by re-encoding the token string, and a database
        // leak no longer hands out replayable attested tokens, because the
        // HMAC half is not stored. Existing rows hold whole raw tokens; the
        // caps are rolling 1-day/7-day windows, so those age out on their own
        // and no migration is required (see docs/INVARIANTS.md #7).
        //
        // feeder_id records the account behind a Bearer-authed report; the
        // per-account cap above counts these rows, and corroboration's
        // distinct-subject count treats the account as one subject.
        const scanRes = await client.query<{ id: string }>(
          `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, feeder_id, device_token, captured_at, received_at, review_status)
           VALUES ($1, $2, 'sos', NULL, $3, $4, now(), now(), 'pending')
           ON CONFLICT (client_uuid) DO NOTHING
           RETURNING id`,
          [dog.dogless ? null : dog.id, dedupeKey, feederId, deviceSubject],
        );
        let scanId = scanRes.rows[0]?.id;
        if (!scanId) {
          const existingScan = await client.query<{ id: string }>(
            `SELECT id FROM scans WHERE client_uuid = $1`,
            [dedupeKey],
          );
          scanId = existingScan.rows[0].id;
        }

        const caseRes = await client.query<{ id: string }>(
          `INSERT INTO sos_cases (scan_id, dog_id, severity, state, tier, note, ward_id, geo)
           VALUES ($1, $2, $3, 'open', 1, $4, $5, $6::geography)
           RETURNING id`,
          // The note (design v5, migration 0026) was validated and then used
          // only in the dedupe key; the N2 responder screen shows it now.
          // ward_id (v6) is the dog's ward, or the reporter's for a dogless
          // case; geo is set for a dogless case only.
          [
            scanId,
            dog.dogless ? null : dog.id,
            severity,
            note?.trim() ? note.trim() : null,
            dog.ward_id,
            dog.dogless ? geoWkt(reportGeo!.lat, reportGeo!.lng) : null,
          ],
        );
        const caseId = caseRes.rows[0].id;

        // WAVE 7: corroboration gates RESPONDER PAGING and nothing else. The
        // report itself was already accepted above unconditionally, and
        // nearbyCare below is returned for every outcome regardless of this
        // branch: in an emergency the fastest useful thing is a phone number,
        // and that must not depend on whether the dog's tag has been
        // corroborated yet.
        //
        //   eligible    → run the responder fan-out. It found someone  → tier 1,
        //                 push delivery handed to the worker, escalation waits
        //                 the normal 8 minutes for an ack. It found nobody →
        //                 tier 2 and escalation runs at now(): HOW-IT-WORKS §3.2
        //                 promises "if no eligible responder exists, it escalates
        //                 to tier 2 immediately", and until wave 7 the code
        //                 broke that promise: zero responders still waited out
        //                 the full 8-minute timer before ANYONE was notified.
        //                 `fanout` stays "responders": the responder path ran;
        //                 tier:2 records that it came back empty.
        //   ineligible  → suppressed. tier 2, no responder rows, no push job,
        //                 escalation at now(). Vets and BMC are notified
        //                 immediately rather than after a timer whose only job
        //                 was to wait for a responder who was never paged.
        //   minor/serious → tier 1; the dog's own feeders are paged at filing
        //                 (notifyOwnFeeders, below; before the v6 pre-deploy
        //                 review nobody was), escalation after 8 minutes.
        //                 `fanout` is "responders" when anyone was paged, else
        //                 "escalated".
        //
        let tier = 1;
        let fanout: FanoutDisposition = "escalated";
        let escalateNow = false;
        let anyTold = false;
        let anyToldProfessional = false;
        if (silenced) {
          tier = 2;
          fanout = "escalated";
          escalateNow = true;
          await client.query(`UPDATE sos_cases SET tier = 2 WHERE id = $1`, [caseId]);
        } else if (severity === "critical") {
          if (dog.sos_eligible_at != null) {
            const paged = await dispatchFanout(client, caseId, dog.lat, dog.lng, severity, dog.ward_id);
            // The dog's own feeders too (a dogless case's ward is already in
            // the fan-out's ward branch). Own feeders at the floor count as
            // responders; below it they are told only and do not hold off
            // escalation.
            const own = dog.dogless ? { responders: 0, told: 0 } : await notifyOwnFeeders(client, caseId, dog.id, null, severity);
            const responders = paged || own.responders > 0;
            anyTold = paged || own.told > 0;
            tier = responders ? 1 : 2;
            fanout = "responders";
            escalateNow = !responders;
            await client.query(`UPDATE sos_cases SET tier = $2 WHERE id = $1`, [caseId, tier]);
          } else {
            // Uncorroborated: no responder fan-out, escalation now, but the
            // dog's own feeders still hear about their dog.
            tier = 2;
            fanout = "escalated";
            escalateNow = true;
            await client.query(`UPDATE sos_cases SET tier = 2 WHERE id = $1`, [caseId]);
            const own = await notifyOwnFeeders(client, caseId, dog.dogless ? null : dog.id, null, severity);
            anyTold = own.told > 0;
          }
        } else {
          // MINOR / SERIOUS (pre-deploy review, design v6: "Tells Priya, Arjun
          // and a vet nearby"). Not the city-wide responder fan-out, which
          // stays critical-only: the dog's own feeders are told at filing
          // (notifyOwnFeeders), those at the trust floor as responders; for a
          // dogless case, the feeders who chose that ward. Escalation keeps
          // its 8 minutes.
          const own = await notifyOwnFeeders(client, caseId, dog.dogless ? null : dog.id, dog.ward_id, severity);
          anyTold = own.told > 0;
          if (own.responders > 0) fanout = "responders";
        }
        if (anyTold) {
          // Web Push (plan §3.4): hand delivery off to the worker (web-push +
          // VAPID) rather than blocking this request on it. The worker writes
          // delivered_at on success and leaves it null on failure, so the
          // sos_notifications receipt columns mean something.
          await client.query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('send_sos_push', $1::jsonb, now())`, [
            JSON.stringify({ caseId, dogId: dog.dogless ? null : dog.id }),
          ]);
        }

        // Design v7 routing (lib/sos-eligibility.ts): the NGO covering the
        // ward now, then every vet nearby after NGO_WINDOW_MINUTES with nobody
        // taking it. Straight to the vets when there is no NGO and nobody at
        // all was told: there is no one to wait fifteen minutes for.
        if (!silenced) {
          const ngo = await routeCaseToNgo(client, caseId, dog.ward_id);
          if (ngo && ngo.paged > 0) anyToldProfessional = true;
          await scheduleOpenToVets(client, caseId, ngo || anyTold ? NGO_WINDOW_MINUTES : 0);
        }
        if (anyToldProfessional && !anyTold) {
          await client.query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('send_sos_push', $1::jsonb, now())`, [
            JSON.stringify({ caseId, dogId: dog.dogless ? null : dog.id }),
          ]);
        }

        // Escalation: worker's escalate_sos handler promotes unacked cases.
        // Immediate whenever critical-case paging did not happen (no eligible
        // responders, or suppressed); +8 min otherwise.
        await client.query(
          `INSERT INTO jobs (kind, payload, run_after)
           VALUES ('escalate_sos', $1::jsonb, ${escalateNow ? "now()" : "now() + interval '8 minutes'"})`,
          [JSON.stringify({ caseId, dogId: dog.dogless ? null : dog.id })],
        );

        opened.scanId = scanId;
        return { created: true, caseId, tier, fanout, wardId: dog.ward_id };
      });
    } catch (err) {
      if (err instanceof SosOpenCaseError) {
        logRateLimited(req.log, "sosOpenCasePerDog", feederId ? "account" : "device");
        const nearbyCare = await careNow();
        return reply.status(429).send({
          ok: false,
          error: { message: "you already have an open report here; add an update to it", code: "SOS_CASE_OPEN" },
          data: { openCase: err.openCase, ...(nearbyCare ? { nearbyCare } : {}) },
        });
      }
      if (err instanceof SosRateLimitError) {
        // INVARIANT 7's case cap. Unchanged in what it counts; what changed
        // (hardening batch 1, T11) is that the refusal still hands the reporter
        // the nearest numbers to call.
        logRateLimited(req.log, "sosCaseCap", feederId ? "account" : "device");
        const nearbyCare = await careNow();
        const openCase = await openCaseNow();
        return reply.status(429).send({
          ok: false,
          error: { message: "sos report cap exceeded", code: "SOS_RATE_LIMITED" },
          ...(nearbyCare || openCase ? { data: { ...(nearbyCare ? { nearbyCare } : {}), ...(openCase ? { openCase } : {}) } } : {}),
        });
      }
      if (err instanceof SosDogNotFoundError) {
        return reply
          .status(404)
          .send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
      }
      throw err;
    }

    // Background write, like a scan photo: never blocks the emergency
    // response. Only for a case this request actually opened (a replay or a
    // capped report stores nothing), and never over a photo the scan row
    // already has: a re-filed report reuses its scan row (see the cap
    // comment above), and the first photo stays the evidence.
    if (photo && release && result.created && opened.scanId) {
      handedOff = true;
      void persistReportPhoto(app, opened.scanId, photo, release);
    }

    // Emergency-path improvement (plan §2.4): return a callable number
    // in the same payload as the case id, so the reporter has something to
    // act on immediately rather than waiting out the 8-min escalation timer.
    // Existing response fields (created, caseId, tier) are left untouched;
    // wave 7 adds `fanout` (see FanoutDisposition). nearbyCare is
    // STATUS-INDEPENDENT on purpose: an uncorroborated dog gets the same
    // phone numbers as a corroborated one.
    const nearbyCare = (await careNow()) ?? [];
    // Design v7: verified vets and active NGOs covering the ward, with their
    // PUBLIC professional numbers (owner decision; INVARIANT 3 is rescoped to
    // feeders and reporters). Never who was paged.
    const professionals = await wardProfessionals(result.wardId);

    return { ok: true, data: { ...result, nearbyCare, professionals } };
    } finally {
      if (release && !handedOff) release();
    }
  });

  /**
   * The REPORTER's credential for their own case: the X-Device-Token whose
   * CANONICAL device id (deviceTokenSubject, never the raw string; see the
   * INVARIANT 7 notes in the POST above) equals scans.device_token on the scan
   * that opened the case, or the Bearer account recorded as that scan's
   * feeder_id. Rate-limited per subject (INVARIANT 6), before any database
   * work. Any mismatch answers the same 404 as a case that does not exist, so
   * a device cannot probe other people's case ids. Sends the response and
   * returns null when the caller should stop.
   */
  const reporterCase = async (
    req: FastifyRequest,
    reply: FastifyReply,
    limiter: RateLimiter,
    limiterName: string,
  ): Promise<{ caseId: string } | null> => {
    reply.header("Cache-Control", "no-store");
    const notFound = () => {
      void reply.status(404).send({ ok: false, error: { message: "not found", code: "NOT_FOUND" } });
      return null;
    };
    let feederId: string | null = null;
    let deviceSubject: string | null = null;
    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    if (rawAuth.startsWith("Bearer ")) {
      try {
        feederId = verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub;
      } catch {
        void reply
          .status(401)
          .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
        return null;
      }
    } else {
      const deviceToken = req.headers["x-device-token"];
      deviceSubject =
        typeof deviceToken === "string" ? deviceTokenSubject(deviceToken, app.config.HETJA_DEVICE_SECRET) : null;
      if (!deviceSubject) {
        void reply
          .status(401)
          .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
        return null;
      }
    }

    const budget = limiter.consume(feederId ? `acct:${feederId}` : `dev:${deviceSubject}`);
    if (!budget.allowed) {
      logRateLimited(req.log, limiterName, feederId ? "account" : "device");
      void reply
        .status(429)
        .header("retry-after", String(budget.retryAfterSec))
        .send({ ok: false, error: { message: "too many requests; try again shortly", code: "RATE_LIMITED" } });
      return null;
    }

    // A malformed id is answered exactly like a foreign one.
    const caseId = parseUuidParam((req.params as { caseId: string }).caseId);
    if (!caseId) return notFound();
    const own = await query(
      `SELECT 1 FROM sos_cases c JOIN scans s ON s.id = c.scan_id
        WHERE c.id = $1 AND s.scan_type = 'sos'
          AND (($2::uuid IS NOT NULL AND s.feeder_id = $2::uuid)
               OR ($3::text IS NOT NULL AND s.device_token = $3::text))`,
      [caseId, feederId, deviceSubject],
    );
    if ((own.rowCount ?? 0) === 0) return notFound();
    return { caseId };
  };

  /**
   * GET /api/v1/reports/:caseId/status: "what happened to my report?"
   *
   * The reporter is usually a stranger with no account, so the credential is
   * the one they reported with (reporterCase above).
   *
   * Design v6 (N10, N11, V19, L7, P12) widens what the reporter learns, and
   * each addition is chosen so the reporter learns who is COMING, not who
   * anyone is: the responder's FIRST NAME only, and only if they kept "Show my
   * first name on dogs' pages" on; the first names of the feeders paged, with
   * opted-out feeders counted but not named; how many vets were told; the
   * lifecycle times; the outcome and the vet's or clinic's name the responder
   * typed. Never a surname, an account id, a phone number, a position of the
   * responder, or anything about feeders beyond those first names (INVARIANT
   * 3). The reporter's own updates come back so the page can list them.
   */
  app.get("/api/v1/reports/:caseId/status", async (req: FastifyRequest, reply: FastifyReply) => {
    const own = await reporterCase(req, reply, reportStatusLimiter, "reportStatusLimiter");
    if (!own) return reply;

    const res = await query<{
      state: string;
      acked_at: Date | null;
      escalated_at: Date | null;
      resolved_at: Date | null;
      close_by_at: Date | null;
      arrived_at: Date | null;
      reporter_left_at: Date | null;
      outcome: string | null;
      vet_name: string | null;
      acker_name: string | null;
      acker_show: boolean | null;
      acker_deleted: Date | null;
    }>(
      `SELECT c.state, c.acked_at, c.escalated_at, c.resolved_at, c.close_by_at, c.arrived_at,
              c.reporter_left_at, c.outcome, c.vet_name,
              f.display_name AS acker_name, f.show_first_name AS acker_show, f.deleted_at AS acker_deleted
         FROM sos_cases c LEFT JOIN feeders f ON f.id = c.acked_by
        WHERE c.id = $1`,
      [own.caseId],
    );
    const row = res.rows[0];
    const [paged, vets, updates] = await Promise.all([
      query<{ display_name: string; show_first_name: boolean; deleted_at: Date | null }>(
        `SELECT f.display_name, f.show_first_name, f.deleted_at
           FROM sos_notifications n JOIN feeders f ON f.id = n.feeder_id
          WHERE n.case_id = $1 AND n.channel = 'push' AND n.route IS NULL
          ORDER BY n.sent_at, n.id`,
        [own.caseId],
      ),
      query<{ n: number }>(
        // Delivered only (pre-deploy review): escalation writes sms/bmc rows
        // that nothing sends yet, and a vet who was never reached must not be
        // counted as told.
        `SELECT count(*)::int AS n FROM sos_notifications
          WHERE case_id = $1 AND delivered_at IS NOT NULL
            AND (vet_id IS NOT NULL OR route IN ('vet_escalation', 'admin_assign'))`,
        [own.caseId],
      ),
      query<{ created_at: Date; note: string }>(
        `SELECT created_at, note FROM sos_case_events
          WHERE case_id = $1 AND kind = 'reporter_update' ORDER BY created_at`,
        [own.caseId],
      ),
    ]);

    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    return {
      ok: true,
      data: {
        state: row.state,
        ackedAt: iso(row.acked_at),
        escalatedAt: iso(row.escalated_at),
        resolvedAt: iso(row.resolved_at),
        // Design v6.
        responderFirstName: row.acked_at ? firstName(row.acker_name, row.acker_show, row.acker_deleted) : null,
        takenAt: iso(row.acked_at),
        closeByAt: iso(row.close_by_at),
        arrivedAt: iso(row.arrived_at),
        outcome: row.outcome ?? null,
        vetName: row.vet_name ?? null,
        feedersNotifiedNames: paged.rows
          .map((f) => firstName(f.display_name, f.show_first_name, f.deleted_at))
          .filter((n): n is string => n !== null),
        feedersNotified: paged.rows.length,
        vetsNotified: vets.rows[0]?.n ?? 0,
        updates: updates.rows.map((u) => ({ at: u.created_at.toISOString(), note: u.note })),
        leftAt: iso(row.reporter_left_at),
      },
    };
  });

  /**
   * POST /api/v1/reports/:caseId/updates { note }: L7 "Send Priya an update".
   * The reporter's own case only (reporterCase), while it is not closed. The
   * note (<= 280) is shown to the people GET /sos/cases/:id admits and to the
   * reporter; it is never logged. Rate limited per device: burst 5, then 20 a
   * day.
   */
  app.post("/api/v1/reports/:caseId/updates", async (req: FastifyRequest, reply: FastifyReply) => {
    const own = await reporterCase(req, reply, reportUpdatePerSubject, "reportUpdatePerSubject");
    if (!own) return reply;
    const parsed = z.strictObject({ note: z.string().trim().min(1).max(280) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "body must be { note: 1 to 280 characters }", code: "INVALID_UPDATE" } });
    }
    const ins = await query<{ created_at: Date }>(
      `INSERT INTO sos_case_events (case_id, kind, note)
       SELECT $1, 'reporter_update', $2 FROM sos_cases WHERE id = $1 AND resolved_at IS NULL
       RETURNING created_at`,
      [own.caseId, parsed.data.note],
    );
    if (!ins.rows[0]) {
      return reply.status(409).send({ ok: false, error: { message: "the case is closed", code: "SOS_CASE_CLOSED" } });
    }
    return reply.status(201).send({ ok: true, data: { at: ins.rows[0].created_at.toISOString() } });
  });

  /**
   * POST /api/v1/reports/:caseId/left: "I had to leave". Tells the responder
   * not to expect the reporter at the spot. Idempotent; it changes nothing
   * about escalation.
   */
  app.post("/api/v1/reports/:caseId/left", async (req: FastifyRequest, reply: FastifyReply) => {
    const own = await reporterCase(req, reply, reportUpdatePerSubject, "reportUpdatePerSubject");
    if (!own) return reply;
    const res = await withTx(async (client) => {
      const upd = await client.query<{ reporter_left_at: Date }>(
        `UPDATE sos_cases SET reporter_left_at = now()
          WHERE id = $1 AND reporter_left_at IS NULL RETURNING reporter_left_at`,
        [own.caseId],
      );
      if (upd.rows[0]) {
        await client.query(`INSERT INTO sos_case_events (case_id, kind) VALUES ($1, 'reporter_left')`, [own.caseId]);
        return upd.rows[0].reporter_left_at;
      }
      const cur = await client.query<{ reporter_left_at: Date }>(`SELECT reporter_left_at FROM sos_cases WHERE id = $1`, [
        own.caseId,
      ]);
      return cur.rows[0].reporter_left_at;
    });
    return { ok: true, data: { leftAt: new Date(res).toISOString() } };
  });

  /**
   * GET /api/v1/sos/cases/:id: case state, BOUND to the people the case is
   * about (wave 7). It previously accepted any valid feeder token, so any
   * account could read any case: who acknowledged it, where it stands. A case
   * is now readable by exactly:
   *
   *   - the responder who acknowledged it (acked_by),
   *   - a responder paged for it (a sos_notifications row exists for them:
   *     the fan-out set; they were told about this dog and may be driving to
   *     it), or
   *   - a moderator (the `moderate` capability, admin today), who needs read
   *     access to arbitrate disputes and false-alarm reports, mirroring the
   *     resolve route below.
   *
   * requireFeeder (not a bare verifyAccessToken) because the binding needs the
   * caller's LIVE role anyway, and its FEEDER_GONE behaviour means a valid
   * token for an erased account reads nothing.
   */
  app.get("/api/v1/sos/cases/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    // Validate before the query: sos_cases.id is a uuid column, and binding a
    // non-UUID here raw raised 22P02 → 500. See lib/params.ts.
    const id = parseUuidParam((req.params as { id: string }).id);
    if (!id) {
      return reply.status(400).send({
        ok: false,
        error: { message: "case id must be a UUID", code: "INVALID_CASE_ID" },
      });
    }
    const res = await query<
      CaseRow & {
        acked_by: string | null;
        fanned_out: boolean;
        told_only: boolean;
        declined_by_me: boolean;
        ward_id: string | null;
        dog_id: string | null;
        slug: string | null;
        dog_name: string | null;
        dog_sex: string | null;
        reporter_anonymous: boolean;
        note: string | null;
        reporter_photo: string | null;
        portrait: string | null;
        avatar: string | null;
        acker_name: string | null;
        acker_show: boolean | null;
        acker_deleted: Date | null;
        paged: number;
        first_told: Date | null;
        vets_told: number;
        ngos_told: number;
        escalates_at: Date | null;
        outcome: string | null;
        vet_name: string | null;
        close_by_at: Date | null;
        arrived_at: Date | null;
        reporter_left_at: Date | null;
      }
    >(
      `SELECT c.id, c.severity, c.state, c.tier, c.opened_at, c.acked_at, c.escalated_at,
              c.resolved_at, c.resolution, c.acked_by, c.note, COALESCE(c.ward_id, d.ward_id) AS ward_id,
              d.id AS dog_id, d.slug, d.name AS dog_name, d.sex AS dog_sex,
              c.outcome, c.vet_name, c.close_by_at, c.arrived_at, c.reporter_left_at,
              (SELECT s.feeder_id IS NULL AND s.device_token IS NOT NULL FROM scans s WHERE s.id = c.scan_id)
                AS reporter_anonymous,
              EXISTS (SELECT 1 FROM sos_notifications n
                       WHERE n.case_id = c.id AND n.feeder_id = $2 AND ${N_IS_GROUND_SQL}) AS fanned_out,
              EXISTS (SELECT 1 FROM sos_notifications n
                       WHERE n.case_id = c.id AND n.feeder_id = $2 AND n.notify_only) AS told_only,
              EXISTS (SELECT 1 FROM sos_notifications n
                       WHERE n.case_id = c.id AND n.feeder_id = $2 AND n.declined_at IS NOT NULL) AS declined_by_me,
              (SELECT count(*)::int FROM sos_notifications n
                WHERE n.case_id = c.id AND n.channel = 'push' AND n.feeder_id IS NOT NULL AND n.route IS NULL) AS paged,
              (SELECT min(n.sent_at) FROM sos_notifications n
                WHERE n.case_id = c.id AND n.channel = 'push' AND n.feeder_id IS NOT NULL AND n.route IS NULL) AS first_told,
              (SELECT count(*)::int FROM sos_notifications n
                WHERE n.case_id = c.id AND n.delivered_at IS NOT NULL
                  AND ((n.vet_id IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM care_providers cp WHERE cp.vet_id = n.vet_id AND cp.kind = 'ngo'))
                       OR n.route IN ('vet_escalation', 'admin_assign')))
                AS vets_told,
              (SELECT count(*)::int FROM sos_notifications n
                WHERE n.case_id = c.id AND n.delivered_at IS NOT NULL
                  AND ((n.vet_id IS NOT NULL
                        AND EXISTS (SELECT 1 FROM care_providers cp WHERE cp.vet_id = n.vet_id AND cp.kind = 'ngo'))
                       OR n.route IN ('ngo_coordinator', 'ngo_dispatch')))
                AS ngos_told,
              (SELECT min(j.run_after) FROM jobs j
                WHERE j.kind = 'escalate_sos' AND j.failed_at IS NULL AND j.payload->>'caseId' = c.id::text)
                AS escalates_at,
              (SELECT s.photo_s3_key FROM scans s WHERE s.id = c.scan_id) AS reporter_photo,
              ${PORTRAIT_SQL} AS portrait, ${AVATAR_SQL} AS avatar,
              af.display_name AS acker_name, af.show_first_name AS acker_show, af.deleted_at AS acker_deleted
       FROM sos_cases c
       LEFT JOIN dogs d ON d.id = c.dog_id
       LEFT JOIN feeders af ON af.id = c.acked_by
       WHERE c.id = $1`,
      [id, auth.feederId],
    );
    const row = res.rows[0];
    if (!row) {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "case not found", code: "NOT_FOUND" } });
    }

    // Who may read the case. v5: the acker, a paged responder, a moderator.
    // v6 adds anyone with the standing to take it (lib/sos-eligibility.ts,
    // ward rule included): the map already hands such a feeder the case id
    // (routes/map.ts, `claimable`), and the ack route already lets them claim,
    // so the page between the two must open for them too.
    const isModerator = capabilitiesFor(auth.role).has("moderate");
    const severity = (["minor", "serious", "critical"].includes(row.severity) ? row.severity : "serious") as SosSeverity;
    const standingRes = await query<{
      sos_opt_in: boolean;
      trust_score: number;
      wards: string[];
      sos_paused_until: Date | null;
      suspended: boolean;
      vet_covers: boolean;
    }>(
      `SELECT sos_opt_in, trust_score, wards, sos_paused_until, suspended_at IS NOT NULL AS suspended,
              ${vetCoversWardSql("f.id", "$2::text")} AS vet_covers
         FROM feeders f WHERE f.id = $1`,
      [auth.feederId, row.ward_id],
    );
    const standing = standingRes.rows[0];
    const standingOk =
      !!standing &&
      canRespond(
        {
          sosOptIn: standing.sos_opt_in,
          trustScore: standing.trust_score,
          wards: standing.wards ?? [],
          pausedUntil: standing.sos_paused_until,
          suspended: standing.suspended,
        },
        severity,
        row.ward_id,
      );
    const isAcker = row.acked_by === auth.feederId;
    const vetCovers = standing?.vet_covers === true && !standing.suspended;
    if (!isAcker && !row.fanned_out && !isModerator && !standingOk && !vetCovers) {
      // 403 rather than 404 on purpose: the caller is authenticated and the
      // case exists, so saying NOT_FOUND would be its own small lie.
      //
      // Design v6 (V22): the refusal says why, as the CALLER's OWN standing
      // against the rule (opt-in, pause, wards, trust against this severity's
      // floor). Nothing about the case beyond the floor its severity implies.
      const wards = standing?.wards ?? [];
      const inMyWards = wards.length === 0 ? null : row.ward_id != null && wards.includes(row.ward_id);
      const trustScore = standing?.trust_score ?? 0;
      const floor = TRUST_FLOOR[severity];
      const paused = !!standing?.sos_paused_until && standing.sos_paused_until.getTime() > Date.now();
      // Order: the first thing the feeder would have to change. "not_paged"
      // remains for completeness; with every standing condition met the
      // caller is admitted above, so in practice one of the others applies.
      const forbiddenReason = !standing?.sos_opt_in
        ? "not_opted_in"
        : paused
          ? "paused"
          : inMyWards === false
            ? "outside_wards"
            : trustScore < floor
              ? "not_enough_trust"
              : "not_paged";
      return reply.status(403).send({
        ok: false,
        error: {
          message: "case is visible only to its acker, the responders paged for it, or a moderator",
          code: "SOS_CASE_FORBIDDEN",
        },
        data: {
          forbiddenReason,
          // A feeder of the dog who was TOLD (notify_only, below the trust
          // floor) and opens it from that push gets the V22 reassurance plus
          // what the reporter already shares with the dog's feeders: the dog,
          // severity, ward and time. Never the note, the photo or the spot.
          ...(row.told_only
            ? {
                summary: {
                  dog: row.slug ? { slug: row.slug, name: row.dog_name ?? null } : null,
                  severity: row.severity,
                  wardId: row.ward_id ?? null,
                  openedAt: new Date(row.opened_at).toISOString(),
                  state: row.state,
                },
              }
            : {}),
          // V22 "This case went to feeders in H/W": the ward, nothing finer.
          wardId: row.ward_id ?? null,
          wardCode: row.ward_id ? wardDisplay(row.ward_id).code : null,
          checklist: {
            sosOptIn: standing?.sos_opt_in ?? false,
            paused,
            inMyWards,
            trustScore,
            trustFloor: floor,
            feedsToGo: Math.max(0, floor - trustScore),
          },
        },
      });
    }

    // Design v5 (N2) and v6 (P9, L4, L5, V21). Everything below is for the
    // people admitted above. On top of that:
    //
    //   location     the case's point, EXACT, and ONLY to the caller who acked
    //                it ("The exact spot unlocks when you tap I'm going"): the
    //                dog's last recorded position, or for a dogless case the
    //                reporter's. A paged responder deciding whether to go, or a
    //                moderator, gets the ward and nothing finer (INVARIANT 2's
    //                reasoning: a precise point for a dog is a precise point
    //                for the people who feed it).
    //   distanceM    from the caller's own last geotagged scan to that point,
    //                rounded to 100 m, and only for a caller who could take the
    //                case (acker, paged, or standing). A distance to a point
    //                the caller chose is not the point; a moderator without
    //                standing gets null.
    //   nearestCare  the nearest listed provider: a published organisation's
    //                name and number (INVARIANT 3 is about people, not clinics).
    //
    // respondingName is the acker's public name (first name and initial, for
    // signed-in viewers); the timeline's "taken" line uses the first name only
    // and respects the acker's opt-out; the reporter is never identified.
    //
    // SECURITY-GATE: public-coordinates -- exact case position, acker only.
    const geoRes = await query<{ lat: number | null; lng: number | null; my_distance: number | null }>(
      `SELECT ST_Y(p.at::geometry) AS lat, ST_X(p.at::geometry) AS lng,
              (SELECT ST_Distance(s.geo, p.at) FROM scans s
                WHERE s.feeder_id = $2 AND s.geo IS NOT NULL
                ORDER BY s.received_at DESC LIMIT 1) AS my_distance
         FROM (SELECT COALESCE(d.last_seen_geo, c.geo) AS at
                 FROM sos_cases c LEFT JOIN dogs d ON d.id = c.dog_id WHERE c.id = $1) p`,
      [id, auth.feederId],
    );
    const geo = geoRes.rows[0];
    const lat = geo?.lat ?? null;
    const lng = geo?.lng ?? null;
    const care = lat != null && lng != null ? await getNearbyCare(lat, lng) : [];
    const nearest = care.find((c) => c.phoneE164) ?? care[0] ?? null;
    const eligible = isAcker || row.fanned_out || standingOk || vetCovers;
    const distanceM =
      eligible && geo?.my_distance != null ? Math.round(Number(geo.my_distance) / 100) * 100 : null;

    const events = await query<{ kind: string; note: string | null; created_at: Date }>(
      `SELECT kind, note, created_at FROM sos_case_events WHERE case_id = $1 ORDER BY created_at`,
      [id],
    );
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    const ackerFirst = row.acked_by ? firstName(row.acker_name, row.acker_show, row.acker_deleted) : null;
    const open = row.resolved_at === null && row.escalated_at === null && row.state === "open";
    const timeline: { at: string; kind: string; detail: string | null }[] = [
      { at: iso(row.opened_at)!, kind: "raised", detail: row.severity },
    ];
    if (row.first_told) {
      timeline.push({ at: iso(row.first_told)!, kind: "told", detail: `${row.paged} ${row.paged === 1 ? "feeder" : "feeders"}` });
    }
    if (open && row.escalates_at) timeline.push({ at: iso(row.escalates_at)!, kind: "escalation_due", detail: null });
    if (row.escalated_at) {
      const told = row.vets_told + row.ngos_told;
      timeline.push({ at: iso(row.escalated_at)!, kind: "escalated", detail: told > 0 ? `${told} vets and NGOs` : null });
    }
    if (row.acked_at) timeline.push({ at: iso(row.acked_at)!, kind: "taken", detail: ackerFirst });
    for (const e of events.rows) {
      timeline.push({
        at: e.created_at.toISOString(),
        kind: e.kind,
        detail: e.kind === "reporter_update" ? e.note : null,
      });
    }
    if (row.resolved_at) timeline.push({ at: iso(row.resolved_at)!, kind: "resolved", detail: row.outcome ?? row.state });
    timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    return {
      ok: true,
      data: {
        id: row.id,
        severity: row.severity,
        state: row.state,
        tier: row.tier,
        openedAt: new Date(row.opened_at).toISOString(),
        ackedAt: iso(row.acked_at),
        escalatedAt: iso(row.escalated_at),
        resolvedAt: iso(row.resolved_at),
        resolution: row.resolution ?? null,
        // Ward-level only (INVARIANT 2), for the /sos/[caseId] page's
        // "see it on the map" link. Never a position.
        wardId: row.ward_id ?? null,
        wardName: wardName(row.ward_id),
        // The caller holds this case (they acknowledged it): the web
        // /sos/[caseId] page shows Resolve only then.
        mine: isAcker,
        dog: row.slug
          ? {
              slug: row.slug,
              name: row.dog_name ?? null,
              sex: dogSex(row.dog_sex),
              photoUrl: photoUrlFor(req, row.portrait),
              avatarUrl: photoUrlFor(req, row.avatar),
            }
          : null,
        dogAvatarUrl: row.slug ? photoUrlFor(req, row.avatar) : null,
        // "Sent by a passer-by, no account": the SOS scan carried a device
        // token and no feeder account. Who it was is never said (INVARIANT 3).
        reporterAnonymous: row.reporter_anonymous === true,
        reporterPhotoUrl: photoUrlFor(req, row.reporter_photo),
        note: row.note ?? null,
        respondingName: row.acked_by ? publicName(row.acker_name, row.acker_deleted) : null,
        respondersPaged: row.paged,
        nearestCare: nearest ? { name: nearest.name, phoneE164: nearest.phoneE164 } : null,
        declinedByMe: row.declined_by_me,
        location: isAcker && lat != null && lng != null ? { lat, lng } : null,
        // Design v6.
        dogless: row.dog_id === null,
        timeline,
        // A paged feeder's account HAS the alert (it is in their Alerts list,
        // built from these rows), whether or not a push reached a phone, so
        // they count as told. Vets and NGOs count only once a notification
        // was actually delivered (the tier-2 sms/bmc rows are not yet sent by
        // anything, so today they count as zero rather than as a claim).
        feedersTold: row.paged,
        vetsTold: row.vets_told,
        ngosTold: row.ngos_told,
        escalatesAt: open ? iso(row.escalates_at) : null,
        distanceM,
        outcome: row.outcome ?? null,
        vetName: row.vet_name ?? null,
        closeByAt: iso(row.close_by_at),
        arrivedAt: iso(row.arrived_at),
        reporterUpdates: events.rows
          .filter((e) => e.kind === "reporter_update" && e.note)
          .map((e) => ({ at: e.created_at.toISOString(), note: e.note as string })),
        reporterLeftAt: iso(row.reporter_left_at),
      },
    };
  });

  /**
   * POST /api/v1/sos/cases/:id/decline: N2 "I can't go right now".
   *
   * Stamps the caller's OWN page for the case as declined, and nothing else.
   * It NEVER affects escalation: the worker's escalate_sos promotes on
   * `state = 'open' AND acked_by IS NULL` and does not read declined_at, so
   * even every paged responder declining leaves the case to escalate on its
   * timer exactly as silence would. Only a responder who was paged has a page
   * to decline (403 otherwise). Idempotent.
   */
  app.post("/api/v1/sos/cases/:id/decline", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (
      !enforceLimits(req.log, reply, [
        { limiter: feederWritePerAccount, key: `acct:${auth.feederId}`, name: "feederWritePerAccount", kind: "account" },
      ])
    ) {
      return reply;
    }
    const id = parseUuidParam((req.params as { id: string }).id);
    if (!id) {
      return reply.status(400).send({
        ok: false,
        error: { message: "case id must be a UUID", code: "INVALID_CASE_ID" },
      });
    }
    const res = await query(
      `UPDATE sos_notifications SET declined_at = COALESCE(declined_at, now())
        WHERE case_id = $1 AND feeder_id = $2 AND channel = 'push'`,
      [id, auth.feederId],
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.status(403).send({
        ok: false,
        error: { message: "only a responder paged for this case can decline it", code: "SOS_CASE_FORBIDDEN" },
      });
    }
    return { ok: true, data: { declined: true } };
  });

  /**
   * POST /api/v1/sos/cases/:id/resolve { resolution, outcome? }: close a
   * case (wave 7).
   *
   * resolved_at / resolution / state ∈ ('resolved','false_alarm') were columns
   * NOTHING wrote: cases could ack and escalate but never finish, so the case
   * machine had no terminal state and every "open cases" metric counted
   * forever. Who may resolve is deliberately narrow: the responder who
   * ACKNOWLEDGED the case (they went out there; their word is what closes it)
   * or a `moderate` holder (admin) resolving unclaimed or disputed cases.
   * The anonymous reporter has no standing here: reports can be filed with no
   * account at all, so "reporter" is not always an identity that can hold a
   * permission.
   *
   * outcome defaults to 'resolved'; 'false_alarm' exists for cases where the
   * report did not correspond to a real emergency. Either way resolved_at is
   * stamped. Both are terminal states, and a closed case must LOOK closed.
   *
   * A retry after success is idempotent (same contract as the ack above): the
   * stored truth is returned rather than a 409, because a flaky-network resend
   * of a resolution is not an error the client needs to distinguish.
   */
  app.post("/api/v1/sos/cases/:id/resolve", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    // Same 22P02 → 500 guard as the GET above (see lib/params.ts).
    const id = parseUuidParam((req.params as { id: string }).id);
    if (!id) {
      return reply.status(400).send({
        ok: false,
        error: { message: "case id must be a UUID", code: "INVALID_CASE_ID" },
      });
    }

    // Design v6 (P11) outcomes: taken_to_vet (with an optional vetName),
    // treated_on_spot, not_found, died. They close the case as 'resolved';
    // the v5 values keep working, and `resolution` becomes optional (it
    // defaults to the outcome). `died` also opens the N9 passed-away status
    // report for the dog, so a second feeder confirms it before the dog's
    // page becomes a memorial: one responder's word does not do that alone.
    const parsed = z
      .object({
        resolution: z.string().min(1).max(500).optional(),
        outcome: z
          .enum(["resolved", "false_alarm", "taken_to_vet", "treated_on_spot", "not_found", "died"])
          .default("resolved"),
        vetName: z.string().trim().min(1).max(80).optional(),
      })
      // Still no silent close: a body must say either what happened (an
      // outcome) or a resolution in words.
      .refine(
        (b) => b.resolution !== undefined || (req.body as { outcome?: unknown } | undefined)?.outcome !== undefined,
        { message: "outcome or resolution required" },
      )
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          message:
            "body must be { outcome?: taken_to_vet | treated_on_spot | not_found | died | resolved | false_alarm, resolution?: string, vetName?: string }",
          code: "INVALID_SOS_RESOLUTION",
        },
      });
    }
    const outcomeValue = parsed.data.outcome;
    const outcome = outcomeValue === "false_alarm" ? "false_alarm" : "resolved";
    const resolution = parsed.data.resolution ?? outcomeValue.replace(/_/g, " ");
    const vetName = outcomeValue === "taken_to_vet" ? (parsed.data.vetName ?? null) : null;

    const isModerator = capabilitiesFor(auth.role).has("moderate");

    const result = await withTx(async (client) => {
      // Conditional UPDATE as the whole mechanism, same idiom as the ack:
      // only a not-yet-resolved case the caller is entitled to closes here.
      const upd = await client.query<{ state: string; resolved_at: Date; resolution: string; dog_id: string | null }>(
        `UPDATE sos_cases
            SET state = $2::case_state, resolved_at = now(), resolution = $3, outcome = $6, vet_name = $7
          WHERE id = $1
            AND resolved_at IS NULL
            AND state IN ('open', 'acked', 'escalated')
            AND (acked_by = $4 OR $5)
          RETURNING state, resolved_at, resolution, dog_id`,
        [id, outcome, resolution, auth.feederId, isModerator, outcomeValue, vetName],
      );
      if (upd.rows[0] && outcomeValue === "died" && upd.rows[0].dog_id) {
        // N9: a pending passed-away report, unless one is already pending.
        await client.query(
          `INSERT INTO dog_status_reports (dog_id, kind, reported_by)
           SELECT d.id, 'passed_away', $2 FROM dogs d
            WHERE d.id = $1 AND d.status IN ('active', 'lost')
              AND NOT EXISTS (SELECT 1 FROM dog_status_reports r
                               WHERE r.dog_id = d.id AND r.kind = 'passed_away' AND r.confirmed_at IS NULL
                                 AND r.created_at >= now() - interval '30 days')`,
          [upd.rows[0].dog_id, auth.feederId],
        );
      }
      if (upd.rows[0]) {
        return {
          status: "resolved" as const,
          state: upd.rows[0].state,
          resolvedAt: upd.rows[0].resolved_at,
          resolution: upd.rows[0].resolution,
        };
      }

      // Zero rows: classify honestly instead of guessing between the three
      // distinct reasons the predicate can fail.
      const cur = await client.query<{
        acked_by: string | null;
        resolved_at: Date | null;
        state: string;
        resolution: string | null;
      }>(`SELECT acked_by, resolved_at, state, resolution FROM sos_cases WHERE id = $1`, [id]);
      const row = cur.rows[0];
      if (!row) return { status: "not_found" as const };
      if (row.resolved_at != null) {
        if (row.acked_by === auth.feederId || isModerator) {
          return {
            status: "resolved" as const,
            state: row.state,
            resolvedAt: row.resolved_at,
            resolution: row.resolution ?? "",
          };
        }
        return { status: "forbidden" as const };
      }
      return { status: "forbidden" as const };
    });

    if (result.status === "not_found") {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "case not found", code: "NOT_FOUND" } });
    }
    if (result.status === "forbidden") {
      return reply.status(403).send({
        ok: false,
        error: {
          message: "only the acknowledging responder or a moderator may resolve a case",
          code: "SOS_RESOLVE_FORBIDDEN",
        },
      });
    }

    const stored = await query<{ outcome: string | null }>(`SELECT outcome FROM sos_cases WHERE id = $1`, [id]);
    return {
      ok: true,
      data: {
        id,
        state: result.state,
        resolvedAt: new Date(result.resolvedAt).toISOString(),
        resolution: result.resolution,
        outcome: stored.rows[0]?.outcome ?? result.state,
      },
    };
  });

  /**
   * Design v6 case lifecycle, all for the ACKER only (403 otherwise), all
   * idempotent, all per-account rate limited (feederWritePerAccount).
   *
   * POST /sos/cases/:id/release: P10 "I can't make it after all". The case goes
   * back to 'open' with no acker, close-by and arrival cleared, a 'released'
   * event on the timeline, and the paged responders are paged again
   * (send_sos_push with repage, the releaser excepted). The ESCALATION CLOCK IS
   * UNCHANGED: escalation is still due at the original time (opened + 8 min,
   * or now if that has passed and the job already ran while the case was
   * held), never restarted by a release. A release is also what an abuser
   * would use to hold and drop cases, so it counts against the same account
   * budget as every other v6 write.
   * POST /sos/cases/:id/arrived:  V21 "With Rani".
   * POST /sos/cases/:id/close-by: "Tell the reporter you're close".
   */
  const ackerAction = async (
    req: FastifyRequest,
    reply: FastifyReply,
    act: (client: TxClient, id: string, feederId: string) => Promise<Record<string, unknown> | null>,
  ) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (
      !enforceLimits(req.log, reply, [
        { limiter: feederWritePerAccount, key: `acct:${auth.feederId}`, name: "feederWritePerAccount", kind: "account" },
      ])
    ) {
      return reply;
    }
    const id = parseUuidParam((req.params as { id: string }).id);
    if (!id) {
      return reply.status(400).send({ ok: false, error: { message: "case id must be a UUID", code: "INVALID_CASE_ID" } });
    }
    const out = await withTx(async (client) => {
      const cur = await client.query<{ acked_by: string | null; resolved_at: Date | null }>(
        `SELECT acked_by, resolved_at FROM sos_cases WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const c = cur.rows[0];
      if (!c) return { status: 404 as const };
      if (c.acked_by !== auth.feederId) return { status: 403 as const };
      if (c.resolved_at) return { status: 409 as const };
      return { status: 200 as const, data: await act(client, id, auth.feederId) };
    });
    if (out.status === 404) {
      return reply.status(404).send({ ok: false, error: { message: "case not found", code: "NOT_FOUND" } });
    }
    if (out.status === 403) {
      return reply.status(403).send({
        ok: false,
        error: { message: "only the responder who took this case can do this", code: "SOS_NOT_ACKER" },
      });
    }
    if (out.status === 409) {
      return reply.status(409).send({ ok: false, error: { message: "the case is closed", code: "SOS_CASE_CLOSED" } });
    }
    return { ok: true, data: { id, ...(out.data ?? {}) } };
  };

  app.post("/api/v1/sos/cases/:id/release", (req, reply) =>
    ackerAction(req, reply, async (client, id, feederId) => {
      await releaseCase(client, id, feederId);
      return { state: "open" };
    }),
  );

  app.post("/api/v1/sos/cases/:id/arrived", (req, reply) =>
    ackerAction(req, reply, async (client, id, feederId) => {
      const r = await client.query<{ arrived_at: Date; fresh: boolean }>(
        `UPDATE sos_cases SET arrived_at = COALESCE(arrived_at, now())
          WHERE id = $1 RETURNING arrived_at, (arrived_at = now()) AS fresh`,
        [id],
      );
      if (r.rows[0].fresh) {
        await client.query(`INSERT INTO sos_case_events (case_id, kind, feeder_id) VALUES ($1, 'arrived', $2)`, [
          id,
          feederId,
        ]);
      }
      return { arrivedAt: r.rows[0].arrived_at.toISOString() };
    }),
  );

  app.post("/api/v1/sos/cases/:id/close-by", (req, reply) =>
    ackerAction(req, reply, async (client, id, feederId) => {
      const r = await client.query<{ close_by_at: Date; fresh: boolean }>(
        `UPDATE sos_cases SET close_by_at = COALESCE(close_by_at, now())
          WHERE id = $1 RETURNING close_by_at, (close_by_at = now()) AS fresh`,
        [id],
      );
      if (r.rows[0].fresh) {
        await client.query(`INSERT INTO sos_case_events (case_id, kind, feeder_id) VALUES ($1, 'close_by', $2)`, [
          id,
          feederId,
        ]);
      }
      return { closeByAt: r.rows[0].close_by_at.toISOString() };
    }),
  );

  /**
   * POST /api/v1/sos/cases/:id/ack: first writer wins (plan §3.1).
   *
   * A conditional UPDATE (`WHERE acked_by IS NULL AND resolved_at IS NULL`) is
   * the whole mechanism: only the first feeder to reach a still-open row claims
   * the case. Everyone else's UPDATE affects zero rows, and -- if that
   * responder was one of the ones fanned out to -- their own sos_notifications
   * row is marked stood_down so the receipt reflects reality; the claimant's
   * row is never touched. A retry from the same claimant (e.g. a flaky-network
   * resend) is treated as idempotent success, not a steal attempt against
   * themselves.
   *
   * `resolved_at IS NULL` is load-bearing. The predicate used to be
   * `acked_by IS NULL` alone, and a moderator can resolve a case NOBODY
   * acknowledged (false alarm, or closed from the desk). Such a row has
   * acked_by NULL and resolved_at set. An ack arriving afterwards then matched,
   * stamped acked_by/acked_at and set `state = 'acked'`, silently REOPENING a
   * closed case: its terminal state overwritten, the case machine walked
   * backwards, and every "open cases" metric counting a case a human had
   * already finished with. A closed case now answers 409 SOS_CASE_CLOSED.
   *
   * requireFeeder (live role read) rather than a bare verifyAccessToken, for
   * the same reason the GET and resolve routes use it: a still-valid token for
   * an erased account must not be able to claim a case (FEEDER_GONE).
   *
   * This is the piece that made the ack metric (p50 < 5min / p90 < 8min)
   * uncomputable before: acked_by/acked_at were columns nothing ever wrote.
   */
  app.post("/api/v1/sos/cases/:id/ack", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const feederId = auth.feederId;

    // Per account (hardening batch 1, T1): burst 5, 10 a day. After auth,
    // before the case id is even parsed, so probing ids costs budget.
    const ackBudget = sosAckPerAccount.consume(`acct:${feederId}`);
    if (!ackBudget.allowed) {
      logRateLimited(req.log, "sosAckPerAccount", "account");
      return reply
        .status(429)
        .header("retry-after", String(ackBudget.retryAfterSec))
        .send({ ok: false, error: { message: "too many acknowledgements; try again later", code: "RATE_LIMITED" } });
    }
    const isModerator = capabilitiesFor(auth.role).has("moderate");

    // Same 22P02 → 500 guard as the GET above (see lib/params.ts).
    const id = parseUuidParam((req.params as { id: string }).id);
    if (!id) {
      return reply.status(400).send({
        ok: false,
        error: { message: "case id must be a UUID", code: "INVALID_CASE_ID" },
      });
    }

    const outcome = await withTx(async (client) => {
      // ELIGIBILITY (hardening batch 1, T1, audit A-01). Checked inside the
      // transaction, under the case row lock, BEFORE the claim UPDATE:
      //
      //   1. the existing acker retrying          -> idempotent success
      //   2. otherwise the caller must have been paged for this case, or be a
      //      moderator, or have the standing that would have got them paged
      //      (sos_opt_in AND trust >= TRUST_FLOOR[severity])  -> else 403
      //   3. a non-moderator already holding MAX_OPEN_ACKS acknowledged,
      //      unresolved cases may not take another       -> 409
      //
      // The claim is what stops escalation (the worker only promotes
      // state = 'open'), so "signed in" was never enough to hold it.
      const caseRes = await client.query<{
        severity: SosSeverity;
        acked_by: string | null;
        acked_at: Date | null;
        resolved_at: Date | null;
        ward_id: string | null;
      }>(
        `SELECT c.severity::text AS severity, c.acked_by, c.acked_at, c.resolved_at,
                COALESCE(c.ward_id, (SELECT d.ward_id FROM dogs d WHERE d.id = c.dog_id)) AS ward_id
           FROM sos_cases c WHERE c.id = $1 FOR UPDATE OF c`,
        [id],
      );
      const current = caseRes.rows[0];
      if (!current) return { status: "not_found" as const };
      if (current.acked_by === feederId) {
        // Same responder retrying: idempotent success, not a steal attempt
        // against their own claim. Holds for a resolved case too.
        return { status: "claimed" as const, ackedAt: current.acked_at as Date };
      }

      const standing = await client.query<{
        sos_opt_in: boolean;
        trust_score: number;
        wards: string[];
        sos_paused_until: Date | null;
        notified: boolean;
        suspended: boolean;
        vet_covers: boolean;
      }>(
        `SELECT f.sos_opt_in, f.trust_score, f.wards, f.sos_paused_until, f.suspended_at IS NOT NULL AS suspended,
                ${vetCoversWardSql("f.id", "$3::text")} AS vet_covers,
                -- A notify_only row (0028) is being told, not a ground to take it;
                -- nor is a suspended vet's vet page (design v7, lib/sos-eligibility.ts).
                EXISTS (SELECT 1 FROM sos_notifications n
                         WHERE n.case_id = $2 AND n.feeder_id = f.id AND ${N_IS_GROUND_SQL}) AS notified
           FROM feeders f WHERE f.id = $1`,
        [feederId, id, current.ward_id],
      );
      const me = standing.rows[0];
      // Design v5: the ward rule is part of standing (lib/sos-eligibility.ts),
      // so a feeder who chose wards may claim by standing only inside them,
      // the same set the fan-out would have paged them for. Being paged or a
      // moderator still suffices on its own.
      const eligible =
        !!me &&
        mayAck(
          {
            sosOptIn: me.sos_opt_in,
            trustScore: me.trust_score,
            wards: me.wards ?? [],
            pausedUntil: me.sos_paused_until,
            notified: me.notified,
            moderator: isModerator,
            suspended: me.suspended,
            vetCoversWard: me.vet_covers,
          },
          current.severity,
          current.ward_id,
        );
      if (!eligible) return { status: "forbidden" as const };

      if (current.resolved_at === null && current.acked_by === null && !isModerator) {
        const open = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM sos_cases
            WHERE acked_by = $1 AND resolved_at IS NULL AND state IN ('open', 'acked', 'escalated')`,
          [feederId],
        );
        if ((open.rows[0]?.n ?? 0) >= MAX_OPEN_ACKS) return { status: "too_many_open" as const };
      }

      const claim = await client.query<{ acked_at: Date }>(
        `UPDATE sos_cases SET acked_by = $1, acked_at = now(), state = 'acked'
         WHERE id = $2 AND acked_by IS NULL AND resolved_at IS NULL
         RETURNING acked_at`,
        [feederId, id],
      );
      const claimedRow = claim.rows[0];
      if (claimedRow) {
        await client.query(
          `UPDATE sos_notifications SET acked_at = now() WHERE case_id = $1 AND feeder_id = $2`,
          [id, feederId],
        );
        // Design v7 (N3): a member an NGO sent who taps the ordinary "I'm
        // going" has accepted that dispatch, exactly as /ngo/dispatches/:id/accept.
        await client.query(
          `UPDATE sos_dispatches SET accepted_at = now(), declined_at = NULL
            WHERE case_id = $1 AND member_feeder_id = $2 AND accepted_at IS NULL`,
          [id, feederId],
        );
        return { status: "claimed" as const, ackedAt: claimedRow.acked_at };
      }

      const existing = await client.query<{
        acked_by: string | null;
        acked_at: Date | null;
        resolved_at: Date | null;
      }>(`SELECT acked_by, acked_at, resolved_at FROM sos_cases WHERE id = $1`, [id]);
      const existingRow = existing.rows[0];
      if (!existingRow) {
        return { status: "not_found" as const };
      }
      if (existingRow.acked_by === feederId) {
        // Same responder retrying -- idempotent success, not a steal
        // attempt against their own claim. Holds for a resolved case too: the
        // acker's own resend after they closed it is still their claim.
        return { status: "claimed" as const, ackedAt: existingRow.acked_at as Date };
      }
      if (existingRow.resolved_at !== null) {
        // Closed without this responder ever owning it. Nothing to claim and
        // nothing to stand down. The case is finished, and saying so beats a
        // misleading "already claimed" when nobody ever acked it.
        return { status: "closed" as const };
      }

      // Someone else already owns this case. Stand this responder's own
      // notification down (a no-op if they were never fanned out to); the
      // claimant's row above is never touched.
      await client.query(
        `UPDATE sos_notifications SET stood_down = TRUE WHERE case_id = $1 AND feeder_id = $2`,
        [id, feederId],
      );
      return { status: "already_claimed" as const };
    });

    if (outcome.status === "not_found") {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "case not found", code: "NOT_FOUND" } });
    }
    if (outcome.status === "forbidden") {
      return reply.status(403).send({
        ok: false,
        error: {
          message:
            "only a responder paged for this case, one opted in with enough trust for its severity, or a moderator may acknowledge it",
          code: "SOS_ACK_FORBIDDEN",
        },
      });
    }
    if (outcome.status === "too_many_open") {
      return reply.status(409).send({
        ok: false,
        error: {
          message: `you already hold ${MAX_OPEN_ACKS} open cases; resolve one before taking another`,
          code: "SOS_TOO_MANY_OPEN_ACKS",
        },
      });
    }
    if (outcome.status === "already_claimed") {
      return reply
        .status(409)
        .send({
          ok: false,
          error: { message: "case already claimed by another responder", code: "SOS_ALREADY_ACKED" },
        });
    }
    if (outcome.status === "closed") {
      return reply.status(409).send({
        ok: false,
        error: { message: "case is already resolved and cannot be acknowledged", code: "SOS_CASE_CLOSED" },
      });
    }

    return {
      ok: true,
      data: { id, ackedBy: feederId, ackedAt: new Date(outcome.ackedAt).toISOString() },
    };
  });
}
