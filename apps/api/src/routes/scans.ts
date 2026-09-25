import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ScanInput, isInMumbai } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";
import { deviceTokenSubject } from "../lib/device.js";
import {
  applyVerificationGate,
  feedTrustCreditAllowed,
  logTrustEvent,
  recomputeScore,
  type TxClient,
} from "../lib/trust.js";
import { decodePhotoUpload, storePhoto, type StorageConfig } from "../lib/storage.js";
import { UnsupportedImageError, type StrippedImage } from "../lib/exif-strip.js";
import {
  currentStreak,
  dateInKolkata,
  getFeederGamification,
  updateFeedStreak,
  withinBackdateLimit,
  type StreakState,
} from "../lib/gamification.js";
import { PHOTO_ROUTE_BODY_LIMIT } from "../lib/body-limits.js";
import { PHOTO_BUSY_RETRY_AFTER_SEC, PhotoBusyError, photoGate, type Release } from "../lib/photo-gate.js";
import { logRateLimited, photoPerSubject, scanPerSubject, subjectKey } from "../lib/rate-limit.js";

interface DogIdRow {
  id: string;
  status: string;
}

interface ScanRow {
  id: string;
}

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

async function applyLww(
  client: TxClient,
  dogId: string,
  geoWktValue: string,
  capturedAt: Date,
  receivedAt: Date,
): Promise<void> {
  await client.query(
    `UPDATE dogs
     SET last_seen_geo = $2::geography, last_seen_at = $3, last_seen_received_at = $4
     WHERE id = $1
       AND (last_seen_at IS NULL
            OR $3 > last_seen_at
            OR ($3 = last_seen_at AND $4 >= COALESCE(last_seen_received_at, last_seen_at)))`,
    [dogId, geoWktValue, capturedAt, receivedAt],
  );
}

/**
 * Background write of an already-decoded, already-metadata-stripped image.
 * The decode/strip/validate step deliberately does NOT live here; see the
 * comment at the call site in the handler.
 */
async function persistScanAssets(
  app: FastifyInstance,
  scanId: string,
  photo: StrippedImage,
  release: Release,
): Promise<void> {
  try {
    const photoKey = await storePhoto(photo, app.config as unknown as StorageConfig);
    await query(`UPDATE scans SET photo_s3_key = $1 WHERE id = $2`, [photoKey, scanId]);
  } catch (err) {
    app.log.warn({ err, scanId }, "photo persist failed");
  } finally {
    // The photo gate's permit covers the decoded buffers until they are on
    // disk (lib/photo-gate.ts), so it is released here, not at decode.
    release();
  }
}

/** Who signed a scan: exactly one of the two is set. */
interface ScanCaller {
  feederId: string | null;
  deviceSubject: string | null;
}

/**
 * Filled by the onRequest hook, read by the handler. A WeakMap rather than a
 * request decoration so nothing outside this file can see or forge it.
 */
const scanCallers = new WeakMap<FastifyRequest, ScanCaller>();

/**
 * ACTIVATION: flip a self-serve registration out of its inert state.
 *
 * A registration made through POST /api/v1/registrations is born
 * 'pending_activation' and stays invisible to every public surface until
 * somebody stands at a location with the printed tag and scans it. This
 * conditional UPDATE is the whole mechanism, the same first-writer-wins
 * idiom as the sos_cases ack: only the first geotagged scan to reach the row
 * while it is still pending (or expired) claims it; everyone else's affects
 * zero rows.
 *
 * 'expired' IS INCLUDED DELIBERATELY. A registrator who prints on day 1 and
 * attaches on day 32 must not have a tag that resolves to a dead record
 * forever. "Never reused" forbids reassigning a slug to a DIFFERENT dog;
 * reactivating the same row is not reuse.
 *
 * Only geotagged scans activate (the caller gates on `geo`), because the
 * anti-abuse value of this entire flow is PHYSICAL PRESENCE: proof somebody
 * was standing next to the animal with the tag. Activation deliberately does
 * NOT require the same feeder who registered: the first geotagged scan by any
 * authenticated feeder or attested device counts, and `registered_by` may be
 * NULL after a DPDP erasure anyway.
 *
 * Uses the existing `retag` value of scan_type: its meaning (a tag being
 * attached/replaced on an animal) is exactly right, and reusing it avoids a
 * third enum migration.
 *
 * Returns the activated dog's slug, or NULL when the dog had nothing to
 * activate from (already active, deceased, adopted…).
 */
