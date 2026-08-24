/**
 * Self-serve dog registration — the registrator surface (wave 6).
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
import { BMC_WARD_CODES } from "@hetja/contracts";
import { isValidSlug, query, withTx } from "@hetja/db";
import { deviceTokenSubject } from "../lib/device.js";
import { capabilitiesFor, requireCapability, requireFeeder } from "../lib/require-role.js";
import { signSlug } from "../lib/hmac.js";
import { PENDING_REGISTRATION_TTL_DAYS, REGISTRATION_BUDGET_MAX, collarUrl, createDogWithCollar } from "../lib/enrol.js";

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
 * stale counts — its request silently vanishing into an over-budget row is
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
   * anything typed non-canonically — see BmcWard in @hetja/contracts. */
  wardId: WardId,
  name: z.string().min(1).max(80).optional(),
  sex: z.enum(["male", "female", "unknown"]).optional(),
  approxAge: z.number().int().min(0).max(30).optional(),
  coatPattern: z.string().max(120).optional(),
  temperament: z.string().max(120).optional(),
  batchNo: z.string().min(1).max(40).default("self-serve"),
  material: z.string().min(1).max(40).default("TPU-Shore-95A"),
});

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
  status: string;
  ward_id: string;
  registered_at: Date | null;
  registered_by: string | null;
}

function expiresAtOf(registeredAt: Date): string {
  return new Date(registeredAt.getTime() + PENDING_REGISTRATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export default async function registrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/registrations", async (req: FastifyRequest, reply: FastifyReply) => {
    // Half one of the gate: the caller holds the register capability (a
    // registrator — self-elected — vet, bmc_officer or admin).
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

    const parsed = RegistrationInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "invalid registration payload", code: "INVALID_REGISTRATION" },
      });
    }
    const input = parsed.data;

    let result;
    try {
      result = await withTx(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [
          REGISTRATION_LOCK_KEY,
          auth.feederId,
        ]);

        // Budget half one: this ACCOUNT. Counts only PENDING registrations —
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
        // constraint — see lib/enrol.ts). The dog is born INERT:
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

        // Read the stamp back from the row rather than clocking it in JS: the
        // database's registered_at is the truth the expiry sweep will measure.
        const stamped = await client.query<{ registered_at: Date }>(
          `SELECT registered_at FROM dogs WHERE id = $1`,
          [minted.dogId],
        );

        return { minted, registeredAt: stamped.rows[0].registered_at };
      });
    } catch (err) {
      if (err instanceof RegistrationBudgetError) {
        return reply.status(429).send({
          ok: false,
          error: {
            message: err.errorCode === "DEVICE_REGISTRATION_BUDGET_EXCEEDED"
              ? "device registration budget exceeded"
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
      },
    });
  });

  /**
   * My registrations. Ward and status ONLY — no coordinates are selected, let
   * alone returned, so INVARIANT 2 is not engaged on this route at all and
   * this file contains no ST_X/ST_Y for the security gate to police.
   */
  app.get("/api/v1/registrations", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const res = await query<RegistrationRow>(
      `SELECT slug, status, ward_id, registered_at, registered_by
         FROM dogs
        WHERE registered_by = $1
        ORDER BY registered_at DESC NULLS LAST
        LIMIT 100`,
      [auth.feederId],
    );

    return {
      ok: true,
      data: {
        registrations: res.rows.map((row) => ({
          slug: row.slug,
          status: row.status,
          wardId: row.ward_id,
          ...(row.registered_at
            ? {
                registeredAt: row.registered_at.toISOString(),
                expiresAt: expiresAtOf(row.registered_at),
              }
            : {}),
        })),
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

    const res = await query<RegistrationRow>(`SELECT slug, status, ward_id, registered_at, registered_by FROM dogs WHERE slug = $1`, [
      slug,
    ]);
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
        status: row.status,
        wardId: row.ward_id,
        registeredAt: row.registered_at?.toISOString() ?? null,
        ...(row.registered_at ? { expiresAt: expiresAtOf(row.registered_at) } : {}),
        collarUrl: collarUrl(slug, sig),
      },
    };
  });
}
