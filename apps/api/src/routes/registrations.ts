/**
 * Self-serve dog registration: the registrator surface (wave 6).
 *
 * POST /api/v1/registrations        file a registration for a street/community
 *                                   dog you look after; get back the signed URL
 *                                   to encode in the QR you print and attach
 * GET  /api/v1/registrations        your own registrations (ward + status only)
 * GET  /api/v1/registrations/:slug  what the print page reads (includes the
 *                                   signed collar URL, deliberately behind auth)
 *
 * WHY THIS EXISTS. Enrolment was admin-only because the register of every
 * tagged stray in a city is sensitive data (see routes/enrolment.ts' header),
 * and there was deliberately no HTTP path to the pen. But a city-scale register
 * that only an operator can write cannot scale to the volunteers who actually
 * know where the dogs are. The product decision here opens enrolment to anyone,
 * and moves the abuse control from a review queue to the PHYSICAL WORLD: a
 * registration is created inert ('pending_activation') and stays invisible to
 * every public surface until somebody stands at a location with the printed tag
 * and scans it (activation in routes/scans.ts). Paper registrations cost a
 * printer, a walk, and a presence at the dog's location; that is the gate.
 *
 * THE TWO BUDGETS. An account-only cap is not a cap: signup is email OTP, so
 * ten Gmail aliases (`you+1@gmail.com`…) give twenty pending registrations to
 * one operator. The second budget keys on the attested DEVICE (INVARIANT 6: a
 * write that mints a physical identifier is attested; INVARIANT 7's lesson that
 * limits key on the canonical deviceId, never on IP or raw token strings).
 * Two per phone is what actually bounds one person's paper output.
 *
 * WHY can_register EXISTS SEPARATELY FROM role. The registrator role is
 * self-elected (`POST /api/v1/feeders/me/surface`), so revoking the role is a
 * preference the account can simply re-set. The kill switch is the column: an
 * operator disables registration for one account without touching its feeder
 * surface, streak or trust.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { BMC_WARD_CODES, MAX_PHOTO_BASE64_CHARS } from "@hetja/contracts";
import { isValidSlug, query, withTx } from "@hetja/db";
import { deviceTokenSubject } from "../lib/device.js";
import { capabilitiesFor, requireCapability, requireFeeder, type RoleAuth } from "../lib/require-role.js";
import { PHOTO_ROUTE_BODY_LIMIT } from "../lib/body-limits.js";
import { PHOTO_BUSY_RETRY_AFTER_SEC, PhotoBusyError, photoGate, type Release } from "../lib/photo-gate.js";
import { decodePhotoUpload, storePhoto, type StorageConfig } from "../lib/storage.js";
import { UnsupportedImageError, type StrippedImage } from "../lib/exif-strip.js";
import { signSlug } from "../lib/hmac.js";
import {
  PENDING_REGISTRATION_TTL_DAYS,
  REGISTRATION_BUDGET_MAX,
  REGISTRATION_WEEKLY_CAP,
  collarUrl,
  createDogWithCollar,
} from "../lib/enrol.js";
import { logRateLimited, photoPerSubject } from "../lib/rate-limit.js";
import { firstName } from "../lib/public-name.js";

/**
 * Advisory-lock namespace, kept beside the rest of the family so the next key
 * does not collide by accident:
 *
 *   420_001  CHAIN_LOCK_KEY (routes/medical.ts)       ledger append serialisation
 *   420_010  ANCHOR_SCHEDULE_LOCK_KEY (apps/worker)   anchor job enqueue
 *   420_011  RETENTION_SCHEDULE_LOCK_KEY (apps/worker) retention job enqueue
 *   420_020  REGISTRATION_LOCK_KEY (this file)        registration budget check
 *
 * `_xact_lock`, NOT `_try_`: two rapid double-taps on "register" must
 * SERIALISE, so the loser re-reads the budget counts after the winner's insert
 * and gets an honest 429. With `_try_`, the loser would skip the wait and read
 * stale counts. Its request silently vanishing into an over-budget row is
 * precisely the outcome the lock exists to prevent.
 *
 * Keyed per-feeder (the second argument hashes the caller's id), which means
 * the DEVICE half of the budget is not serialised across different accounts
 * sharing one phone. That residual race needs two OTP-verified accounts on one
 * attested browser profile; the honest statement is that the device budget is
 * strong against one abuser with aliases, not against a coordinated pair.
 */
const REGISTRATION_LOCK_KEY = 420_020;