async function activatePendingRegistration(
  client: TxClient,
  dogId: string,
  scanId: string,
): Promise<string | null> {
  const res = await client.query<{ slug: string }>(
    `UPDATE dogs
        SET status = 'active', activated_at = now(), activation_scan_id = $2
      WHERE id = $1 AND status IN ('pending_activation', 'expired')
      RETURNING slug`,
    [dogId, scanId],
  );
  const slug = res.rows[0]?.slug ?? null;
  if (slug !== null) {
    // The expiry sweep (apps/worker, expire_stale_registrations) retires the
    // collar row when a registration goes 'expired'. A scan of that tag proves
    // it IS on the animal after all, so the row comes back with the dog;
    // otherwise the register held an active dog wearing a 'retired' collar,
    // and any future reader filtering collars on status would drop it.
    await client.query(
      `UPDATE collars SET status = 'active', retired_at = NULL
        WHERE dog_id = $1 AND qr_code = $2 AND status = 'retired'`,
      [dogId, slug],
    );
  }
  return slug;
}

/**
 * CORROBORATION: stamp `dogs.sos_eligible_at` once physical presence has been
 * demonstrated well enough to page real responders about this dog later.
 *
 * Reached when the dog accumulates EITHER two geotagged scans from distinct
 * subjects OR one geotagged scan by a verified feeder. A "subject" is
 * `COALESCE(feeder_id::text, 'dev:' || device_token)`, one identity per
 * account or attested device, so one phone scanning twice does not
 * corroborate anything. "Verified feeder" resolves to role IN
 * ('admin','vet','bmc_officer') OR verification_tier = 'verified' (settable
 * only from the box via cli/grant-verified.ts); trust_score is deliberately
 * NOT consulted here. See INVARIANTS.md's recorded defect where a single
 * feed moved a score by 60, making any score-based gate decorative.
 *
 * MATERIALISED, NOT DERIVED PER READ. Wave 7 gates the SOS responder fan-out
 * on `sos_eligible_at IS NOT NULL`. Deriving eligibility at fan-out time would
 * let it flip back to FALSE (retention NULLs a photo key, a review status
 * changes), and a fan-out that silently turns itself off is precisely the
 * failure class docs/INVARIANTS.md keeps recording. So: set once, never
 * cleared, and the canonical derivation is committed beside the other
 * documented queries in docs/queries/sos_corroboration.sql so the two cannot
 * drift apart unobserved (INVARIANT 12 EXPLAINs that file in CI).
 *
 * The `sos_eligible_at IS NULL` guard means the aggregate runs only while it
 * can still change the answer: after the stamp, this is a single-row index
 * lookup that updates nothing.
 */
async function corroborateSosEligibility(client: TxClient, dogId: string): Promise<Date | null> {
  const res = await client.query<{ sos_eligible_at: Date }>(
    `UPDATE dogs d
        SET sos_eligible_at = now()
      WHERE d.id = $1
        AND d.sos_eligible_at IS NULL
        AND (
              (SELECT count(DISTINCT COALESCE(s.feeder_id::text, 'dev:' || s.device_token))
                 FROM scans s
                WHERE s.dog_id = d.id
                  AND s.geo IS NOT NULL) >= 2
              OR EXISTS (
                   SELECT 1
                     FROM scans s
                     JOIN feeders f ON f.id = s.feeder_id
                    WHERE s.dog_id = d.id
                      AND s.geo IS NOT NULL
                      AND (f.role IN ('admin', 'vet', 'bmc_officer')
                           OR f.verification_tier = 'verified'))
            )
      RETURNING sos_eligible_at`,
    [dogId],
  );
  return res.rows[0]?.sos_eligible_at ?? null;
}

