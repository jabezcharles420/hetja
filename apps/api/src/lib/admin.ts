/**
 * Admin portal roles (design v7, A6) and invitations.
 *
 * FOUR ROLES, ONE MAP. What each role may open is `ROLE_PERMISSIONS` below and
 * nothing else; routes/admin.ts asks for a permission, never a role, so a new
 * section cannot forget a role check. The map follows A6's copy:
 *
 *   Owner          everything, including removing vets and team members
 *   Moderator      verify vets, merge dogs, handle reports and SOS (and the
 *                  D13 feeder tools, NGOs, collars and the audit log to read)
 *   Avatar editor  upload and publish avatars only (dogs to read, for matching)
 *   Ward lead      collars and SOS in their wards
 *
 * WHERE THE OWNER COMES FROM. Three sources, all LIVE reads, never a claim in
 * the JWT (same reasoning as lib/require-role.ts: revoking must bite at the
 * next request):
 *   1. an admin_roles row (granted by an Owner in A6);
 *   2. HETJA_OWNER_EMAILS: at boot each address becomes its identity HMAC
 *      (both the typed and the canonical form, the same two lib/email.ts
 *      resolves sign-ins under) and the addresses are dropped. Never logged;
 *   3. feeders.role = 'admin', the pre-v7 operator role granted by
 *      `pnpm admin:grant`: treated as Owner ("legacy_admin"), because it
 *      already held every moderation and enrolment power.
 *
 * A suspended account (D13) holds no admin role at all.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { query, withTx } from "@hetja/db";
import { canonicalEmailAddress } from "./email.js";
import { identityHmac } from "./hmac.js";
import { requireFeeder } from "./require-role.js";
import { audit } from "./audit.js";

export type AdminRole = "owner" | "moderator" | "avatar_editor" | "ward_lead";
export const ADMIN_ROLES: readonly AdminRole[] = ["owner", "moderator", "avatar_editor", "ward_lead"];

export type AdminPermission =
  | "vets"
  | "vets_remove"
  | "ngos"
  | "ngos_remove"
  | "dogs"
  | "merge"
  | "feeders"
  | "collars"
  | "sos"
  | "reports"
  | "avatars"
  | "team"
  | "team_read"
  | "audit"
  | "settings";

const ALL: AdminPermission[] = [
  "vets", "vets_remove", "ngos", "ngos_remove", "dogs", "merge", "feeders", "collars",
  "sos", "reports", "avatars", "team", "team_read", "audit", "settings",
];

export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  owner: ALL,
  // Moderators READ the team (A6); writes stay the Owner's ("team").
  moderator: ["vets", "ngos", "dogs", "merge", "feeders", "collars", "sos", "reports", "team_read", "audit", "settings"],
  avatar_editor: ["avatars", "dogs", "settings"],
  ward_lead: ["collars", "sos", "dogs", "settings"],
};

export interface AdminGrant {
  role: AdminRole;
  wards: string[];
  grantedAt: string | null;
  grantedByName: string | null;
  source: "granted" | "config" | "legacy_admin";
}

export interface AdminAuth {
  feederId: string;
  name: string;
  roles: AdminGrant[];
  permissions: Set<AdminPermission>;
  /** null = every ward. Set only when every role held is a ward lead. */
  wards: string[] | null;
}

// ---------------------------------------------------------------------------
// Owner bootstrap (HETJA_OWNER_EMAILS)
// ---------------------------------------------------------------------------

let ownerCache: { key: string; hmacs: Set<string> } | null = null;

/**
 * The identity HMACs of the configured owner addresses. Computed once per
 * (addresses, pepper) and memoised; buildServer calls it at boot. The
 * addresses are never kept: only this set is.
 */
export function ownerHmacs(emails: string, pepper: string): Set<string> {
  const key = identityHmac(`${emails}\u0000owners`, pepper);
  if (ownerCache && ownerCache.key === key) return ownerCache.hmacs;
  const hmacs = new Set<string>();
  for (const raw of emails.split(",")) {
    const email = raw.trim();
    if (!email) continue;
    hmacs.add(identityHmac(email, pepper));
    hmacs.add(identityHmac(canonicalEmailAddress(email), pepper));
  }
  ownerCache = { key, hmacs };
  return hmacs;
}

