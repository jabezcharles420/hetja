/**
 * Design v7 admin portal, part 1 (A1, A2, A6, A7 and settings). Part 2 is
 * routes/admin-content.ts (avatars, dogs and merges, feeders and devices,
 * collars, SOS cases, reports).
 *
 * EVERY route here is `requireAdmin(req, reply, <permission>)` (lib/admin.ts):
 * the permission map, never a role name, decides. EVERY write is audited in
 * the same transaction as the change (lib/audit.ts), and so is every document
 * opened. Admin writes are rate limited per account.
 *
 * GET  /api/v1/admin/me | today | search?q= | settings
 * GET  /api/v1/admin/vets[?status=]  GET /api/v1/admin/vets/:id
 * POST /api/v1/admin/vets/:id/verify | ask-more | decline | suspend | reinstate | remove | link-care
 * POST /api/v1/admin/vets/invite
 * GET  /api/v1/admin/documents/:id              (streams the decrypted file)
 * GET  /api/v1/admin/ngos[?status=]  GET /api/v1/admin/ngos/:id  POST /api/v1/admin/ngos  PATCH /api/v1/admin/ngos/:id
 * POST /api/v1/admin/ngos/:id/approve | pause | resume | remove | link-care
 * GET  /api/v1/admin/care?q=
 * GET  /api/v1/admin/team  POST /api/v1/admin/team  POST /api/v1/admin/team/:feederId/role | remove
 * GET  /api/v1/admin/audit  GET /api/v1/admin/audit.csv
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { wardDisplay, wardName } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import {
  ADMIN_ROLES,
  accountForEmail,
  guardAccountAction,
  rolesHeldBy,
  adminCoversWard,
  adminMePayload,
  claimInvites,
  inviteHmac,
  ownerHmacs,
  requireAdmin,
  type AdminAuth,
  type AdminRole,
} from "../lib/admin.js";
import { audit } from "../lib/audit.js";
import {
  adminSearchPerAccount,
  adminWritePerAccount,
  documentViewPerAccount,
  enforceLimits,
  invitePerAccount,
  inviteMailGlobal,
  GLOBAL_SUBJECT,
} from "../lib/rate-limit.js";
import { enqueueFeederPush } from "../lib/dog-feeders.js";
import { ALL_WARDS, publicPhone, validWards, type NgoStatus, type VetStatus } from "../lib/professionals.js";
import { adminVetDetailOf, adminVetRowOf, documentsOf, loadVetProfileRow, VET_PROFILE_SQL, type VetProfileRow } from "../lib/vet-profile.js";
import { readDocument } from "../lib/documents.js";
import { sendInviteEmail } from "../lib/mailer.js";
import { MAX_OPEN_ACKS, NGO_WINDOW_MINUTES, TRUST_FLOOR } from "../lib/sos-eligibility.js";
import { FEED_TRUST_DAILY_CAP } from "../lib/trust.js";
import { AVATAR_SQL, PORTRAIT_SQL, photoUrlFor } from "../lib/photo-url.js";
import { publicName, firstName } from "../lib/public-name.js";
import { loadNgoRow, ngoProfileOf } from "./ngo.js";
import { duplicateCandidates } from "./admin-content.js";

export const err = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.status(status).send({ ok: false, error: { message, code } });

export function writeLimited(req: FastifyRequest, reply: FastifyReply, a: AdminAuth): boolean {
  return enforceLimits(req.log, reply, [
    { limiter: adminWritePerAccount, key: `acct:${a.feederId}`, name: "adminWritePerAccount", kind: "account" },
  ]);
}

export const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function uuidParam(req: FastifyRequest, name = "id"): string | null {
  const v = (req.params as Record<string, string>)[name];
  return z.string().uuid().safeParse(v).success ? v : null;
}

export function slugCode(slug: string): string {
  return `${slug.slice(0, 3)}-${slug.slice(3, 6)}-${slug.slice(6)}`;
}

const Reason = z.strictObject({ reason: z.string().trim().min(3).max(500) });

/** Best-effort invitation email: production, SMTP configured, inside the global budget. Never throws. */
async function mailInvite(app: FastifyInstance, email: string, what: string): Promise<boolean> {
  const c = app.config;
  if (c.NODE_ENV !== "production" || !c.BREVO_SMTP_HOST) return false;
  if (!inviteMailGlobal.consume(GLOBAL_SUBJECT).allowed) return false;
  try {
    await sendInviteEmail(email, what, {
      host: c.BREVO_SMTP_HOST,
      port: c.BREVO_SMTP_PORT,
      user: c.BREVO_SMTP_USER,
      pass: c.BREVO_SMTP_PASS,
      from: c.MAIL_FROM,
    });
    return true;
  } catch {
    app.log.warn({ event: "invite_mail_failed" }, "invite email not sent");
    return false;
  }
}

