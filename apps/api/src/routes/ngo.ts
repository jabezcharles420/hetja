/**
 * Design v7 NGO portal (N1 to N5). One person applies for the NGO; once an
 * admin approves it (A7) its members get the NGO tab and keep every feeder
 * action.
 *
 * POST  /api/v1/ngo/register                    N1 (documents first, POST /documents)
 * GET   /api/v1/ngo/me                          the caller's NGO and role (claims an NGO invite)
 * PATCH /api/v1/ngo/me                          coordinator: contact, phone, offers, wards, hours (audited)
 * GET   /api/v1/ngo/home                        N2
 * POST  /api/v1/ngo/ambulance                   N2 "Mark back" / out on a case
 * POST  /api/v1/ngo/beds                        N2 shelter beds "Update"
 * GET   /api/v1/ngo/sos/:caseId/candidates      N3 "Who's going to Moti?"
 * POST  /api/v1/ngo/sos/:caseId/dispatch        N3 "Send Dr. Qureshi"
 * POST  /api/v1/ngo/sos/:caseId/pass            N3 "We can't take this one": opens to vets now
 * GET   /api/v1/ngo/dispatches/mine             cases the caller was sent to
 * POST  /api/v1/ngo/dispatches/:id/accept       takes the case as the member
 * POST  /api/v1/ngo/dispatches/:id/decline
 * GET   /api/v1/ngo/team                        N4
 * POST  /api/v1/ngo/team/invite                 coordinator
 * PATCH /api/v1/ngo/team/:feederId              coordinator: role, transport
 * POST  /api/v1/ngo/team/:feederId/remove       coordinator
 * POST  /api/v1/ngo/vets/:feederId/vouch        coordinator: "Vouch for her"
 * GET   /api/v1/ngo/dogs                        dogs in the NGO's wards
 * GET   /api/v1/ngo/drives, POST /api/v1/ngo/drives, GET/PATCH /api/v1/ngo/drives/:id
 * POST  /api/v1/ngo/drives/:id/dogs, PATCH /api/v1/ngo/drives/:id/dogs/:driveDogId
 * POST  /api/v1/ngo/drives/:id/start, POST /api/v1/ngo/drives/:id/finish
 *
 * DISPATCH IS A PAGE. "Send someone" writes an sos_dispatches row AND an
 * ordinary responder page (sos_notifications, route ngo_dispatch), so the
 * member opening the push lands on the normal case page, is admitted on that
 * page and can tap the normal "I'm going" (POST /sos/cases/:id/ack), which
 * marks the dispatch accepted exactly as /dispatches/:id/accept does.
 *
 * NO COORDINATES of any member, or of the dog before an ack: the coordinator's
 * list carries a distance from each member's own last geotagged scan to the
 * case, rounded to 100 m (the case page's rule), and nothing finer.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { wardDisplay, wardName } from "@hetja/contracts";
import { isValidSlug, openCaseToVets, query, withTx } from "@hetja/db";
import { requireFeeder, type RoleAuth } from "../lib/require-role.js";
import { applyPerAccount, enforceLimits, invitePerAccount, ngoWritePerAccount } from "../lib/rate-limit.js";
import { claimInvites, accountForEmail, inviteHmac } from "../lib/admin.js";
import { audit } from "../lib/audit.js";
import { enqueueFeederPush } from "../lib/dog-feeders.js";
import { MAX_OPEN_ACKS } from "../lib/sos-eligibility.js";
import { ALL_WARDS, publicPhone, regLabel, validWards, type NgoMemberRole, type NgoStatus } from "../lib/professionals.js";
import { attachDocuments } from "../lib/vet-profile.js";
import { AVATAR_SQL, PORTRAIT_SQL, photoUrlFor } from "../lib/photo-url.js";
import { firstName, publicName } from "../lib/public-name.js";
import { sterilisedFrom } from "./dogs.js";

const ROLES = ["coordinator", "rescue", "collars", "volunteer"] as const;
const Offers = z.strictObject({
  ambulance: z.boolean(),
  shelterBeds: z.boolean(),
  sterilisation: z.boolean(),
  collars: z.boolean(),
});
const RegisterInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  regType: z.enum(["trust", "society", "section8", "other"]),
  regNo: z.string().trim().min(1).max(64),
  since: z.number().int().min(1800).max(2100).nullable().optional(),
  has80g: z.boolean().optional(),
  wards: z.array(z.string()).min(1).max(24),
  offers: Offers,
  contactName: z.string().trim().min(1).max(80),
  publicPhone: z.string().trim().min(6).max(32),
  documentIds: z.array(z.string().uuid()).min(1).max(6),
});
const PatchInput = z
  .strictObject({
    contactName: z.string().trim().min(1).max(80).optional(),
    publicPhone: z.string().trim().min(6).max(32).optional(),
    offers: Offers.partial().optional(),
    ambulanceCount: z.number().int().min(0).max(50).optional(),
    ambulanceHours: z.string().trim().min(1).max(60).nullable().optional(),
    hours: z.string().trim().min(1).max(80).nullable().optional(),
    has80g: z.boolean().optional(),
    wards: z.array(z.string()).min(1).max(24).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "at least one field" });
const YMD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const Tasks = z.strictObject({ collar: z.boolean().optional(), vaccinate: z.boolean().optional(), sterilise: z.boolean().optional() });
const DriveInput = z.strictObject({
  title: z.string().trim().min(1).max(80).optional(),
  wardId: z.string(),
  date: YMD,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  leadVetFeederId: z.string().uuid().nullable().optional(),
  volunteerIds: z.array(z.string().uuid()).max(50).optional(),
  collarsPacked: z.number().int().min(0).max(1000).optional(),
  dogs: z.array(z.strictObject({ slug: z.string(), tasks: Tasks })).max(200).optional(),
});
const DrivePatch = z
  .strictObject({
    title: z.string().trim().min(1).max(80).optional(),
    date: YMD.optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    leadVetFeederId: z.string().uuid().nullable().optional(),
    volunteerIds: z.array(z.string().uuid()).max(50).optional(),
    collarsPacked: z.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "at least one field" });

interface Member {
  auth: RoleAuth;
  ngoId: string;
  ngoName: string;
  status: NgoStatus;
  role: NgoMemberRole;
  wards: string[];
  citywide: boolean;
}

const err = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.status(status).send({ ok: false, error: { message, code } });

/** A member of an active or paused NGO (coordinator only with `coordinator`). */
async function requireMember(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: { coordinator?: boolean; roles?: NgoMemberRole[]; anyStatus?: boolean } = {},
): Promise<Member | null> {
  const auth = await requireFeeder(req, reply);
  if (!auth) return null;
  const r = await query<{ ngo_id: string; name: string; status: NgoStatus; role: NgoMemberRole; wards: string[]; citywide: boolean }>(
    `SELECT m.ngo_id, n.name, n.status, m.role, n.wards, n.citywide
       FROM ngo_members m JOIN ngos n ON n.id = m.ngo_id
      WHERE m.feeder_id = $1 AND m.left_at IS NULL AND n.status <> 'removed'`,
    [auth.feederId],
  );
  const m = r.rows[0];
  if (!m || (!opts.anyStatus && m.status !== "active" && m.status !== "paused")) {
    void err(reply, 403, "NGO_REQUIRED", "a member of an approved NGO is required");
    return null;
  }
  const allowed = opts.coordinator ? ["coordinator"] : opts.roles;
  if (allowed && !allowed.includes(m.role)) {
    void err(reply, 403, "NGO_ROLE_REQUIRED", `only a ${allowed.join(" or ")} can do this`);
    return null;
  }
  return { auth, ngoId: m.ngo_id, ngoName: m.name, status: m.status, role: m.role, wards: m.wards ?? [], citywide: m.citywide };
}

