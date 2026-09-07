/**
 * Hetja SOS — report + case state routes.
 *
 * POST /api/v1/reports        — anon-attested (device token, INVARIANT 7 caps)
 *                                OR feeder-authed (Bearer access token). Opens a
 *                                sos_case at tier 1. Severity routing:
 *                                minor/serious wait for validation before fan-out
 *                                (validation pipeline is out of Phase-0 scope, so
 *                                no responders are notified at report time);
 *                                critical fans out immediately via the canonical
 *                                query in docs/queries/sos_fanout.sql — but ONLY
 *                                when dogs.sos_eligible_at IS NOT NULL (wave 7:
 *                                corroboration gates responder paging, never the
 *                                report itself or nearbyCare). Every response
 *                carries `fanout`: "responders" when the responder fan-out is
 *                what owns this case's notification, "escalated" when it is not.
 *                The escalate_sos job runs at now() instead of +8 min whenever
 *                responders were NOT paged at report time on a critical case —
 *                there is no one to wait eight minutes for.
 * GET  /api/v1/sos/cases/:id   — feeder-authed case state, visible only to the
 *                acker, the responders paged for it, or a moderator.
 * POST /api/v1/sos/cases/:id/ack     — first writer wins (below).
 * POST /api/v1/sos/cases/:id/resolve — closes a case (acker or moderator).
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SLUG_REGEX, type SosSeverity } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { deviceTokenSubject } from "../lib/device.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { parseUuidParam } from "../lib/params.js";
import { capabilitiesFor, requireFeeder } from "../lib/require-role.js";
import { getNearbyCare } from "./care.js";

// INVARIANT 7 — anonymous SOS is capped per attested device token.
const SOS_DAILY_CAP = 2;
const SOS_WEEKLY_CAP = 5;

const SosReportInput = z.object({
  dogSlug: z.string().regex(SLUG_REGEX),
  severity: z.enum(["minor", "serious", "critical"]),
  note: z.string().max(500).optional(),
  deviceToken: z.string().min(1).max(256).optional(),
});

class SosRateLimitError extends Error {
  constructor() {
    super("sos report rate cap exceeded");
    this.name = "SosRateLimitError";
  }
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
}

/**
 * What owns this case's responder notification, reported as `fanout` in every
 * POST /api/v1/reports response:
 *
 *   "responders" — the responder fan-out ran for this case (it was critical
 *                  AND the dog was corroborated). `tier` then says whether it
 *                  found anyone: 1 = responders paged, 2 = the set came back
 *                  empty and escalation took over immediately.
 *   "escalated"  — responder paging did NOT run at report time: the dog is
 *                  uncorroborated (paging gated off), or the severity defers
 *                  to validation. The escalation channel owns notification.
 *
 * The field exists because tier alone cannot distinguish "paging was gated
 * off" from "paging ran and found nobody nearby" — two states that need
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
 * feeders.last_known_geo — a column NOTHING ever wrote, so it returned zero
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
 * feeders.last_known_geo / feeders.last_seen_at — both are dead by decision,
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
): Promise<boolean> {
  if (lat == null || lng == null) {
    await client.query(`UPDATE sos_cases SET tier = 2 WHERE id = $1`, [caseId]);
    return false;
  }
  const trustFloor = severity === "critical" ? 60 : 40;
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
       AND f.trust_score >= $2
       AND recent.last_nearby_scan IS NOT NULL
     ORDER BY f.trust_score DESC, recent.last_nearby_scan DESC
     LIMIT 15`,
    [geoWkt(lat, lng), trustFloor],
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

export default async function sosRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/reports", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SosReportInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid sos report", code: "INVALID_SOS_REPORT" } });
    }
    const { dogSlug, severity, note, deviceToken } = parsed.data;

    // INVARIANT 6/7: `deviceSubject` — the canonical deviceId the token
    // attests — is the rate-limit subject, and the ONLY device-derived value
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

    // INVARIANT 5: deterministic client_uuid → replay of the same report is
    // idempotent (a re-submit while a case is open/acked never double-opens).
    // Keyed on `deviceSubject`, not the token string, for the same reason the
    // cap below is: otherwise re-encoding the token also defeats the dedupe,
    // and one held report re-submits as an unbounded family of new cases.
    // Feeder-authed reports key on the ACCOUNT instead — before wave 7 two
    // different feeders reporting the same dog with the same words produced
    // the same key, and the second feeder was silently handed the first one's
    // live case as a "replay".
    const dedupeKey = deterministicUuid(
      "sos-report",
      // Feeder identity wins over device deliberately: accounts sharing one
      // phone (an NGO field phone, say) must not collide into each other's
      // cases, while one account reporting from two devices SHOULD collapse —
      // it is the account that holds the cap and the standing.
      [feederId ?? deviceSubject ?? "", dogSlug, severity, note ?? ""].join("|"),
    );

    interface ReportOutcome {
      created: boolean;
      caseId: string;
      tier: number;
      fanout: FanoutDisposition;
    }
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
          // the responder fan-out ran for it. Channel matters — escalated
          // cases accumulate sms/bmc rows from the worker, which say nothing
          // about responder paging.
          const paged = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM sos_notifications
             WHERE case_id = $1 AND channel = 'push'`,
            [replay.id],
          );
          return {
            created: false,
            caseId: replay.id,
            tier: replay.tier,
            fanout: paged.rows[0].n > 0 ? "responders" : "escalated",
          };
        }

        // INVARIANT 7 — SOS caps, rolling windows. `$1`/subject differs by
        // caller kind and NEVER derives from the IP (INVARIANT 6):
        //
        //   anon   — the canonical deviceId the token attests (`deviceSubject`).
        //            Not `deviceToken` as submitted: the token string is not a
        //            canonical name for a device (see the comment above), so
        //            keying on it let each re-encoding mint a fresh budget.
        //   authed — the feeder account. Wave 7: authenticated callers were
        //            previously exempt from every cap, which INVARIANT 6 does
        //            not license ("per account OR per device") — an signed-in
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
        // that path open cases without ever touching the cap — one held report
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
        const dogRes = await client.query<DogRow>(
          `SELECT id, ST_Y(last_seen_geo::geometry) AS lat, ST_X(last_seen_geo::geometry) AS lng,
                  sos_eligible_at
           FROM dogs WHERE slug = $1`,
          [dogSlug],
        );
        const dog = dogRes.rows[0];
        if (!dog) throw new SosDogNotFoundError();

        // scans.device_token stores the canonical deviceId, NOT the bearer
        // token. Two consequences worth stating: the cap query above can no
        // longer be defeated by re-encoding the token string, and a database
        // leak no longer hands out replayable attested tokens, because the
        // HMAC half is not stored. Existing rows hold whole raw tokens; the
        // caps are rolling 1-day/7-day windows, so those age out on their own
        // and no migration is required (see docs/INVARIANTS.md #7).
        //
        // feeder_id records the account behind a Bearer-authed report — the
        // per-account cap above counts these rows, and corroboration's
        // distinct-subject count treats the account as one subject.
        const scanRes = await client.query<{ id: string }>(
          `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, feeder_id, device_token, captured_at, received_at, review_status)
           VALUES ($1, $2, 'sos', NULL, $3, $4, now(), now(), 'pending')
           ON CONFLICT (client_uuid) DO NOTHING
           RETURNING id`,
          [dog.id, dedupeKey, feederId, deviceSubject],
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
          `INSERT INTO sos_cases (scan_id, dog_id, severity, state, tier)
           VALUES ($1, $2, $3, 'open', 1)
           RETURNING id`,
          [scanId, dog.id, severity],
        );
        const caseId = caseRes.rows[0].id;

        // WAVE 7 — corroboration gates RESPONDER PAGING and nothing else. The
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
        //                 broke that promise — zero responders still waited out
        //                 the full 8-minute timer before ANYONE was notified.
        //                 `fanout` stays "responders": the responder path ran;
        //                 tier:2 records that it came back empty.
        //   ineligible  → suppressed. tier 2, no responder rows, no push job,
        //                 escalation at now() — vets and BMC are notified
        //                 immediately rather than after a timer whose only job
        //                 was to wait for a responder who was never paged.
        //   minor/serious → unchanged: tier 1, no paging at report time
        //                 (validation pipeline out of scope), escalation after
        //                 8 minutes. `fanout` is "escalated" because the
        //                 escalation channel is what will notify anyone.
        //
        let tier = 1;
        let fanout: FanoutDisposition = "escalated";
        let escalateNow = false;
        if (severity === "critical") {
          if (dog.sos_eligible_at != null) {
            const notified = await dispatchFanout(client, caseId, dog.lat, dog.lng, severity);
            tier = notified ? 1 : 2;
            fanout = "responders";
            escalateNow = !notified;
            if (notified) {
              // Web Push (plan §3.4): hand delivery off to the worker
              // (web-push + VAPID) rather than blocking this request on it.
              // The worker writes delivered_at on success and leaves it null
              // on failure, so the sos_notifications receipt columns mean
              // something. Enqueued ONLY here — a job nothing enqueues is a ✅
              // that lies (see docs/INVARIANTS.md on INVARIANT 10's history).
              await client.query(
                `INSERT INTO jobs (kind, payload, run_after) VALUES ('send_sos_push', $1::jsonb, now())`,
                [JSON.stringify({ caseId, dogId: dog.id })],
              );
            }
          } else {
            tier = 2;
            fanout = "escalated";
            escalateNow = true;
          }
        }

        // Escalation: worker's escalate_sos handler promotes unacked cases.
        // Immediate whenever critical-case paging did not happen (no eligible
        // responders, or suppressed); +8 min otherwise.
        await client.query(
          `INSERT INTO jobs (kind, payload, run_after)
           VALUES ('escalate_sos', $1::jsonb, ${escalateNow ? "now()" : "now() + interval '8 minutes'"})`,
          [JSON.stringify({ caseId, dogId: dog.id })],
        );

        return { created: true, caseId, tier, fanout };
      });
    } catch (err) {
      if (err instanceof SosRateLimitError) {
        return reply
          .status(429)
          .send({ ok: false, error: { message: "sos report cap exceeded", code: "SOS_RATE_LIMITED" } });
      }
      if (err instanceof SosDogNotFoundError) {
        return reply
          .status(404)
          .send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
      }
      throw err;
    }

    // Emergency-path improvement (plan §2.4): return a callable number
    // in the same payload as the case id, so the reporter has something to
    // act on immediately rather than waiting out the 8-min escalation timer.
    // Existing response fields (created, caseId, tier) are left untouched;
    // wave 7 adds `fanout` (see FanoutDisposition). nearbyCare is
    // STATUS-INDEPENDENT on purpose: an uncorroborated dog gets the same
    // phone numbers as a corroborated one.
    // SECURITY-GATE: public-coordinates -- internal only. Used to rank nearby
    // care providers by distance; the dog's own position is not echoed back.
    // Only the resulting provider list (published clinic addresses) is returned.
    const dogGeoRes = await query<{ lat: number | null; lng: number | null }>(
      `SELECT ST_Y(last_seen_geo::geometry) AS lat, ST_X(last_seen_geo::geometry) AS lng
       FROM dogs WHERE slug = $1`,
      [dogSlug],
    );
    const dogGeo = dogGeoRes.rows[0];
    const nearbyCare =
      dogGeo?.lat != null && dogGeo?.lng != null ? await getNearbyCare(dogGeo.lat, dogGeo.lng) : [];

    return { ok: true, data: { ...result, nearbyCare } };
  });

  /**
   * GET /api/v1/sos/cases/:id — case state, BOUND to the people the case is
   * about (wave 7). It previously accepted any valid feeder token, so any
   * account could read any case: who acknowledged it, where it stands. A case
   * is now readable by exactly:
   *
   *   - the responder who acknowledged it (acked_by),
   *   - a responder paged for it (a sos_notifications row exists for them —
   *     the fan-out set; they were told about this dog and may be driving to
   *     it), or
   *   - a moderator (the `moderate` capability — admin today), who needs read
   *     access to arbitrate disputes and false-alarm reports, mirroring the
   *     resolve route below.
   *
   * requireFeeder (not a bare verifyAccessToken) because the binding needs the
   * caller's LIVE role anyway — and its FEEDER_GONE behaviour means a valid
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
    const res = await query<CaseRow & { acked_by: string | null; fanned_out: boolean }>(
      `SELECT c.id, c.severity, c.state, c.tier, c.opened_at, c.acked_at, c.escalated_at,
              c.resolved_at, c.resolution, c.acked_by,
              EXISTS (SELECT 1 FROM sos_notifications n
                       WHERE n.case_id = c.id AND n.feeder_id = $2) AS fanned_out
       FROM sos_cases c WHERE c.id = $1`,
      [id, auth.feederId],
    );
    const row = res.rows[0];
    if (!row) {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "case not found", code: "NOT_FOUND" } });
    }

    const isModerator = capabilitiesFor(auth.role).has("moderate");
    if (row.acked_by !== auth.feederId && !row.fanned_out && !isModerator) {
      // 403 rather than 404 on purpose: the caller is authenticated and the
      // case exists, so saying NOT_FOUND would be its own small lie.
      return reply.status(403).send({
        ok: false,
        error: {
          message: "case is visible only to its acker, the responders paged for it, or a moderator",
          code: "SOS_CASE_FORBIDDEN",
        },
      });
    }

    return {
      ok: true,
      data: {
        id: row.id,
        severity: row.severity,
        state: row.state,
        tier: row.tier,
        openedAt: new Date(row.opened_at).toISOString(),
        ackedAt: row.acked_at ? new Date(row.acked_at).toISOString() : null,
        escalatedAt: row.escalated_at ? new Date(row.escalated_at).toISOString() : null,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
        resolution: row.resolution ?? null,
      },
    };
  });

  /**
   * POST /api/v1/sos/cases/:id/resolve { resolution, outcome? } — close a
   * case (wave 7).
   *
   * resolved_at / resolution / state ∈ ('resolved','false_alarm') were columns
   * NOTHING wrote: cases could ack and escalate but never finish, so the case
   * machine had no terminal state and every "open cases" metric counted
   * forever. Who may resolve is deliberately narrow — the responder who
   * ACKNOWLEDGED the case (they went out there; their word is what closes it)
   * or a `moderate` holder (admin) resolving unclaimed or disputed cases.
   * The anonymous reporter has no standing here: reports can be filed with no
   * account at all, so "reporter" is not always an identity that can hold a
   * permission.
   *
   * outcome defaults to 'resolved'; 'false_alarm' exists for cases where the
   * report did not correspond to a real emergency. Either way resolved_at is
   * stamped — both are terminal states, and a closed case must LOOK closed.
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

    const parsed = z
      .object({
        resolution: z.string().min(1).max(500),
        outcome: z.enum(["resolved", "false_alarm"]).default("resolved"),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          message: "body must be { resolution: string, outcome?: 'resolved' | 'false_alarm' }",
          code: "INVALID_SOS_RESOLUTION",
        },
      });
    }
    const { resolution, outcome } = parsed.data;

    const isModerator = capabilitiesFor(auth.role).has("moderate");

    const result = await withTx(async (client) => {
      // Conditional UPDATE as the whole mechanism, same idiom as the ack:
      // only a not-yet-resolved case the caller is entitled to closes here.
      const upd = await client.query<{ state: string; resolved_at: Date; resolution: string }>(
        `UPDATE sos_cases
            SET state = $2::case_state, resolved_at = now(), resolution = $3
          WHERE id = $1
            AND resolved_at IS NULL
            AND state IN ('open', 'acked', 'escalated')
            AND (acked_by = $4 OR $5)
          RETURNING state, resolved_at, resolution`,
        [id, outcome, resolution, auth.feederId, isModerator],
      );
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

    return {
      ok: true,
      data: {
        id,
        state: result.state,
        resolvedAt: new Date(result.resolvedAt).toISOString(),
        resolution: result.resolution,
      },
    };
  });

  /**
   * POST /api/v1/sos/cases/:id/ack — first writer wins (plan §3.1).
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
   * acknowledged (false alarm, or closed from the desk) — such a row has
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

    // Same 22P02 → 500 guard as the GET above (see lib/params.ts).
    const id = parseUuidParam((req.params as { id: string }).id);
    if (!id) {
      return reply.status(400).send({
        ok: false,
        error: { message: "case id must be a UUID", code: "INVALID_CASE_ID" },
      });
    }

    const outcome = await withTx(async (client) => {
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
        // nothing to stand down — the case is finished, and saying so beats a
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
