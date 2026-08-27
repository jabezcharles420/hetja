/**
 * GET /api/v1/feeders/me — the caller's own account, as the server sees it.
 * PATCH /api/v1/feeders/me { sosOptIn } — the SOS responder consent surface.
 *
 * WHY THIS EXISTS. The client learns its role exactly once today — in the
 * /auth/verify response — and throws it away, so after a refresh or a page
 * load the web app has no way to know which surface to land on. The
 * registrator flow ("fill a form, print a sheet, walk outside, scan a tag")
 * needs the app to route on capability at any moment, not only at login.
 *
 * Everything here is a LIVE read (requireFeeder re-reads feeders.role; the
 * profile SELECT reads what the database says NOW). Deliberately no caching
 * and no role claim in the JWT: grant-admin.ts --revoke and DPDP erasure
 * both work by the next request seeing the database's truth — see
 * lib/require-role.ts for the full reasoning.
 *
 * registrationBudget is the live number now that the write path exists
 * (routes/registrations.ts): pending counts this account's INERT
 * ('pending_activation') registrations against REGISTRATION_BUDGET_MAX —
 * attaching tags consumes the budget, so the number falls as tags go on.
 * `canRegister` is the AND of the role's capability and the operator-side
 * `can_register` flag: the flag is the real kill switch (the role is
 * self-elected, so removing it would be a preference the account re-sets),
 * and /me must say "no" when either half says no.
 *
 * sosOptIn is the consent half of the SOS fan-out (routes/sos.ts). Paging
 * someone's phone requires it, and until wave 7 NOTHING could set it: the
 * column existed in 0001, the fan-out filtered on it, and every feeder row
 * therefore answered FALSE forever — one half of why the fan-out never
 * notified anyone. The PATCH accepts exactly one field, deliberately: the
 * old design expected feeders.last_known_geo to ride along with consent,
 * which would have turned a consent checkbox into a location-tracking
 * surface. Proximity is now derived from scan history instead (sos.ts), so
 * consent stays consent and carries no position.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "@hetja/db";
import { requireFeeder } from "../lib/require-role.js";
import { capabilitiesFor } from "../lib/require-role.js";
import { REGISTRATION_BUDGET_MAX } from "../lib/enrol.js";

interface MeRow {
  display_name: string;
  trust_score: number;
  verification_tier: string;
  home_ward: string | null;
  can_register: boolean;
  sos_opt_in: boolean;
}

export default async function feederRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/feeders/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    // requireFeeder already proved the row exists (FEEDER_GONE otherwise), so
    // this SELECT cannot come back empty barring a concurrent erasure — in
    // which case answering FEEDER_GONE is again the honest response.
    const res = await query<MeRow>(
      `SELECT display_name, trust_score, verification_tier, home_ward, can_register, sos_opt_in
         FROM feeders WHERE id = $1`,
      [auth.feederId],
    );
    const feeder = res.rows[0];
    if (!feeder) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "account no longer exists", code: "FEEDER_GONE" } });
    }

    const capabilities = [...capabilitiesFor(auth.role)].sort();
    const holdsRegister = capabilities.includes("register");

    // The budget is only meaningful for accounts that can file registrations;
    // everyone else reports a truthful zero without spending the query.
    const pending = holdsRegister
      ? (
          await query<{ n: number }>(
            `SELECT count(*)::int AS n FROM dogs
              WHERE registered_by = $1 AND status = 'pending_activation'`,
            [auth.feederId],
          )
        ).rows[0]?.n ?? 0
      : 0;

    return {
      ok: true,
      data: {
        feederId: auth.feederId,
        displayName: feeder.display_name,
        role: auth.role,
        capabilities,
        trustScore: feeder.trust_score,
        verificationTier: feeder.verification_tier,
        homeWard: feeder.home_ward ?? null,
        canRegister: holdsRegister && feeder.can_register,
        registrationBudget: { pending, max: REGISTRATION_BUDGET_MAX },
        sosOptIn: feeder.sos_opt_in,
      },
    };
  });

  /**
   * PATCH /api/v1/feeders/me { sosOptIn: boolean } — SOS responder consent.
   *
   * This is THE consent surface for being paged (routes/sos.ts filters the
   * fan-out on feeders.sos_opt_in). The schema is one optional field and
   * nothing else — `strictObject` rather than a loose object, because a
   * consent endpoint that silently ignored extra fields would let a client
   * believe it had updated something (a display name, a ward) that this
   * route does not handle. Unknown fields are a 400, not a no-op.
   *
   * Deliberately NOT location-shaped. The column this write feeds was
   * designed alongside feeders.last_known_geo, and the original intent was
   * for opt-in to carry the feeder's position with it. Wave 7 removed the
   * fan-out's dependency on last_known_geo (proximity now derives from scan
   * history), so consent is all this route accepts or stores.
   *
   * Idempotent by nature: re-asserting the current value is a successful
   * no-op, which is what a checkbox PUT/PATCH should be.
   */
  /**
   * PATCH /api/v1/feeders/me { sosOptIn?, displayName? } — SOS consent + profile.
   *
   * Initially this route accepted only `{ sosOptIn: boolean }` (strict), so
   * every account's display_name stayed the literal 'Hetja Feeder' seeded at
   * signup (BUGS P2-11). Now it accepts an optional `displayName` (1..64 chars,
   * trimmed) alongside sosOptIn — at least one must be present, unknown fields
   * still 400. display_name is set properly at signup via
   * displayNameFromEmail() in routes/auth.ts, and this PATCH lets the feeder
   * correct it without an admin.
   */
  app.patch("/api/v1/feeders/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const parsed = z
      .strictObject({
        sosOptIn: z.boolean().optional(),
        displayName: z.string().trim().min(1).max(64).optional(),
      })
      .refine((v) => v.sosOptIn !== undefined || v.displayName !== undefined, {
        message: "body must contain at least one of { sosOptIn, displayName }",
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          message: "body must contain { sosOptIn?: boolean, displayName?: string (1..64) } and no unknown fields",
          code: "INVALID_SOS_OPT_IN",
        },
      });
    }

    const sets: string[] = [];
    const vals: unknown[] = [auth.feederId];
    let idx = 2;
    if (parsed.data.sosOptIn !== undefined) {
      sets.push(`sos_opt_in = $${idx++}`);
      vals.push(parsed.data.sosOptIn);
    }
    if (parsed.data.displayName !== undefined) {
      sets.push(`display_name = $${idx++}`);
      vals.push(parsed.data.displayName);
    }
    await query(`UPDATE feeders SET ${sets.join(", ")} WHERE id = $1`, vals);
    const out: Record<string, unknown> = {};
    if (parsed.data.sosOptIn !== undefined) out.sosOptIn = parsed.data.sosOptIn;
    if (parsed.data.displayName !== undefined) out.displayName = parsed.data.displayName;
    return { ok: true, data: out };
  });

  /**
   * POST /api/v1/feeders/me/surface { surface: "register" } — self-election.
   *
   * Becoming a registrator is a PREFERENCE the account sets, not a privilege
   * anyone grants: the abuse control is physical-world binding plus the
   * two-sided budget (see routes/registrations.ts), so there is nothing to
   * review here. That is exactly why `can_register` exists separately — it is
   * the operator's actual control over one account's registration surface,
   * while this route stays open.
   *
   * Electable ONLY from 'feeder'. An admin/vet/bmc_officer already holds the
   * register capability; letting them "elect" would DEMOTE them to
   * registrator and silently strip moderation/enrolment — a 409 with the truth
   * is cheaper than that surprise. Re-electing as an existing registrator is
   * idempotent success, because a double-tap is not an error the client needs
   * to distinguish from success.
   */
  app.post("/api/v1/feeders/me/surface", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const parsed = z.object({ surface: z.enum(["register"]) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "unknown surface", code: "UNKNOWN_SURFACE" },
      });
    }

    if (auth.role === "feeder") {
      await query(`UPDATE feeders SET role = 'registrator' WHERE id = $1`, [auth.feederId]);
    } else if (auth.role !== "registrator") {
      return reply.status(409).send({
        ok: false,
        error: {
          message: `${auth.role} already holds the registration capability; electing would be a demotion`,
          code: "ROLE_NOT_ELECTABLE",
        },
      });
    }

    const role = auth.role === "feeder" ? "registrator" : auth.role;
    return {
      ok: true,
      data: { role, capabilities: [...capabilitiesFor(role)].sort() },
    };
  });
}