function limited(req: FastifyRequest, reply: FastifyReply, auth: RoleAuth, limiter = ngoWritePerAccount, name = "ngoWritePerAccount") {
  return enforceLimits(req.log, reply, [{ limiter, key: `acct:${auth.feederId}`, name, kind: "account" }]);
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

interface NgoRow {
  id: string;
  name: string;
  reg_type: string;
  reg_no: string;
  since_year: number | null;
  has_80g: boolean;
  wards: string[];
  citywide: boolean;
  offers_ambulance: boolean;
  offers_shelter: boolean;
  offers_sterilisation: boolean;
  offers_collars: boolean;
  contact_name: string | null;
  phone_e164: string | null;
  hours: string | null;
  ambulance_count: number;
  ambulance_hours: string | null;
  ambulance_status: "in" | "out";
  ambulance_case_id: string | null;
  amb_dog_name: string | null;
  beds_total: number;
  beds_free: number;
  status: NgoStatus;
  applied_at: Date;
  decided_at: Date | null;
  decision_reason: string | null;
  care_provider_id: string | null;
}

export const NGO_SQL = `
  SELECT n.*, (SELECT d.name FROM sos_cases c JOIN dogs d ON d.id = c.dog_id WHERE c.id = n.ambulance_case_id) AS amb_dog_name
    FROM ngos n`;

export function ngoProfileOf(n: NgoRow) {
  return {
    id: n.id,
    name: n.name,
    regType: n.reg_type,
    regNo: n.reg_no,
    since: n.since_year,
    has80g: n.has_80g,
    wards: n.citywide ? [...ALL_WARDS] : (n.wards ?? []),
    citywide: n.citywide,
    offers: {
      ambulance: n.offers_ambulance,
      shelterBeds: n.offers_shelter,
      sterilisation: n.offers_sterilisation,
      collars: n.offers_collars,
    },
    contactName: n.contact_name,
    publicPhone: n.phone_e164,
    hours: n.hours,
    status: n.status,
    appliedAt: new Date(n.applied_at).toISOString(),
    decidedAt: iso(n.decided_at),
    decisionReason: n.decision_reason,
    ambulance: {
      count: n.ambulance_count,
      hours: n.ambulance_hours,
      status: n.ambulance_status,
      outOnCase: n.ambulance_status === "out" && n.ambulance_case_id ? { caseId: n.ambulance_case_id, dogName: n.amb_dog_name } : null,
    },
    beds: { total: n.beds_total, free: n.beds_free },
  };
}

export async function loadNgoRow(id: string): Promise<NgoRow | null> {
  const r = await query<NgoRow>(`${NGO_SQL} WHERE n.id = $1`, [id]);
  return r.rows[0] ?? null;
}

/** The NGO's wards as a SQL array (every ward for a citywide NGO). */
function coverage(m: Pick<Member, "wards" | "citywide">): string[] {
  return m.citywide ? [...ALL_WARDS] : m.wards;
}

/** A case this NGO may act on: routed to it, or in its wards. */
async function caseForNgo(m: Member, caseId: string) {
  if (!z.string().uuid().safeParse(caseId).success) return null;
  const r = await query<{ id: string; ward_id: string | null; acked_by: string | null; resolved_at: Date | null; ngo_id: string | null }>(
    `SELECT c.id, COALESCE(c.ward_id, d.ward_id) AS ward_id, c.acked_by, c.resolved_at, c.ngo_id
       FROM sos_cases c LEFT JOIN dogs d ON d.id = c.dog_id WHERE c.id = $1`,
    [caseId],
  );
  const c = r.rows[0];
  if (!c) return null;
  if (c.ngo_id !== m.ngoId && !(c.ward_id && coverage(m).includes(c.ward_id))) return null;
  return c;
}

const DRIVE_SQL = `
  SELECT dr.id, dr.title, dr.ward_id, dr.starts_at, dr.lead_vet_feeder_id, lv.display_name AS lead_name,
         dr.volunteer_ids, dr.started_at, dr.finished_at, dr.collars_packed, dr.cancelled_at,
         (SELECT count(*)::int FROM drive_dogs dd WHERE dd.drive_id = dr.id) AS dogs,
         (SELECT count(*)::int FROM drive_dogs dd WHERE dd.drive_id = dr.id AND dd.task_sterilise AND dd.done_sterilise_at IS NULL) AS need_sterilising
    FROM drives dr LEFT JOIN feeders lv ON lv.id = dr.lead_vet_feeder_id`;

interface DriveRow {
  id: string;
  title: string;
  ward_id: string;
  starts_at: Date;
  lead_vet_feeder_id: string | null;
  lead_name: string | null;
  volunteer_ids: string[];
  started_at: Date | null;
  finished_at: Date | null;
  collars_packed: number;
  cancelled_at: Date | null;
  dogs: number;
  need_sterilising: number;
}

function driveSummaryOf(d: DriveRow) {
  return {
    id: d.id,
    title: d.title,
    wardId: d.ward_id,
    wardCode: wardDisplay(d.ward_id).code,
    startsAt: d.starts_at.toISOString(),
    leadVet: d.lead_vet_feeder_id ? { feederId: d.lead_vet_feeder_id, name: d.lead_name ?? "" } : null,
    volunteers: (d.volunteer_ids ?? []).length,
    dogs: d.dogs,
    needSterilising: d.need_sterilising,
    collarsPacked: d.collars_packed,
    startedAt: iso(d.started_at),
    finishedAt: iso(d.finished_at),
    state: d.finished_at ? "finished" : d.started_at ? "started" : "planned",
  };
}

interface DriveDogRow {
  id: string;
  slug: string;
  name: string | null;
  photo_key: string | null;
  avatar_key: string | null;
  task_collar: boolean;
  task_vaccinate: boolean;
  task_sterilise: boolean;
  done_collar_at: Date | null;
  done_vaccinate_at: Date | null;
  done_sterilise_at: Date | null;
  status: string;
  dog_status: string;
}

const DRIVE_DOG_SQL = `
  SELECT dd.id, d.slug, d.name, ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key,
         dd.task_collar, dd.task_vaccinate, dd.task_sterilise, dd.done_collar_at, dd.done_vaccinate_at,
         dd.done_sterilise_at, dd.status, d.status::text AS dog_status
    FROM drive_dogs dd JOIN dogs d ON d.id = dd.dog_id`;

function driveDogOf(req: FastifyRequest, r: DriveDogRow) {
  return {
    id: r.id,
    dog: { slug: r.slug, name: r.name, photoUrl: photoUrlFor(req, r.photo_key), avatarUrl: photoUrlFor(req, r.avatar_key) },
    tasks: { collar: r.task_collar, vaccinate: r.task_vaccinate, sterilise: r.task_sterilise },
    done: { collar: !!r.done_collar_at, vaccinate: !!r.done_vaccinate_at, sterilise: !!r.done_sterilise_at },
    status: r.status,
    // N5: a dog registered during the drive is pending until its tag is scanned on.
    registrationStatus: r.dog_status,
  };
}

/** Kolkata wall time (date + HH:MM) to an instant. */
function kolkataInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

/**
 * Add a dog to a drive (N5, and registration's optional driveId). The dog
 * must be in the NGO's wards and public. Returns the drive_dogs id.
 */
export async function addDogToDrive(
  client: { query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> },
  driveId: string,
  dogId: string,
  tasks: { collar?: boolean; vaccinate?: boolean; sterilise?: boolean },
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO drive_dogs (drive_id, dog_id, task_collar, task_vaccinate, task_sterilise)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (drive_id, dog_id) DO UPDATE
       SET task_collar = drive_dogs.task_collar OR EXCLUDED.task_collar,
           task_vaccinate = drive_dogs.task_vaccinate OR EXCLUDED.task_vaccinate,
           task_sterilise = drive_dogs.task_sterilise OR EXCLUDED.task_sterilise,
           updated_at = now()
     RETURNING id`,
    [driveId, dogId, tasks.collar ?? false, tasks.vaccinate ?? false, tasks.sterilise ?? false],
  );
  return r.rows[0].id;
}

/** Registration's driveId (POST /registrations): the caller must be a member of the drive's NGO. */
export async function driveForMember(driveId: string, feederId: string): Promise<boolean> {
  const r = await query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM drives dr JOIN ngo_members m ON m.ngo_id = dr.ngo_id
                     WHERE dr.id = $1 AND m.feeder_id = $2 AND m.left_at IS NULL
                       AND dr.cancelled_at IS NULL AND dr.finished_at IS NULL) AS ok`,
    [driveId, feederId],
  );
  return r.rows[0]?.ok === true;
}