// Built from the canonical tuple in @hetja/contracts rather than importing
// its zod-v4 schema object: apps/api pins zod@^3.23 and the two majors never
// share a runtime instance (see the note on BMC_WARD_CODES there).
const WardId = z.enum(BMC_WARD_CODES);

const RegistrationInput = z.object({
  /** One of the 24 BMC ward codes. Free-text wards made the heatmap blind to
   * anything typed non-canonically; see BmcWard in @hetja/contracts. */
  wardId: WardId,
  name: z.string().min(1).max(80).optional(),
  sex: z.enum(["male", "female", "unknown"]).optional(),
  approxAge: z.number().int().min(0).max(30).optional(),
  coatPattern: z.string().max(120).optional(),
  temperament: z.string().max(120).optional(),
  /**
   * The registrator's own word on medical status (migration 0025). Stored as
   * a SELF-REPORT on dogs.vaccinated_reported / dogs.sterilised_reported and
   * never surfaced as Vaccinated / Sterilised on any public read: only
   * vet-verified medical records do that (routes/dogs.ts). Optional, so older
   * clients are unaffected.
   */
  vaccinatedReported: z.boolean().optional(),
  sterilisedReported: z.boolean().optional(),
  batchNo: z.string().min(1).max(40).default("self-serve"),
  material: z.string().min(1).max(40).default("TPU-Shore-95A"),
  /**
   * Design v5 R2: the face photo, which becomes the dog's portrait. Same cap,
   * decode, magic-byte check and EXIF strip as a scan photo (lib/storage.ts),
   * through the same photo gate and the same per-account daily photo budget.
   * It is stored on an 'identify' scan of the new dog, which is exactly how
   * GET /dogs/:slug already picks a portrait (lib/photo-url.ts PORTRAIT_SQL),
   * so it also falls under the same retention and moderation as every other
   * photo. The scan has no geo, so it cannot activate the registration or
   * corroborate SOS eligibility: only a scan at the dog does that.
   */
  photoBase64: z.string().max(MAX_PHOTO_BASE64_CHARS).optional(),
  /** Design v5 R4 "How to spot her": at most 8 short strings. */
  markings: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
});

/** Who is registering: filled by the onRequest hook, read by the handler. */
const registrationCallers = new WeakMap<FastifyRequest, { auth: RoleAuth; deviceSubject: string }>();

async function persistRegistrationPhoto(
  app: FastifyInstance,
  scanId: string,
  photo: StrippedImage,
  release: Release,
): Promise<void> {
  try {
    const photoKey = await storePhoto(photo, app.config as unknown as StorageConfig);
    await query(`UPDATE scans SET photo_s3_key = $1 WHERE id = $2`, [photoKey, scanId]);
  } catch (err) {
    app.log.warn({ err, scanId }, "registration photo persist failed");
  } finally {
    release();
  }
}

class RegistrationBudgetError extends Error {
  constructor(public readonly errorCode: string) {
    super(`registration budget exceeded (${errorCode})`);
    this.name = "RegistrationBudgetError";
  }
}

class RegistrationDisabledError extends Error {
  constructor() {
    super("registration disabled for this account");
    this.name = "RegistrationDisabledError";
  }
}

interface RegistrationRow {
  slug: string;
  name: string | null;
  status: string;
  ward_id: string;
  registered_at: Date | null;
  registered_by: string | null;
}

/**
 * Design v6 (P1, P4, P6, V12) fields for one registration: when its tag was
 * last printed, days left before a pending one expires, how often it has been
 * scanned and when last, when it went live, and its feeders' first names
 * (opt-out respected, lib/public-name.ts). Counts and times only; no position.
 */
const V6_COLUMNS = `
  (SELECT max(p.printed_at) FROM tag_prints p WHERE p.dog_id = d.id) AS printed_at,
  (SELECT count(*)::int FROM scans s WHERE s.dog_id = d.id AND s.scan_type <> 'sos') AS scan_count,
  (SELECT max(s.captured_at) FROM scans s WHERE s.dog_id = d.id AND s.scan_type <> 'sos') AS last_scan_at,
  d.activated_at,
  (SELECT coalesce(array_agg(f.display_name ORDER BY f.created_at) FILTER (WHERE f.show_first_name), '{}')
     FROM feeders f
    WHERE f.deleted_at IS NULL
      AND (f.id = d.registered_by
           OR EXISTS (SELECT 1 FROM scans s
                       WHERE s.dog_id = d.id AND s.feeder_id = f.id AND s.scan_type = 'feed'
                         AND s.review_status <> 'rejected'
                         AND s.received_at >= now() - interval '60 days'))) AS feeder_display_names`;

