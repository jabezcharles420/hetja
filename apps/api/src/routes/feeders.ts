/**
 * GET /api/v1/feeders/me — the caller's own account, as the server sees it.
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
}

export default async function feederRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/feeders/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    // requireFeeder already proved the row exists (FEEDER_GONE otherwise), so
    // this SELECT cannot come back empty barring a concurrent erasure — in
    // which case answering FEEDER_GONE is again the honest response.
    const res = await query<MeRow>(
      `SELECT display_name, trust_score, verification_tier, home_ward, can_register
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
      },
    };
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