/** A vet decision: documents are deleted 30 days after it (owner decision). */
async function scheduleDocumentDeletion(
  client: { query: (t: string, p?: unknown[]) => Promise<unknown> },
  ownerKind: "vet_profile" | "ngo",
  ownerId: string,
) {
  await client.query(
    `UPDATE documents SET delete_after = now() + interval '30 days'
      WHERE owner_kind = $1 AND owner_id = $2 AND deleted_at IS NULL AND delete_after IS NULL`,
    [ownerKind, ownerId],
  );
}

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Boot: the owner HMACs from HETJA_OWNER_EMAILS, once (the addresses are not kept).
  ownerHmacs(app.config.HETJA_OWNER_EMAILS, app.config.HETJA_HMAC_PEPPER);

  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/api/v1/admin")) reply.header("Cache-Control", "no-store");
  });

  app.get("/api/v1/admin/me", async (req, reply) => {
    const a = await requireAdmin(req, reply);
    if (!a) return reply;
    return { ok: true, data: adminMePayload(a) };
  });

  // ---------------------------------------------------------------------------
  // A1 Today
  // ---------------------------------------------------------------------------
  app.get("/api/v1/admin/today", async (req, reply) => {
    const a = await requireAdmin(req, reply);
    if (!a) return reply;
    const can = (p: Parameters<typeof a.permissions.has>[0]) => a.permissions.has(p);
    const wards = a.wards ?? [...ALL_WARDS];
    const [vets, avatars, sos, reports, ngos, week] = await Promise.all([
      query<{ n: number; oldest: Date | null }>(
        `SELECT count(*)::int AS n, min(applied_at) AS oldest FROM vet_profiles WHERE status = 'waiting'`,
      ),
      query<{ n: number; batch_id: string | null; number: number | null; batch_created_at: Date | null }>(
        `SELECT count(*)::int AS n,
                (SELECT b.id FROM avatar_batches b WHERE EXISTS (SELECT 1 FROM dog_avatars x WHERE x.batch_id = b.id AND x.status = 'draft')
                  ORDER BY b.created_at DESC LIMIT 1) AS batch_id,
                (SELECT b.number FROM avatar_batches b WHERE EXISTS (SELECT 1 FROM dog_avatars x WHERE x.batch_id = b.id AND x.status = 'draft')
                  ORDER BY b.created_at DESC LIMIT 1) AS number,
                (SELECT b.created_at FROM avatar_batches b WHERE EXISTS (SELECT 1 FROM dog_avatars x WHERE x.batch_id = b.id AND x.status = 'draft')
                  ORDER BY b.created_at DESC LIMIT 1) AS batch_created_at
           FROM dog_avatars WHERE status = 'draft'`,
      ),
      query<{ n: number; unassigned: number; oldest: Date | null }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE c.acked_by IS NULL)::int AS unassigned,
                min(c.opened_at) FILTER (WHERE c.acked_by IS NULL) AS oldest
           FROM sos_cases c LEFT JOIN dogs d ON d.id = c.dog_id
          WHERE c.resolved_at IS NULL AND c.state IN ('open', 'acked', 'escalated')
            AND COALESCE(c.ward_id, d.ward_id) = ANY($1::text[])`,
        [wards],
      ),
      query<{ n: number; dup: number; photo: number; other: number }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE kind = 'duplicate_dog')::int AS dup,
                count(*) FILTER (WHERE kind = 'photo')::int AS photo, count(*) FILTER (WHERE kind = 'other')::int AS other
           FROM reports WHERE status = 'open'`,
      ),
      query<{ n: number }>(`SELECT count(*)::int AS n FROM ngos WHERE status = 'waiting'`),
      query<{ new_dogs: number; signed: number; resolved: number; total: number; collars: number }>(
        `SELECT (SELECT count(*)::int FROM dogs WHERE created_at >= now() - interval '7 days' AND merged_into IS NULL
                   AND status NOT IN ('pending_activation', 'expired')) AS new_dogs,
                (SELECT count(*)::int FROM medical_records WHERE record_source = 'vet_signed' AND record_type <> 'withdrawal'
                   AND created_at >= now() - interval '7 days') AS signed,
                (SELECT count(*)::int FROM sos_cases WHERE opened_at >= now() - interval '7 days' AND resolved_at IS NOT NULL) AS resolved,
                (SELECT count(*)::int FROM sos_cases WHERE opened_at >= now() - interval '7 days') AS total,
                (SELECT count(*)::int FROM collars WHERE issued_at >= now() - interval '7 days') AS collars`,
      ),
    ]);
    const by = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 14 * 86_400_000));
    const due = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dogs d
        LEFT JOIN LATERAL (SELECT m.payload->>'dueOn' AS due_on FROM medical_records m
                            WHERE m.dog_id = d.id AND m.record_type IN ('vaccination', 'vaccine') AND m.is_verified
                              AND NOT EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = m.id)
                            ORDER BY m.created_at DESC LIMIT 1) v ON true
       WHERE d.status IN ('active', 'lost') AND COALESCE(v.due_on, d.vaccine_due_month) <= $1`,
      [by],
    );

    const needsYou: unknown[] = [];
    if (can("sos")) {
      const cases = await query<{
        id: string;
        dog_name: string | null;
        ward_id: string | null;
        severity: string;
        note: string | null;
        opened_at: Date;
        rname: string | null;
        rshow: boolean | null;
        rdel: Date | null;
      }>(
        `SELECT c.id, d.name AS dog_name, COALESCE(c.ward_id, d.ward_id) AS ward_id, c.severity::text AS severity, c.note, c.opened_at,
                f.display_name AS rname, f.show_first_name AS rshow, f.deleted_at AS rdel
           FROM sos_cases c LEFT JOIN dogs d ON d.id = c.dog_id JOIN scans s ON s.id = c.scan_id LEFT JOIN feeders f ON f.id = s.feeder_id
          WHERE c.resolved_at IS NULL AND c.acked_by IS NULL AND c.state IN ('open', 'escalated')
            AND COALESCE(c.ward_id, d.ward_id) = ANY($1::text[])
          ORDER BY c.opened_at LIMIT 10`,
        [wards],
      );
      for (const c of cases.rows) {
        needsYou.push({
          kind: "sos",
          caseId: c.id,
          dogName: c.dog_name,
          wardId: c.ward_id,
          wardName: wardName(c.ward_id),
          severity: c.severity,
          note: c.note,
          raisedBy: firstName(c.rname, c.rshow, c.rdel),
          openedAt: c.opened_at.toISOString(),
        });
      }
    }
    if (can("vets")) {
      const w = await query<VetProfileRow & { docs: number }>(
        `${VET_PROFILE_SQL.replace("FROM vet_profiles v", ", (SELECT count(*)::int FROM documents x WHERE x.owner_kind = 'vet_profile' AND x.owner_id = v.id) AS docs FROM vet_profiles v")}
          WHERE v.status = 'waiting' ORDER BY (v.vouched_by_ngo_id IS NOT NULL) DESC, v.applied_at LIMIT 10`,
      );
      for (const v of w.rows) {
        const r = adminVetRowOf(v);
        needsYou.push({ kind: "vet", vetId: r.id, name: r.name, regLabel: r.regLabel, appliedAt: r.appliedAt, documents: v.docs, vouched: r.vouched });
      }
    }
    if (can("merge")) {
      for (const d of (await duplicateCandidates()).slice(0, 5)) {
        needsYou.push({
          kind: "duplicate",
          reportId: d.reportId,
          a: { slug: d.a.slug, name: d.a.name },
          b: { slug: d.b.slug, name: d.b.name },
          reason: d.reason,
          sameWard: d.a.wardId === d.b.wardId,
          differentFeeders: d.a.addedBy !== d.b.addedBy,
        });
      }
    }
    if (can("avatars")) {
      const b = await query<{ id: string; number: number; created_at: Date; files: number; matched: number }>(
        `SELECT b.id, b.number, b.created_at, count(x.id)::int AS files, count(x.id) FILTER (WHERE x.dog_id IS NOT NULL)::int AS matched
           FROM avatar_batches b JOIN dog_avatars x ON x.batch_id = b.id AND x.status = 'draft'
          GROUP BY b.id ORDER BY b.created_at DESC LIMIT 3`,
      );
      for (const x of b.rows) {
        needsYou.push({
          kind: "avatars",
          batchId: x.id,
          batchNumber: x.number,
          createdAt: x.created_at.toISOString(),
          files: x.files,
          matched: x.matched,
          needMatch: x.files - x.matched,
        });
      }
    }
    if (can("ngos")) {
      const n = await query<{ id: string; name: string; applied_at: Date }>(
        `SELECT id, name, applied_at FROM ngos WHERE status = 'waiting' ORDER BY applied_at LIMIT 5`,
      );
      for (const x of n.rows) needsYou.push({ kind: "ngo", ngoId: x.id, name: x.name, appliedAt: x.applied_at.toISOString() });
    }
    if (can("reports")) {
      const r = await query<{ id: string; kind: string; slug: string; name: string | null; created_at: Date }>(
        `SELECT r.id, r.kind, d.slug, d.name, r.created_at FROM reports r JOIN dogs d ON d.id = r.dog_id
          WHERE r.status = 'open' AND r.kind <> 'duplicate_dog' ORDER BY r.created_at LIMIT 5`,
      );
      for (const x of r.rows) {
        needsYou.push({ kind: "report", reportId: x.id, reportKind: x.kind, dog: { slug: x.slug, name: x.name }, createdAt: x.created_at.toISOString() });
      }
    }

    const v = vets.rows[0];
    const s = sos.rows[0];
    const rp = reports.rows[0];
    const now = Date.now();
    return {
      ok: true,
      data: {
        sidebar: {
          vets: can("vets") ? v.n : 0,
          ngos: can("ngos") ? ngos.rows[0].n : 0,
          avatars: can("avatars") ? avatars.rows[0].n : 0,
          reports: can("reports") ? rp.n : 0,
          sos: can("sos") ? s.n : 0,
        },
        cards: {
          vetsToVerify: { count: v.n, oldestWaitingDays: v.oldest ? Math.floor((now - v.oldest.getTime()) / 86_400_000) : null },
          avatarsToReview: {
            count: avatars.rows[0].n,
            batchId: avatars.rows[0].batch_id,
            batchNumber: avatars.rows[0].number,
            batchCreatedAt: iso(avatars.rows[0].batch_created_at),
          },
          openSos: { count: s.n, unassigned: s.unassigned, oldestUnassignedMin: s.oldest ? Math.floor((now - s.oldest.getTime()) / 60_000) : null },
          reports: { count: rp.n, duplicates: rp.dup, photos: rp.photo, other: rp.other },
        },
        needsYou,
        week: {
          newDogs: week.rows[0].new_dogs,
          vetSignedRecords: week.rows[0].signed,
          sosResolved: week.rows[0].resolved,
          sosTotal: week.rows[0].total,
          collarsIssued: week.rows[0].collars,
          vaccinationsDue14d: due.rows[0].n,
        },
      },
    };
  });

  // ---------------------------------------------------------------------------
  // Global search (the ⌘K box)
  // ---------------------------------------------------------------------------
  app.get("/api/v1/admin/search", async (req, reply) => {
    const a = await requireAdmin(req, reply);
    if (!a) return reply;
    if (
      !enforceLimits(req.log, reply, [
        { limiter: adminSearchPerAccount, key: `acct:${a.feederId}`, name: "adminSearchPerAccount", kind: "account" },
      ])
    ) {
      return reply;
    }
    const q = String((req.query as { q?: string }).q ?? "").trim().slice(0, 60);
    const empty = { dogs: [], feeders: [], vets: [], collars: [], ngos: [] };
    if (q.length < 2) return { ok: true, data: empty };
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const slugish = q.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wards = a.wards ?? [...ALL_WARDS];
    const out: Record<string, unknown[]> = { ...empty };
    if (a.permissions.has("dogs")) {
      const r = await query<any>(
        `SELECT d.slug, d.name, d.ward_id, d.status::text AS status, d.created_at, ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key,
                c.qr_code, c.batch_no,
                (SELECT count(DISTINCT s.feeder_id)::int FROM scans s WHERE s.dog_id = d.id AND s.scan_type = 'feed') AS feeders,
                (SELECT max(s.captured_at) FROM scans s WHERE s.dog_id = d.id AND s.scan_type = 'feed') AS last_fed_at
           FROM dogs d LEFT JOIN collars c ON c.dog_id = d.id
          WHERE d.merged_into IS NULL AND d.ward_id = ANY($3::text[])
            AND (d.name ILIKE $1 OR ($2 <> '' AND d.slug LIKE $2 || '%'))
          ORDER BY d.name LIMIT 8`,
        [like, slugish.length >= 3 ? slugish : "", wards],
      );
      out.dogs = r.rows.map((d) => dogRowOf(req, d));
    }
    if (a.permissions.has("feeders")) {
      const r = await query<any>(
        `${FEEDER_ROW_SQL} WHERE f.deleted_at IS NULL AND f.display_name ILIKE $1 ORDER BY f.display_name LIMIT 8`,
        [like],
      );
      out.feeders = r.rows.map(feederRowOf);
    }
    if (a.permissions.has("vets")) {
      const r = await query<VetProfileRow>(`${VET_PROFILE_SQL} WHERE f.display_name ILIKE $1 OR v.reg_no ILIKE $1 ORDER BY f.display_name LIMIT 8`, [like]);
      out.vets = r.rows.map(adminVetRowOf);
    }
    if (a.permissions.has("collars")) {
      const r = await query<any>(
        `${COLLAR_SQL} WHERE d.ward_id = ANY($3::text[]) AND (c.batch_no ILIKE $1 OR ($2 <> '' AND c.qr_code LIKE $2 || '%'))
          ORDER BY c.issued_at DESC LIMIT 8`,
        [like, slugish.length >= 3 ? slugish : "", wards],
      );
      out.collars = r.rows.map(collarRowOf);
    }
    if (a.permissions.has("ngos")) {
      const r = await query<any>(`${NGO_ROW_SQL} WHERE n.name ILIKE $1 ORDER BY n.name LIMIT 8`, [like]);
      out.ngos = r.rows.map(ngoRowOf);
    }
    return { ok: true, data: out };
  });

  // ---------------------------------------------------------------------------
  // A2 Vets
  // ---------------------------------------------------------------------------
  const STATUSES: VetStatus[] = ["invited", "waiting", "more_info", "verified", "suspended", "declined", "removed"];

  app.get("/api/v1/admin/vets", async (req, reply) => {
    const a = await requireAdmin(req, reply, "vets");
    if (!a) return reply;
    const status = (req.query as { status?: string }).status;
    if (status && !STATUSES.includes(status as VetStatus)) return err(reply, 400, "INVALID_STATUS", "unknown status");
    const [counts, rows] = await Promise.all([
      query<{ status: VetStatus; n: number }>(`SELECT status, count(*)::int AS n FROM vet_profiles GROUP BY status`),
      query<VetProfileRow>(
        `${VET_PROFILE_SQL} WHERE ($1::text IS NULL OR v.status = $1)
          ORDER BY (v.status = 'waiting') DESC, (v.vouched_by_ngo_id IS NOT NULL) DESC, v.applied_at NULLS LAST, v.created_at
          LIMIT 300`,
        [status ?? null],
      ),
    ]);
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<VetStatus, number>;
    for (const r of counts.rows) c[r.status] = r.n;
    return { ok: true, data: { counts: c, vets: rows.rows.map(adminVetRowOf) } };
  });

  app.get("/api/v1/admin/vets/:id", async (req, reply) => {
    const a = await requireAdmin(req, reply, "vets");
    if (!a) return reply;
    const id = uuidParam(req);
    const row = id ? await loadVetProfileRow("id", id) : null;
    if (!row) return err(reply, 404, "NOT_FOUND", "no such vet");
    return { ok: true, data: adminVetDetailOf(row, await documentsOf("vet_profile", row.id)) };
  });

  /**
   * One vet decision: a conditional UPDATE from the allowed statuses, the
   * audit row, a push to the vet, and the document deletion clock where the
   * application is decided. Answers the fresh detail.
   */
  const decide = (opts: {
    action: string;
    perm: "vets" | "vets_remove";
    from: VetStatus[];
    to: VetStatus;
    needsReason: boolean;
    decides: boolean;
    words: (name: string) => string;
    push?: { title: string; body: string };
  }) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await requireAdmin(req, reply, opts.perm);
      if (!a) return reply;
      if (!writeLimited(req, reply, a)) return reply;
      const id = uuidParam(req);
      if (!id) return err(reply, 400, "INVALID_ID", "bad id");
      if (opts.to === "suspended" || opts.to === "removed") {
        const own = await query(`SELECT 1 FROM vet_profiles WHERE id = $1 AND feeder_id = $2`, [id, a.feederId]);
        if ((own.rowCount ?? 0) > 0) return err(reply, 409, "CANNOT_TARGET_SELF", "you cannot do this to your own account");
      }
      let reason: string | null = null;
      let extra: Record<string, unknown> = {};
      if (opts.action === "vet.verify") {
        const b = z
          .strictObject({
            registerChecked: z.literal(true),
            validTo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(),
            note: z.string().trim().max(300).optional(),
          })
          .safeParse(req.body ?? {});
        if (!b.success) return err(reply, 400, "REGISTER_CHECK_REQUIRED", "tick 'Checked on the MSVC register' first");
        extra = { validTo: b.data.validTo ?? null, note: b.data.note ?? null };
      } else if (opts.action === "vet.remove") {
        const b = z.strictObject({ reason: z.string().trim().min(3).max(500), signatures: z.enum(["keep", "flag"]) }).safeParse(req.body ?? {});
        if (!b.success) return err(reply, 400, "INVALID_REMOVAL", "body must be { reason, signatures: keep | flag }");
        reason = b.data.reason;
        extra = { signatures: b.data.signatures };
      } else if (opts.needsReason) {
        const b = Reason.safeParse(req.body ?? {});
        if (!b.success) return err(reply, 400, "REASON_REQUIRED", "type the reason the vet will be told");
        reason = b.data.reason;
      }
      const done = await withTx(async (client) => {
        const upd = await client.query<{ id: string; feeder_id: string; name: string }>(
          `UPDATE vet_profiles v SET status = $2,
                  decided_at = CASE WHEN $4 THEN now() ELSE decided_at END,
                  decided_by = CASE WHEN $4 THEN $5::uuid ELSE decided_by END,
                  decision_reason = CASE WHEN $6::text IS NOT NULL THEN $6 WHEN $2 = 'verified' THEN NULL ELSE decision_reason END,
                  register_checked_at = CASE WHEN $2 = 'verified' AND $1::text = 'vet.verify' THEN now() ELSE register_checked_at END,
                  register_checked_by = CASE WHEN $2 = 'verified' AND $1::text = 'vet.verify' THEN $5::uuid ELSE register_checked_by END,
                  register_not_found_at = CASE WHEN $1::text = 'vet.verify' THEN NULL ELSE register_not_found_at END,
                  valid_to = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE valid_to END,
                  signatures_flagged_at = CASE WHEN $8 THEN now() ELSE signatures_flagged_at END,
                  updated_at = now()
             FROM feeders f
            WHERE v.id = $9 AND f.id = v.feeder_id AND v.status = ANY($3::text[])
            RETURNING v.id, v.feeder_id, f.display_name AS name`,
          [
            opts.action,
            opts.to,
            opts.from,
            opts.decides,
            a.feederId,
            reason,
            (extra.validTo as string | null) ?? null,
            extra.signatures === "flag",
            id,
          ],
        );
        const v = upd.rows[0];
        if (!v) return null;
        if (opts.decides) await scheduleDocumentDeletion(client, "vet_profile", v.id);
        if (opts.to === "removed") {
          // "Removing unlinks" a vet from their NGOs; their signatures stay
          // (default) or are flagged for re-check (signatures_flagged_at).
          await client.query(`UPDATE ngo_vets SET unlinked_at = now() WHERE vet_feeder_id = $1 AND unlinked_at IS NULL`, [v.feeder_id]);
        }
        if (opts.push) {
          await enqueueFeederPush(client, [v.feeder_id], {
            kind: "v7",
            title: opts.push.title,
            body: reason ? `${opts.push.body} ${reason}` : opts.push.body,
            url: "/vet",
            tag: `vet-${v.id}`,
          });
        }
        await audit(client, {
          actorId: a.feederId,
          actorKind: "admin",
          action: opts.action,
          subjectType: "vet_profile",
          subjectId: v.id,
          summary: opts.words(v.name) + (reason ? ` · reason: ${reason}` : ""),
          detail: extra,
        });
        return v;
      });
      if (!done) return err(reply, 409, "VET_STATUS", `this vet is not ${opts.from.join(" or ")}`);
      const row = await loadVetProfileRow("id", id);
      return { ok: true, data: adminVetDetailOf(row!, await documentsOf("vet_profile", id)) };
    };

  app.post(
    "/api/v1/admin/vets/:id/verify",
    decide({
      action: "vet.verify",
      perm: "vets",
      from: ["waiting", "more_info"],
      to: "verified",
      needsReason: false,
      decides: true,
      words: (n) => `verified ${n}`,
      push: { title: "You're verified", body: "You can now sign records as a vet on Hetja." },
    }),
  );
  app.post(
    "/api/v1/admin/vets/:id/ask-more",
    decide({
      action: "vet.ask_more",
      perm: "vets",
      from: ["waiting"],
      to: "more_info",
      needsReason: true,
      decides: false,
      words: (n) => `asked ${n} for more`,
      push: { title: "Hetja needs a little more", body: "About your vet application:" },
    }),
  );
  app.post(
    "/api/v1/admin/vets/:id/decline",
    decide({
      action: "vet.decline",
      perm: "vets",
      from: ["waiting", "more_info"],
      to: "declined",
      needsReason: true,
      decides: true,
      words: (n) => `declined ${n}`,
      push: { title: "Your vet application", body: "Hetja could not verify it." },
    }),
  );
  app.post(
    "/api/v1/admin/vets/:id/suspend",
    decide({
      action: "vet.suspend",
      perm: "vets",
      from: ["verified"],
      to: "suspended",
      needsReason: true,
      decides: false,
      words: (n) => `suspended ${n}`,
      push: { title: "Signing paused", body: "Hetja suspended your vet account." },
    }),
  );
  app.post(
    "/api/v1/admin/vets/:id/reinstate",
    decide({
      action: "vet.reinstate",
      perm: "vets",
      from: ["suspended"],
      to: "verified",
      needsReason: false,
      decides: false,
      words: (n) => `reinstated ${n}`,
      push: { title: "Signing is back on", body: "Your vet account is active again." },
    }),
  );
  app.post(
    "/api/v1/admin/vets/:id/remove",
    decide({
      action: "vet.remove",
      perm: "vets_remove",
      from: ["verified", "suspended", "waiting", "more_info", "invited"],
      to: "removed",
      needsReason: true,
      decides: true,
      words: (n) => `removed ${n}`,
    }),
  );

  /**
   * Flag a vet's past signatures for re-check, or clear the flag, whatever
   * the vet's status (a suspended vet's too, not only on removal). Flagged
   * records show `flagged: true` on the health list; nothing in
   * medical_records changes. Audited.
   */
  app.post("/api/v1/admin/vets/:id/flag-signatures", async (req, reply) => {
    const a = await requireAdmin(req, reply, "vets");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const id = uuidParam(req);
    const b = z.strictObject({ flag: z.boolean(), reason: z.string().trim().min(3).max(300) }).safeParse(req.body ?? {});
    if (!id || !b.success) return err(reply, 400, "INVALID_FLAG", "body must be { flag: boolean, reason }");
    const done = await withTx(async (client) => {
      const u = await client.query<{ name: string; feeder_id: string }>(
        `UPDATE vet_profiles v SET signatures_flagged_at = CASE WHEN $2 THEN COALESCE(signatures_flagged_at, now()) ELSE NULL END,
                updated_at = now()
           FROM feeders f WHERE v.id = $1 AND f.id = v.feeder_id RETURNING f.display_name AS name, v.feeder_id`,
        [id, b.data.flag],
      );
      if (!u.rows[0]) return null;
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: b.data.flag ? "vet.flag_signatures" : "vet.unflag_signatures",
        subjectType: "vet_profile",
        subjectId: id,
        summary: `${b.data.flag ? "flagged" : "cleared the flag on"} ${u.rows[0].name}'s signatures for re-check · reason: ${b.data.reason}`,
      });
      return u.rows[0];
    });
    if (!done) return err(reply, 404, "NOT_FOUND", "no such vet");
    const row = await loadVetProfileRow("id", id);
    return { ok: true, data: adminVetDetailOf(row!, await documentsOf("vet_profile", id)) };
  });

  /** A2: "Not found" on the MSVC register (shown red). Separate from Decline; Verify clears it. */
  app.post("/api/v1/admin/vets/:id/not-on-register", async (req, reply) => {
    const a = await requireAdmin(req, reply, "vets");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const id = uuidParam(req);
    const b = z.strictObject({ note: z.string().trim().max(300).optional(), found: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!id || !b.success) return err(reply, 400, "INVALID_REGISTER_CHECK", "body must be { note?, found? }");
    const notFound = b.data.found !== true;
    const done = await withTx(async (client) => {
      const u = await client.query<{ name: string }>(
        `UPDATE vet_profiles v SET register_not_found_at = CASE WHEN $2 THEN now() ELSE NULL END,
                register_not_found_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END, updated_at = now()
           FROM feeders f WHERE v.id = $1 AND f.id = v.feeder_id RETURNING f.display_name AS name`,
        [id, notFound, a.feederId],
      );
      if (!u.rows[0]) return false;
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: notFound ? "vet.not_on_register" : "vet.on_register",
        subjectType: "vet_profile",
        subjectId: id,
        summary: notFound ? `could not find ${u.rows[0].name} on the MSVC register` : `cleared the register flag on ${u.rows[0].name}`,
        detail: { note: b.data.note ?? null },
      });
      return true;
    });
    if (!done) return err(reply, 404, "NOT_FOUND", "no such vet");
    const row = await loadVetProfileRow("id", id);
    return { ok: true, data: adminVetDetailOf(row!, await documentsOf("vet_profile", id)) };
  });

  app.post("/api/v1/admin/vets/invite", async (req, reply) => {
    const a = await requireAdmin(req, reply, "vets");
    if (!a) return reply;
    if (!enforceLimits(req.log, reply, [{ limiter: invitePerAccount, key: `acct:${a.feederId}`, name: "invitePerAccount", kind: "account" }])) {
      return reply;
    }
    const b = z
      .strictObject({ email: z.string().trim().email().max(254), name: z.string().trim().max(80).optional(), ngoId: z.string().uuid().nullable().optional() })
      .safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_INVITE", "body must be { email, name?, ngoId? }");
    const pepper = app.config.HETJA_HMAC_PEPPER;
    const existing = await accountForEmail(b.data.email, pepper);
    const id = await withTx(async (client) => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO invites (kind, identity_hmac, ngo_id, invited_by) VALUES ('vet', $1, $2, $3) RETURNING id`,
        [inviteHmac(b.data.email, pepper), b.data.ngoId ?? null, a.feederId],
      );
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "vet.invite",
        subjectType: "invite",
        subjectId: ins.rows[0].id,
        summary: `invited ${b.data.name ? b.data.name : "a vet"}`,
      });
      return ins.rows[0].id;
    });
    if (existing) await claimInvites(existing);
    else await mailInvite(app, b.data.email, "as a vet");
    return reply.status(201).send({ ok: true, data: { id, existingAccount: existing !== null } });
  });

  const linkCare = (table: "vet_profiles" | "ngos", perm: "vets" | "ngos", subject: string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await requireAdmin(req, reply, perm);
      if (!a) return reply;
      if (!writeLimited(req, reply, a)) return reply;
      const id = uuidParam(req);
      const b = z.strictObject({ careProviderId: z.string().uuid().nullable() }).safeParse(req.body ?? {});
      if (!id || !b.success) return err(reply, 400, "INVALID_LINK", "body must be { careProviderId | null }");
      if (b.data.careProviderId) {
        const c = await query(`SELECT 1 FROM care_providers WHERE id = $1`, [b.data.careProviderId]);
        if ((c.rowCount ?? 0) === 0) return err(reply, 404, "NOT_FOUND", "no such directory entry");
      }
      const done = await withTx(async (client) => {
        const u = await client.query(`UPDATE ${table} SET care_provider_id = $2, updated_at = now() WHERE id = $1`, [id, b.data.careProviderId]);
        if ((u.rowCount ?? 0) === 0) return false;
        await audit(client, {
          actorId: a.feederId,
          actorKind: "admin",
          action: `${subject}.link_care`,
          subjectType: table === "ngos" ? "ngo" : "vet_profile",
          subjectId: id,
          summary: b.data.careProviderId ? `linked a ${subject} to its directory entry` : `unlinked a ${subject} from the directory`,
          detail: { careProviderId: b.data.careProviderId },
        });
        return true;
      });
      if (!done) return err(reply, 404, "NOT_FOUND", `no such ${subject}`);
      return { ok: true, data: { careProviderId: b.data.careProviderId } };
    };
  app.post("/api/v1/admin/vets/:id/link-care", linkCare("vet_profiles", "vets", "vet"));
  app.post("/api/v1/admin/ngos/:id/link-care", linkCare("ngos", "ngos", "ngo"));

  // ---------------------------------------------------------------------------
  // Documents: admins only, every open audited, never cached
  // ---------------------------------------------------------------------------
  app.get("/api/v1/admin/documents/:id", async (req, reply) => {
    const a = await requireAdmin(req, reply);
    if (!a) return reply;
    const id = uuidParam(req);
    if (!id) return err(reply, 400, "INVALID_ID", "bad id");
    const d = await query<{ owner_kind: string; kind: string; mime: string; blob_key: string | null; deleted_at: Date | null }>(
      `SELECT owner_kind, kind, mime, blob_key, deleted_at FROM documents WHERE id = $1`,
      [id],
    );
    const doc = d.rows[0];
    if (!doc || doc.owner_kind === "pending") return err(reply, 404, "NOT_FOUND", "no such document");
    const perm = doc.owner_kind === "ngo" ? "ngos" : "vets";
    if (!a.permissions.has(perm)) return err(reply, 403, "ADMIN_FORBIDDEN", `your role cannot do this (${perm})`);
    if (
      !enforceLimits(req.log, reply, [
        { limiter: documentViewPerAccount, key: `acct:${a.feederId}`, name: "documentViewPerAccount", kind: "account" },
      ])
    ) {
      return reply;
    }
    if (doc.deleted_at || !doc.blob_key) return err(reply, 410, "DOCUMENT_DELETED", "this document was deleted after the decision");
    let bytes: Buffer;
    try {
      bytes = await readDocument(app.config, id, doc.blob_key);
    } catch {
      return err(reply, 503, "DOCUMENTS_UNAVAILABLE", "the document could not be read");
    }
    await audit(null, {
      actorId: a.feederId,
      actorKind: "admin",
      action: "document.view",
      subjectType: "document",
      subjectId: id,
      summary: `opened a ${doc.kind.replace("_", " ")}`,
    });
    const ext = doc.mime === "application/pdf" ? "pdf" : doc.mime.split("/")[1];
    return reply
      .header("Content-Type", doc.mime)
      .header("Content-Disposition", `attachment; filename="${doc.kind}-${id}.${ext}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(bytes);
  });

  // ---------------------------------------------------------------------------
  // A7 NGOs
  // ---------------------------------------------------------------------------
  const NGO_STATUSES: NgoStatus[] = ["waiting", "active", "paused", "removed"];

  app.get("/api/v1/admin/ngos", async (req, reply) => {
    const a = await requireAdmin(req, reply, "ngos");
    if (!a) return reply;
    const status = (req.query as { status?: string }).status;
    if (status && !NGO_STATUSES.includes(status as NgoStatus)) return err(reply, 400, "INVALID_STATUS", "unknown status");
    const [counts, rows] = await Promise.all([
      query<{ status: NgoStatus; n: number }>(`SELECT status, count(*)::int AS n FROM ngos GROUP BY status`),
      query<any>(`${NGO_ROW_SQL} WHERE ($1::text IS NULL OR n.status = $1) ORDER BY (n.status = 'waiting') DESC, n.name LIMIT 300`, [status ?? null]),
    ]);
    const c = Object.fromEntries(NGO_STATUSES.map((s) => [s, 0])) as Record<NgoStatus, number>;
    for (const r of counts.rows) c[r.status] = r.n;
    return { ok: true, data: { counts: c, ngos: rows.rows.map(ngoRowOf) } };
  });

  async function ngoDetail(id: string) {
    const n = await loadNgoRow(id);
    if (!n) return null;
    const [row, vets, members, docs] = await Promise.all([
      query<any>(`${NGO_ROW_SQL} WHERE n.id = $1`, [id]),
      query<{ vet_feeder_id: string; display_name: string; status: VetStatus | null; vouched_at: Date | null }>(
        `SELECT v.vet_feeder_id, f.display_name, vp.status, v.vouched_at FROM ngo_vets v
           JOIN feeders f ON f.id = v.vet_feeder_id LEFT JOIN vet_profiles vp ON vp.feeder_id = v.vet_feeder_id
          WHERE v.ngo_id = $1 AND v.unlinked_at IS NULL ORDER BY f.display_name`,
        [id],
      ),
      query<{ n: number }>(`SELECT count(*)::int AS n FROM ngo_members WHERE ngo_id = $1 AND left_at IS NULL`, [id]),
      documentsOf("ngo", id),
    ]);
    const r = ngoRowOf(row.rows[0]);
    return {
      ...ngoProfileOf(n),
      vetCount: r.vets,
      dogCount: r.dogs,
      sos30d: r.sos30d,
      members: members.rows[0].n,
      vetList: vets.rows.map((v) => ({ feederId: v.vet_feeder_id, name: v.display_name, status: v.status ?? "invited", vouched: v.vouched_at !== null })),
      documents: docs,
      careProviderId: n.care_provider_id,
    };
  }

  app.get("/api/v1/admin/ngos/:id", async (req, reply) => {
    const a = await requireAdmin(req, reply, "ngos");
    if (!a) return reply;
    const id = uuidParam(req);
    const d = id ? await ngoDetail(id) : null;
    if (!d) return err(reply, 404, "NOT_FOUND", "no such NGO");
    return { ok: true, data: d };
  });

  const NgoFields = z.strictObject({
    name: z.string().trim().min(2).max(120),
    regType: z.enum(["trust", "society", "section8", "other"]),
    regNo: z.string().trim().min(1).max(64),
    since: z.number().int().min(1800).max(2100).nullable().optional(),
    has80g: z.boolean().optional(),
    wards: z.array(z.string()).max(24),
    citywide: z.boolean().optional(),
    offers: z.strictObject({ ambulance: z.boolean(), shelterBeds: z.boolean(), sterilisation: z.boolean(), collars: z.boolean() }),
    contactName: z.string().trim().min(1).max(80),
    publicPhone: z.string().trim().min(6).max(32),
    coordinatorEmail: z.string().trim().email().max(254).optional(),
  });

  app.post("/api/v1/admin/ngos", async (req, reply) => {
    const a = await requireAdmin(req, reply, "ngos");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const b = NgoFields.safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_NGO", "invalid NGO");
    const n = b.data;
    if (!validWards(n.wards) || (!n.citywide && n.wards.length === 0)) return err(reply, 400, "INVALID_WARDS", "NGOs may only cover Mumbai BMC wards");
    const phone = publicPhone(n.publicPhone);
    if (!phone) return err(reply, 400, "INVALID_PHONE", "that is not a valid Indian phone number");
    const pepper = app.config.HETJA_HMAC_PEPPER;
    const existing = n.coordinatorEmail ? await accountForEmail(n.coordinatorEmail, pepper) : null;
    const id = await withTx(async (client) => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO ngos (name, reg_type, reg_no, since_year, has_80g, wards, citywide, offers_ambulance, offers_shelter,
                           offers_sterilisation, offers_collars, contact_name, phone_e164, status, decided_at, decided_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', now(), $14) RETURNING id`,
        [
          n.name, n.regType, n.regNo, n.since ?? null, n.has80g ?? false, n.wards, n.citywide ?? false, n.offers.ambulance,
          n.offers.shelterBeds, n.offers.sterilisation, n.offers.collars, n.contactName, phone, a.feederId,
        ],
      );
      if (n.coordinatorEmail) {
        await client.query(
          `INSERT INTO invites (kind, identity_hmac, role, ngo_id, invited_by) VALUES ('ngo_member', $1, 'coordinator', $2, $3)`,
          [inviteHmac(n.coordinatorEmail, pepper), ins.rows[0].id, a.feederId],
        );
      }
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "ngo.create",
        subjectType: "ngo",
        subjectId: ins.rows[0].id,
        summary: `added ${n.name}`,
      });
      return ins.rows[0].id;
    });
    if (existing) await claimInvites(existing);
    else if (n.coordinatorEmail) await mailInvite(app, n.coordinatorEmail, `as the coordinator of ${n.name}`);
    return reply.status(201).send({ ok: true, data: await ngoDetail(id) });
  });

  app.patch("/api/v1/admin/ngos/:id", async (req, reply) => {
    const a = await requireAdmin(req, reply, "ngos");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const id = uuidParam(req);
    const b = NgoFields.omit({ coordinatorEmail: true }).partial().safeParse(req.body ?? {});
    if (!id || !b.success || Object.keys(b.data).length === 0) return err(reply, 400, "INVALID_NGO", "invalid NGO change");
    const p = b.data;
    if (p.wards && !validWards(p.wards)) return err(reply, 400, "INVALID_WARDS", "NGOs may only cover Mumbai BMC wards");
    const phone = p.publicPhone !== undefined ? publicPhone(p.publicPhone) : undefined;
    if (p.publicPhone !== undefined && !phone) return err(reply, 400, "INVALID_PHONE", "that is not a valid Indian phone number");
    const done = await withTx(async (client) => {
      const u = await client.query(
        `UPDATE ngos SET name = COALESCE($2, name), reg_type = COALESCE($3, reg_type), reg_no = COALESCE($4, reg_no),
                since_year = CASE WHEN $5 THEN $6 ELSE since_year END, has_80g = COALESCE($7, has_80g), wards = COALESCE($8, wards),
                citywide = COALESCE($9, citywide), offers_ambulance = COALESCE($10, offers_ambulance),
                offers_shelter = COALESCE($11, offers_shelter), offers_sterilisation = COALESCE($12, offers_sterilisation),
                offers_collars = COALESCE($13, offers_collars), contact_name = COALESCE($14, contact_name),
                phone_e164 = COALESCE($15, phone_e164), updated_at = now()
          WHERE id = $1`,
        [
          id, p.name ?? null, p.regType ?? null, p.regNo ?? null, p.since !== undefined, p.since ?? null, p.has80g ?? null,
          p.wards ?? null, p.citywide ?? null, p.offers?.ambulance ?? null, p.offers?.shelterBeds ?? null,
          p.offers?.sterilisation ?? null, p.offers?.collars ?? null, p.contactName ?? null, phone ?? null,
        ],
      );
      if ((u.rowCount ?? 0) === 0) return false;
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "ngo.edit",
        subjectType: "ngo",
        subjectId: id,
        summary: `edited an NGO's details`,
        detail: { fields: Object.keys(p) },
      });
      return true;
    });
    if (!done) return err(reply, 404, "NOT_FOUND", "no such NGO");
    return { ok: true, data: await ngoDetail(id!) };
  });

  const ngoDecide = (action: string, perm: "ngos" | "ngos_remove", from: NgoStatus[], to: NgoStatus, needsReason: boolean, decides: boolean, words: string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await requireAdmin(req, reply, perm);
      if (!a) return reply;
      if (!writeLimited(req, reply, a)) return reply;
      const id = uuidParam(req);
      if (!id) return err(reply, 400, "INVALID_ID", "bad id");
      let reason: string | null = null;
      if (needsReason) {
        const b = Reason.safeParse(req.body ?? {});
        if (!b.success) return err(reply, 400, "REASON_REQUIRED", "type a reason");
        reason = b.data.reason;
      }
      const done = await withTx(async (client) => {
        const u = await client.query<{ name: string }>(
          `UPDATE ngos SET status = $2, decision_reason = COALESCE($4, decision_reason),
                  decided_at = CASE WHEN $5 THEN now() ELSE decided_at END,
                  decided_by = CASE WHEN $5 THEN $6::uuid ELSE decided_by END, updated_at = now()
            WHERE id = $1 AND status = ANY($3::text[]) RETURNING name`,
          [id, to, from, reason, decides, a.feederId],
        );
        if (!u.rows[0]) return null;
        if (decides) await scheduleDocumentDeletion(client, "ngo", id);
        if (to === "removed") {
          // "Removing unlinks its vets but keeps their verification."
          await client.query(`UPDATE ngo_vets SET unlinked_at = now() WHERE ngo_id = $1 AND unlinked_at IS NULL`, [id]);
          await client.query(`UPDATE ngo_members SET left_at = now() WHERE ngo_id = $1 AND left_at IS NULL`, [id]);
        }
        const coords = await client.query<{ feeder_id: string }>(
          `SELECT feeder_id FROM ngo_members WHERE ngo_id = $1 AND role = 'coordinator' AND left_at IS NULL`,
          [id],
        );
        await enqueueFeederPush(client, coords.rows.map((c) => c.feeder_id), {
          kind: "v7",
          title: u.rows[0].name,
          body: `Hetja ${words} ${u.rows[0].name}.${reason ? ` ${reason}` : ""}`,
          url: "/ngo",
          tag: `ngo-${id}`,
        });
        await audit(client, {
          actorId: a.feederId,
          actorKind: "admin",
          action,
          subjectType: "ngo",
          subjectId: id,
          summary: `${words} ${u.rows[0].name}${reason ? ` · reason: ${reason}` : ""}`,
        });
        return true;
      });
      if (!done) return err(reply, 409, "NGO_STATUS", `this NGO is not ${from.join(" or ")}`);
      return { ok: true, data: await ngoDetail(id) };
    };
  app.post("/api/v1/admin/ngos/:id/approve", ngoDecide("ngo.approve", "ngos", ["waiting"], "active", false, true, "approved"));
  app.post("/api/v1/admin/ngos/:id/pause", ngoDecide("ngo.pause", "ngos", ["active"], "paused", true, false, "paused"));
  app.post("/api/v1/admin/ngos/:id/resume", ngoDecide("ngo.resume", "ngos", ["paused"], "active", false, false, "resumed"));
  app.post("/api/v1/admin/ngos/:id/remove", ngoDecide("ngo.remove", "ngos_remove", ["waiting", "active", "paused"], "removed", true, true, "removed"));

  app.get("/api/v1/admin/care", async (req, reply) => {
    const a = await requireAdmin(req, reply);
    if (!a) return reply;
    if (!a.permissions.has("vets") && !a.permissions.has("ngos")) return err(reply, 403, "ADMIN_FORBIDDEN", "your role cannot do this");
    const q = String((req.query as { q?: string }).q ?? "").trim().slice(0, 60);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const r = await query<any>(
      `SELECT id, name, kind::text AS kind, is_person, (is_government OR kind = 'govt') AS is_government, reg_no, wards, phone_e164, listed
         FROM care_providers WHERE ($1 = '' OR name ILIKE $2 OR reg_no ILIKE $2) ORDER BY listed DESC, name LIMIT 30`,
      [q, like],
    );
    return {
      ok: true,
      data: {
        entries: r.rows.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          isPerson: c.is_person,
          isGovernment: c.is_government,
          regNo: c.reg_no,
          wards: c.wards ?? [],
          phoneE164: c.phone_e164,
          listed: c.listed,
        })),
      },
    };
  });

  // ---------------------------------------------------------------------------
  // A6 Team and roles
  // ---------------------------------------------------------------------------
  app.get("/api/v1/admin/team", async (req, reply) => {
    const a = await requireAdmin(req, reply, "team_read");
    if (!a) return reply;
    const hmacs = [...ownerHmacs(app.config.HETJA_OWNER_EMAILS, app.config.HETJA_HMAC_PEPPER)];
    const rows = await query<{ id: string; display_name: string; identity_hmac: string; role: string }>(
      `SELECT f.id, f.display_name, f.identity_hmac, f.role::text AS role FROM feeders f
        WHERE f.deleted_at IS NULL AND (f.role = 'admin' OR f.identity_hmac = ANY($1::text[])
              OR EXISTS (SELECT 1 FROM admin_roles r WHERE r.feeder_id = f.id AND r.revoked_at IS NULL))
        ORDER BY f.display_name`,
      [hmacs],
    );
    const { loadAdmin } = await import("../lib/admin.js");
    const members = [];
    for (const f of rows.rows) {
      const m = await loadAdmin(f.id, app.config);
      if (m) members.push({ feederId: f.id, name: f.display_name, roles: m.roles });
    }
    const invites = await query<{ id: string; role: AdminRole; wards: string[]; created_at: Date; by: string | null }>(
      `SELECT i.id, i.role, i.wards, i.created_at, f.display_name AS by FROM invites i LEFT JOIN feeders f ON f.id = i.invited_by
        WHERE i.kind = 'team' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC`,
    );
    return {
      ok: true,
      data: {
        members,
        invites: invites.rows.map((i) => ({ id: i.id, role: i.role, wards: i.wards ?? [], createdAt: i.created_at.toISOString(), invitedBy: i.by })),
      },
    };
  });

  const RoleInput = z.strictObject({
    role: z.enum(ADMIN_ROLES as unknown as [AdminRole, ...AdminRole[]]),
    wards: z.array(z.string()).max(24).optional(),
  });

  app.post("/api/v1/admin/team", async (req, reply) => {
    const a = await requireAdmin(req, reply, "team");
    if (!a) return reply;
    if (!enforceLimits(req.log, reply, [{ limiter: invitePerAccount, key: `acct:${a.feederId}`, name: "invitePerAccount", kind: "account" }])) {
      return reply;
    }
    const b = RoleInput.extend({ email: z.string().trim().email().max(254) }).safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_TEAM", "body must be { email, role, wards? }");
    const wards = b.data.role === "ward_lead" ? (b.data.wards ?? []) : [];
    if (b.data.role === "ward_lead" && (wards.length === 0 || !validWards(wards))) {
      return err(reply, 400, "INVALID_WARDS", "a ward lead needs Mumbai wards");
    }
    const pepper = app.config.HETJA_HMAC_PEPPER;
    const existing = await accountForEmail(b.data.email, pepper);
    const out = await withTx(async (client) => {
      if (existing) {
        await client.query(
          `INSERT INTO admin_roles (feeder_id, role, wards, granted_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (feeder_id, role) WHERE revoked_at IS NULL DO UPDATE SET wards = EXCLUDED.wards`,
          [existing, b.data.role, wards, a.feederId],
        );
      } else {
        await client.query(`INSERT INTO invites (kind, identity_hmac, role, wards, invited_by) VALUES ('team', $1, $2, $3, $4)`, [
          inviteHmac(b.data.email, pepper),
          b.data.role,
          wards,
          a.feederId,
        ]);
      }
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: existing ? "team.grant" : "team.invite",
        subjectType: existing ? "feeder" : "invite",
        subjectId: existing,
        summary: `${existing ? "made someone" : "invited someone as"} ${b.data.role.replace("_", " ")}${wards.length ? ` · ${wards.map((w) => wardDisplay(w).code).join(", ")}` : ""}`,
      });
      return { granted: existing !== null, invited: existing === null };
    });
    if (!existing) await mailInvite(app, b.data.email, "as part of the admin team");
    return reply.status(201).send({ ok: true, data: out });
  });

  app.post("/api/v1/admin/team/:feederId/role", async (req, reply) => {
    const a = await requireAdmin(req, reply, "team");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const who = uuidParam(req, "feederId");
    const b = RoleInput.safeParse(req.body ?? {});
    if (!who || !b.success) return err(reply, 400, "INVALID_TEAM", "body must be { role, wards? }");
    const wards = b.data.role === "ward_lead" ? (b.data.wards ?? []) : [];
    if (b.data.role === "ward_lead" && (wards.length === 0 || !validWards(wards))) return err(reply, 400, "INVALID_WARDS", "a ward lead needs Mumbai wards");
    if (who === a.feederId && b.data.role !== "owner") return err(reply, 409, "CANNOT_DEMOTE_SELF", "ask another owner to change your role");
    if (who !== a.feederId) {
      const held = await rolesHeldBy(who, app.config);
      const losesOwner = !!held?.roles.some((x) => x.role === "owner") && b.data.role !== "owner";
      const refused = await guardAccountAction(a, who, app.config, { losesOwner });
      if (refused) return err(reply, refused.status, refused.code, refused.message);
    }
    const name = await withTx(async (client) => {
      const f = await client.query<{ display_name: string }>(`SELECT display_name FROM feeders WHERE id = $1 AND deleted_at IS NULL`, [who]);
      if (!f.rows[0]) return null;
      await client.query(`UPDATE admin_roles SET revoked_at = now(), revoked_by = $2 WHERE feeder_id = $1 AND revoked_at IS NULL AND role <> $3`, [
        who,
        a.feederId,
        b.data.role,
      ]);
      await client.query(
        `INSERT INTO admin_roles (feeder_id, role, wards, granted_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (feeder_id, role) WHERE revoked_at IS NULL DO UPDATE SET wards = EXCLUDED.wards`,
        [who, b.data.role, wards, a.feederId],
      );
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "team.role",
        subjectType: "feeder",
        subjectId: who,
        summary: `changed ${publicName(f.rows[0].display_name)} to ${b.data.role.replace("_", " ")}`,
      });
      return f.rows[0].display_name;
    });
    if (!name) return err(reply, 404, "NOT_FOUND", "no such account");
    const { loadAdmin } = await import("../lib/admin.js");
    return { ok: true, data: { roles: (await loadAdmin(who, app.config))?.roles ?? [] } };
  });

  app.post("/api/v1/admin/team/:feederId/remove", async (req, reply) => {
    const a = await requireAdmin(req, reply, "team");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const who = uuidParam(req, "feederId");
    if (!who) return err(reply, 400, "INVALID_ID", "bad id");
    if (who === a.feederId) return err(reply, 409, "CANNOT_REMOVE_SELF", "ask another owner to remove you");
    const refused = await guardAccountAction(a, who, app.config);
    if (refused) return err(reply, refused.status, refused.code, refused.message);
    const rb = z.strictObject({ reason: z.string().trim().max(300).optional() }).safeParse(req.body ?? {});
    if (!rb.success) return err(reply, 400, "INVALID_REASON", "body may carry { reason }");
    const reason = rb.data.reason ?? null;
    const n = await withTx(async (client) => {
      const u = await client.query(`UPDATE admin_roles SET revoked_at = now(), revoked_by = $2 WHERE feeder_id = $1 AND revoked_at IS NULL`, [
        who,
        a.feederId,
      ]);
      if ((u.rowCount ?? 0) > 0) {
        await audit(client, {
          actorId: a.feederId,
          actorKind: "admin",
          action: "team.remove",
          subjectType: "feeder",
          subjectId: who,
          summary: `removed someone from the team${reason ? ` · reason: ${reason}` : ""}`,
        });
      }
      return u.rowCount ?? 0;
    });
    if (n === 0) {
      return err(reply, 409, "ROLE_NOT_GRANTED", "no granted role to remove (an owner from HETJA_OWNER_EMAILS or pnpm admin:grant is removed there)");
    }
    return { ok: true, data: { removed: true } };
  });

  // ---------------------------------------------------------------------------
  // A6 Audit log
  // ---------------------------------------------------------------------------
  const AUDIT_SQL = `
    SELECT l.id, l.at, l.actor_id, f.display_name AS actor_name, l.actor_kind, l.action, l.subject_type, l.subject_id, l.summary, l.detail
      FROM audit_log l LEFT JOIN feeders f ON f.id = l.actor_id`;

  const auditEntryOf = (r: any) => ({
    id: r.id,
    at: r.at.toISOString(),
    actor: { id: r.actor_id, name: r.actor_name ? publicName(r.actor_name) : null, kind: r.actor_kind },
    action: r.action,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    summary: r.summary,
    detail: r.detail ?? {},
  });

  app.get("/api/v1/admin/audit", async (req, reply) => {
    const a = await requireAdmin(req, reply, "audit");
    if (!a) return reply;
    const q = z
      .object({
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        action: z.string().max(64).optional(),
        subjectId: z.string().max(64).optional(),
      })
      .safeParse(req.query ?? {});
    if (!q.success) return err(reply, 400, "INVALID_QUERY", "bad audit query");
    const r = await query<any>(
      `${AUDIT_SQL}
        WHERE ($1::timestamptz IS NULL OR l.at < $1) AND ($2::text IS NULL OR l.action LIKE $2 || '%')
          AND ($3::text IS NULL OR l.subject_id = $3)
        ORDER BY l.at DESC, l.id DESC LIMIT $4`,
      [q.data.before ?? null, q.data.action ?? null, q.data.subjectId ?? null, q.data.limit + 1],
    );
    const entries = r.rows.slice(0, q.data.limit).map(auditEntryOf);
    return { ok: true, data: { entries, nextBefore: r.rows.length > q.data.limit ? entries[entries.length - 1].at : null } };
  });

  app.get("/api/v1/admin/audit.csv", async (req, reply) => {
    const a = await requireAdmin(req, reply, "audit");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const r = await query<any>(`${AUDIT_SQL} ORDER BY l.at DESC, l.id DESC LIMIT 50000`);
    const cell = (v: unknown) => {
      const s = v == null ? "" : String(v);
      // A leading = + - @ would be a formula in a spreadsheet: neutralise it.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = ["at,actor,actor_kind,action,subject_type,subject_id,summary"];
    for (const e of r.rows.map(auditEntryOf)) {
      lines.push([e.at, e.actor.name, e.actor.kind, e.action, e.subjectType, e.subjectId, e.summary].map(cell).join(","));
    }
    await audit(null, { actorId: a.feederId, actorKind: "admin", action: "audit.export", summary: `exported the audit log (${r.rows.length} rows)` });
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="hetja-audit-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(lines.join("\n") + "\n");
  });

  // ---------------------------------------------------------------------------
  // Settings (read-only)
  // ---------------------------------------------------------------------------
  app.get("/api/v1/admin/settings", async (req, reply) => {
    const a = await requireAdmin(req, reply, "settings");
    if (!a) return reply;
    return {
      ok: true,
      data: {
        sos: {
          escalateAfterMin: 8,
          ngoWindowMin: NGO_WINDOW_MINUTES,
          trustFloors: TRUST_FLOOR,
          maxOpenAcks: MAX_OPEN_ACKS,
          dailyCap: 2,
          weeklyCap: 5,
          maxPaged: 15,
        },
        retention: { photoDays: Number(process.env.HETJA_PHOTO_TTL_DAYS ?? 7), documentDaysAfterDecision: 30, avatarPreviousDays: 30 },
        budgets: { scanPageKb: 40, feedTrustDailyCap: FEED_TRUST_DAILY_CAP },
        limits: [
          { name: "SOS reports", rule: "2 a day and 5 a week per phone or account (INVARIANT 7)" },
          { name: "Dogless SOS", rule: "3 a day per phone or account, 6 a day per address" },
          { name: "Scans", rule: "burst 30, then 1 a minute per phone or account" },
          { name: "Registrations", rule: "2 waiting and 6 a week per account and per phone" },
          { name: "Report a problem", rule: "10 a day per phone or account, 20 an hour per address, 20 a day per dog" },
          { name: "Vet signing", rule: "burst 40, then 200 a day per vet" },
          { name: "Documents", rule: "12 uploads a day per account; PDF up to 5 MB, images up to 2 MB" },
          { name: "Admin writes", rule: "burst 60, then 1 every 5 s per admin" },
        ],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Row shapes shared with admin-content.ts
// ---------------------------------------------------------------------------

export function dogRowOf(req: FastifyRequest, d: any) {
  return {
    slug: d.slug,
    name: d.name,
    wardId: d.ward_id,
    wardCode: wardDisplay(d.ward_id).code,
    status: d.status,
    photoUrl: photoUrlFor(req, d.photo_key),
    avatarUrl: photoUrlFor(req, d.avatar_key),
    collar: d.qr_code ? { code: slugCode(d.qr_code), batchNo: d.batch_no ?? null } : null,
    createdAt: new Date(d.created_at).toISOString(),
    feeders: d.feeders ?? 0,
    lastFedAt: iso(d.last_fed_at),
  };
}

export const FEEDER_ROW_SQL = `
  SELECT f.id, f.display_name, f.trust_score, f.wards, f.created_at, f.suspended_at,
         (SELECT count(DISTINCT s.dog_id)::int FROM scans s WHERE s.feeder_id = f.id AND s.scan_type = 'feed') AS dogs,
         (SELECT count(*)::int FROM scans s WHERE s.feeder_id = f.id AND s.scan_type = 'feed' AND s.received_at >= now() - interval '30 days') AS feeds30d
    FROM feeders f`;

export function feederRowOf(f: any) {
  return {
    id: f.id,
    name: f.display_name,
    trust: f.trust_score,
    wards: f.wards ?? [],
    createdAt: new Date(f.created_at).toISOString(),
    suspended: f.suspended_at !== null,
    dogs: f.dogs,
    feeds30d: f.feeds30d,
  };
}

export const COLLAR_SQL = `
  SELECT c.qr_code, c.batch_no, c.material, c.issued_at, c.status, d.slug, d.name, d.ward_id,
         (SELECT count(*)::int FROM tag_prints p WHERE p.dog_id = d.id) AS prints,
         (SELECT count(*)::int FROM collar_reissues r WHERE r.dog_id = d.id) AS reissues
    FROM collars c JOIN dogs d ON d.id = c.dog_id`;

export function collarRowOf(c: any) {
  return {
    slug: c.slug,
    code: slugCode(c.qr_code),
    dogName: c.name,
    wardId: c.ward_id,
    batchNo: c.batch_no,
    material: c.material,
    issuedAt: new Date(c.issued_at).toISOString(),
    status: c.status,
    prints: c.prints,
    reissues: c.reissues,
  };
}

export const NGO_ROW_SQL = `
  SELECT n.id, n.name, n.wards, n.citywide, n.status, n.applied_at,
         (SELECT count(*)::int FROM ngo_vets v WHERE v.ngo_id = n.id AND v.unlinked_at IS NULL) AS vets,
         (SELECT count(*)::int FROM dogs d WHERE d.status IN ('active', 'lost') AND (n.citywide OR d.ward_id = ANY(n.wards))) AS dogs,
         (SELECT count(*)::int FROM sos_cases c WHERE c.opened_at >= now() - interval '30 days'
             AND (c.ngo_id = n.id OR (c.ward_id IS NOT NULL AND (n.citywide OR c.ward_id = ANY(n.wards))))) AS sos30d
    FROM ngos n`;

export function ngoRowOf(n: any) {
  return {
    id: n.id,
    name: n.name,
    wards: n.wards ?? [],
    citywide: n.citywide,
    vets: n.vets,
    dogs: n.dogs,
    sos30d: n.sos30d,
    status: n.status,
    appliedAt: new Date(n.applied_at).toISOString(),
  };
}

export { adminCoversWard };