export default async function scanRoutes(app: FastifyInstance): Promise<void> {
  /**
   * AUTH BEFORE BODY (hardening batch 1, T5). This route is one of the two
   * that accept a ~2.9 MB body (lib/body-limits.ts), so it authenticates in
   * onRequest, which Fastify runs BEFORE it reads and parses the body: an
   * unauthenticated caller is answered 401 without the server ever buffering
   * its payload.
   *
   * Dual auth: a feeder may sign scans with a Bearer access token (that
   * attributes the scan for trust), otherwise the attested device token.
   *
   * `deviceSubject` is the CANONICAL device id derived from the token, not the
   * token itself. Two reasons, both learned from the INVARIANT 7 bypass fixed
   * in lib/device.ts on 2026-08-14:
   *
   *   1. Node's base64 decoder ignores non-alphabet characters and padding, so
   *      `tok`, `tok=`, `tok==` and `tok!` all decode to the same device, but
   *      as raw strings they are four distinct values. Any rate limit or
   *      uniqueness constraint keyed on the string is trivially reset by
   *      appending a character.
   *   2. The token is a bearer credential. Storing it in `scans.device_token`
   *      means a leak of that column hands over replayable attestations,
   *      whereas the derived id is not a credential.
   */
  const authenticateScan = async (req: FastifyRequest, reply: FastifyReply) => {
    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    if (rawAuth.startsWith("Bearer ")) {
      let feederId: string;
      try {
        feederId = verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub;
      } catch {
        return reply
          .status(401)
          .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
      }
      scanCallers.set(req, { feederId, deviceSubject: null });
      return;
    }
    const deviceToken = req.headers["x-device-token"];
    const deviceSubject =
      typeof deviceToken === "string" ? deviceTokenSubject(deviceToken, app.config.HETJA_DEVICE_SECRET) : null;
    if (deviceSubject === null) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
    }
    scanCallers.set(req, { feederId: null, deviceSubject });
  };

  app.post(
    "/api/v1/scans",
    { bodyLimit: PHOTO_ROUTE_BODY_LIMIT, onRequest: authenticateScan },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const caller = scanCallers.get(req);
      if (!caller) {
        // Unreachable: the onRequest hook either set this or answered 401.
        return reply
          .status(401)
          .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
      }
      const { feederId, deviceSubject } = caller;
      const subject = subjectKey(feederId, deviceSubject);
      const subjectKind = feederId ? "account" : "device";

      // Per account / device, never per IP (INVARIANT 6). Before the body is
      // validated and before any photo is decoded, so a flood costs a bucket
      // lookup and nothing else. The offline queue retries a 429.
      const scanBudget = scanPerSubject.consume(subject);
      if (!scanBudget.allowed) {
        logRateLimited(req.log, "scanPerSubject", subjectKind);
        return reply
          .status(429)
          .header("retry-after", String(scanBudget.retryAfterSec))
          .send({ ok: false, error: { message: "too many scans; try again shortly", code: "RATE_LIMITED" } });
      }

      const parsed = ScanInput.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ ok: false, error: { message: "invalid scan payload", code: "INVALID_SCAN" } });
      }
      const { clientUuid, dogSlug, type, geo, photoBase64, capturedAt } = parsed.data;
      // `outcome` only means something on a feed. On any other scan type it is
      // ignored rather than refused: a 400 here would be permanent, and the
      // offline queue drops a scan on a permanent 4xx, so a client bug in an
      // optional field would cost the scan itself.
      const feedOutcome = type === "feed" ? (parsed.data.outcome ?? null) : null;

      // MUMBAI ONLY (hardening batch 1, T4, audit A-03). A geotag outside
      // MUMBAI_BOUNDS is a spoof or a phone without a fix, and it is treated
      // exactly as if no geo had been sent: it does not move last_seen_geo,
      // does not activate a registration, does not corroborate SOS eligibility
      // and is not stored on the scan (so it can never count towards
      // corroboration or responder proximity later). The scan itself is still
      // recorded. The log line carries no coordinates.
      const acceptedGeo = geo && isInMumbai(geo.lat, geo.lng) ? geo : null;
      const geoAccepted = geo ? acceptedGeo !== null : undefined;

      // Container validation + metadata strip happens HERE, synchronously,
      // before the scan row exists, not in the background writer below.
      //
      // Two reasons, both about honesty. First, the browser pipeline
      // (apps/web/lib/photo.ts) is a client-side guard, and a client-side guard
      // is not a control an attacker is subject to: this endpoint accepts
      // `photoBase64` from anyone holding a device token, and unstripped bytes
      // written here end up in `scans.photo_s3_key` and then in a public
      // `GET /api/v1/dogs/:slug` response, publishing whatever GPS the original
      // camera embedded (INVARIANT 2). Second, "reject" has to mean reject:
      // doing this in the background writer could only log a warning, the same
      // silent-rejection failure INVARIANT 14 rules out for AI validation.
      //
      // PHOTO BUDGET (T3): over 40 photos a day per account/device the photo is
      // dropped and the scan is still accepted, answered `photoAccepted: false`.
      // A 4xx would make the offline queue drop the feed along with the photo.
      //
      // PHOTO GATE (T5): a permit from lib/photo-gate.ts is held from decode
      // until the bytes are on disk. When the gate is saturated the answer is
      // 503 PHOTO_BUSY with retry-after, which the offline queue retries.
      let photo: StrippedImage | null = null;
      let photoAccepted: false | undefined;
      let release: Release | null = null;
      let handedOff = false;
      if (photoBase64) {
        if (!photoPerSubject.peek(subject).allowed) {
          logRateLimited(req.log, "photoPerSubject", subjectKind);
          photoAccepted = false;
        } else {
          try {
            release = await photoGate.acquire();
          } catch (err) {
            if (!(err instanceof PhotoBusyError)) throw err;
            return reply
              .status(503)
              .header("retry-after", String(PHOTO_BUSY_RETRY_AFTER_SEC))
              .send({
                ok: false,
                error: { message: "photo processing is busy; try again shortly", code: "PHOTO_BUSY" },
              });
          }
          photoPerSubject.consume(subject);
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
      }

      try {
        const dogRes = await query<DogIdRow>(`SELECT id, status::text AS status FROM dogs WHERE slug = $1`, [
          dogSlug,
        ]);
        const dog = dogRes.rows[0];
        if (!dog) {
          return reply
            .status(404)
            .send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
        }

        // INVARIANT 15, enforced where it bites: a provisional feeder whose
        // last three scans were all rejected/flagged is PAUSED, and a paused
        // feeder's scans are refused rather than recorded.
        //
        // Evaluated in its own transaction, before the scan's: the gate's
        // idempotent `auto_paused` flag row must commit even though the scan
        // below is refused, or the pause would be recomputed from scratch on
        // every attempt and never recorded. Anonymous (device-token) scans
        // carry no trust and are not gated: the pause is about the ACCOUNT's
        // standing.
        //
        // 403 is a permanent 4xx: apps/web's offline queue drops the record and
        // tells the feeder (recordDroppedFeed) instead of retrying forever, and
        // SOS reporting (POST /api/v1/reports) is deliberately NOT gated here:
        // an emergency report from a paused account is still an emergency.
        if (feederId) {
          const gate = await withTx((client) => applyVerificationGate(feederId, client));
          if (gate.paused) {
            return reply.status(403).send({
              ok: false,
              error: {
                message:
                  "this account is paused pending review: its last scans were rejected, so new scans are not being accepted",
                code: "FEEDER_PAUSED",
              },
            });
          }
        }

        if (geo && !acceptedGeo) {
          req.log.warn({ event: "geo_outside_mumbai", dogId: dog.id }, "scan geo outside Mumbai treated as absent");
        }

        const receivedAt = new Date();
        const captured = new Date(capturedAt);

        // INVARIANT 5 + trust callback in ONE transaction: the feed trust
        // event is only logged when the scan was actually created (ON CONFLICT
        // client_uuid DO NOTHING), so a replay can never double-count.
        const result = await withTx(async (client) => {
          const insertRes = await client.query<ScanRow>(
            `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, feeder_id, device_token, captured_at, received_at, review_status)
             VALUES ($1, $2, $3, $4::geography, $5, $6, $7, $8, 'pending')
             ON CONFLICT (client_uuid) DO NOTHING
             RETURNING id`,
            [
              dog.id,
              clientUuid,
              type,
              acceptedGeo ? geoWkt(acceptedGeo.lat, acceptedGeo.lng) : null,
              feederId,
              deviceSubject,
              captured,
              receivedAt,
            ],
          );

          const created = (insertRes.rowCount ?? 0) === 1;
          if (!created) {
            return {
              created: false as const,
              scanId: undefined,
              activatedSlug: null,
              sosEligibleAt: null,
              streak: null as StreakState | null,
            };
          }

          const scanId = insertRes.rows[0].id;
          if (acceptedGeo) {
            await applyLww(client, dog.id, geoWkt(acceptedGeo.lat, acceptedGeo.lng), captured, receivedAt);
          }

          // Feed outcome (migration 0024), INSIDE the `created` branch so a
          // replay (created:false above) can never rewrite what the first
          // submission said (INVARIANT 5). 'unwell' is stored and nothing more:
          // it is a flag for a human, and it must never open an SOS case by
          // itself (INVARIANT 14). Nor does it touch review_status, which
          // INVARIANT 15 counts toward pausing the feeder.
          if (feedOutcome !== null) {
            await client.query(`UPDATE scans SET feed_outcome = $2 WHERE id = $1`, [scanId, feedOutcome]);
          }

          // Streak and trust (hardening batch 1, T2). The scan above is always
          // recorded; what is withheld is the REWARD:
          //   - the streak only moves for a feed that reached the server within
          //     72 h of capture (lib/gamification.ts BACKDATE_LIMIT_HOURS), so
          //     a month of backdated capturedAt values cannot build a streak;
          //   - the +1 trust credit only for an active dog, once per dog per
          //     Mumbai day, and at most FEED_TRUST_DAILY_CAP in a rolling day
          //     (lib/trust.ts feedTrustCreditAllowed).
          let streak: StreakState | null = null;
          if (type === "feed" && feederId) {
            if (withinBackdateLimit(captured, receivedAt)) {
              streak = await updateFeedStreak(feederId, dateInKolkata(captured), client);
            }
            if (await feedTrustCreditAllowed(feederId, dog.id, dog.status, client)) {
              await logTrustEvent(
                { feederId, eventType: "feed", reason: "feed scan logged", refScanId: scanId },
                client,
              );
              await recomputeScore(feederId, client);
            }
          }

          // Activation + corroboration live INSIDE this transaction and INSIDE
          // the `created` branch, on purpose. INVARIANT 5's replay idempotency
          // then covers them free of charge: a replayed scan yields
          // created:false above and can never re-stamp activated_at or re-run
          // corroboration. Both need an accepted (Mumbai) geotag: an
          // ungeotagged scan proves a camera, not a location.
          let activatedSlug: string | null = null;
          let sosEligibleAt: Date | null = null;
          if (acceptedGeo) {
            activatedSlug = await activatePendingRegistration(client, dog.id, scanId);
            sosEligibleAt = await corroborateSosEligibility(client, dog.id);
          }
          return { created: true as const, scanId, activatedSlug, sosEligibleAt, streak };
        });

        if (result.created && result.scanId && photo && release) {
          handedOff = true;
          void persistScanAssets(app, result.scanId, photo, release);
        }

        if (result.activatedSlug) {
          req.log.info(
            { dogSlug: result.activatedSlug, scanId: result.scanId },
            "registration activated by geotagged scan",
          );
        }
        if (result.sosEligibleAt) {
          req.log.info({ dogId: dog.id }, "sos eligibility corroborated");
        }
        if (result.created && feedOutcome === "unwell") {
          // Visible to an operator reading the logs; deliberately no job, no
          // case, no page (INVARIANT 14). The reporter is told, client-side,
          // how to file an SOS if the dog needs one.
          req.log.warn({ dogId: dog.id, scanId: result.scanId }, "feed reported dog unwell (flag only)");
        }

        // `streak` (optional, signed-in feeds only): the state updateFeedStreak
        // just persisted. When nothing was updated (a replay, or a feed too old
        // to move the streak) the CURRENT state is read instead; the client
        // gets the same answer either way.
        let streak: StreakState | null = result.streak;
        if (streak === null && type === "feed" && feederId) {
          const row = await getFeederGamification(feederId);
          const state = { streakDays: row.streak_days, lastFeedDate: row.last_feed_date };
          streak = { streakDays: currentStreak(state, dateInKolkata(new Date())), lastFeedDate: row.last_feed_date };
        }

        return {
          ok: true,
          data: {
            created: result.created,
            scanId: result.created ? result.scanId : undefined,
            ...(streak ? { streak: { streakDays: streak.streakDays, lastFeedDate: streak.lastFeedDate } } : {}),
            // Only when a photo was sent and dropped for the daily budget.
            ...(photoAccepted === false ? { photoAccepted: false as const } : {}),
            // Only when geo was sent: false means it was outside Mumbai and
            // treated as absent.
            ...(geoAccepted !== undefined ? { geoAccepted } : {}),
          },
        };
      } finally {
        if (release && !handedOff) release();
      }
    },
  );
}
