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
 * registrationBudget is reported honestly as zeroes: no write path consumes
 * a registration budget yet (the registrator surface that would is a later
 * wave), so zero pending against a maximum of zero is the only value the
 * system actually knows. `canRegister` — derived from capabilities, not from
 * the budget — is what carries permission until then. When the write path
 * lands, it increments these numbers; the shape stays.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query } from "@hetja/db";
import { requireFeeder } from "../lib/require-role.js";
import { capabilitiesFor } from "../lib/require-role.js";

interface MeRow {
  display_name: string;
  trust_score: number;
  verification_tier: string;
  home_ward: string | null;
}

export default async function feederRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/feeders/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    // requireFeeder already proved the row exists (FEEDER_GONE otherwise), so
    // this SELECT cannot come back empty barring a concurrent erasure — in
    // which case answering FEEDER_GONE is again the honest response.
    const res = await query<MeRow>(
      `SELECT display_name, trust_score, verification_tier, home_ward
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
        canRegister: capabilities.includes("register"),
        registrationBudget: { pending: 0, max: 0 },
      },
    };
  });
}