export default async function ngoRoutes(app: FastifyInstance): Promise<void> {
  // --- N1 register ---------------------------------------------------------
  app.post("/api/v1/ngo/register", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!limited(req, reply, auth, applyPerAccount, "applyPerAccount")) return reply;
    const parsed = RegisterInput.safeParse(req.body ?? {});
    if (!parsed.success) return err(reply, 400, "INVALID_NGO", "invalid NGO registration");
    const b = parsed.data;
    if (!validWards(b.wards)) return err(reply, 400, "INVALID_WARDS", "NGOs may only cover Mumbai BMC wards");
    const phone = publicPhone(b.publicPhone);
    if (!phone) return err(reply, 400, "INVALID_PHONE", "that is not a valid Indian phone number");
    const out = await withTx(async (client) => {
      const live = await client.query(`SELECT 1 FROM ngo_members WHERE feeder_id = $1 AND left_at IS NULL`, [auth.feederId]);
      if ((live.rowCount ?? 0) > 0) return { conflict: true as const };
      const ins = await client.query<{ id: string }>(
        `INSERT INTO ngos (name, reg_type, reg_no, since_year, has_80g, wards, offers_ambulance, offers_shelter,
                           offers_sterilisation, offers_collars, contact_name, phone_e164, applied_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          b.name, b.regType, b.regNo, b.since ?? null, b.has80g ?? false, b.wards, b.offers.ambulance,
          b.offers.shelterBeds, b.offers.sterilisation, b.offers.collars, b.contactName, phone, auth.feederId,
        ],
      );
      const id = ins.rows[0].id;
      const kinds = await attachDocuments(client, auth.feederId, b.documentIds, "ngo", id);
      if (!kinds.includes("ngo_registration")) throw new MissingRegistration();
      await client.query(`INSERT INTO ngo_members (ngo_id, feeder_id, role) VALUES ($1, $2, 'coordinator')`, [id, auth.feederId]);
      await audit(client, {
        actorId: auth.feederId,
        actorKind: "ngo",
        action: "ngo.register",
        subjectType: "ngo",
        subjectId: id,
        summary: `registered ${b.name}`,
      });
      return { id };
    }).catch((e) => {
      if (e instanceof MissingRegistration) return { missing: true as const };
      throw e;
    });
    if ("missing" in out) return err(reply, 400, "DOCUMENTS_REQUIRED", "upload the registration certificate first");
    if ("conflict" in out) return err(reply, 409, "ALREADY_IN_NGO", "you are already a member of an NGO");
    return reply.status(201).send({ ok: true, data: ngoProfileOf((await loadNgoRow(out.id))!) });
  });

  // --- me --------------------------------------------------------------------
  app.get("/api/v1/ngo/me", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    await claimInvites(auth.feederId);
    const m = await query<{ ngo_id: string; role: NgoMemberRole; has_transport: boolean }>(
      `SELECT m.ngo_id, m.role, m.has_transport FROM ngo_members m JOIN ngos n ON n.id = m.ngo_id
        WHERE m.feeder_id = $1 AND m.left_at IS NULL AND n.status <> 'removed'`,
      [auth.feederId],
    );
    const row = m.rows[0];
    if (!row) return { ok: true, data: { ngo: null, role: null, hasTransport: false } };
    return {
      ok: true,
      data: { ngo: ngoProfileOf((await loadNgoRow(row.ngo_id))!), role: row.role, hasTransport: row.has_transport },
    };
  });

  app.patch("/api/v1/ngo/me", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true, anyStatus: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const parsed = PatchInput.safeParse(req.body ?? {});
    if (!parsed.success) return err(reply, 400, "INVALID_NGO", "invalid NGO change");
    const p = parsed.data;
    if (p.wards && !validWards(p.wards)) return err(reply, 400, "INVALID_WARDS", "NGOs may only cover Mumbai BMC wards");
    const phone = p.publicPhone !== undefined ? publicPhone(p.publicPhone) : undefined;
    if (p.publicPhone !== undefined && !phone) return err(reply, 400, "INVALID_PHONE", "that is not a valid Indian phone number");
    await withTx(async (client) => {
      const before = await client.query<{ wards: string[] }>(`SELECT wards FROM ngos WHERE id = $1`, [m.ngoId]);
      await client.query(
        `UPDATE ngos SET
            contact_name = COALESCE($2, contact_name),
            phone_e164 = COALESCE($3, phone_e164),
            offers_ambulance = COALESCE($4, offers_ambulance),
            offers_shelter = COALESCE($5, offers_shelter),
            offers_sterilisation = COALESCE($6, offers_sterilisation),
            offers_collars = COALESCE($7, offers_collars),
            ambulance_count = COALESCE($8, ambulance_count),
            ambulance_hours = CASE WHEN $9 THEN $10 ELSE ambulance_hours END,
            hours = CASE WHEN $11 THEN $12 ELSE hours END,
            has_80g = COALESCE($13, has_80g),
            wards = COALESCE($14, wards),
            updated_at = now()
          WHERE id = $1`,
        [
          m.ngoId, p.contactName ?? null, phone ?? null, p.offers?.ambulance ?? null, p.offers?.shelterBeds ?? null,
          p.offers?.sterilisation ?? null, p.offers?.collars ?? null, p.ambulanceCount ?? null,
          p.ambulanceHours !== undefined, p.ambulanceHours ?? null, p.hours !== undefined, p.hours ?? null,
          p.has80g ?? null, p.wards ?? null,
        ],
      );
      await audit(client, {
        actorId: m.auth.feederId,
        actorKind: "ngo",
        action: "ngo.edit",
        subjectType: "ngo",
        subjectId: m.ngoId,
        summary: p.wards
          ? `changed ${m.ngoName}'s wards to ${p.wards.map((w) => wardDisplay(w).code).join(", ")}`
          : `edited ${m.ngoName}'s details`,
        detail: { fields: Object.keys(p), wardsBefore: before.rows[0]?.wards ?? [], wardsAfter: p.wards ?? null },
      });
    });
    return { ok: true, data: ngoProfileOf((await loadNgoRow(m.ngoId))!) };
  });

  // --- N2 home ---------------------------------------------------------------
  app.get("/api/v1/ngo/home", async (req, reply) => {
    const m = await requireMember(req, reply);
    if (!m) return reply;
    const wards = coverage(m);
    const sos = await query<{
      id: string;
      slug: string | null;
      name: string | null;
      photo_key: string | null;
      avatar_key: string | null;
      ward_id: string | null;
      severity: string;
      opened_at: Date;
      state: string;
      acker_name: string | null;
      acker_show: boolean | null;
      acker_deleted: Date | null;
      dispatch_id: string | null;
      member_name: string | null;
      member_is_vet: boolean | null;
      with_ambulance: boolean | null;
      eta_min: number | null;
      accepted_at: Date | null;
      vets_opened_at: Date | null;
      ngo_routed_at: Date | null;
    }>(
      `SELECT c.id, d.slug, d.name, ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key,
              COALESCE(c.ward_id, d.ward_id) AS ward_id, c.severity::text AS severity, c.opened_at, c.state::text AS state,
              af.display_name AS acker_name, af.show_first_name AS acker_show, af.deleted_at AS acker_deleted,
              sd.id AS dispatch_id, mf.display_name AS member_name,
              EXISTS (SELECT 1 FROM vet_profiles vp WHERE vp.feeder_id = sd.member_feeder_id AND vp.status = 'verified') AS member_is_vet,
              sd.with_ambulance, sd.eta_min, sd.accepted_at, c.vets_opened_at, c.ngo_routed_at
         FROM sos_cases c
         LEFT JOIN dogs d ON d.id = c.dog_id
         LEFT JOIN feeders af ON af.id = c.acked_by
         LEFT JOIN LATERAL (SELECT * FROM sos_dispatches x WHERE x.case_id = c.id AND x.ngo_id = $1 AND x.declined_at IS NULL
                             ORDER BY x.sent_at DESC LIMIT 1) sd ON true
         LEFT JOIN feeders mf ON mf.id = sd.member_feeder_id
        WHERE c.resolved_at IS NULL AND c.state IN ('open', 'acked', 'escalated')
          AND (c.ngo_id = $1 OR COALESCE(c.ward_id, d.ward_id) = ANY($2::text[]))
        ORDER BY (c.acked_by IS NULL) DESC, c.opened_at
        LIMIT 20`,
      [m.ngoId, wards],
    );
    const [team, drive, dogs] = await Promise.all([
      query<{ vets: number; volunteers: number }>(
        `SELECT (SELECT count(*)::int FROM ngo_vets WHERE ngo_id = $1 AND unlinked_at IS NULL) AS vets,
                (SELECT count(*)::int FROM ngo_members WHERE ngo_id = $1 AND left_at IS NULL) AS volunteers`,
        [m.ngoId],
      ),
      query<{ id: string; title: string; starts_at: Date; ward_id: string }>(
        `SELECT id, title, starts_at, ward_id FROM drives
          WHERE ngo_id = $1 AND cancelled_at IS NULL AND finished_at IS NULL AND starts_at >= now() - interval '12 hours'
          ORDER BY starts_at LIMIT 1`,
        [m.ngoId],
      ),
      query<{ total: number; unsterilised: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM medical_records r WHERE r.dog_id = d.id AND r.is_verified AND r.abc_date IS NOT NULL)
                                   AND COALESCE(d.abc_status, '') NOT IN ('sterilised', 'sterilized', 'done'))::int AS unsterilised
           FROM dogs d WHERE d.ward_id = ANY($1::text[]) AND d.status IN ('active', 'lost')`,
        [wards],
      ),
    ]);
    const ngo = (await loadNgoRow(m.ngoId))!;
    return {
      ok: true,
      data: {
        ngo: ngoProfileOf(ngo),
        role: m.role,
        sos: sos.rows.map((c) => ({
          caseId: c.id,
          dog: c.slug ? { slug: c.slug, name: c.name, photoUrl: photoUrlFor(req, c.photo_key), avatarUrl: photoUrlFor(req, c.avatar_key) } : null,
          wardId: c.ward_id,
          wardCode: c.ward_id ? wardDisplay(c.ward_id).code : null,
          wardName: wardName(c.ward_id),
          severity: c.severity,
          openedAt: c.opened_at.toISOString(),
          state: c.state,
          assigned: c.dispatch_id
            ? {
                dispatchId: c.dispatch_id,
                name: publicName(c.member_name) ?? "",
                kind: c.member_is_vet ? "vet" : "member",
                withAmbulance: c.with_ambulance === true,
                etaMin: c.eta_min,
                accepted: c.accepted_at !== null,
              }
            : null,
          takenBy: firstName(c.acker_name, c.acker_show, c.acker_deleted),
          opensToVetsAt: c.vets_opened_at
            ? null
            : new Date((c.ngo_routed_at ?? c.opened_at).getTime() + 15 * 60_000).toISOString(),
        })),
        team: team.rows[0],
        nextDrive: drive.rows[0]
          ? { id: drive.rows[0].id, title: drive.rows[0].title, startsAt: drive.rows[0].starts_at.toISOString(), wardId: drive.rows[0].ward_id }
          : null,
        dogs: dogs.rows[0],
      },
    };
  });

  app.post("/api/v1/ngo/ambulance", async (req, reply) => {
    const m = await requireMember(req, reply, { roles: ["coordinator", "rescue"] });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const parsed = z.strictObject({ status: z.enum(["in", "out"]), caseId: z.string().uuid().nullable().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return err(reply, 400, "INVALID_AMBULANCE", "body must be { status: in | out, caseId? }");
    await query(
      `UPDATE ngos SET ambulance_status = $2, ambulance_case_id = CASE WHEN $2 = 'out' THEN $3::uuid ELSE NULL END, updated_at = now()
        WHERE id = $1`,
      [m.ngoId, parsed.data.status, parsed.data.caseId ?? null],
    );
    return { ok: true, data: ngoProfileOf((await loadNgoRow(m.ngoId))!).ambulance };
  });

  app.post("/api/v1/ngo/beds", async (req, reply) => {
    const m = await requireMember(req, reply, { roles: ["coordinator", "rescue"] });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const parsed = z
      .strictObject({ free: z.number().int().min(0).max(5000), total: z.number().int().min(0).max(5000).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) return err(reply, 400, "INVALID_BEDS", "body must be { free, total? }");
    const upd = await query(
      `UPDATE ngos SET beds_total = COALESCE($3, beds_total), beds_free = $2, updated_at = now()
        WHERE id = $1 AND $2 <= COALESCE($3, beds_total)`,
      [m.ngoId, parsed.data.free, parsed.data.total ?? null],
    );
    if ((upd.rowCount ?? 0) === 0) return err(reply, 400, "INVALID_BEDS", "free beds cannot exceed the total");
    return { ok: true, data: ngoProfileOf((await loadNgoRow(m.ngoId))!).beds };
  });

  // --- N3 dispatch -------------------------------------------------------------
  app.get("/api/v1/ngo/sos/:caseId/candidates", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true });
    if (!m) return reply;
    const c = await caseForNgo(m, (req.params as { caseId: string }).caseId);
    if (!c) return err(reply, 404, "NOT_FOUND", "no such case for this NGO");
    // SECURITY-GATE: public-coordinates -- none returned: each member's
    // distance to the case, rounded to 100 m, from their own last scan.
    const res = await query<{
      feeder_id: string;
      display_name: string;
      role: string;
      has_transport: boolean;
      is_vet: boolean;
      distance: number | null;
      busy_with: string | null;
    }>(
      `WITH here AS (SELECT COALESCE(d.last_seen_geo, c.geo) AS at FROM sos_cases c LEFT JOIN dogs d ON d.id = c.dog_id WHERE c.id = $2),
       people AS (
         SELECT m.feeder_id, m.role, m.has_transport, FALSE AS via_vet FROM ngo_members m WHERE m.ngo_id = $1 AND m.left_at IS NULL
         UNION
         SELECT v.vet_feeder_id, 'vet', FALSE, TRUE FROM ngo_vets v
           JOIN vet_profiles vp ON vp.feeder_id = v.vet_feeder_id AND vp.status = 'verified'
          WHERE v.ngo_id = $1 AND v.unlinked_at IS NULL)
       SELECT p.feeder_id, f.display_name, max(p.role) AS role, bool_or(p.has_transport) AS has_transport,
              EXISTS (SELECT 1 FROM vet_profiles vp WHERE vp.feeder_id = p.feeder_id AND vp.status = 'verified') AS is_vet,
              (SELECT ST_Distance(s.geo, (SELECT at FROM here)) FROM scans s
                WHERE s.feeder_id = p.feeder_id AND s.geo IS NOT NULL ORDER BY s.received_at DESC LIMIT 1) AS distance,
              (SELECT d2.name FROM sos_cases c2 LEFT JOIN dogs d2 ON d2.id = c2.dog_id
                WHERE c2.acked_by = p.feeder_id AND c2.resolved_at IS NULL AND c2.id <> $2 LIMIT 1) AS busy_with
         FROM people p JOIN feeders f ON f.id = p.feeder_id AND f.deleted_at IS NULL AND f.suspended_at IS NULL
        GROUP BY p.feeder_id, f.display_name
        ORDER BY is_vet DESC, distance NULLS LAST
        LIMIT 60`,
      [m.ngoId, c.id],
    );
    const ngo = (await loadNgoRow(m.ngoId))!;
    const routed = await query<{ ngo_routed_at: Date | null; opened_at: Date; vets_opened_at: Date | null }>(
      `SELECT ngo_routed_at, opened_at, vets_opened_at FROM sos_cases WHERE id = $1`,
      [c.id],
    );
    const rr = routed.rows[0];
    return {
      ok: true,
      data: {
        candidates: res.rows.map((p) => ({
          kind: p.is_vet ? "vet" : "member",
          feederId: p.feeder_id,
          name: publicName(p.display_name) ?? "",
          role: p.is_vet ? "vet" : p.role,
          hasTransport: p.has_transport,
          distanceM: p.distance != null ? Math.round(Number(p.distance) / 100) * 100 : null,
          free: p.is_vet,
          busy: p.busy_with !== null,
          busyWith: p.busy_with,
        })),
        ambulance: {
          available: ngo.offers_ambulance && ngo.ambulance_count > 0 && ngo.ambulance_status === "in",
          busyWith: ngo.ambulance_status === "out" ? ngo.amb_dog_name : null,
        },
        opensToVetsAt: rr?.vets_opened_at ? null : new Date((rr?.ngo_routed_at ?? rr?.opened_at ?? new Date()).getTime() + 15 * 60_000).toISOString(),
      },
    };
  });

  app.post("/api/v1/ngo/sos/:caseId/dispatch", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const parsed = z
      .strictObject({
        feederId: z.string().uuid(),
        withAmbulance: z.boolean().optional(),
        etaMin: z.number().int().min(0).max(600).nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return err(reply, 400, "INVALID_DISPATCH", "body must be { feederId, withAmbulance?, etaMin? }");
    const c = await caseForNgo(m, (req.params as { caseId: string }).caseId);
    if (!c) return err(reply, 404, "NOT_FOUND", "no such case for this NGO");
    if (c.resolved_at) return err(reply, 409, "SOS_CASE_CLOSED", "the case is closed");
    if (c.acked_by) return err(reply, 409, "SOS_ALREADY_ACKED", "someone has already taken this case");
    const who = parsed.data.feederId;
    const eligible = await query<{ ok: boolean; name: string | null }>(
      `SELECT (EXISTS (SELECT 1 FROM ngo_members WHERE ngo_id = $1 AND feeder_id = $2 AND left_at IS NULL)
               OR EXISTS (SELECT 1 FROM ngo_vets v JOIN vet_profiles vp ON vp.feeder_id = v.vet_feeder_id AND vp.status = 'verified'
                           WHERE v.ngo_id = $1 AND v.vet_feeder_id = $2 AND v.unlinked_at IS NULL))
              AND EXISTS (SELECT 1 FROM feeders WHERE id = $2 AND deleted_at IS NULL AND suspended_at IS NULL) AS ok,
              (SELECT display_name FROM feeders WHERE id = $2) AS name`,
      [m.ngoId, who],
    );
    if (!eligible.rows[0]?.ok) return err(reply, 400, "NOT_A_MEMBER", "you can only send members and linked vets of your NGO");
    const out = await withTx(async (client) => {
      const d = await client.query<{ id: string; sent_at: Date }>(
        `INSERT INTO sos_dispatches (case_id, ngo_id, kind, member_feeder_id, with_ambulance, eta_min, sent_by)
         VALUES ($1, $2, 'ngo_member', $3, $4, $5, $6) RETURNING id, sent_at`,
        [c.id, m.ngoId, who, parsed.data.withAmbulance ?? false, parsed.data.etaMin ?? null, m.auth.feederId],
      );
      // The page that makes them a responder for THIS case: the normal case
      // page admits them and the normal ack works (mayAck `notified`).
      await client.query(
        `INSERT INTO sos_notifications (case_id, feeder_id, channel, route)
         VALUES ($1, $2, 'push', 'ngo_dispatch') ON CONFLICT DO NOTHING`,
        [c.id, who],
      );
      // An existing told-only row (a feeder of the dog below the floor) is
      // upgraded: being sent is a ground to take it.
      await client.query(
        `UPDATE sos_notifications SET notify_only = FALSE, route = COALESCE(route, 'ngo_dispatch'), delivered_at = NULL
          WHERE case_id = $1 AND feeder_id = $2 AND channel = 'push' AND notify_only`,
        [c.id, who],
      );
      await client.query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('send_sos_push', $1::jsonb, now())`, [
        JSON.stringify({ caseId: c.id }),
      ]);
      if (parsed.data.withAmbulance) {
        await client.query(`UPDATE ngos SET ambulance_status = 'out', ambulance_case_id = $2 WHERE id = $1`, [m.ngoId, c.id]);
      }
      await audit(client, {
        actorId: m.auth.feederId,
        actorKind: "ngo",
        action: "sos.dispatch",
        subjectType: "sos_case",
        subjectId: c.id,
        summary: `${m.ngoName} sent ${publicName(eligible.rows[0].name) ?? "a member"} to an SOS`,
        detail: { withAmbulance: parsed.data.withAmbulance ?? false },
      });
      return d.rows[0];
    });
    return reply.status(201).send({
      ok: true,
      data: {
        id: out.id,
        caseId: c.id,
        ngoId: m.ngoId,
        kind: "ngo_member",
        memberName: publicName(eligible.rows[0].name) ?? "",
        withAmbulance: parsed.data.withAmbulance ?? false,
        etaMin: parsed.data.etaMin ?? null,
        sentAt: out.sent_at.toISOString(),
        acceptedAt: null,
        declinedAt: null,
      },
    });
  });

  app.post("/api/v1/ngo/sos/:caseId/pass", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const c = await caseForNgo(m, (req.params as { caseId: string }).caseId);
    if (!c) return err(reply, 404, "NOT_FOUND", "no such case for this NGO");
    await withTx(async (client) => {
      await client.query(`UPDATE sos_cases SET ngo_passed_at = COALESCE(ngo_passed_at, now()) WHERE id = $1`, [c.id]);
      const paged = await openCaseToVets(client, c.id);
      if (paged > 0) {
        await client.query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('send_sos_push', $1::jsonb, now())`, [
          JSON.stringify({ caseId: c.id }),
        ]);
      }
      await audit(client, {
        actorId: m.auth.feederId,
        actorKind: "ngo",
        action: "sos.ngo_pass",
        subjectType: "sos_case",
        subjectId: c.id,
        summary: `${m.ngoName} could not take an SOS; it opened to vets nearby`,
        detail: { vetsPaged: paged },
      });
    });
    return { ok: true, data: { passed: true } };
  });

  const dispatchOf = (d: {
    id: string;
    case_id: string;
    ngo_id: string | null;
    kind: string;
    member_name: string | null;
    with_ambulance: boolean;
    eta_min: number | null;
    sent_at: Date;
    accepted_at: Date | null;
    declined_at: Date | null;
  }) => ({
    id: d.id,
    caseId: d.case_id,
    ngoId: d.ngo_id,
    kind: d.kind,
    memberName: publicName(d.member_name) ?? "",
    withAmbulance: d.with_ambulance,
    etaMin: d.eta_min,
    sentAt: d.sent_at.toISOString(),
    acceptedAt: iso(d.accepted_at),
    declinedAt: iso(d.declined_at),
  });

  app.get("/api/v1/ngo/dispatches/mine", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const r = await query<any>(
      `SELECT x.*, f.display_name AS member_name, d.slug, d.name AS dog_name, COALESCE(c.ward_id, d.ward_id) AS ward_id,
              c.severity::text AS severity, c.opened_at, c.state::text AS case_state
         FROM sos_dispatches x JOIN sos_cases c ON c.id = x.case_id LEFT JOIN dogs d ON d.id = c.dog_id
         JOIN feeders f ON f.id = x.member_feeder_id
        WHERE x.member_feeder_id = $1 AND x.sent_at >= now() - interval '7 days'
        ORDER BY x.sent_at DESC LIMIT 30`,
      [auth.feederId],
    );
    return {
      ok: true,
      data: {
        dispatches: r.rows.map((d) => ({
          ...dispatchOf(d),
          dog: d.slug ? { slug: d.slug, name: d.dog_name } : null,
          wardId: d.ward_id,
          severity: d.severity,
          openedAt: d.opened_at.toISOString(),
          caseState: d.case_state,
        })),
      },
    };
  });

  app.post("/api/v1/ngo/dispatches/:id/accept", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!limited(req, reply, auth)) return reply;
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return err(reply, 400, "INVALID_ID", "bad id");
    const out = await withTx(async (client) => {
      const d = await client.query<{ case_id: string; declined_at: Date | null }>(
        `SELECT case_id, declined_at FROM sos_dispatches WHERE id = $1 AND member_feeder_id = $2 FOR UPDATE`,
        [id.data, auth.feederId],
      );
      const row = d.rows[0];
      if (!row) return { status: 404 as const };
      const c = await client.query<{ acked_by: string | null; acked_at: Date | null; resolved_at: Date | null }>(
        `SELECT acked_by, acked_at, resolved_at FROM sos_cases WHERE id = $1 FOR UPDATE`,
        [row.case_id],
      );
      const cs = c.rows[0];
      if (cs.acked_by === auth.feederId) return { status: 200 as const, caseId: row.case_id, ackedAt: cs.acked_at! };
      if (cs.resolved_at) return { status: 409 as const, code: "SOS_CASE_CLOSED" };
      if (cs.acked_by) return { status: 409 as const, code: "SOS_ALREADY_ACKED" };
      const open = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sos_cases WHERE acked_by = $1 AND resolved_at IS NULL AND state IN ('open', 'acked', 'escalated')`,
        [auth.feederId],
      );
      if ((open.rows[0]?.n ?? 0) >= MAX_OPEN_ACKS) return { status: 409 as const, code: "SOS_TOO_MANY_OPEN_ACKS" };
      const claim = await client.query<{ acked_at: Date }>(
        `UPDATE sos_cases SET acked_by = $1, acked_at = now(), state = 'acked'
          WHERE id = $2 AND acked_by IS NULL AND resolved_at IS NULL RETURNING acked_at`,
        [auth.feederId, row.case_id],
      );
      if (!claim.rows[0]) return { status: 409 as const, code: "SOS_ALREADY_ACKED" };
      await client.query(`UPDATE sos_dispatches SET accepted_at = now(), declined_at = NULL WHERE id = $1`, [id.data]);
      await client.query(`UPDATE sos_notifications SET acked_at = now() WHERE case_id = $1 AND feeder_id = $2`, [
        row.case_id,
        auth.feederId,
      ]);
      return { status: 200 as const, caseId: row.case_id, ackedAt: claim.rows[0].acked_at };
    });
    if (out.status === 404) return err(reply, 404, "NOT_FOUND", "no such dispatch for you");
    if (out.status === 409) return err(reply, 409, out.code, "this case cannot be taken now");
    return { ok: true, data: { caseId: out.caseId, ackedAt: new Date(out.ackedAt).toISOString() } };
  });

  app.post("/api/v1/ngo/dispatches/:id/decline", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!limited(req, reply, auth)) return reply;
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return err(reply, 400, "INVALID_ID", "bad id");
    const upd = await query(
      `UPDATE sos_dispatches SET declined_at = now() WHERE id = $1 AND member_feeder_id = $2 AND accepted_at IS NULL`,
      [id.data, auth.feederId],
    );
    if ((upd.rowCount ?? 0) === 0) return err(reply, 404, "NOT_FOUND", "no open dispatch for you");
    return { ok: true, data: { declined: true } };
  });

  // --- N4 team ---------------------------------------------------------------
  app.get("/api/v1/ngo/team", async (req, reply) => {
    const m = await requireMember(req, reply, { anyStatus: true });
    if (!m) return reply;
    const [vets, members, invites] = await Promise.all([
      query<{ vet_feeder_id: string; display_name: string; status: string | null; council: string | null; reg_no: string | null; vouched_at: Date | null }>(
        `SELECT v.vet_feeder_id, f.display_name, vp.status, vp.council, vp.reg_no, v.vouched_at
           FROM ngo_vets v JOIN feeders f ON f.id = v.vet_feeder_id LEFT JOIN vet_profiles vp ON vp.feeder_id = v.vet_feeder_id
          WHERE v.ngo_id = $1 AND v.unlinked_at IS NULL ORDER BY f.display_name`,
        [m.ngoId],
      ),
      query<{ feeder_id: string; display_name: string; role: NgoMemberRole; has_transport: boolean; joined_at: Date }>(
        `SELECT m.feeder_id, f.display_name, m.role, m.has_transport, m.joined_at
           FROM ngo_members m JOIN feeders f ON f.id = m.feeder_id
          WHERE m.ngo_id = $1 AND m.left_at IS NULL
          ORDER BY (m.role = 'coordinator') DESC, m.joined_at`,
        [m.ngoId],
      ),
      query<{ id: string; role: string; kind: string; created_at: Date }>(
        `SELECT id, role, kind, created_at FROM invites
          WHERE ngo_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
        [m.ngoId],
      ),
    ]);
    return {
      ok: true,
      data: {
        vets: vets.rows.map((v) => ({
          feederId: v.vet_feeder_id,
          name: v.display_name,
          status: v.status ?? "invited",
          regLabel: regLabel(v.council, v.reg_no),
          vouchedAt: iso(v.vouched_at),
        })),
        members: members.rows.map((x) => ({
          feederId: x.feeder_id,
          name: publicName(x.display_name) ?? "",
          role: x.role,
          hasTransport: x.has_transport,
          joinedAt: x.joined_at.toISOString(),
        })),
        invites: invites.rows.map((i) => ({ id: i.id, role: i.kind === "vet" ? "vet" : i.role, createdAt: i.created_at.toISOString() })),
        canManage: m.role === "coordinator",
      },
    };
  });

  app.post("/api/v1/ngo/team/invite", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true, anyStatus: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth, invitePerAccount, "invitePerAccount")) return reply;
    const parsed = z
      .strictObject({ email: z.string().trim().email().max(254), role: z.enum([...ROLES, "vet"]), hasTransport: z.boolean().optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) return err(reply, 400, "INVALID_INVITE", "body must be { email, role, hasTransport? }");
    const { email, role } = parsed.data;
    const pepper = app.config.HETJA_HMAC_PEPPER;
    const existing = await accountForEmail(email, pepper);
    // The email is HMAC'd here and dropped (INVARIANT 3): never stored, never logged, never audited.
    const inv = await withTx(async (client) => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO invites (kind, identity_hmac, role, ngo_id, has_transport, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [role === "vet" ? "vet" : "ngo_member", inviteHmac(email, pepper), role === "vet" ? null : role, m.ngoId, parsed.data.hasTransport ?? false, m.auth.feederId],
      );
      await audit(client, {
        actorId: m.auth.feederId,
        actorKind: "ngo",
        action: "ngo.invite",
        subjectType: "invite",
        subjectId: ins.rows[0].id,
        summary: `${m.ngoName} invited someone as ${role}`,
      });
      return ins.rows[0].id;
    });
    let joined = false;
    if (existing) joined = (await claimInvites(existing)) > 0;
    return reply.status(201).send({ ok: true, data: { id: inv, joined } });
  });

  app.patch("/api/v1/ngo/team/:feederId", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true, anyStatus: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const parsed = z
      .strictObject({ role: z.enum(ROLES).optional(), hasTransport: z.boolean().optional() })
      .refine((v) => v.role !== undefined || v.hasTransport !== undefined)
      .safeParse(req.body ?? {});
    const who = z.string().uuid().safeParse((req.params as { feederId: string }).feederId);
    if (!parsed.success || !who.success) return err(reply, 400, "INVALID_MEMBER", "body must be { role?, hasTransport? }");
    if (who.data === m.auth.feederId && parsed.data.role && parsed.data.role !== "coordinator") {
      const others = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ngo_members WHERE ngo_id = $1 AND role = 'coordinator' AND left_at IS NULL AND feeder_id <> $2`,
        [m.ngoId, m.auth.feederId],
      );
      if ((others.rows[0]?.n ?? 0) === 0) return err(reply, 409, "LAST_COORDINATOR", "an NGO needs at least one coordinator");
    }
    const upd = await query(
      `UPDATE ngo_members SET role = COALESCE($3, role), has_transport = COALESCE($4, has_transport)
        WHERE ngo_id = $1 AND feeder_id = $2 AND left_at IS NULL`,
      [m.ngoId, who.data, parsed.data.role ?? null, parsed.data.hasTransport ?? null],
    );
    if ((upd.rowCount ?? 0) === 0) return err(reply, 404, "NOT_FOUND", "not a member of this NGO");
    await audit(null, {
      actorId: m.auth.feederId,
      actorKind: "ngo",
      action: "ngo.member_change",
      subjectType: "feeder",
      subjectId: who.data,
      summary: `${m.ngoName} changed a member${parsed.data.role ? ` to ${parsed.data.role}` : ""}`,
    });
    return { ok: true, data: { updated: true } };
  });

  app.post("/api/v1/ngo/team/:feederId/remove", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true, anyStatus: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const who = z.string().uuid().safeParse((req.params as { feederId: string }).feederId);
    if (!who.success) return err(reply, 400, "INVALID_ID", "bad id");
    if (who.data === m.auth.feederId) return err(reply, 409, "CANNOT_REMOVE_SELF", "ask another coordinator to remove you");
    const out = await withTx(async (client) => {
      const a = await client.query(`UPDATE ngo_members SET left_at = now() WHERE ngo_id = $1 AND feeder_id = $2 AND left_at IS NULL`, [
        m.ngoId,
        who.data,
      ]);
      const b = await client.query(`UPDATE ngo_vets SET unlinked_at = now() WHERE ngo_id = $1 AND vet_feeder_id = $2 AND unlinked_at IS NULL`, [
        m.ngoId,
        who.data,
      ]);
      const n = (a.rowCount ?? 0) + (b.rowCount ?? 0);
      if (n > 0) {
        await audit(client, {
          actorId: m.auth.feederId,
          actorKind: "ngo",
          action: "ngo.member_remove",
          subjectType: "feeder",
          subjectId: who.data,
          summary: `${m.ngoName} removed a member`,
        });
      }
      return n;
    });
    if (out === 0) return err(reply, 404, "NOT_FOUND", "not a member of this NGO");
    return { ok: true, data: { removed: true } };
  });

  app.post("/api/v1/ngo/vets/:feederId/vouch", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const who = z.string().uuid().safeParse((req.params as { feederId: string }).feederId);
    if (!who.success) return err(reply, 400, "INVALID_ID", "bad id");
    const out = await withTx(async (client) => {
      const v = await client.query<{ vouched_at: Date }>(
        `UPDATE ngo_vets SET vouched_at = COALESCE(vouched_at, now()), vouched_by = COALESCE(vouched_by, $3)
          WHERE ngo_id = $1 AND vet_feeder_id = $2 AND unlinked_at IS NULL RETURNING vouched_at`,
        [m.ngoId, who.data, m.auth.feederId],
      );
      if (!v.rows[0]) return null;
      // A2: "A vet who applies through an NGO arrives already vouched for" (top of the queue).
      await client.query(
        `UPDATE vet_profiles SET vouched_by_ngo_id = COALESCE(vouched_by_ngo_id, $2), vouched_at = COALESCE(vouched_at, now())
          WHERE feeder_id = $1`,
        [who.data, m.ngoId],
      );
      await audit(client, {
        actorId: m.auth.feederId,
        actorKind: "ngo",
        action: "ngo.vouch",
        subjectType: "feeder",
        subjectId: who.data,
        summary: `${m.ngoName} vouched for a vet`,
      });
      return v.rows[0].vouched_at;
    });
    if (!out) return err(reply, 404, "NOT_FOUND", "that vet is not linked to your NGO");
    return { ok: true, data: { vouchedAt: out.toISOString() } };
  });

  // --- Dogs in the NGO's wards -------------------------------------------------
  app.get("/api/v1/ngo/dogs", async (req, reply) => {
    const m = await requireMember(req, reply);
    if (!m) return reply;
    const filter = (req.query as { filter?: string }).filter;
    const res = await query<{
      slug: string;
      name: string | null;
      ward_id: string;
      abc_status: string | null;
      abc_verified: boolean;
      vaccinated: boolean;
      last_fed_at: Date | null;
      photo_key: string | null;
      avatar_key: string | null;
    }>(
      `SELECT d.slug, d.name, d.ward_id, d.abc_status,
              EXISTS (SELECT 1 FROM medical_records r WHERE r.dog_id = d.id AND r.is_verified AND r.abc_date IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = r.id)) AS abc_verified,
              EXISTS (SELECT 1 FROM medical_records r WHERE r.dog_id = d.id AND r.is_verified AND r.record_type IN ('vaccination', 'vaccine')
                        AND NOT EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = r.id)) AS vaccinated,
              (SELECT max(s.captured_at) FROM scans s WHERE s.dog_id = d.id AND s.scan_type = 'feed' AND s.review_status <> 'rejected') AS last_fed_at,
              ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key
         FROM dogs d WHERE d.ward_id = ANY($1::text[]) AND d.status IN ('active', 'lost')
        ORDER BY d.name NULLS LAST, d.slug LIMIT 1000`,
      [coverage(m)],
    );
    let dogs = res.rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      wardId: r.ward_id,
      wardCode: wardDisplay(r.ward_id).code,
      photoUrl: photoUrlFor(req, r.photo_key),
      avatarUrl: photoUrlFor(req, r.avatar_key),
      sterilised: sterilisedFrom(r.abc_status, r.abc_verified),
      vaccinated: r.vaccinated ? ("yes" as const) : ("unknown" as const),
      lastFedAt: iso(r.last_fed_at),
    }));
    const total = dogs.length;
    if (filter === "unsterilised") dogs = dogs.filter((d) => d.sterilised !== "yes");
    if (filter === "unvaccinated") dogs = dogs.filter((d) => d.vaccinated !== "yes");
    return { ok: true, data: { dogs, total } };
  });

  // --- N5 drives ------------------------------------------------------------------
  app.get("/api/v1/ngo/drives", async (req, reply) => {
    const m = await requireMember(req, reply);
    if (!m) return reply;
    const r = await query<DriveRow>(`${DRIVE_SQL} WHERE dr.ngo_id = $1 AND dr.cancelled_at IS NULL ORDER BY dr.starts_at DESC LIMIT 50`, [m.ngoId]);
    return { ok: true, data: { drives: r.rows.map(driveSummaryOf) } };
  });

  async function driveDetail(req: FastifyRequest, id: string, ngoId: string) {
    const r = await query<DriveRow>(`${DRIVE_SQL} WHERE dr.id = $1 AND dr.ngo_id = $2`, [id, ngoId]);
    const d = r.rows[0];
    if (!d) return null;
    const [dogs, names] = await Promise.all([
      query<DriveDogRow>(`${DRIVE_DOG_SQL} WHERE dd.drive_id = $1 ORDER BY dd.status = 'done', d.name`, [id]),
      query<{ display_name: string }>(`SELECT display_name FROM feeders WHERE id = ANY($1::uuid[]) ORDER BY display_name`, [d.volunteer_ids ?? []]),
    ]);
    return {
      ...driveSummaryOf(d),
      volunteerNames: names.rows.map((n) => publicName(n.display_name) ?? ""),
      dogList: dogs.rows.map((x) => driveDogOf(req, x)),
    };
  }

  const driveIdOf = (req: FastifyRequest) => z.string().uuid().safeParse((req.params as { id: string }).id);

  app.post("/api/v1/ngo/drives", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const parsed = DriveInput.safeParse(req.body ?? {});
    if (!parsed.success) return err(reply, 400, "INVALID_DRIVE", "invalid drive");
    const b = parsed.data;
    if (!coverage(m).includes(b.wardId)) return err(reply, 400, "INVALID_WARDS", "a drive must be in one of your NGO's wards");
    const startsAt = kolkataInstant(b.date, b.time);
    const slugs = (b.dogs ?? []).map((x) => x.slug);
    if (slugs.some((s) => !isValidSlug(s))) return err(reply, 400, "INVALID_DOG", "a dog code is not valid");
    const id = await withTx(async (client) => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO drives (ngo_id, title, ward_id, starts_at, lead_vet_feeder_id, volunteer_ids, collars_packed, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          m.ngoId, b.title ?? `${wardName(b.wardId) ?? b.wardId} drive`, b.wardId, startsAt, b.leadVetFeederId ?? null,
          b.volunteerIds ?? [], b.collarsPacked ?? 0, m.auth.feederId,
        ],
      );
      for (const x of b.dogs ?? []) {
        const dog = await client.query<{ id: string }>(
          `SELECT id FROM dogs WHERE slug = $1 AND status IN ('active', 'lost') AND ward_id = ANY($2::text[])`,
          [x.slug, coverage(m)],
        );
        if (dog.rows[0]) await addDogToDrive(client, ins.rows[0].id, dog.rows[0].id, x.tasks);
      }
      await audit(client, {
        actorId: m.auth.feederId,
        actorKind: "ngo",
        action: "drive.create",
        subjectType: "drive",
        subjectId: ins.rows[0].id,
        summary: `${m.ngoName} planned a drive in ${wardDisplay(b.wardId).code} on ${b.date}`,
      });
      return ins.rows[0].id;
    });
    return reply.status(201).send({ ok: true, data: await driveDetail(req, id, m.ngoId) });
  });

  app.get("/api/v1/ngo/drives/:id", async (req, reply) => {
    const m = await requireMember(req, reply);
    if (!m) return reply;
    const id = driveIdOf(req);
    const d = id.success ? await driveDetail(req, id.data, m.ngoId) : null;
    if (!d) return err(reply, 404, "NOT_FOUND", "no such drive");
    return { ok: true, data: d };
  });

  app.patch("/api/v1/ngo/drives/:id", async (req, reply) => {
    const m = await requireMember(req, reply, { coordinator: true });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const id = driveIdOf(req);
    const parsed = DrivePatch.safeParse(req.body ?? {});
    if (!id.success || !parsed.success) return err(reply, 400, "INVALID_DRIVE", "invalid drive change");
    const p = parsed.data;
    const cur = await query<{ starts_at: Date }>(`SELECT starts_at FROM drives WHERE id = $1 AND ngo_id = $2`, [id.data, m.ngoId]);
    if (!cur.rows[0]) return err(reply, 404, "NOT_FOUND", "no such drive");
    const curLocal = new Date(cur.rows[0].starts_at.getTime() + 330 * 60_000).toISOString();
    const startsAt = p.date || p.time ? kolkataInstant(p.date ?? curLocal.slice(0, 10), p.time ?? curLocal.slice(11, 16)) : null;
    await query(
      `UPDATE drives SET title = COALESCE($3, title), starts_at = COALESCE($4, starts_at),
              lead_vet_feeder_id = CASE WHEN $5 THEN $6 ELSE lead_vet_feeder_id END,
              volunteer_ids = COALESCE($7, volunteer_ids), collars_packed = COALESCE($8, collars_packed),
              headsup_sent_at = CASE WHEN $4 IS NOT NULL THEN NULL ELSE headsup_sent_at END
        WHERE id = $1 AND ngo_id = $2`,
      [id.data, m.ngoId, p.title ?? null, startsAt, p.leadVetFeederId !== undefined, p.leadVetFeederId ?? null, p.volunteerIds ?? null, p.collarsPacked ?? null],
    );
    return { ok: true, data: await driveDetail(req, id.data, m.ngoId) };
  });

  app.post("/api/v1/ngo/drives/:id/dogs", async (req, reply) => {
    const m = await requireMember(req, reply, { roles: ["coordinator", "collars", "rescue"] });
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const id = driveIdOf(req);
    const parsed = z.strictObject({ slug: z.string(), tasks: Tasks }).safeParse(req.body ?? {});
    if (!id.success || !parsed.success || !isValidSlug(parsed.data.slug)) return err(reply, 400, "INVALID_DRIVE_DOG", "body must be { slug, tasks }");
    const drive = await query(`SELECT 1 FROM drives WHERE id = $1 AND ngo_id = $2 AND cancelled_at IS NULL AND finished_at IS NULL`, [id.data, m.ngoId]);
    if ((drive.rowCount ?? 0) === 0) return err(reply, 404, "NOT_FOUND", "no such open drive");
    const dog = await query<{ id: string }>(
      `SELECT id FROM dogs WHERE slug = $1 AND status IN ('active', 'lost') AND ward_id = ANY($2::text[])`,
      [parsed.data.slug, coverage(m)],
    );
    if (!dog.rows[0]) return err(reply, 404, "DOG_NOT_FOUND", "no such dog in your wards");
    const ddId = await withTx((client) => addDogToDrive(client, id.data, dog.rows[0].id, parsed.data.tasks));
    const row = await query<DriveDogRow>(`${DRIVE_DOG_SQL} WHERE dd.id = $1`, [ddId]);
    return reply.status(201).send({ ok: true, data: driveDogOf(req, row.rows[0]) });
  });

  app.patch("/api/v1/ngo/drives/:id/dogs/:driveDogId", async (req, reply) => {
    const m = await requireMember(req, reply);
    if (!m) return reply;
    if (!limited(req, reply, m.auth)) return reply;
    const id = driveIdOf(req);
    const dd = z.string().uuid().safeParse((req.params as { driveDogId: string }).driveDogId);
    const parsed = z
      .strictObject({ done: Tasks.optional(), status: z.enum(["todo", "done", "to_clinic", "not_found"]).optional() })
      .safeParse(req.body ?? {});
    if (!id.success || !dd.success || !parsed.success) return err(reply, 400, "INVALID_DRIVE_DOG", "body must be { done?, status? }");
    // "vaccinate" is checked off only by a vet-signed record (POST /vet/records
    // with driveDogId): "Vaccinations Dr. Pillai logs here are signed as she goes."
    if (parsed.data.done?.vaccinate === true) {
      return err(reply, 400, "VACCINATION_NEEDS_VET", "a vaccination is checked off when the vet signs it");
    }
    const done = parsed.data.done ?? {};
    const upd = await query(
      `UPDATE drive_dogs dd SET
          done_collar_at = CASE WHEN $3::boolean IS NULL THEN done_collar_at WHEN $3 THEN COALESCE(done_collar_at, now()) ELSE NULL END,
          done_sterilise_at = CASE WHEN $4::boolean IS NULL THEN done_sterilise_at WHEN $4 THEN COALESCE(done_sterilise_at, now()) ELSE NULL END,
          done_vaccinate_at = CASE WHEN $5::boolean IS FALSE THEN NULL ELSE done_vaccinate_at END,
          status = COALESCE($6, status), updated_at = now()
         FROM drives dr
        WHERE dd.id = $1 AND dd.drive_id = $2 AND dr.id = dd.drive_id AND dr.ngo_id = $7`,
      [dd.data, id.data, done.collar ?? null, done.sterilise ?? null, done.vaccinate ?? null, parsed.data.status ?? null, m.ngoId],
    );
    if ((upd.rowCount ?? 0) === 0) return err(reply, 404, "NOT_FOUND", "no such dog on this drive");
    const row = await query<DriveDogRow>(`${DRIVE_DOG_SQL} WHERE dd.id = $1`, [dd.data]);
    return { ok: true, data: driveDogOf(req, row.rows[0]) };
  });

  const driveStamp = (column: "started_at" | "finished_at", action: string, words: string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const m = await requireMember(req, reply, { coordinator: true });
      if (!m) return reply;
      if (!limited(req, reply, m.auth)) return reply;
      const id = driveIdOf(req);
      if (!id.success) return err(reply, 400, "INVALID_ID", "bad id");
      const out = await withTx(async (client) => {
        const r = await client.query<{ at: Date }>(
          `UPDATE drives SET ${column} = COALESCE(${column}, now())
                             ${column === "finished_at" ? ", started_at = COALESCE(started_at, now())" : ""}
            WHERE id = $1 AND ngo_id = $2 AND cancelled_at IS NULL RETURNING ${column} AS at`,
          [id.data, m.ngoId],
        );
        if (!r.rows[0]) return null;
        await audit(client, {
          actorId: m.auth.feederId,
          actorKind: "ngo",
          action,
          subjectType: "drive",
          subjectId: id.data,
          summary: `${m.ngoName} ${words} a drive`,
        });
        return r.rows[0].at;
      });
      if (!out) return err(reply, 404, "NOT_FOUND", "no such drive");
      return { ok: true, data: column === "started_at" ? { startedAt: out.toISOString() } : { state: "finished", finishedAt: out.toISOString() } };
    };
  app.post("/api/v1/ngo/drives/:id/start", driveStamp("started_at", "drive.start", "started"));
  app.post("/api/v1/ngo/drives/:id/finish", driveStamp("finished_at", "drive.finish", "finished"));
}

class MissingRegistration extends Error {}

export { enqueueFeederPush };
