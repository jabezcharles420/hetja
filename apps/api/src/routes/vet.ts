/**
 * Design v7 vet portal (V1 to V5). A vet is a feeder whose application an
 * admin verified (A2); they keep every feeder action and gain these.
 *
 * GET  /api/v1/vet/me                        profile, passkeys, documents (claims a vet invite)
 * POST /api/v1/vet/apply                     V1 (documents first, POST /documents)
 * PATCH /api/v1/vet/me                       wards, SOS hours, public phone, clinic
 * GET  /api/v1/vet/home                      V2: SOS near you, sign requests, due soon
 * GET  /api/v1/vet/due-soon                  the due-soon list
 * GET  /api/v1/vet/dogs/:slug                V2b / V3 header
 * GET  /api/v1/vet/sign-requests             feeders asking this vet (or any vet in their wards)
 * POST /api/v1/vet/sign-requests/:id/decline V3 "I didn't give this"
 * POST /api/v1/vet/passkeys/options          passkey setup, step 1
 * POST /api/v1/vet/passkeys                  passkey setup, step 2
 * POST /api/v1/vet/passkeys/:id/remove
 * POST /api/v1/vet/records/options           V3/V5 step 1: the record hash is the challenge
 * POST /api/v1/vet/records                   V3/V5 step 2: verify the assertion, append the record
 * GET  /api/v1/vet/signatures                "My signatures"
 *
 * SIGNING NEVER UPDATES medical_records (INVARIANT 8). A signature is a new
 * row through appendMedicalRecord (INVARIANT 9) carrying the signer, the
 * credential, the assertion and the record hash; a correction is a new row
 * with corrects_record_id (supersedes) and a reason; a withdrawal is a row of
 * record_type 'withdrawal'. Only the vet who signed a record may correct or
 * withdraw it.
 *
 * SUSPENDED VETS (A2) keep their page and their past signatures, and cannot
 * sign or accept SOS: every signing route requires status 'verified'.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { MedicalRecordInput, wardDisplay, wardName } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { requireFeeder, type RoleAuth } from "../lib/require-role.js";
import {
  applyPerAccount,
  documentUploadPerAccount,
  enforceLimits,
  feederWritePerAccount,
  passkeyPerAccount,
  vetSearchPerAccount,
  vetSignPerAccount,
} from "../lib/rate-limit.js";
import { randomUUID } from "node:crypto";
import { PHOTO_BUSY_RETRY_AFTER_SEC, PhotoBusyError, photoGate } from "../lib/photo-gate.js";
import { PHOTO_ROUTE_BODY_LIMIT } from "../lib/body-limits.js";
import { decodePhotoUpload } from "../lib/storage.js";
import { UnsupportedImageError } from "../lib/exif-strip.js";
import { DocumentsUnavailableError, docsKey, sha256Hex, writeDocument } from "../lib/documents.js";
import { claimInvites } from "../lib/admin.js";
import { audit } from "../lib/audit.js";
import { enqueueFeederPush, feederIdsOfDog, isFeederOfDog, dogSex } from "../lib/dog-feeders.js";
import { currentRecords, healthRecords } from "../lib/health.js";
import { minutesOf, publicPhone, validWards, type VetStatus } from "../lib/professionals.js";
import { attachDocuments, documentsOf, loadVetProfileRow, vetProfileOf } from "../lib/vet-profile.js";
import { AVATAR_SQL, PORTRAIT_SQL, photoUrlFor } from "../lib/photo-url.js";
import { firstName } from "../lib/public-name.js";
import {
  CHALLENGE_TTL_MS,
  recordHash,
  registrationOptions,
  signingOptions,
  verifyRegistration,
  verifySigning,
} from "../lib/webauthn.js";
import { VetRecordProposal, publicDogBySlug } from "./v7-public.js";
import { appendMedicalRecord } from "./medical.js";
import { forgetDog } from "./dogs.js";
import { addDogToDrive } from "./ngo.js";

const YMD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const Hours = z.strictObject({ from: z.string(), to: z.string() }).refine((h) => minutesOf(h.from) !== null && minutesOf(h.to) !== null, {
  message: "HH:MM",
});

const ApplyInput = z.strictObject({
  council: z.literal("MSVC"),
  regNo: z.string().trim().regex(/^[A-Za-z0-9/-]{1,32}$/),
  qualification: z.string().trim().min(1).max(80).optional(),
  clinic: z.string().trim().min(1).max(120).nullable().optional(),
  wards: z.array(z.string()).min(1).max(24),
  sosAvailable: z.boolean(),
  sosHours: Hours.nullable().optional(),
  publicPhone: z.string().trim().min(6).max(32),
  ngoId: z.string().uuid().nullable().optional(),
  documentIds: z.array(z.string().uuid()).min(1).max(6),
});

const PatchInput = z
  .strictObject({
    clinic: z.string().trim().min(1).max(120).nullable().optional(),
    qualification: z.string().trim().min(1).max(80).nullable().optional(),
    wards: z.array(z.string()).min(1).max(24).optional(),
    sosAvailable: z.boolean().optional(),
    sosHours: Hours.nullable().optional(),
    publicPhone: z.string().trim().min(6).max(32).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "at least one field" });

const Draft = z.strictObject({
  dogSlug: z.string().min(9).max(16),
  type: z.enum(["vaccination", "sterilisation", "treatment", "withdrawal"]),
  vaccine: z.string().trim().min(1).max(60).optional(),
  brand: z.string().trim().min(1).max(60).optional(),
  batch: z.string().trim().min(1).max(40).optional(),
  givenOn: YMD.optional(),
  dueOn: YMD.nullable().optional(),
  earNotched: z.boolean().optional(),
  diagnosis: z.string().trim().min(1).max(300).optional(),
  treatment: z.string().trim().min(1).max(500).optional(),
  note: z.string().trim().min(1).max(280).optional(),
  supersedes: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(280).optional(),
  signRequestId: z.string().uuid().optional(),
  driveDogId: z.string().uuid().optional(),
  /** N5: signing from a drive's page ("drive=<id>"): the dog's task on that drive is ticked (added if missing). */
  driveId: z.string().uuid().optional(),
  /** A feeder-noted record this signature confirms (it shows as confirmed; the ledger keeps both). */
  confirmsRecordId: z.string().uuid().optional(),
  /** A private photo uploaded first (POST /vet/record-photos): the vaccine sticker. */
  photoId: z.string().uuid().optional(),
});
type Draft = z.infer<typeof Draft>;

const forbidden = (reply: FastifyReply, code: string, message: string) =>
  reply.status(403).send({ ok: false, error: { message, code } });

function minuteNow(): number {
  return Math.floor((((Date.now() / 60_000 + 330) % 1440) + 1440) % 1440);
}