interface V6Row {
  printed_at: Date | null;
  scan_count: number;
  last_scan_at: Date | null;
  activated_at: Date | null;
  feeder_display_names: string[];
}

function daysLeftOf(status: string, registeredAt: Date | null): number | null {
  if (status !== "pending_activation" || !registeredAt) return null;
  const ms = registeredAt.getTime() + PENDING_REGISTRATION_TTL_DAYS * 86_400_000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function v6Fields(row: RegistrationRow & V6Row) {
  return {
    printedAt: row.printed_at ? row.printed_at.toISOString() : null,
    daysLeft: daysLeftOf(row.status, row.registered_at),
    scanCount: row.scan_count,
    liveSince: row.activated_at ? row.activated_at.toISOString() : null,
    lastScanAt: row.last_scan_at ? row.last_scan_at.toISOString() : null,
    feederNames: (row.feeder_display_names ?? [])
      .map((n) => firstName(n, true))
      .filter((n): n is string => n !== null),
  };
}

function expiresAtOf(registeredAt: Date): string {
  return new Date(registeredAt.getTime() + PENDING_REGISTRATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export default async function registrationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * AUTH BEFORE BODY (design v5). With the R2 photo this became the third
   * route to accept a ~2.9 MB body (lib/body-limits.ts), so, like POST /scans,
   * both halves of the gate run in onRequest, before Fastify reads the body:
   * an unauthenticated caller is answered without the server buffering it.
   */
  const authenticateRegistration = async (req: FastifyRequest, reply: FastifyReply) => {
    // Half one of the gate: the caller holds the register capability (a
    // registrator (self-elected), vet, bmc_officer or admin).
    const auth = await requireCapability(req, reply, "register");
    if (!auth) return reply;

    // Half two: an ATTESTED DEVICE. The budget's other half keys on this, and
    // a write that mints a physical identifier is exactly the class INVARIANT 6
    // reserves attestation for. Same header contract as routes/scans.ts.
    const deviceToken = req.headers["x-device-token"];
    const deviceSubject =
      typeof deviceToken === "string"
        ? deviceTokenSubject(deviceToken, app.config.HETJA_DEVICE_SECRET)
        : null;
    if (deviceSubject === null) {
      return reply.status(401).send({
        ok: false,
        error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" },
      });
    }
    registrationCallers.set(req, { auth, deviceSubject });
  };

  app.post(
    "/api/v1/registrations",
    { bodyLimit: PHOTO_ROUTE_BODY_LIMIT, onRequest: authenticateRegistration },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const caller = registrationCallers.get(req);
      if (!caller) {
        // Unreachable: the onRequest hook either set this or answered.
        return reply.status(401).send({
          ok: false,
          error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" },
        });
      }
      const { auth, deviceSubject } = caller;

      const parsed = RegistrationInput.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: { message: "invalid registration payload", code: "INVALID_REGISTRATION" },
        });
      }
      const input = parsed.data;

      // The photo is validated here, before the transaction, for the reasons
      // routes/scans.ts gives: "rejected" must be a 400, and unstripped bytes
      // must never reach a public read. Over the daily photo budget the
      // registration still goes through, answered `photoAccepted: false`.
      let photo: StrippedImage | null = null;
      let photoAccepted: false | undefined;
      let release: Release | null = null;
      let handedOff = false;
      const photoSubject = `acct:${auth.feederId}`;
      if (input.photoBase64) {
        if (!photoPerSubject.peek(photoSubject).allowed) {
          logRateLimited(req.log, "photoPerSubject", "account");
          photoAccepted = false;
        } else {
          try {
            release = await photoGate.acquire();
          } catch (err) {
            if (!(err instanceof PhotoBusyError)) throw err;
            return reply
              .status(503)
              .header("retry-after", String(PHOTO_BUSY_RETRY_AFTER_SEC))
              .send({ ok: false, error: { message: "photo processing is busy; try again shortly", code: "PHOTO_BUSY" } });
          }
          photoPerSubject.consume(photoSubject);
          try {
            photo = decodePhotoUpload(input.photoBase64);
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
        let result;
        try {
          result = await withTx(async (client) => {
            await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [
              REGISTRATION_LOCK_KEY,
              auth.feederId,
            ]);

            // Budget half one: this ACCOUNT. Counts only PENDING registrations:
            // activation is what consumes the budget, so attaching tags frees it.
            const accountCount = await client.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM dogs
                WHERE registered_by = $1 AND status = 'pending_activation'`,
              [auth.feederId],
            );
            if ((accountCount.rows[0]?.n ?? 0) >= REGISTRATION_BUDGET_MAX) {
              throw new RegistrationBudgetError("REGISTRATION_BUDGET_EXCEEDED");
            }

            // Budget half two: this DEVICE. Ten email aliases do not buy ten more
            // prints; the phone they were requested from is still holding two.
            const deviceCount = await client.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM dogs
                WHERE registered_device_id = $1 AND status = 'pending_activation'`,
              [deviceSubject],
            );
            if ((deviceCount.rows[0]?.n ?? 0) >= REGISTRATION_BUDGET_MAX) {
              throw new RegistrationBudgetError("DEVICE_REGISTRATION_BUDGET_EXCEEDED");
            }

            // Weekly cap (hardening batch 1, T9): registrations of ANY status in
            // the rolling last 7 days, per account and per device. Activation frees
            // the pending budget above; it does not free this one.
            const weekly = await client.query<{ by_account: number; by_device: number }>(
              `SELECT
                 (SELECT count(*)::int FROM dogs
                   WHERE registered_by = $1 AND registered_at >= now() - interval '7 days') AS by_account,
                 (SELECT count(*)::int FROM dogs
                   WHERE registered_device_id = $2 AND registered_at >= now() - interval '7 days') AS by_device`,
              [auth.feederId, deviceSubject],
            );
            if (
              (weekly.rows[0]?.by_account ?? 0) >= REGISTRATION_WEEKLY_CAP ||
              (weekly.rows[0]?.by_device ?? 0) >= REGISTRATION_WEEKLY_CAP
            ) {
              throw new RegistrationBudgetError("REGISTRATION_WEEKLY_CAP");
            }

            // The operator-side kill switch. Read INSIDE the transaction, after the
            // locks and budgets, so a disable racing a registration wins cleanly.
            const flagRes = await client.query<{ can_register: boolean }>(
              `SELECT can_register FROM feeders WHERE id = $1`,
              [auth.feederId],
            );
            if (flagRes.rows[0]?.can_register === false) {
              throw new RegistrationDisabledError();
            }

            // Mint dog + collar atomically (slug uniqueness enforced by the UNIQUE
            // constraint; see lib/enrol.ts). The dog is born INERT:
            // 'pending_activation', sos_eligible_at NULL, absent from the heatmap
            // and ward index by their existing `status = 'active'` predicates, and
            // SOS-ineligible until corroboration proves physical presence twice.
            const minted = await createDogWithCollar(
              client,
              {
                name: input.name ?? null,
                sex: input.sex ?? null,
                approxAge: input.approxAge ?? null,
                coatPattern: input.coatPattern ?? null,
                temperament: input.temperament ?? null,
                wardId: input.wardId,
                status: "pending_activation",
                registeredBy: auth.feederId,
                registeredDeviceId: deviceSubject,
              },
              { batchNo: input.batchNo, material: input.material },
              app.config.HETJA_QR_SECRET,
            );

            // Self-reported medical status, in the same transaction as the dog so
            // a registration never exists half-written. COALESCE keeps NULL (not
            // asked) distinct from false (asked, said no).
            if (input.vaccinatedReported !== undefined || input.sterilisedReported !== undefined) {
              await client.query(
                `UPDATE dogs
                    SET vaccinated_reported = COALESCE($2, vaccinated_reported),
                        sterilised_reported = COALESCE($3, sterilised_reported)
                  WHERE id = $1`,
                [minted.dogId, input.vaccinatedReported ?? null, input.sterilisedReported ?? null],
              );
            }

            if (input.markings && input.markings.length > 0) {
              await client.query(`UPDATE dogs SET markings = $2 WHERE id = $1`, [minted.dogId, input.markings]);
            }

            // The portrait's scan row, in the same transaction as the dog; the
            // bytes are written after commit (persistRegistrationPhoto).
            let photoScanId: string | null = null;
            if (photo) {
              const scan = await client.query<{ id: string }>(
                `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, feeder_id, device_token, captured_at, received_at, review_status)
                 VALUES ($1, $2, 'identify', NULL, $3, $4, now(), now(), 'pending')
                 RETURNING id`,
                [minted.dogId, randomUUID(), auth.feederId, deviceSubject],
              );
              photoScanId = scan.rows[0].id;
            }

            // Read the stamp back from the row rather than clocking it in JS: the
            // database's registered_at is the truth the expiry sweep will measure.
            const stamped = await client.query<{ registered_at: Date }>(
              `SELECT registered_at FROM dogs WHERE id = $1`,
              [minted.dogId],
            );

            return { minted, registeredAt: stamped.rows[0].registered_at, photoScanId };
          });
        } catch (err) {
          if (err instanceof RegistrationBudgetError) {
            logRateLimited(
              req.log,
              err.errorCode,
              err.errorCode === "DEVICE_REGISTRATION_BUDGET_EXCEEDED" ? "device" : "account",
            );
            return reply.status(429).send({
              ok: false,
              error: {
                message:
                  err.errorCode === "DEVICE_REGISTRATION_BUDGET_EXCEEDED"
                    ? "device registration budget exceeded"
                    : err.errorCode === "REGISTRATION_WEEKLY_CAP"
                      ? `at most ${REGISTRATION_WEEKLY_CAP} registrations a week per account and per phone`
                      : "registration budget exceeded",
                code: err.errorCode,
              },
            });
          }
          if (err instanceof RegistrationDisabledError) {
            return reply.status(403).send({
              ok: false,
              error: { message: "registration disabled for this account", code: "REGISTRATION_DISABLED" },
            });
          }
          throw err;
        }

        if (photo && release && result.photoScanId) {
          handedOff = true;
          void persistRegistrationPhoto(app, result.photoScanId, photo, release);
        }

        req.log.info(
          { dogId: result.minted.dogId, slug: result.minted.slug, wardId: input.wardId },
          "dog registered (pending activation)",
        );

        const accountPending =
          (
            await query<{ n: number }>(
              `SELECT count(*)::int AS n FROM dogs
                WHERE registered_by = $1 AND status = 'pending_activation'`,
              [auth.feederId],
            )
          ).rows[0]?.n ?? 0;

        return reply.status(201).send({
          ok: true,
          data: {
            slug: result.minted.slug,
            status: "pending_activation",
            wardId: input.wardId,
            registeredAt: result.registeredAt.toISOString(),
            expiresAt: expiresAtOf(result.registeredAt),
            // The whole point of the endpoint: the exact signed string to encode
            // in the QR. Everything else here is metadata.
            collarUrl: collarUrl(result.minted.slug, result.minted.sig),
            budget: { pending: accountPending, max: REGISTRATION_BUDGET_MAX },
            // Only when a photo was sent and dropped for the daily budget.
            ...(photoAccepted === false ? { photoAccepted: false as const } : {}),
          },
        });
      } finally {
        if (release && !handedOff) release();
      }
    },
  );

  /**
   * My registrations. Ward and status ONLY: no coordinates are selected, let
   * alone returned, so INVARIANT 2 is not engaged on this route at all and
   * this file contains no ST_X/ST_Y for the security gate to police.
   */
  app.get("/api/v1/registrations", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const res = await query<RegistrationRow & V6Row>(
      `SELECT d.slug, d.name, d.status, d.ward_id, d.registered_at, d.registered_by, ${V6_COLUMNS}
         FROM dogs d
        WHERE d.registered_by = $1
        ORDER BY d.registered_at DESC NULLS LAST
        LIMIT 100`,
      [auth.feederId],
    );

    // P6: which of the caller's registrations hold the pending slots, so the
    // form can say so on open instead of failing on Save.
    const holders = res.rows
      .filter((r) => r.status === "pending_activation")
      .map((r) => ({
        slug: r.slug,
        name: r.name ?? null,
        printedAt: r.printed_at ? r.printed_at.toISOString() : null,
        daysLeft: daysLeftOf(r.status, r.registered_at) ?? 0,
      }));

    return {
      ok: true,
      data: {
        registrations: res.rows.map((row) => ({
          slug: row.slug,
          name: row.name ?? null,
          status: row.status,
          wardId: row.ward_id,
          ...(row.registered_at
            ? {
                registeredAt: row.registered_at.toISOString(),
                expiresAt: expiresAtOf(row.registered_at),
              }
            : {}),
          ...v6Fields(row),
        })),
        budget: { pending: holders.length, max: REGISTRATION_BUDGET_MAX, holders },
      },
    };
  });

  /**
   * What the print page reads. The signature is served HERE, behind auth,
   * rather than embedded in any link the registrator's browser might leak: a
   * URL bar entry, a history row, or a shared "look at my dog's page" link
   * must never carry a valid collar credential. Ownership rule below.
   */
  app.get("/api/v1/registrations/:slug", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const { slug } = req.params as { slug: string };
    if (!isValidSlug(slug)) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid slug", code: "INVALID_SLUG" } });
    }

    const res = await query<RegistrationRow & V6Row>(
      `SELECT d.slug, d.name, d.status, d.ward_id, d.registered_at, d.registered_by, ${V6_COLUMNS}
         FROM dogs d WHERE d.slug = $1`,
      [slug],
    );
    const row = res.rows[0];
    if (!row) {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "not found", code: "DOG_NOT_FOUND" } });
    }

    // Yours, or the enrolment desk's. NOT "any registrator's": registrator is
    // self-elected and carries no authority over other people's registrations.
    if (row.registered_by !== auth.feederId && !capabilitiesFor(auth.role).has("enrol")) {
      return reply.status(403).send({
        ok: false,
        error: { message: "not your registration", code: "NOT_YOUR_REGISTRATION" },
      });
    }

    // Signed NOW under the current secret. collars.hmac_sig remains the
    // verification-first path, so this stays correct even across a rotation.
    const sig = signSlug(slug, app.config.HETJA_QR_SECRET);

    return {
      ok: true,
      data: {
        slug: row.slug,
        // The name the registrator gave: the Collar ready screen prints it.
        name: row.name ?? null,
        status: row.status,
        wardId: row.ward_id,
        registeredAt: row.registered_at?.toISOString() ?? null,
        ...(row.registered_at ? { expiresAt: expiresAtOf(row.registered_at) } : {}),
        collarUrl: collarUrl(slug, sig),
        ...v6Fields(row),
      },
    };
  });

  /**
   * POST /api/v1/registrations/:slug/tag-check { code } (design v6, P2):
   * before activating, does the tag the registrator just scanned belong to
   * THIS registration? A wrong tag is answered with both dogs' names and
   * codes, but the scanned one only when the caller may see it: their own
   * registration, or a dog any public surface shows. Anything else is
   * `scanned: null`, so this cannot be used to learn about pending dogs of
   * other people. Activation itself is still the geotagged scan (routes/scans.ts).
   */
  app.post("/api/v1/registrations/:slug/tag-check", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const { slug } = req.params as { slug: string };
    const parsed = z.strictObject({ code: z.string().min(1).max(200) }).safeParse(req.body ?? {});
    if (!isValidSlug(slug) || !parsed.success) {
      return reply.status(400).send({ ok: false, error: { message: "body must be { code }", code: "INVALID_TAG_CHECK" } });
    }
    const own = await query<{ slug: string; name: string | null; registered_by: string | null }>(
      `SELECT slug, name, registered_by FROM dogs WHERE slug = $1`,
      [slug],
    );
    const mine = own.rows[0];
    if (!mine) {
      return reply.status(404).send({ ok: false, error: { message: "not found", code: "DOG_NOT_FOUND" } });
    }
    if (mine.registered_by !== auth.feederId && !capabilitiesFor(auth.role).has("enrol")) {
      return reply.status(403).send({ ok: false, error: { message: "not your registration", code: "NOT_YOUR_REGISTRATION" } });
    }
    // Accept a full collar URL (…/d/<slug>?s=…) or a typed code.
    const raw = parsed.data.code.trim();
    const fromUrl = /\/d\/([a-z0-9]{9})(?:[?#/]|$)/i.exec(raw)?.[1];
    const scannedSlug = (fromUrl ?? raw).toLowerCase().replace(/[\s-]+/g, "").replace(/0/g, "o").replace(/[1l]/g, "i");
    if (scannedSlug === slug) return { ok: true, data: { match: true } };
    const other = isValidSlug(scannedSlug)
      ? (
          await query<{ slug: string; name: string | null; status: string; registered_by: string | null }>(
            `SELECT slug, name, status::text AS status, registered_by FROM dogs WHERE slug = $1`,
            [scannedSlug],
          )
        ).rows[0]
      : undefined;
    const visible =
      other && (other.registered_by === auth.feederId || !["pending_activation", "expired"].includes(other.status));
    return {
      ok: true,
      data: {
        match: false,
        expected: { slug: mine.slug, name: mine.name ?? null },
        scanned: visible ? { slug: other.slug, name: other.name ?? null } : null,
      },
    };
  });
}