// ---------------------------------------------------------------------------
// Loading an admin
// ---------------------------------------------------------------------------

interface Cfg {
  HETJA_OWNER_EMAILS: string;
  HETJA_HMAC_PEPPER: string;
}

export async function loadAdmin(feederId: string, cfg: Cfg): Promise<AdminAuth | null> {
  const me = await query<{ display_name: string; identity_hmac: string; role: string; suspended_at: Date | null }>(
    `SELECT display_name, identity_hmac, role::text AS role, suspended_at
       FROM feeders WHERE id = $1 AND deleted_at IS NULL`,
    [feederId],
  );
  const f = me.rows[0];
  if (!f || f.suspended_at) return null;
  const rows = await query<{ role: AdminRole; wards: string[]; granted_at: Date; granted_by_name: string | null }>(
    `SELECT r.role, r.wards, r.granted_at, g.display_name AS granted_by_name
       FROM admin_roles r LEFT JOIN feeders g ON g.id = r.granted_by
      WHERE r.feeder_id = $1 AND r.revoked_at IS NULL
      ORDER BY r.granted_at`,
    [feederId],
  );
  const roles: AdminGrant[] = rows.rows.map((r) => ({
    role: r.role,
    wards: r.role === "ward_lead" ? (r.wards ?? []) : [],
    grantedAt: new Date(r.granted_at).toISOString(),
    grantedByName: r.granted_by_name,
    source: "granted",
  }));
  if (ownerHmacs(cfg.HETJA_OWNER_EMAILS, cfg.HETJA_HMAC_PEPPER).has(f.identity_hmac)) {
    roles.unshift({ role: "owner", wards: [], grantedAt: null, grantedByName: null, source: "config" });
  }
  if (f.role === "admin" && !roles.some((r) => r.role === "owner")) {
    roles.unshift({ role: "owner", wards: [], grantedAt: null, grantedByName: null, source: "legacy_admin" });
  }
  if (roles.length === 0) return null;
  const permissions = new Set<AdminPermission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r.role]) permissions.add(p);
  const onlyWardLead = roles.every((r) => r.role === "ward_lead");
  const wards = onlyWardLead ? [...new Set(roles.flatMap((r) => r.wards))] : null;
  return { feederId, name: f.display_name, roles, permissions, wards };
}

/** Is this ward inside the admin's reach? A ward lead's wards, or everything. */
export function adminCoversWard(auth: Pick<AdminAuth, "wards">, wardId: string | null | undefined): boolean {
  if (auth.wards === null) return true;
  return !!wardId && auth.wards.includes(wardId);
}

/**
 * Signed in, holds an admin role (after claiming any invite for this
 * account), and, when `perm` is given, holds that permission.
 *   401  the requireFeeder pair (UNAUTHENTICATED, BAD_ACCESS_TOKEN, FEEDER_GONE)
 *   403  ADMIN_REQUIRED (no role) or ADMIN_FORBIDDEN (role, not this permission)
 */
export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  perm?: AdminPermission,
): Promise<AdminAuth | null> {
  const auth = await requireFeeder(req, reply);
  if (!auth) return null;
  await claimInvites(auth.feederId);
  const admin = await loadAdmin(auth.feederId, req.server.config);
  if (!admin) {
    void reply.status(403).send({ ok: false, error: { message: "admin role required", code: "ADMIN_REQUIRED" } });
    return null;
  }
  if (perm && !admin.permissions.has(perm)) {
    void reply
      .status(403)
      .send({ ok: false, error: { message: `your role cannot do this (${perm})`, code: "ADMIN_FORBIDDEN" } });
    return null;
  }
  return admin;
}

