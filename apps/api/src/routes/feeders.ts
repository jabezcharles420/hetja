/**
 * GET /api/v1/feeders/me: the caller's own account, as the server sees it.
 * PATCH /api/v1/feeders/me { sosOptIn?, displayName?, homeWard? }: SOS consent + profile.
 *
 * WHY THIS EXISTS. The client learns its role exactly once today (in the
 * /auth/verify response) and throws it away, so after a refresh or a page
 * load the web app has no way to know which surface to land on. The
 * registrator flow ("fill a form, print a sheet, walk outside, scan a tag")
 * needs the app to route on capability at any moment, not only at login.
 *
 * Everything here is a LIVE read (requireFeeder re-reads feeders.role; the
 * profile SELECT reads what the database says NOW). Deliberately no caching
 * and no role claim in the JWT: grant-admin.ts --revoke and DPDP erasure
 * both work by the next request seeing the database's truth. See
 * lib/require-role.ts for the full reasoning.
 *
 * registrationBudget is the live number now that the write path exists
 * (routes/registrations.ts): pending counts this account's INERT
 * ('pending_activation') registrations against REGISTRATION_BUDGET_MAX:
 * attaching tags consumes the budget, so the number falls as tags go on.
 * `canRegister` is the AND of the role's capability and the operator-side
 * `can_register` flag: the flag is the real kill switch (the role is
 * self-elected, so removing it would be a preference the account re-sets),
 * and /me must say "no" when either half says no.
 *
 * sosOptIn is the consent half of the SOS fan-out (routes/sos.ts). Paging
 * someone's phone requires it, and until wave 7 NOTHING could set it: the
 * column existed in 0001, the fan-out filtered on it, and every feeder row
 * therefore answered FALSE forever. That was one half of why the fan-out never
 * notified anyone. The PATCH accepts exactly one field, deliberately: the
 * old design expected feeders.last_known_geo to ride along with consent,
 * which would have turned a consent checkbox into a location-tracking
 * surface. Proximity is now derived from scan history instead (sos.ts), so
 * consent stays consent and carries no position.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BMC_WARD_CODES, wardName } from "@hetja/contracts";
import { query } from "@hetja/db";
import { requireFeeder } from "../lib/require-role.js";
import { capabilitiesFor } from "../lib/require-role.js";
import { REGISTRATION_BUDGET_MAX, REGISTRATION_WEEKLY_CAP } from "../lib/enrol.js";

interface MyDogRow {
  slug: string;
  name: string | null;
  ward_id: string;
  last_fed_at: Date | null;
  my_last_fed_at: Date;
}

/** Upper bound on GET /feeders/me/dogs. A feeder with more is an NGO, and a page of 50 is plenty for a home screen. */
const MY_DOGS_LIMIT = 50;

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
    // this SELECT cannot come back empty barring a concurrent erasure, in
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
    const counts = holdsRegister
      ? (
          await query<{ pending: number; weekly: number }>(
            `SELECT count(*) FILTER (WHERE status = 'pending_activation')::int AS pending,
                    count(*) FILTER (WHERE registered_at >= now() - interval '7 days')::int AS weekly
               FROM dogs WHERE registered_by = $1`,
            [auth.feederId],
          )
        ).rows[0]
      : undefined;
    const pending = counts?.pending ?? 0;
    // `weekly` (hardening batch 1, T9): this account's registrations of any
    // status in the rolling last 7 days, against REGISTRATION_WEEKLY_CAP. The
    // per-device half of the cap is enforced on POST /registrations but has no
    // device to report on here.
    const weeklyUsed = counts?.weekly ?? 0;

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
        registrationBudget: {
          pending,
          max: REGISTRATION_BUDGET_MAX,
          weekly: { used: weeklyUsed, max: REGISTRATION_WEEKLY_CAP },
        },
        sosOptIn: feeder.sos_opt_in,
      },
    };
  });

  /**
   * GET /api/v1/feeders/me/dogs: the dogs this account has fed.
   *
   * Distinct dogs from the caller's OWN feed scans, the one they fed most
   * recently first, at most MY_DOGS_LIMIT. Each carries:
   *
   *   lastFedAt     the dog's latest non-rejected feed by ANYONE (the "has
   *                 somebody fed her today?" question); a time, never who
   *   myLastFedAt   this caller's own latest feed of the dog (the sort key)
   *
   * No coordinates of any kind, not even coarsened: the ward is enough to
   * find a dog you already know, and a list of where one person's dogs are is
   * a list of where that person goes (INVARIANT 2's reasoning). Scoped to the
   * caller's own scans, so it reveals nothing about any other feeder.
   */
  app.get("/api/v1/feeders/me/dogs", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const res = await query<MyDogRow>(
      `SELECT d.slug, d.name, d.ward_id, mine.my_last_fed_at,
              (SELECT max(a.captured_at) FROM scans a
                WHERE a.dog_id = d.id AND a.scan_type = 'feed' AND a.review_status <> 'rejected') AS last_fed_at
         FROM (SELECT s.dog_id, max(s.captured_at) AS my_last_fed_at
                 FROM scans s
                WHERE s.feeder_id = $1 AND s.scan_type = 'feed'
                GROUP BY s.dog_id
                ORDER BY my_last_fed_at DESC
                LIMIT $2) mine
         JOIN dogs d ON d.id = mine.dog_id
        ORDER BY mine.my_last_fed_at DESC, d.slug`,
      [auth.feederId, MY_DOGS_LIMIT],
    );

    return {
      ok: true,
      data: {
        dogs: res.rows.map((r) => ({
          slug: r.slug,
          name: r.name ?? null,
          wardId: r.ward_id,
          wardName: wardName(r.ward_id),
          lastFedAt: r.last_fed_at ? new Date(r.last_fed_at).toISOString() : null,
          myLastFedAt: new Date(r.my_last_fed_at).toISOString(),
        })),
      },
    };
  });

  /**
   * PATCH /api/v1/feeders/me { sosOptIn: boolean }: SOS responder consent.
   *
   * This is THE consent surface for being paged (routes/sos.ts filters the
   * fan-out on feeders.sos_opt_in). The schema is one optional field and
   * nothing else: `strictObject` rather than a loose object, because a
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
   * PATCH /api/v1/feeders/me { sosOptIn?, displayName?, homeWard? }: SOS consent + profile.
   *
   * Initially this route accepted only `{ sosOptIn: boolean }` (strict), so
   * every account's display_name stayed the literal 'Hetja Feeder' seeded at
   * signup (BUGS P2-11). Now it accepts an optional `displayName` (1..64 chars,
   * trimmed) alongside sosOptIn. At least one must be present, unknown fields
   * still 400. display_name is set properly at signup via
   * displayNameFromEmail() in routes/auth.ts, and this PATCH lets the feeder
   * correct it without an admin.
   */
  /*
   * homeWard (map screen 19, "Get alerts for K/W ward"): one of the 24
   * canonical BMC_WARD_CODES ("K-West", never the "K/W" display form), or
   * null to clear it. It is a ward, not a position, so it stays inside
   * INVARIANT 2 and does not reintroduce the location-shaped consent this
   * route was built to avoid. Note it does not (yet) drive paging: the
   * fan-out still selects responders by recent scans near the dog.
   */
  app.patch("/api/v1/feeders/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;

    const parsed = z
      .strictObject({
        sosOptIn: z.boolean().optional(),
        displayName: z.string().trim().min(1).max(64).optional(),
        homeWard: z.enum(BMC_WARD_CODES).nullable().optional(),
      })
      .refine(
        (v) => v.sosOptIn !== undefined || v.displayName !== undefined || v.homeWard !== undefined,
        { message: "body must contain at least one of { sosOptIn, displayName, homeWard }" },
      )
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      // Error code (docs/BUGS.md, B-11). This route grew from a one-field
      // consent toggle into a profile PATCH, but every failure still said
      // INVALID_SOS_OPT_IN, so a bad displayName read as a consent error. Now:
      //   INVALID_SOS_OPT_IN    the `sosOptIn` field itself is what failed
      //                         (kept exactly, so existing clients that branch
      //                         on it for the consent toggle are unaffected)
      //   INVALID_FEEDER_PATCH  anything else: displayName, homeWard, an
      //                         unknown field, or an empty body
      const sosOptInFailed = parsed.error.issues.some((i) => i.path[0] === "sosOptIn");
      return reply.status(400).send({
        ok: false,
        error: {
          message:
            "body must contain { sosOptIn?: boolean, displayName?: string (1..64), homeWard?: BMC ward code | null } and no unknown fields",
          code: sosOptInFailed ? "INVALID_SOS_OPT_IN" : "INVALID_FEEDER_PATCH",
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
    if (parsed.data.homeWard !== undefined) {
      sets.push(`home_ward = $${idx++}`);
      vals.push(parsed.data.homeWard);
    }
    await query(`UPDATE feeders SET ${sets.join(", ")} WHERE id = $1`, vals);
    const out: Record<string, unknown> = {};
    if (parsed.data.sosOptIn !== undefined) out.sosOptIn = parsed.data.sosOptIn;
    if (parsed.data.displayName !== undefined) out.displayName = parsed.data.displayName;
    if (parsed.data.homeWard !== undefined) out.homeWard = parsed.data.homeWard;
    return { ok: true, data: out };
  });

  /**
   * POST /api/v1/feeders/me/surface { surface: "register" }: self-election.
   *
   * Becoming a registrator is a PREFERENCE the account sets, not a privilege
   * anyone grants: the abuse control is physical-world binding plus the
   * two-sided budget (see routes/registrations.ts), so there is nothing to
   * review here. That is exactly why `can_register` exists separately: it is
   * the operator's actual control over one account's registration surface,
   * while this route stays open.
   *
   * Electable ONLY from 'feeder'. An admin/vet/bmc_officer already holds the
   * register capability; letting them "elect" would DEMOTE them to
   * registrator and silently strip moderation/enrolment. A 409 with the truth
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
