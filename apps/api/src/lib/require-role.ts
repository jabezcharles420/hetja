/**
 * One shared role/capability gate, replacing the seven per-route copies.
 *
 * Before this module, bearer auth + a role check was re-implemented in
 * enrolment.ts (requireAdmin), moderation.ts (feederAuth + requireAdmin),
 * medical.ts, trust.ts, territories.ts, push.ts and metrics.ts — with
 * inconsistent error codes for identical failures. This module is the one
 * implementation; conversion is deliberately incremental (only the two
 * requireAdmin copies moved in this wave — see each route's history), so the
 * older copies still exist beside it until their own waves convert them.
 *
 * CAPABILITIES, NOT A ROLE JOIN TABLE. `feeders.role` is a single enum value,
 * and "a user holds both surfaces" has to be expressed within that: the map
 * below derives what an account MAY do from the one role it holds. admin gets
 * all four; registrator, vet and bmc_officer get feed+register; feeder gets
 * feed. `registrator` cannot yet exist on any row — contracts declares it
 * ahead of the migration that extends feeders.role, precisely so this map can
 * name the value before accounts can hold it.
 *
 * THE ROLE CHECK IS A LIVE READ, AND THAT IS LOAD-BEARING. Nothing here reads
 * a role out of the JWT, and none must ever be added to the token: access
 * tokens live 15 minutes, and `grant-admin.ts --revoke` takes effect
 * instantly today BECAUSE every authorisation decision re-reads
 * `feeders.role` from the database. Admin is the role that can write the
 * register of every stray in a city; a quarter-hour-stale claim that keeps an
 * revoked admin holding the pen is a bad trade for one saved SELECT. (The
 * same reasoning is why the DPDP erasure path works: delete the feeders row
 * and every capability dies with it at the next request.)
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FeederRole } from "@hetja/contracts";
import { query } from "@hetja/db";
import { verifyAccessToken } from "./jwt.js";

export type Capability = "feed" | "register" | "moderate" | "enrol";

/**
 * What each role may do. An unknown role string yields an EMPTY set —
 * fail-closed, so a future role added to the database enum without a mapping
 * here can do nothing rather than everything.
 */
export function capabilitiesFor(role: string): Set<Capability> {
  switch (role) {
    case "admin":
      return new Set<Capability>(["feed", "register", "moderate", "enrol"]);
    case "registrator":
    case "vet":
    case "bmc_officer":
      return new Set<Capability>(["feed", "register"]);
    case "feeder":
      return new Set<Capability>(["feed"]);
    default:
      return new Set<Capability>();
  }
}

export interface RoleAuth {
  feederId: string;
  role: FeederRole;
}

/** The 403 body per capability. `enrol` preserves the exact message both
 * converted requireAdmin copies have always sent. */
const FORBIDDEN_MESSAGE: Record<Capability, string> = {
  enrol: "admin role required",
  moderate: "admin role required",
  register: "registration capability required",
  feed: "feeder capability required",
};

/**
 * Bearer authentication only: verify the JWT and return its subject. Sends
 * the standard 401 pair (no header → UNAUTHENTICATED, bad token →
 * BAD_ACCESS_TOKEN) and returns null when the caller should stop.
 */
function authenticate(req: FastifyRequest, reply: FastifyReply): string | null {
  const rawAuth =
    typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  if (!rawAuth.startsWith("Bearer ")) {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "feeder auth required", code: "UNAUTHENTICATED" } });
    return null;
  }
  try {
    return verifyAccessToken(rawAuth.slice(7), req.server.config.JWT_SECRET).sub as string;
  } catch {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
    return null;
  }
}

async function loadRole(feederId: string): Promise<FeederRole | null> {
  const res = await query<{ role: FeederRole }>(`SELECT role FROM feeders WHERE id = $1`, [
    feederId,
  ]);
  return res.rows[0]?.role ?? null;
}

/**
 * Any signed-in feeder whose account still exists. One live role read — the
 * same read requireCapability performs, returned instead of filtered, so a
 * caller needing the role does not query twice.
 */
export async function requireFeeder(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<RoleAuth | null> {
  const feederId = authenticate(req, reply);
  if (!feederId) return null;

  const role = await loadRole(feederId);
  if (!role) {
    // A cryptographically valid token for an erased account must not pass as
    // "authenticated": INVARIANT 11's erasure deletes the feeders row, and
    // whatever survives in localStorage afterwards should be told the account
    // is gone, not shown a feeder profile.
    void reply
      .status(401)
      .send({ ok: false, error: { message: "account no longer exists", code: "FEEDER_GONE" } });
    return null;
  }
  return { feederId, role };
}

/**
 * Bearer auth + LIVE role read + capability check.
 *
 * Returns {feederId, role} on success; sends the response and returns null on
 * any failure, exactly like the requireAdmin copies it replaces:
 *   401 UNAUTHENTICATED   no Bearer header
 *   401 BAD_ACCESS_TOKEN  malformed / mis-signed / expired token
 *   401 FEEDER_GONE       valid token, feeders row deleted (erasure)
 *   403 FORBIDDEN         account exists but lacks the capability
 */
export async function requireCapability(
  req: FastifyRequest,
  reply: FastifyReply,
  cap: Capability,
): Promise<RoleAuth | null> {
  const feederId = authenticate(req, reply);
  if (!feederId) return null;

  const role = await loadRole(feederId);
  if (!role) {
    // Same contract as requireFeeder above. (Both converted requireAdmin
    // copies used to answer 403 here — implying the account existed but
    // lacked the role. Saying WHY it fails is more honest than which of two
    // wrong roles it failed with, and no asserted test pins the old body.)
    void reply
      .status(401)
      .send({ ok: false, error: { message: "account no longer exists", code: "FEEDER_GONE" } });
    return null;
  }

  if (!capabilitiesFor(role).has(cap)) {
    void reply
      .status(403)
      .send({
        ok: false,
        error: { message: FORBIDDEN_MESSAGE[cap], code: "FORBIDDEN" },
      });
    return null;
  }
  return { feederId, role };
}