export function adminMePayload(a: AdminAuth) {
  return {
    feederId: a.feederId,
    name: a.name,
    roles: a.roles,
    permissions: ALL.filter((p) => a.permissions.has(p)),
    wards: a.wards,
  };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/** The identity HMAC an invite for this address is stored under (the canonical form). */
export function inviteHmac(email: string, pepper: string): string {
  return identityHmac(canonicalEmailAddress(email), pepper);
}

/** An existing live account for this address, by either HMAC form, or null. */
export async function accountForEmail(email: string, pepper: string): Promise<string | null> {
  const res = await query<{ id: string }>(
    `SELECT id FROM feeders WHERE identity_hmac IN ($1, $2) AND deleted_at IS NULL LIMIT 1`,
    [identityHmac(email.trim(), pepper), identityHmac(canonicalEmailAddress(email), pepper)],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Apply every open, unexpired invite addressed to this account (matched on
 * identity_hmac, so no address is ever compared or stored). Called on the
 * reads that decide what a person sees: GET /feeders/me, /admin/*, /vet/me,
 * /ngo/me. Idempotent; a cheap indexed read when there is nothing to claim.
 */
export async function claimInvites(feederId: string): Promise<number> {
  const open = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM invites i JOIN feeders f ON f.identity_hmac = i.identity_hmac
      WHERE f.id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
    [feederId],
  );
  if ((open.rows[0]?.n ?? 0) === 0) return 0;
  return withTx(async (client) => {
    const inv = await client.query<{
      id: string;
      kind: "vet" | "team" | "ngo_member";
      role: string | null;
      wards: string[];
      ngo_id: string | null;
      has_transport: boolean;
      invited_by: string | null;
    }>(
      `SELECT i.id, i.kind, i.role, i.wards, i.ngo_id, i.has_transport, i.invited_by
         FROM invites i JOIN feeders f ON f.identity_hmac = i.identity_hmac
        WHERE f.id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
        FOR UPDATE OF i`,
      [feederId],
    );
    let claimed = 0;
    for (const i of inv.rows) {
      if (i.kind === "team" && i.role && (ADMIN_ROLES as readonly string[]).includes(i.role)) {
        await client.query(
          `INSERT INTO admin_roles (feeder_id, role, wards, granted_by)
           VALUES ($1, $2, $3, $4) ON CONFLICT (feeder_id, role) WHERE revoked_at IS NULL DO NOTHING`,
          [feederId, i.role, i.role === "ward_lead" ? i.wards : [], i.invited_by],
        );
      } else if (i.kind === "vet") {
        await client.query(
          `INSERT INTO vet_profiles (feeder_id, status, ngo_id) VALUES ($1, 'invited', $2)
           ON CONFLICT (feeder_id) DO NOTHING`,
          [feederId, i.ngo_id],
        );
        if (i.ngo_id) {
          await client.query(
            `INSERT INTO ngo_vets (ngo_id, vet_feeder_id) VALUES ($1, $2)
             ON CONFLICT (ngo_id, vet_feeder_id) WHERE unlinked_at IS NULL DO NOTHING`,
            [i.ngo_id, feederId],
          );
        }
      } else if (i.kind === "ngo_member" && i.ngo_id && i.role) {
        await client.query(
          `INSERT INTO ngo_members (ngo_id, feeder_id, role, has_transport, invited_by)
           SELECT $1, $2, $3, $4, $5
            WHERE EXISTS (SELECT 1 FROM ngos WHERE id = $1 AND status IN ('waiting', 'active', 'paused'))
           ON CONFLICT (feeder_id) WHERE left_at IS NULL DO NOTHING`,
          [i.ngo_id, feederId, i.role, i.has_transport, i.invited_by],
        );
      }
      await client.query(`UPDATE invites SET accepted_at = now(), accepted_by = $2 WHERE id = $1`, [i.id, feederId]);
      await audit(client, {
        actorId: feederId,
        actorKind: "feeder",
        action: "invite.claim",
        subjectType: "invite",
        subjectId: i.id,
        summary: `accepted an invitation (${i.kind}${i.role ? `, ${i.role}` : ""})`,
      });
      claimed++;
    }
    return claimed;
  });
}