function kolkataToday(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

/** Verified (or, with allowSuspended, suspended) vet; sends the 403 otherwise. */
async function requireVet(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: { allowSuspended?: boolean } = {},
): Promise<{ auth: RoleAuth; status: VetStatus; wards: string[]; profileId: string } | null> {
  const auth = await requireFeeder(req, reply);
  if (!auth) return null;
  const v = await query<{ id: string; status: VetStatus; wards: string[] }>(
    `SELECT id, status, wards FROM vet_profiles WHERE feeder_id = $1`,
    [auth.feederId],
  );
  const row = v.rows[0];
  const ok = row && (row.status === "verified" || (opts.allowSuspended && row.status === "suspended"));
  if (!ok) {
    void forbidden(reply, "VET_NOT_VERIFIED", "a verified vet account is required");
    return null;
  }
  return { auth, status: row.status, wards: row.wards ?? [], profileId: row.id };
}

function limited(req: FastifyRequest, reply: FastifyReply, auth: RoleAuth, limiter = feederWritePerAccount, name = "feederWritePerAccount"): boolean {
  return enforceLimits(req.log, reply, [{ limiter, key: `acct:${auth.feederId}`, name, kind: "account" }]);
}

async function passkeysOf(feederId: string) {
  const r = await query<{ id: string; credential_id: string; public_key: Buffer; counter: string; transports: string[]; label: string | null; created_at: Date; last_used_at: Date | null }>(
    `SELECT id, credential_id, public_key, counter::text AS counter, transports, label, created_at, last_used_at
       FROM webauthn_credentials WHERE feeder_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [feederId],
  );
  return r.rows;
}

interface SignRequestRow {
  id: string;
  slug: string;
  name: string | null;
  photo_key: string | null;
  avatar_key: string | null;
  proposed: Record<string, unknown>;
  record_id: string | null;
  requester_name: string | null;
  requester_show: boolean | null;
  requester_deleted: Date | null;
  created_at: Date;
  evidence_document_id: string | null;
  note: string | null;
  status: string;
}

const SIGN_REQUEST_SQL = `
  SELECT r.id, d.slug, d.name, ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key,
         r.proposed, r.record_id, f.display_name AS requester_name, f.show_first_name AS requester_show,
         f.deleted_at AS requester_deleted, r.created_at, r.evidence_document_id, r.note, r.status
    FROM sign_requests r
    JOIN dogs d ON d.id = r.dog_id
    LEFT JOIN feeders f ON f.id = r.requested_by`;

function signRequestOf(req: FastifyRequest, r: SignRequestRow) {
  return {
    id: r.id,
    dog: { slug: r.slug, name: r.name, photoUrl: photoUrlFor(req, r.photo_key), avatarUrl: photoUrlFor(req, r.avatar_key) },
    proposed: r.proposed,
    recordId: r.record_id,
    requestedBy: firstName(r.requester_name, r.requester_show, r.requester_deleted),
    requestedAt: new Date(r.created_at).toISOString(),
    // The clinic slip is PRIVATE: a path to fetch with a session
    // (GET /sign-requests/:id/evidence), never a public photo URL.
    hasEvidencePhoto: r.evidence_document_id !== null,
    evidencePhotoPath: r.evidence_document_id ? `/sign-requests/${r.id}/evidence` : null,
    evidencePhotoUrl: r.evidence_document_id ? `/sign-requests/${r.id}/evidence` : null,
    note: r.note,
    status: r.status,
  };
}

/** Open requests this vet may answer: addressed to them, or to any vet in a ward they cover. */
async function openRequestsFor(req: FastifyRequest, feederId: string, wards: string[], dogId?: string) {
  const res = await query<SignRequestRow>(
    `${SIGN_REQUEST_SQL}
      WHERE r.status = 'open' AND (r.vet_feeder_id = $1 OR (r.vet_feeder_id IS NULL AND d.ward_id = ANY($2::text[])))
        AND r.requested_by IS DISTINCT FROM $1
        AND ($3::uuid IS NULL OR r.dog_id = $3::uuid)
      ORDER BY r.created_at DESC LIMIT 50`,
    [feederId, wards, dogId ?? null],
  );
  return res.rows.map((r) => signRequestOf(req, r));
}

function cleanDraft(d: Draft): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
}

/**
 * Everything that must hold for this vet to sign this draft, checked at both
 * steps (the world may change between them). Returns the dog and context, or
 * sends the error and returns null.
 */
async function checkDraft(req: FastifyRequest, reply: FastifyReply, me: string, wards: string[], d: Draft) {
  const bad = (code: string, message: string) => {
    void reply.status(400).send({ ok: false, error: { message, code } });
    return null;
  };
  const dog = await publicDogBySlug(d.dogSlug, me);
  if (!dog) {
    void reply.status(404).send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
    return null;
  }
  if (d.type === "withdrawal") {
    if (!d.supersedes || !d.reason) return bad("INVALID_RECORD", "a withdrawal needs supersedes and a reason");
  } else {
    if (!d.givenOn) return bad("INVALID_RECORD", "givenOn is required");
    if (d.givenOn > kolkataToday()) return bad("INVALID_RECORD", "givenOn cannot be in the future");
    if (d.type === "vaccination" && !d.vaccine) return bad("INVALID_RECORD", "a vaccination needs the vaccine");
    if (d.type === "treatment" && !d.treatment && !d.diagnosis) return bad("INVALID_RECORD", "a treatment needs what was given");
    if (d.dueOn && d.dueOn <= d.givenOn) return bad("INVALID_RECORD", "dueOn must be after givenOn");
    if (d.supersedes && !d.reason) return bad("INVALID_RECORD", "a correction needs a reason");
  }
  let supersededType: string | null = null;
  if (d.supersedes) {
    const s = await query<{ record_type: string; signed_by: string | null; dog_ok: boolean; current: boolean }>(
      `SELECT m.record_type, m.signed_by,
              m.dog_id IN (SELECT id FROM dogs WHERE id = $2 OR merged_into = $2) AS dog_ok,
              NOT EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = m.id) AS current
         FROM medical_records m WHERE m.id = $1`,
      [d.supersedes, dog.id],
    );
    const r = s.rows[0];
    if (!r || !r.dog_ok) return bad("INVALID_SUPERSEDES", "that record is not on this dog");
    if (r.signed_by !== me) {
      void forbidden(reply, "NOT_YOUR_SIGNATURE", "only the vet who signed a record may correct or withdraw it");
      return null;
    }
    if (!r.current) {
      void reply.status(409).send({ ok: false, error: { message: "that record was already corrected or withdrawn", code: "RECORD_NOT_CURRENT" } });
      return null;
    }
    if (r.record_type === "withdrawal") return bad("INVALID_SUPERSEDES", "a withdrawal cannot be corrected");
    supersededType = r.record_type;
    if (d.type !== "withdrawal" && d.type !== r.record_type) return bad("INVALID_SUPERSEDES", "a correction keeps the record's type");
  }
  let confirms: string | null = d.confirmsRecordId ?? null;
  if (d.signRequestId) {
    const s = await query<{ ok: boolean; record_id: string | null }>(
      `SELECT (r.dog_id IN (SELECT id FROM dogs WHERE id = $2 OR merged_into = $2)
               AND r.status = 'open'
               AND (r.vet_feeder_id = $3 OR (r.vet_feeder_id IS NULL AND d.ward_id = ANY($4::text[])))) AS ok,
              r.record_id
         FROM sign_requests r JOIN dogs d ON d.id = r.dog_id WHERE r.id = $1`,
      [d.signRequestId, dog.id, me, wards],
    );
    if (!s.rows[0]?.ok) return bad("INVALID_SIGN_REQUEST", "that request is not open for you on this dog");
    // "Ask a vet to sign" on a feeder note: signing it confirms that note.
    confirms = confirms ?? s.rows[0].record_id;
  }
  if (confirms) {
    if (d.supersedes || d.type === "withdrawal") return bad("INVALID_CONFIRMS", "a confirmation cannot also correct or withdraw");
    const c = await query<{ ok: boolean }>(
      `SELECT (m.dog_id IN (SELECT id FROM dogs WHERE id = $2 OR merged_into = $2) AND NOT m.is_verified
               AND NOT EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = m.id)) AS ok
         FROM medical_records m WHERE m.id = $1`,
      [confirms, dog.id],
    );
    if (!c.rows[0]?.ok) return bad("INVALID_CONFIRMS", "that is not a current feeder note on this dog");
  }
  if (d.photoId) {
    const p = await query(
      `SELECT 1 FROM documents WHERE id = $1 AND uploaded_by = $2 AND owner_kind = 'pending' AND kind = 'record_photo'
          AND deleted_at IS NULL AND blob_key IS NOT NULL`,
      [d.photoId, me],
    );
    if ((p.rowCount ?? 0) === 0) return bad("INVALID_PHOTO", "upload the photo first (POST /vet/record-photos)");
  }
  let driveId: string | null = null;
  let driveDogId: string | null = d.driveDogId ?? null;
  if (d.driveId && !d.driveDogId) {
    const s = await query<{ ok: boolean; dd: string | null }>(
      `SELECT (dr.cancelled_at IS NULL AND dr.finished_at IS NULL
               AND (dr.lead_vet_feeder_id = $2
                    OR EXISTS (SELECT 1 FROM ngo_vets nv WHERE nv.ngo_id = dr.ngo_id AND nv.vet_feeder_id = $2 AND nv.unlinked_at IS NULL)
                    OR EXISTS (SELECT 1 FROM ngo_members nm WHERE nm.ngo_id = dr.ngo_id AND nm.feeder_id = $2 AND nm.left_at IS NULL))) AS ok,
              (SELECT dd.id FROM drive_dogs dd WHERE dd.drive_id = dr.id AND dd.dog_id = $3) AS dd
         FROM drives dr WHERE dr.id = $1`,
      [d.driveId, me, dog.id],
    );
    if (!s.rows[0]?.ok) return bad("INVALID_DRIVE", "that drive is not yours to sign on");
    driveId = d.driveId;
    driveDogId = s.rows[0].dd;
  }
  if (d.driveDogId) {
    const s = await query<{ ok: boolean }>(
      `SELECT (dd.dog_id = $2 AND dr.cancelled_at IS NULL
               AND (dr.lead_vet_feeder_id = $3
                    OR EXISTS (SELECT 1 FROM ngo_vets nv WHERE nv.ngo_id = dr.ngo_id AND nv.vet_feeder_id = $3 AND nv.unlinked_at IS NULL)
                    OR EXISTS (SELECT 1 FROM ngo_members nm WHERE nm.ngo_id = dr.ngo_id AND nm.feeder_id = $3 AND nm.left_at IS NULL))) AS ok
         FROM drive_dogs dd JOIN drives dr ON dr.id = dd.drive_id WHERE dd.id = $1`,
      [d.driveDogId, dog.id, me],
    );
    if (!s.rows[0]?.ok) return bad("INVALID_DRIVE_DOG", "that drive task is not yours to sign");
  }
  return { dog, supersededType, confirms, driveId, driveDogId };
}

export default async function vetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/vet/me", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    await claimInvites(auth.feederId);
    const row = await loadVetProfileRow("feeder_id", auth.feederId);
    const keys = await passkeysOf(auth.feederId);
    const canSign = row?.status === "verified" && keys.length > 0;
    return {
      ok: true,
      data: {
        profile: row ? vetProfileOf(row) : null,
        canSign,
        canAcceptSos: row?.status === "verified",
        passkeys: keys.map((k) => ({
          id: k.id,
          label: k.label,
          createdAt: k.created_at.toISOString(),
          lastUsedAt: k.last_used_at ? k.last_used_at.toISOString() : null,
        })),
        documents: row ? (await documentsOf("vet_profile", row.id)).map(({ deleteAfter: _d, deleted: _x, ...d }) => d) : [],
      },
    };
  });

  app.post("/api/v1/vet/apply", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!limited(req, reply, auth, applyPerAccount, "applyPerAccount")) return reply;
    const parsed = ApplyInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: { message: "invalid vet application", code: "INVALID_APPLICATION" } });
    }
    const a = parsed.data;
    if (!validWards(a.wards)) {
      return reply.status(400).send({ ok: false, error: { message: "wards must be Mumbai BMC wards", code: "INVALID_WARDS" } });
    }
    const phone = publicPhone(a.publicPhone);
    if (!phone) {
      return reply.status(400).send({ ok: false, error: { message: "that is not a valid Indian phone number", code: "INVALID_PHONE" } });
    }
    const start = a.sosHours ? minutesOf(a.sosHours.from) : null;
    const end = a.sosHours ? minutesOf(a.sosHours.to) : null;
    if (a.ngoId) {
      const n = await query(`SELECT 1 FROM ngos WHERE id = $1 AND status <> 'removed'`, [a.ngoId]);
      if ((n.rowCount ?? 0) === 0) {
        return reply.status(400).send({ ok: false, error: { message: "no such NGO", code: "INVALID_NGO" } });
      }
    }
    const out = await withTx(async (client) => {
      const cur = await client.query<{ id: string; status: VetStatus }>(
        `SELECT id, status FROM vet_profiles WHERE feeder_id = $1 FOR UPDATE`,
        [auth.feederId],
      );
      const existing = cur.rows[0];
      if (existing && ["waiting", "verified", "suspended"].includes(existing.status)) return { conflict: existing.status };
      if (existing?.status === "removed") return { removed: true };
      const values = [
        auth.feederId, a.regNo, a.qualification ?? null, a.clinic ?? null, a.wards, a.sosAvailable,
        start, end, phone, a.ngoId ?? null,
      ];
      const id = existing
        ? (
            await client.query<{ id: string }>(
              `UPDATE vet_profiles
                  SET council = 'MSVC', reg_no = $2, qualification = $3, clinic = $4, wards = $5, sos_available = $6,
                      sos_start = $7, sos_end = $8, phone_e164 = $9, ngo_id = COALESCE($10, ngo_id),
                      status = 'waiting', applied_at = now(), register_checked_at = NULL, register_checked_by = NULL,
                      updated_at = now()
                WHERE feeder_id = $1 RETURNING id`,
              values,
            )
          ).rows[0].id
        : (
            await client.query<{ id: string }>(
              `INSERT INTO vet_profiles (feeder_id, reg_no, qualification, clinic, wards, sos_available, sos_start, sos_end,
                                         phone_e164, ngo_id, status, applied_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'waiting', now()) RETURNING id`,
              values,
            )
          ).rows[0].id;
      await attachDocuments(client, auth.feederId, a.documentIds, "vet_profile", id);
      const kinds = await client.query<{ kind: string }>(
        `SELECT DISTINCT kind FROM documents WHERE owner_kind = 'vet_profile' AND owner_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      const have = new Set(kinds.rows.map((k) => k.kind));
      if (!have.has("certificate") || !have.has("photo_id")) throw new MissingDocuments();
      if (a.ngoId) {
        await client.query(
          `INSERT INTO ngo_vets (ngo_id, vet_feeder_id) VALUES ($1, $2)
           ON CONFLICT (ngo_id, vet_feeder_id) WHERE unlinked_at IS NULL DO NOTHING`,
          [a.ngoId, auth.feederId],
        );
      }
      await audit(client, {
        actorId: auth.feederId,
        actorKind: "vet",
        action: "vet.apply",
        subjectType: "vet_profile",
        subjectId: id,
        summary: `applied to sign records (MSVC ${a.regNo})`,
      });
      return { id };
    }).catch((err) => {
      if (err instanceof MissingDocuments) return { missingDocs: true as const };
      throw err;
    });
    if ("missingDocs" in out) {
      return reply.status(400).send({
        ok: false,
        error: { message: "upload your registration certificate and a photo ID first", code: "DOCUMENTS_REQUIRED" },
      });
    }
    if ("conflict" in out) {
      return reply.status(409).send({ ok: false, error: { message: `your application is ${out.conflict}`, code: "ALREADY_APPLIED" } });
    }
    if ("removed" in out) return forbidden(reply, "VET_REMOVED", "this account was removed as a vet; contact Hetja");
    const row = await loadVetProfileRow("feeder_id", auth.feederId);
    return reply.status(201).send({ ok: true, data: vetProfileOf(row!) });
  });

  app.patch("/api/v1/vet/me", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!limited(req, reply, auth)) return reply;
    const parsed = PatchInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: { message: "invalid profile change", code: "INVALID_PROFILE" } });
    }
    const p = parsed.data;
    if (p.wards && !validWards(p.wards)) {
      return reply.status(400).send({ ok: false, error: { message: "wards must be Mumbai BMC wards", code: "INVALID_WARDS" } });
    }
    const phone = p.publicPhone !== undefined ? publicPhone(p.publicPhone) : undefined;
    if (p.publicPhone !== undefined && !phone) {
      return reply.status(400).send({ ok: false, error: { message: "that is not a valid Indian phone number", code: "INVALID_PHONE" } });
    }
    const hoursSet = p.sosHours !== undefined;
    const upd = await query(
      `UPDATE vet_profiles SET
          clinic = CASE WHEN $2 THEN $3 ELSE clinic END,
          qualification = CASE WHEN $4 THEN $5 ELSE qualification END,
          wards = COALESCE($6, wards),
          sos_available = COALESCE($7, sos_available),
          sos_start = CASE WHEN $8 THEN $9 ELSE sos_start END,
          sos_end = CASE WHEN $8 THEN $10 ELSE sos_end END,
          phone_e164 = COALESCE($11, phone_e164),
          updated_at = now()
        WHERE feeder_id = $1 AND status <> 'removed'`,
      [
        auth.feederId,
        p.clinic !== undefined, p.clinic ?? null,
        p.qualification !== undefined, p.qualification ?? null,
        p.wards ?? null,
        p.sosAvailable ?? null,
        hoursSet, p.sosHours ? minutesOf(p.sosHours.from) : null, p.sosHours ? minutesOf(p.sosHours.to) : null,
        phone ?? null,
      ],
    );
    if ((upd.rowCount ?? 0) === 0) {
      return reply.status(404).send({ ok: false, error: { message: "apply as a vet first", code: "NO_VET_PROFILE" } });
    }
    const row = await loadVetProfileRow("feeder_id", auth.feederId);
    await audit(null, {
      actorId: auth.feederId,
      actorKind: "vet",
      action: "vet.profile_edit",
      subjectType: "vet_profile",
      subjectId: row!.id,
      summary: `edited their vet profile (${Object.keys(p).filter((k) => p[k as keyof typeof p] !== undefined).join(", ")})`,
      detail: { fields: Object.keys(p).filter((k) => p[k as keyof typeof p] !== undefined), wards: p.wards ?? null },
    });
    return { ok: true, data: vetProfileOf(row!) };
  });

  app.get("/api/v1/vet/home", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    const me = vet.auth.feederId;
    const row = (await loadVetProfileRow("feeder_id", me))!;
    const keys = await passkeysOf(me);
    // SOS near you: open cases in the vet's wards from the last day, and any
    // case they were paged for. Ward level only; a distance from the vet's
    // own last geotagged scan, rounded to 100 m (the case page's rule).
    // SECURITY-GATE: public-coordinates -- none returned; distance only.
    const sos = await query<{
      id: string;
      slug: string | null;
      name: string | null;
      photo_key: string | null;
      avatar_key: string | null;
      ward_id: string | null;
      severity: string;
      opened_at: Date;
      note: string | null;
      reporter_name: string | null;
      reporter_show: boolean | null;
      reporter_deleted: Date | null;
      acked_by: string | null;
      my_distance: number | null;
      sex: string | null;
    }>(
      `SELECT c.id, d.slug, d.name, ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key,
              COALESCE(c.ward_id, d.ward_id) AS ward_id, c.severity::text AS severity, c.opened_at, c.note,
              rf.display_name AS reporter_name, rf.show_first_name AS reporter_show, rf.deleted_at AS reporter_deleted,
              c.acked_by, d.sex,
              (SELECT ST_Distance(s2.geo, COALESCE(d.last_seen_geo, c.geo)) FROM scans s2
                WHERE s2.feeder_id = $1 AND s2.geo IS NOT NULL ORDER BY s2.received_at DESC LIMIT 1) AS my_distance
         FROM sos_cases c
         LEFT JOIN dogs d ON d.id = c.dog_id
         JOIN scans s ON s.id = c.scan_id
         LEFT JOIN feeders rf ON rf.id = s.feeder_id
        WHERE c.resolved_at IS NULL AND c.state IN ('open', 'acked', 'escalated')
          AND (EXISTS (SELECT 1 FROM sos_notifications n WHERE n.case_id = c.id AND n.feeder_id = $1)
               OR (COALESCE(c.ward_id, d.ward_id) = ANY($2::text[]) AND c.opened_at >= now() - interval '1 day'))
        ORDER BY (c.acked_by IS NULL) DESC, c.opened_at DESC
        LIMIT 10`,
      [me, vet.wards],
    );
    const requests = await openRequestsFor(req, me, vet.wards);
    const by = kolkataToday(14);
    const due = await dueSoon(vet.wards, by, 1000);
    return {
      ok: true,
      data: {
        profile: vetProfileOf(row),
        canSign: vet.status === "verified" && keys.length > 0,
        canAcceptSos: vet.status === "verified",
        sos: sos.rows.map((c) => ({
          caseId: c.id,
          dog: c.slug
            ? {
                slug: c.slug,
                name: c.name,
                sex: dogSex(c.sex),
                photoUrl: photoUrlFor(req, c.photo_key),
                avatarUrl: photoUrlFor(req, c.avatar_key),
              }
            : null,
          wardId: c.ward_id,
          wardCode: c.ward_id ? wardDisplay(c.ward_id).code : null,
          wardName: wardName(c.ward_id),
          severity: c.severity,
          openedAt: new Date(c.opened_at).toISOString(),
          note: c.note,
          reporterName: firstName(c.reporter_name, c.reporter_show, c.reporter_deleted),
          taken: c.acked_by !== null,
          distanceM: c.my_distance != null ? Math.round(Number(c.my_distance) / 100) * 100 : null,
        })),
        signRequests: requests.slice(0, 10),
        signRequestCount: requests.length,
        dueSoon: { count: due.length, by },
      },
    };
  });

  async function dueSoon(wards: string[], by: string, limit: number) {
    const res = await query<{
      slug: string;
      name: string | null;
      ward_id: string;
      due: string;
      last_label: string | null;
      photo_key: string | null;
      avatar_key: string | null;
    }>(
      `SELECT d.slug, d.name, d.ward_id, COALESCE(v.due_on, d.vaccine_due_month) AS due, v.vaccine_name AS last_label,
              ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key
         FROM dogs d
         LEFT JOIN LATERAL (
           SELECT m.payload->>'dueOn' AS due_on, m.vaccine_name FROM medical_records m
            WHERE m.dog_id = d.id AND m.record_type IN ('vaccination', 'vaccine') AND m.is_verified
              AND NOT EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = m.id)
            ORDER BY m.created_at DESC LIMIT 1) v ON true
        WHERE d.ward_id = ANY($1::text[]) AND d.status IN ('active', 'lost')
          AND COALESCE(v.due_on, d.vaccine_due_month) IS NOT NULL
          AND COALESCE(v.due_on, d.vaccine_due_month) <= $2
        ORDER BY due, d.name
        LIMIT $3`,
      [wards, by, limit],
    );
    return res.rows;
  }

  app.get("/api/v1/vet/due-soon", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    const by = kolkataToday(14);
    const rows = await dueSoon(vet.wards, by, 200);
    return {
      ok: true,
      data: {
        by,
        dogs: rows.map((r) => ({
          slug: r.slug,
          name: r.name,
          wardId: r.ward_id,
          wardCode: wardDisplay(r.ward_id).code,
          due: r.due,
          lastLabel: r.last_label,
          photoUrl: photoUrlFor(req, r.photo_key),
          avatarUrl: photoUrlFor(req, r.avatar_key),
        })),
      },
    };
  });

  app.get("/api/v1/vet/dogs/:slug", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    const me = vet.auth.feederId;
    const dog = await publicDogBySlug((req.params as { slug: string }).slug, me);
    if (!dog) return reply.status(404).send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
    const info = await query<{
      sex: string | null;
      approx_age: number | null;
      photo_key: string | null;
      avatar_key: string | null;
      qr_code: string | null;
      batch_no: string | null;
      last_fed_at: Date | null;
      lf_name: string | null;
      lf_show: boolean | null;
      lf_deleted: Date | null;
    }>(
      `SELECT d.sex, d.approx_age, ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key,
              c.qr_code, c.batch_no,
              lf.captured_at AS last_fed_at, lf.display_name AS lf_name, lf.show_first_name AS lf_show, lf.deleted_at AS lf_deleted
         FROM dogs d
         LEFT JOIN collars c ON c.dog_id = d.id AND c.retired_at IS NULL
         LEFT JOIN LATERAL (
           SELECT s.captured_at, f.display_name, f.show_first_name, f.deleted_at
             FROM scans s LEFT JOIN feeders f ON f.id = s.feeder_id
            WHERE s.dog_id = d.id AND s.scan_type = 'feed' AND s.review_status <> 'rejected'
            ORDER BY s.captured_at DESC LIMIT 1) lf ON true
        WHERE d.id = $1 LIMIT 1`,
      [dog.id],
    );
    const i = info.rows[0];
    const [records, youFeed, requests, keys] = await Promise.all([
      healthRecords(dog.id),
      isFeederOfDog(me, dog),
      openRequestsFor(req, me, vet.wards, dog.id),
      passkeysOf(me),
    ]);
    const code = i?.qr_code ?? dog.slug;
    return {
      ok: true,
      data: {
        dog: {
          slug: dog.slug,
          name: dog.name,
          sex: dogSex(i?.sex),
          approxAge: i?.approx_age ?? null,
          status: dog.status,
          wardId: dog.ward_id,
          wardCode: wardDisplay(dog.ward_id).code,
          photoUrl: photoUrlFor(req, i?.photo_key),
          avatarUrl: photoUrlFor(req, i?.avatar_key),
          collar: i?.qr_code ? { code: `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6)}`, batchNo: i.batch_no } : null,
        },
        youFeed,
        lastFedAt: i?.last_fed_at ? new Date(i.last_fed_at).toISOString() : null,
        lastFedBy: i?.last_fed_at ? firstName(i.lf_name, i.lf_show, i.lf_deleted) : null,
        health: { records, viewerIsVet: vet.status === "verified" },
        notesToConfirm: currentRecords(records).filter((r) => r.status === "feeder_noted"),
        openSignRequests: requests,
        // A suspended vet sees the dog but may not sign: the UI hides the buttons.
        canSign: vet.status === "verified" && keys.length > 0,
        vetStatus: vet.status,
        signingBlockedReason: vet.status !== "verified" ? "suspended" : keys.length === 0 ? "no_passkey" : null,
      },
    };
  });

  app.get("/api/v1/vet/sign-requests", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    return { ok: true, data: { requests: await openRequestsFor(req, vet.auth.feederId, vet.wards) } };
  });

  app.post("/api/v1/vet/sign-requests/:id/decline", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    if (!limited(req, reply, vet.auth)) return reply;
    const reason = z.strictObject({ reason: z.string().trim().min(1).max(280).optional() }).safeParse(req.body ?? {});
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!reason.success || !id.success) {
      return reply.status(400).send({ ok: false, error: { message: "invalid request", code: "INVALID_REQUEST" } });
    }
    const me = vet.auth.feederId;
    const upd = await withTx(async (client) => {
      const r = await client.query<{ requested_by: string | null; dog_name: string | null; slug: string }>(
        `UPDATE sign_requests r SET status = 'declined', decided_by = $2, decided_at = now(), decline_reason = $4
           FROM dogs d
          WHERE r.id = $1 AND d.id = r.dog_id AND r.status = 'open'
            AND (r.vet_feeder_id = $2 OR (r.vet_feeder_id IS NULL AND d.ward_id = ANY($3::text[])))
          RETURNING r.requested_by, d.name AS dog_name, d.slug`,
        [id.data, me, vet.wards, reason.data.reason ?? null],
      );
      const row = r.rows[0];
      if (row) {
        // Decided: the clinic slip's 30-day deletion clock starts.
        await client.query(
          `UPDATE documents SET delete_after = now() + interval '30 days'
            WHERE owner_kind = 'sign_request' AND owner_id = $1 AND deleted_at IS NULL AND delete_after IS NULL`,
          [id.data],
        );
        await audit(client, {
          actorId: me,
          actorKind: "vet",
          action: "sign_request.decline",
          subjectType: "sign_request",
          subjectId: id.data,
          summary: `declined a request to sign ${row.dog_name ?? row.slug}'s record`,
          detail: { reason: reason.data.reason ?? null },
        });
      }
      if (row?.requested_by) {
        await enqueueFeederPush(client, [row.requested_by], {
          kind: "v7",
          title: "A vet could not sign",
          body: `The vet said they did not give ${row.dog_name ?? "the dog"} this.`,
          url: `/dog/${row.slug}`,
          tag: `sign-request-${id.data}`,
        });
      }
      return row;
    });
    if (!upd) return reply.status(404).send({ ok: false, error: { message: "no open request", code: "NOT_FOUND" } });
    return { ok: true, data: { declined: true } };
  });

  // --- Passkeys -----------------------------------------------------------

  app.post("/api/v1/vet/passkeys/options", async (req, reply) => {
    const vet = await requireVet(req, reply);
    if (!vet) return reply;
    if (!limited(req, reply, vet.auth, passkeyPerAccount, "passkeyPerAccount")) return reply;
    const me = vet.auth.feederId;
    const name = (await query<{ display_name: string }>(`SELECT display_name FROM feeders WHERE id = $1`, [me])).rows[0]
      ?.display_name ?? "Hetja vet";
    const keys = await passkeysOf(me);
    if (keys.length >= 5) {
      return reply.status(409).send({ ok: false, error: { message: "five passkeys at most; remove one first", code: "TOO_MANY_PASSKEYS" } });
    }
    const { options, challenge } = await registrationOptions(
      app.config,
      { feederId: me, name },
      keys.map((k) => ({ id: k.credential_id, transports: k.transports ?? [] })),
    );
    await query(
      `INSERT INTO webauthn_challenges (feeder_id, purpose, challenge, expires_at)
       VALUES ($1, 'register', $2, now() + make_interval(secs => $3))`,
      [me, challenge, CHALLENGE_TTL_MS / 1000],
    );
    return { ok: true, data: options };
  });

  app.post("/api/v1/vet/passkeys", async (req, reply) => {
    const vet = await requireVet(req, reply);
    if (!vet) return reply;
    if (!limited(req, reply, vet.auth, passkeyPerAccount, "passkeyPerAccount")) return reply;
    const parsed = z
      .strictObject({ response: z.record(z.unknown()), label: z.string().trim().min(1).max(60).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: { message: "body must be { response, label? }", code: "INVALID_PASSKEY" } });
    }
    const me = vet.auth.feederId;
    const ch = await query<{ id: string; challenge: string }>(
      `SELECT id, challenge FROM webauthn_challenges
        WHERE feeder_id = $1 AND purpose = 'register' AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [me],
    );
    const challenge = ch.rows[0];
    if (!challenge) {
      return reply.status(400).send({ ok: false, error: { message: "start passkey setup again", code: "CHALLENGE_EXPIRED" } });
    }
    let verified;
    try {
      verified = await verifyRegistration(app.config, parsed.data.response, challenge.challenge);
    } catch {
      verified = null;
    }
    if (!verified) {
      return reply.status(400).send({ ok: false, error: { message: "the passkey could not be verified", code: "PASSKEY_INVALID" } });
    }
    const out = await withTx(async (client) => {
      const used = await client.query(`UPDATE webauthn_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [
        challenge.id,
      ]);
      if ((used.rowCount ?? 0) === 0) return null;
      const ins = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO webauthn_credentials (feeder_id, credential_id, public_key, counter, transports, label)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (credential_id) DO NOTHING
         RETURNING id, created_at`,
        [me, verified.credentialId, verified.publicKey, verified.counter, verified.transports, parsed.data.label ?? null],
      );
      if (!ins.rows[0]) return null;
      await audit(client, {
        actorId: me,
        actorKind: "vet",
        action: "vet.passkey_add",
        subjectType: "webauthn_credential",
        subjectId: ins.rows[0].id,
        summary: "added a passkey for signing",
      });
      return ins.rows[0];
    });
    if (!out) return reply.status(409).send({ ok: false, error: { message: "that passkey is already registered", code: "PASSKEY_EXISTS" } });
    return reply.status(201).send({
      ok: true,
      data: { id: out.id, label: parsed.data.label ?? null, createdAt: out.created_at.toISOString(), lastUsedAt: null },
    });
  });

  app.post("/api/v1/vet/passkeys/:id/remove", async (req, reply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!limited(req, reply, auth)) return reply;
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.status(400).send({ ok: false, error: { message: "bad id", code: "INVALID_ID" } });
    const upd = await query(
      `UPDATE webauthn_credentials SET revoked_at = now() WHERE id = $1 AND feeder_id = $2 AND revoked_at IS NULL`,
      [id.data, auth.feederId],
    );
    if ((upd.rowCount ?? 0) === 0) return reply.status(404).send({ ok: false, error: { message: "no such passkey", code: "NOT_FOUND" } });
    await audit(null, {
      actorId: auth.feederId,
      actorKind: "vet",
      action: "vet.passkey_remove",
      subjectType: "webauthn_credential",
      subjectId: id.data,
      summary: "removed a passkey",
    });
    return { ok: true, data: { removed: true } };
  });

  // --- Signing (V3, V5) ---------------------------------------------------

  app.post("/api/v1/vet/records/options", async (req, reply) => {
    const vet = await requireVet(req, reply);
    if (!vet) return reply;
    if (!limited(req, reply, vet.auth, vetSignPerAccount, "vetSignPerAccount")) return reply;
    const parsed = z.strictObject({ record: Draft }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: { message: "body must be { record }", code: "INVALID_RECORD" } });
    }
    const me = vet.auth.feederId;
    const ctx = await checkDraft(req, reply, me, vet.wards, parsed.data.record);
    if (!ctx) return reply;
    const keys = await passkeysOf(me);
    if (keys.length === 0) {
      return reply.status(409).send({ ok: false, error: { message: "set up a passkey first", code: "PASSKEY_REQUIRED" } });
    }
    const hash = recordHash(me, cleanDraft(parsed.data.record));
    const options = await signingOptions(
      app.config,
      hash,
      keys.map((k) => ({ id: k.credential_id, transports: k.transports ?? [] })),
    );
    const ch = await query<{ id: string }>(
      `INSERT INTO webauthn_challenges (feeder_id, purpose, challenge, record_hash, expires_at)
       VALUES ($1, 'sign', $2, $3, now() + make_interval(secs => $4)) RETURNING id`,
      [me, options.challenge, hash, CHALLENGE_TTL_MS / 1000],
    );
    return { ok: true, data: { challengeId: ch.rows[0].id, recordHash: hash, options } };
  });

  app.post("/api/v1/vet/records", async (req, reply) => {
    const vet = await requireVet(req, reply);
    if (!vet) return reply;
    if (!limited(req, reply, vet.auth, vetSignPerAccount, "vetSignPerAccount")) return reply;
    const parsed = z
      .strictObject({ challengeId: z.string().uuid(), record: Draft, assertion: z.record(z.unknown()) })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "body must be { challengeId, record, assertion }", code: "INVALID_RECORD" } });
    }
    const me = vet.auth.feederId;
    const d = parsed.data.record;
    const ctx = await checkDraft(req, reply, me, vet.wards, d);
    if (!ctx) return reply;
    const hash = recordHash(me, cleanDraft(d));
    const ch = await query<{ record_hash: string }>(
      `SELECT record_hash FROM webauthn_challenges
        WHERE id = $1 AND feeder_id = $2 AND purpose = 'sign' AND used_at IS NULL AND expires_at > now()`,
      [parsed.data.challengeId, me],
    );
    if (!ch.rows[0] || ch.rows[0].record_hash !== hash) {
      return reply.status(400).send({
        ok: false,
        error: { message: "this record is not the one the passkey was asked to sign; start again", code: "CHALLENGE_MISMATCH" },
      });
    }
    const credId = typeof parsed.data.assertion.id === "string" ? parsed.data.assertion.id : "";
    const key = (await passkeysOf(me)).find((k) => k.credential_id === credId);
    if (!key) {
      return reply.status(400).send({ ok: false, error: { message: "unknown passkey", code: "PASSKEY_UNKNOWN" } });
    }
    const ok = await verifySigning(app.config, parsed.data.assertion, hash, {
      id: key.credential_id,
      publicKey: key.public_key,
      counter: Number(key.counter),
      transports: key.transports ?? [],
    });
    if (!ok) {
      return reply.status(400).send({ ok: false, error: { message: "the signature did not verify", code: "BAD_SIGNATURE" } });
    }

    const type = d.type;
    const input = MedicalRecordInput.safeParse({
      dogId: ctx.dog.id,
      recordType: type,
      ...(d.supersedes || ctx.confirms ? { correctsRecordId: d.supersedes ?? ctx.confirms } : {}),
      ...(type === "vaccination" ? { vaccineName: d.vaccine, vaccineDate: d.givenOn } : {}),
      ...(type === "sterilisation" ? { abcDate: d.givenOn } : {}),
      ...(type === "treatment" ? { ...(d.diagnosis ? { diagnosis: d.diagnosis } : {}), ...(d.treatment ? { treatment: d.treatment } : {}) } : {}),
    });
    if (!input.success) {
      return reply.status(400).send({ ok: false, error: { message: "invalid record", code: "INVALID_RECORD" } });
    }
    const title =
      type === "vaccination" ? d.vaccine : type === "sterilisation" ? "Sterilised" : type === "treatment" ? (d.treatment ?? d.diagnosis) : undefined;
    const result = await withTx(async (client) => {
      const used = await client.query(
        `UPDATE webauthn_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
        [parsed.data.challengeId],
      );
      if ((used.rowCount ?? 0) === 0) return null;
      await client.query(
        `UPDATE webauthn_credentials SET counter = GREATEST(counter, $2), last_used_at = now() WHERE id = $1`,
        [key.id, ok.newCounter],
      );
      const out = await appendMedicalRecord(client, {
        input: input.data,
        vetId: null,
        isVerified: true,
        vetSignature: null,
        v7: {
          recordSource: "vet_signed",
          hashVetId: `vet:${me}`,
          hashed: {
            source: "vet_signed",
            signer: me,
            credentialId: key.credential_id,
            recordHash: hash,
            ...(title ? { title } : {}),
            ...(d.givenOn ? { givenOn: d.givenOn } : {}),
            ...(d.dueOn ? { dueOn: d.dueOn } : {}),
            ...(d.brand ? { brand: d.brand } : {}),
            ...(d.batch ? { batch: d.batch } : {}),
            ...(d.earNotched !== undefined ? { earNotched: d.earNotched } : {}),
            ...(d.note ? { note: d.note } : {}),
            ...(d.reason ? { reason: d.reason } : {}),
            ...(ctx.confirms ? { confirms: ctx.confirms } : {}),
            ...(d.photoId ? { photoId: d.photoId } : {}),
          },
          signedBy: me,
          credentialId: key.credential_id,
          assertion: parsed.data.assertion,
          recordHash: hash,
          correctionReason: d.reason ?? null,
          driveDogId: ctx.driveDogId,
        },
      });
      // Signed from a drive the dog is not on yet (registered there, say): add it.
      let driveDogId = ctx.driveDogId;
      if (ctx.driveId && !driveDogId && (type === "vaccination" || type === "sterilisation")) {
        driveDogId = await addDogToDrive(client, ctx.driveId, ctx.dog.id, {
          vaccinate: type === "vaccination",
          sterilise: type === "sterilisation",
        });
      }
      if (d.photoId) {
        await client.query(
          // Retention (docs/INVARIANTS.md, v7): the record is final once
          // signed (a correction is a new record), so the photo's 30 days
          // start now, the same clock as a decided application's documents.
          `UPDATE documents SET owner_kind = 'medical_record', owner_id = $2, delete_after = now() + interval '30 days'
            WHERE id = $1 AND owner_kind = 'pending'`,
          [d.photoId, out.id],
        );
      }
      // What the record means for the dog's page and for the people waiting on it.
      if (type !== "withdrawal") {
        await client.query(
          `UPDATE dogs SET verified_at = COALESCE(verified_at, now()), verified_by = COALESCE(verified_by, $2),
                           verified_via = COALESCE(verified_via, 'vet'),
                           vaccine_due_month = CASE WHEN $3::text IS NOT NULL THEN substr($3::text, 1, 7) ELSE vaccine_due_month END,
                           abc_status = CASE WHEN $4 THEN 'sterilised' ELSE abc_status END
            WHERE id = $1`,
          [ctx.dog.id, me, type === "vaccination" ? (d.dueOn ?? null) : null, type === "sterilisation"],
        );
      }
      let requester: string | null = null;
      if (d.signRequestId) {
        const r = await client.query<{ requested_by: string | null }>(
          `UPDATE sign_requests SET status = 'signed', decided_by = $2, decided_at = now(), signed_record_id = $3
            WHERE id = $1 AND status = 'open' RETURNING requested_by`,
          [d.signRequestId, me, out.id],
        );
        requester = r.rows[0]?.requested_by ?? null;
      }
      if (ctx.confirms) {
        // Any other open request on the confirmed note is answered too.
        const r = await client.query<{ requested_by: string | null }>(
          `UPDATE sign_requests SET status = 'signed', decided_by = $2, decided_at = now(), signed_record_id = $3
            WHERE record_id = $1 AND status = 'open' RETURNING requested_by`,
          [ctx.confirms, me, out.id],
        );
        requester = requester ?? r.rows[0]?.requested_by ?? null;
      }
      await client.query(
        `UPDATE documents SET delete_after = now() + interval '30 days'
          WHERE owner_kind = 'sign_request' AND deleted_at IS NULL AND delete_after IS NULL
            AND owner_id IN (SELECT id FROM sign_requests WHERE status <> 'open' AND signed_record_id = $1)`,
        [out.id],
      );
      if (driveDogId) {
        await client.query(
          `UPDATE drive_dogs SET
              done_vaccinate_at = CASE WHEN $2 = 'vaccination' THEN COALESCE(done_vaccinate_at, now()) ELSE done_vaccinate_at END,
              done_sterilise_at = CASE WHEN $2 = 'sterilisation' THEN COALESCE(done_sterilise_at, now()) ELSE done_sterilise_at END,
              vaccination_record_id = CASE WHEN $2 = 'vaccination' THEN $3::uuid ELSE vaccination_record_id END,
              updated_at = now()
            WHERE id = $1`,
          [driveDogId, type, out.id],
        );
      }
      const dogName = ctx.dog.name ?? "the dog";
      if (type === "withdrawal") {
        // V5: "The badge comes off Rani's page and Priya is told."
        await enqueueFeederPush(client, await feederIdsOfDog(ctx.dog.id, me, client), {
          kind: "v7",
          title: "A vet withdrew a record",
          body: `A vet withdrew a signed record on ${dogName}'s page.`,
          url: `/dog/${ctx.dog.slug}`,
          tag: `record-${out.id}`,
        });
      } else if (requester) {
        await enqueueFeederPush(client, [requester], {
          kind: "v7",
          title: "Signed by a vet",
          body: `${dogName}'s record is now vet signed.`,
          url: `/dog/${ctx.dog.slug}`,
          tag: `record-${out.id}`,
        });
      }
      await audit(client, {
        actorId: me,
        actorKind: "vet",
        action: type === "withdrawal" ? "vet.withdraw" : d.supersedes ? "vet.correct" : "vet.sign",
        subjectType: "medical_record",
        subjectId: out.id,
        summary: `${type === "withdrawal" ? "withdrew" : d.supersedes ? "corrected" : "signed"} ${ctx.dog.name ?? ctx.dog.slug} · ${
          type === "withdrawal" ? (ctx.supersededType ?? "record") : (title ?? type)
        }`,
        detail: { dogSlug: ctx.dog.slug, recordType: type, supersedes: d.supersedes ?? null, reason: d.reason ?? null },
      });
      return out;
    });
    if (!result) {
      return reply.status(409).send({ ok: false, error: { message: "that signature was already used", code: "CHALLENGE_USED" } });
    }
    forgetDog(ctx.dog.slug);
    return reply.status(201).send({
      ok: true,
      data: { recordId: result.id, hash: result.hashCurr, recordHash: hash, dogSlug: ctx.dog.slug, type, signedAt: new Date().toISOString() },
    });
  });

  const signatures = async (req: FastifyRequest, me: string, id: string | null) => {
    const res = await query<{
      id: string;
      slug: string;
      name: string | null;
      record_type: string;
      payload: Record<string, unknown>;
      created_at: Date;
      corrects_record_id: string | null;
      withdrawn: boolean;
      corrected: boolean;
      flagged: boolean;
      rq_name: string | null;
      rq_show: boolean | null;
      rq_deleted: Date | null;
    }>(
      `SELECT m.id, d.slug, d.name, m.record_type, m.payload, m.created_at, m.corrects_record_id,
              rq.display_name AS rq_name, rq.show_first_name AS rq_show, rq.deleted_at AS rq_deleted,
              EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = m.id AND w.record_type = 'withdrawal') AS withdrawn,
              EXISTS (SELECT 1 FROM medical_records w WHERE w.corrects_record_id = m.id AND w.record_type <> 'withdrawal') AS corrected,
              (SELECT vp.signatures_flagged_at IS NOT NULL FROM vet_profiles vp WHERE vp.feeder_id = m.signed_by) AS flagged
         FROM medical_records m JOIN dogs d ON d.id = m.dog_id
         LEFT JOIN LATERAL (SELECT sr.requested_by FROM sign_requests sr WHERE sr.signed_record_id = m.id LIMIT 1) sr ON true
         LEFT JOIN feeders rq ON rq.id = sr.requested_by
        WHERE m.signed_by = $1 AND ($2::uuid IS NULL OR m.id = $2::uuid)
        ORDER BY m.created_at DESC LIMIT 200`,
      [me, id],
    );
    return res.rows.map((r) => ({
          id: r.id,
          dog: { slug: r.slug, name: r.name },
          type: r.record_type,
          title: typeof r.payload?.title === "string" ? r.payload.title : r.record_type,
          date: typeof r.payload?.givenOn === "string" ? r.payload.givenOn : null,
          batch: typeof r.payload?.batch === "string" ? r.payload.batch : null,
          signedAt: new Date(r.created_at).toISOString(),
          status: r.withdrawn ? "withdrawn" : r.corrected ? "corrected" : r.flagged ? "flagged" : "valid",
          supersedes: r.corrects_record_id,
          requestedBy: firstName(r.rq_name, r.rq_show, r.rq_deleted),
        }));
  };

  app.get("/api/v1/vet/signatures", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    return { ok: true, data: { signatures: await signatures(req, vet.auth.feederId, null) } };
  });

  app.get("/api/v1/vet/signatures/:id", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    const one = id.success ? (await signatures(req, vet.auth.feederId, id.data))[0] : undefined;
    if (!one) return reply.status(404).send({ ok: false, error: { message: "no such signature of yours", code: "NOT_FOUND" } });
    return { ok: true, data: one };
  });

  app.get("/api/v1/vet/sign-requests/:id", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.status(404).send({ ok: false, error: { message: "no such request", code: "NOT_FOUND" } });
    const r = await query<SignRequestRow>(
      `${SIGN_REQUEST_SQL}
        WHERE r.id = $1 AND (r.vet_feeder_id = $2 OR r.decided_by = $2 OR (r.vet_feeder_id IS NULL AND d.ward_id = ANY($3::text[])))`,
      [id.data, vet.auth.feederId, vet.wards],
    );
    if (!r.rows[0]) return reply.status(404).send({ ok: false, error: { message: "no such request", code: "NOT_FOUND" } });
    return { ok: true, data: signRequestOf(req, r.rows[0]) };
  });

  /** V2 "Or search by name or ID": dogs in the vet's wards. Ward level only. */
  app.get("/api/v1/vet/dogs", async (req, reply) => {
    const vet = await requireVet(req, reply, { allowSuspended: true });
    if (!vet) return reply;
    if (!limited(req, reply, vet.auth, vetSearchPerAccount, "vetSearchPerAccount")) return reply;
    const q = String((req.query as { q?: string }).q ?? "").trim().slice(0, 60);
    if (q.length < 2) return { ok: true, data: { dogs: [] } };
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const slugish = q.toLowerCase().replace(/[^a-z0-9]/g, "");
    const r = await query<{ slug: string; name: string | null; ward_id: string; sex: string | null; photo_key: string | null; avatar_key: string | null }>(
      `SELECT d.slug, d.name, d.ward_id, d.sex, ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key
         FROM dogs d
        WHERE d.status IN ('active', 'lost') AND d.ward_id = ANY($1::text[])
          AND (d.name ILIKE $2 OR (length($3) >= 3 AND d.slug LIKE $3 || '%'))
        ORDER BY d.name NULLS LAST LIMIT 20`,
      [vet.wards, like, slugish],
    );
    return {
      ok: true,
      data: {
        dogs: r.rows.map((d) => ({
          slug: d.slug,
          name: d.name,
          sex: dogSex(d.sex),
          wardId: d.ward_id,
          wardCode: wardDisplay(d.ward_id).code,
          photoUrl: photoUrlFor(req, d.photo_key),
          avatarUrl: photoUrlFor(req, d.avatar_key),
        })),
      },
    };
  });

  /** V3: the vaccine sticker. Private to the record (vets, the dog's feeders, admins); encrypted like documents. */
  app.post("/api/v1/vet/record-photos", { bodyLimit: PHOTO_ROUTE_BODY_LIMIT }, async (req, reply) => {
    const vet = await requireVet(req, reply);
    if (!vet) return reply;
    if (!limited(req, reply, vet.auth, documentUploadPerAccount, "documentUploadPerAccount")) return reply;
    const b = z.strictObject({ base64: z.string().min(1) }).safeParse(req.body ?? {});
    if (!b.success) return reply.status(400).send({ ok: false, error: { message: "body must be { base64 }", code: "INVALID_PHOTO" } });
    try {
      docsKey(app.config);
    } catch {
      return reply.status(503).send({ ok: false, error: { message: "photo upload is not available yet", code: "DOCUMENTS_UNAVAILABLE" } });
    }
    let release;
    try {
      release = await photoGate.acquire();
    } catch (e) {
      if (!(e instanceof PhotoBusyError)) throw e;
      return reply
        .status(503)
        .header("retry-after", String(PHOTO_BUSY_RETRY_AFTER_SEC))
        .send({ ok: false, error: { message: "photo processing is busy; try again shortly", code: "PHOTO_BUSY" } });
    }
    try {
      const img = decodePhotoUpload(b.data.base64);
      const mime = img.ext === "png" ? "image/png" : img.ext === "webp" ? "image/webp" : "image/jpeg";
      const id = randomUUID();
      await query(
        `INSERT INTO documents (id, owner_kind, uploaded_by, kind, mime, size_bytes, sha256, delete_after)
         VALUES ($1, 'pending', $2, 'record_photo', $3, $4, $5, now() + interval '1 day')`,
        [id, vet.auth.feederId, mime, img.bytes.length, sha256Hex(img.bytes)],
      );
      const key = await writeDocument(app.config, id, img.bytes);
      await query(`UPDATE documents SET blob_key = $2 WHERE id = $1`, [id, key]);
      return reply.status(201).send({ ok: true, data: { photoId: id } });
    } catch (e) {
      if (e instanceof UnsupportedImageError) {
        return reply.status(400).send({ ok: false, error: { message: `photo rejected: ${e.message}`, code: "INVALID_PHOTO" } });
      }
      if (e instanceof DocumentsUnavailableError) {
        return reply.status(503).send({ ok: false, error: { message: "photo upload is not available yet", code: "DOCUMENTS_UNAVAILABLE" } });
      }
      throw e;
    } finally {
      release();
    }
  });
}

class MissingDocuments extends Error {}

export { VetRecordProposal };
