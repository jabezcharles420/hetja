/**
 * Design v7, the public and feeder-side routes (docs/design/v7-portals/CONTRACT.md "API").
 *
 * GET  /api/v1/dogs/:slug/health              V4 health list. Public; a Bearer only sets viewerIsVet
 * GET  /api/v1/wards/:wardId/professionals    verified vets and active NGOs covering a ward (public numbers)
 * GET  /api/v1/dogs/:slug/vets                the same vets, for "Ask a vet to sign"
 * POST /api/v1/dogs/:slug/problems            "Report a problem": duplicate, photo, other
 * POST /api/v1/dogs/:slug/health-notes        a feeder of the dog notes care ("Feeder noted")
 * POST /api/v1/dogs/:slug/sign-requests       "Ask a vet to sign" (feeder of the dog)
 * GET  /api/v1/dogs/:slug/avatar-signoff      A4 "Ask Priya": the avatar waiting for this feeder
 * POST /api/v1/dogs/:slug/avatar-signoff      her answer: looks right, or a redo
 * POST /api/v1/documents                      V1 / N1 upload (encrypted at rest, admins only)
 *
 * ABUSE. Every write is rate limited per account (or per device for the
 * anonymous problem report, which is also limited per IP and per dog, the
 * tag-report pattern). The anonymous reads (health, professionals) are limited
 * per device, or per address with no device, under a global bucket, like the
 * v5 finding reads (docs/INVARIANTS.md #6). Notes and document bytes are never
 * logged; the request serializer drops bodies already.
 */
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { MAX_PHOTO_BASE64_CHARS, MedicalRecordInput, isBmcWardCode } from "@hetja/contracts";
import { isValidSlug, query, withTx } from "@hetja/db";
import { anonSubject, deviceSubjectOf } from "../lib/anon-subject.js";
import { deviceTokenSubject } from "../lib/device.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { requireFeeder, type RoleAuth } from "../lib/require-role.js";
import {
  GLOBAL_SUBJECT,
  documentUploadPerAccount,
  enforceLimits,
  feederWritePerAccount,
  healthReadGlobal,
  healthReadPerSubject,
  ipBucketKey,
  problemReportPerDog,
  problemReportPerIp,
  problemReportPerSubject,
  professionalsReadPerSubject,
  signRequestPerAccount,
  signRequestPerDog,
  subjectKey,
} from "../lib/rate-limit.js";
import { enqueueFeederPush, isFeederOfDog, type DogRef } from "../lib/dog-feeders.js";
import { healthRecords } from "../lib/health.js";
import { isActiveVet, vetsForWard, wardProfessionals } from "../lib/professionals.js";
import { deviceBlockedBody, isDeviceBlocked, isSuspended, suspendedBody } from "../lib/moderation-state.js";
import { photoUrlFor } from "../lib/photo-url.js";
import { PHOTO_ROUTE_BODY_LIMIT } from "../lib/body-limits.js";
import { PHOTO_BUSY_RETRY_AFTER_SEC, PhotoBusyError, photoGate } from "../lib/photo-gate.js";
import { decodePhotoUpload, storePhoto, type StorageConfig } from "../lib/storage.js";
import { UnsupportedImageError } from "../lib/exif-strip.js";
import {
  DOCUMENT_ROUTE_BODY_LIMIT,
  DocumentRejectedError,
  DocumentsUnavailableError,
  decodeDocument,
  docsKey,
  sha256Hex,
  writeDocument,
} from "../lib/documents.js";
import { appendMedicalRecord } from "./medical.js";
import { readDocument } from "../lib/documents.js";
import { loadAdmin } from "../lib/admin.js";
import { audit } from "../lib/audit.js";
import { forgetDog, printedBatchNo } from "./dogs.js";

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });

const NON_PUBLIC = new Set(["pending_activation", "expired"]);

/** A public dog by slug, following a merge to the kept dog. null = answer 404. */
export async function publicDogBySlug(slug: string, viewerId: string | null = null): Promise<DogRef | null> {
  if (!isValidSlug(slug)) return null;
  const res = await query<DogRef & { merged_into: string | null }>(
    `SELECT id, slug, name, status::text AS status, ward_id, registered_by, registered_device_id, tag_review_since, merged_into
       FROM dogs WHERE slug = $1`,
    [slug],
  );
  let dog = res.rows[0];
  if (!dog) return null;
  if (dog.merged_into) {
    const kept = await query<DogRef & { merged_into: string | null }>(
      `SELECT id, slug, name, status::text AS status, ward_id, registered_by, registered_device_id, tag_review_since, merged_into
         FROM dogs WHERE id = $1`,
      [dog.merged_into],
    );
    if (!kept.rows[0]) return null;
    dog = kept.rows[0];
  }
  if (NON_PUBLIC.has(dog.status) && (!viewerId || viewerId !== dog.registered_by)) return null;
  return dog;
}

/** The Bearer's subject when a valid access token is presented; never answers 401. */
function optionalFeederId(req: FastifyRequest): string | null {
  const raw = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  if (!raw.startsWith("Bearer ")) return null;
  try {
    return verifyAccessToken(raw.slice(7), req.server.config.JWT_SECRET).sub as string;
  } catch {
    return null;
  }
}

const YMD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const Short = (n: number) => z.string().trim().min(1).max(n);

const HealthNoteInput = z.strictObject({
  type: z.enum(["vaccination", "sterilisation", "treatment", "deworming", "other"]),
  title: Short(60).optional(),
  date: YMD,
  vaccine: Short(60).optional(),
  brand: Short(60).optional(),
  batch: Short(40).optional(),
  dueOn: YMD.optional(),
  note: Short(280).optional(),
});

export const VetRecordProposal = z.strictObject({
  type: z.enum(["vaccination", "sterilisation", "treatment"]),
  vaccine: Short(60).optional(),
  brand: Short(60).optional(),
  batch: Short(40).optional(),
  givenOn: YMD,
  dueOn: YMD.nullable().optional(),
  earNotched: z.boolean().optional(),
  diagnosis: Short(300).optional(),
  treatment: Short(500).optional(),
  note: Short(280).optional(),
});
export type VetRecordProposal = z.infer<typeof VetRecordProposal>;

const SignRequestInput = z
  .strictObject({
    recordId: z.string().uuid().optional(),
    proposed: VetRecordProposal.optional(),
    vetFeederId: z.string().uuid().nullable().optional(),
    evidencePhotoBase64: z.string().max(MAX_PHOTO_BASE64_CHARS).optional(),
    note: Short(280).optional(),
  })
  .refine((b) => !!b.recordId !== !!b.proposed, { message: "exactly one of recordId or proposed" });

const ProblemInput = z.strictObject({
  kind: z.enum(["duplicate", "photo", "other"]),
  otherSlug: z.string().max(16).optional(),
  note: Short(500).optional(),
  deviceToken: z.string().max(256).optional(),
});

const DocumentInput = z.strictObject({
  kind: z.enum(["certificate", "photo_id", "ngo_registration"]),
  fileName: z.string().trim().min(1).max(200),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(1).max(DOCUMENT_ROUTE_BODY_LIMIT),
});

/** The label a feeder-noted record gets when none is typed. */
const DEFAULT_TITLE = {
  vaccination: "Vaccination",
  sterilisation: "Sterilised",
  treatment: "Treatment",
  deworming: "Deworming",
  other: "Care note",
} as const;

/** A proposal read back out of a feeder-noted ledger row (for "Ask a vet to sign" on it). */
function proposalFromRecord(r: {
  record_type: string;
  vaccine_name: string | null;
  payload: Record<string, unknown> | null;
}): VetRecordProposal | null {
  const p = r.payload ?? {};
  const type = r.record_type === "vaccination" ? "vaccination" : r.record_type === "sterilisation" ? "sterilisation" : "treatment";
  const parsed = VetRecordProposal.safeParse({
    type,
    ...(type === "vaccination" && (r.vaccine_name || p.title) ? { vaccine: String(r.vaccine_name ?? p.title) } : {}),
    ...(typeof p.brand === "string" ? { brand: p.brand } : {}),
    ...(typeof p.batch === "string" ? { batch: p.batch } : {}),
    givenOn: typeof p.givenOn === "string" ? p.givenOn : undefined,
    ...(typeof p.dueOn === "string" ? { dueOn: p.dueOn } : {}),
    ...(type === "treatment" && typeof p.title === "string" ? { treatment: p.title } : {}),
    ...(typeof p.note === "string" ? { note: p.note } : {}),
  });
  return parsed.success ? parsed.data : null;
}

export function reporterDeviceHash(subject: string): string {
  return createHash("sha256").update(`problem-report|${subject}`).digest("hex");
}

export default async function v7PublicRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // V4: the health list
  // -------------------------------------------------------------------------
  app.get("/api/v1/dogs/:slug/health", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    // An invalid or expired token is IGNORED here, not a 401 (the collar page
    // reads this anonymously too): it only ever decides viewerIsVet.
    const viewerId = optionalFeederId(req);
    const anon = anonSubject(req);
    if (
      !enforceLimits(req.log, reply, [
        {
          limiter: healthReadPerSubject,
          key: viewerId ? `acct:${viewerId}` : anon.key,
          name: "healthReadPerSubject",
          kind: viewerId ? "account" : anon.kind,
        },
        { limiter: healthReadGlobal, key: GLOBAL_SUBJECT, name: "healthReadGlobal", kind: "global" },
      ])
    ) {
      return reply;
    }
    const dog = await publicDogBySlug((req.params as { slug: string }).slug, viewerId);
    if (!dog) return notFound(reply);
    const [records, viewerIsVet] = await Promise.all([
      healthRecords(dog.id),
      viewerId ? isActiveVet(viewerId) : Promise.resolve(false),
    ]);
    // The V4 certificate is a web page that builds the PDF in the browser.
    const certificateUrl = `${app.config.PUBLIC_WEB_ORIGIN.replace(/\/+$/, "")}/vet/${dog.slug}/certificate`;
    const collar = await query<{ batch_no: string | null }>(`SELECT batch_no FROM collars WHERE dog_id = $1 LIMIT 1`, [dog.id]);
    return { ok: true, data: { records, certificateUrl, viewerIsVet, collarBatchNo: printedBatchNo(collar.rows[0]?.batch_no) } };
  });

  /**
   * Who may see a PRIVATE photo about a dog (a record's vaccine sticker, a
   * sign request's clinic slip): a verified vet, a feeder of the dog, or an
   * admin holding a MODERATION permission (vets or reports), not every admin
   * role (pre-deploy review). Every open is audited. Encrypted at rest with
   * the documents; streamed, never cached.
   */
  async function mayViewPrivatePhoto(feederId: string, dog: DogRef): Promise<"vet" | "feeder" | "admin" | null> {
    if (await isActiveVet(feederId)) return "vet";
    if (await isFeederOfDog(feederId, dog)) return "feeder";
    const admin = await loadAdmin(feederId, app.config);
    if (admin && (admin.permissions.has("vets") || admin.permissions.has("reports"))) return "admin";
    return null;
  }

  async function streamPrivatePhoto(
    reply: FastifyReply,
    viewer: { feederId: string; kind: "vet" | "feeder" | "admin" },
    doc: { id: string; mime: string; blob_key: string | null; kind: string } | undefined,
    subject: { type: string; id: string },
  ) {
    if (!doc?.blob_key) return notFound(reply);
    let bytes: Buffer;
    try {
      bytes = await readDocument(app.config, doc.id, doc.blob_key);
    } catch {
      return reply.status(503).send({ ok: false, error: { message: "the photo could not be read", code: "DOCUMENTS_UNAVAILABLE" } });
    }
    await audit(null, {
      actorId: viewer.feederId,
      actorKind: viewer.kind === "admin" ? "admin" : viewer.kind === "vet" ? "vet" : "feeder",
      action: "document.view",
      subjectType: "document",
      subjectId: doc.id,
      summary: `opened a ${doc.kind.replace("_", " ")}`,
      detail: { on: subject.type, onId: subject.id },
    });
    return reply.header("Content-Type", doc.mime).header("Cache-Control", "private, no-store").send(bytes);
  }

  const notAllowedPhoto = (reply: FastifyReply) =>
    reply
      .status(403)
      .send({ ok: false, error: { message: "only vets, this dog's feeders and moderators can see this photo", code: "NOT_ALLOWED" } });

  app.get("/api/v1/dogs/:slug/health/:recordId/photo", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const { recordId } = req.params as { recordId: string };
    if (!z.string().uuid().safeParse(recordId).success) return notFound(reply);
    const dog = await publicDogBySlug((req.params as { slug: string }).slug, auth.feederId);
    if (!dog) return notFound(reply);
    const kind = await mayViewPrivatePhoto(auth.feederId, dog);
    if (!kind) return notAllowedPhoto(reply);
    const d = await query<{ id: string; mime: string; blob_key: string | null; kind: string }>(
      `SELECT x.id, x.mime, x.blob_key, x.kind FROM documents x JOIN medical_records m ON m.id = x.owner_id
        WHERE x.owner_kind = 'medical_record' AND x.owner_id = $1 AND x.deleted_at IS NULL
          AND m.dog_id IN (SELECT id FROM dogs WHERE id = $2 OR merged_into = $2) LIMIT 1`,
      [recordId, dog.id],
    );
    return streamPrivatePhoto(reply, { feederId: auth.feederId, kind }, d.rows[0], { type: "medical_record", id: recordId });
  });

  /** A sign request's clinic slip (V2): the same private rule as a record photo. */
  app.get("/api/v1/sign-requests/:id/evidence", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return notFound(reply);
    const r = await query<{ slug: string; doc_id: string | null }>(
      `SELECT d.slug, r.evidence_document_id AS doc_id FROM sign_requests r JOIN dogs d ON d.id = r.dog_id WHERE r.id = $1`,
      [id],
    );
    const row = r.rows[0];
    if (!row?.doc_id) return notFound(reply);
    const dog = await publicDogBySlug(row.slug, auth.feederId);
    if (!dog) return notFound(reply);
    const kind = await mayViewPrivatePhoto(auth.feederId, dog);
    if (!kind) return notAllowedPhoto(reply);
    const d = await query<{ id: string; mime: string; blob_key: string | null; kind: string }>(
      `SELECT id, mime, blob_key, kind FROM documents WHERE id = $1 AND owner_kind = 'sign_request' AND owner_id = $2 AND deleted_at IS NULL`,
      [row.doc_id, id],
    );
    return streamPrivatePhoto(reply, { feederId: auth.feederId, kind }, d.rows[0], { type: "sign_request", id });
  });

  // -------------------------------------------------------------------------
  // Vets and NGOs covering a ward (public professional numbers)
  // -------------------------------------------------------------------------
  const professionalsLimited = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const viewerId = optionalFeederId(req);
    const anon = anonSubject(req);
    return enforceLimits(req.log, reply, [
      {
        limiter: professionalsReadPerSubject,
        key: viewerId ? `acct:${viewerId}` : anon.key,
        name: "professionalsReadPerSubject",
        kind: viewerId ? "account" : anon.kind,
      },
    ]);
  };

  app.get("/api/v1/wards/:wardId/professionals", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!professionalsLimited(req, reply)) return reply;
    const { wardId } = req.params as { wardId: string };
    if (!isBmcWardCode(wardId)) {
      return reply.status(404).send({ ok: false, error: { message: "no such ward", code: "UNKNOWN_WARD" } });
    }
    reply.header("Cache-Control", "public, max-age=60");
    return { ok: true, data: await wardProfessionals(wardId) };
  });

  app.get("/api/v1/dogs/:slug/vets", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!professionalsLimited(req, reply)) return reply;
    const dog = await publicDogBySlug((req.params as { slug: string }).slug, optionalFeederId(req));
    if (!dog) return notFound(reply);
    return { ok: true, data: { vets: await vetsForWard(dog.ward_id, 20) } };
  });

  // -------------------------------------------------------------------------
  // "Report a problem" (duplicate, photo, other)
  // -------------------------------------------------------------------------
  app.post("/api/v1/dogs/:slug/problems", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ProblemInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "body must be { kind: duplicate | photo | other, otherSlug?, note? }", code: "INVALID_PROBLEM" },
      });
    }
    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    let feederId: string | null = null;
    if (rawAuth.startsWith("Bearer ")) {
      try {
        feederId = verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub as string;
      } catch {
        return reply.status(401).send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
      }
    }
    const bodyToken = parsed.data.deviceToken;
    const deviceSubject = feederId
      ? null
      : (deviceSubjectOf(req) ?? (bodyToken ? deviceTokenSubject(bodyToken, app.config.HETJA_DEVICE_SECRET) : null));
    if (!feederId && !deviceSubject) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
    }
    if (feederId ? await isSuspended(feederId) : await isDeviceBlocked(deviceSubject)) {
      return reply.status(403).send(feederId ? suspendedBody : deviceBlockedBody);
    }
    const dog = await publicDogBySlug((req.params as { slug: string }).slug, feederId);
    if (!dog) return notFound(reply);
    if (
      !enforceLimits(req.log, reply, [
        {
          limiter: problemReportPerSubject,
          key: subjectKey(feederId, deviceSubject),
          name: "problemReportPerSubject",
          kind: feederId ? "account" : "device",
        },
        { limiter: problemReportPerIp, key: ipBucketKey(req.ip), name: "problemReportPerIp", kind: "ip" },
        { limiter: problemReportPerDog, key: `dog:${dog.id}`, name: "problemReportPerDog", kind: "global" },
      ])
    ) {
      return reply;
    }
    const kind = parsed.data.kind === "duplicate" ? "duplicate_dog" : parsed.data.kind;
    let otherDogId: string | null = null;
    if (kind === "duplicate_dog") {
      const other = parsed.data.otherSlug ? await publicDogBySlug(parsed.data.otherSlug) : null;
      if (!other || other.id === dog.id) {
        return reply.status(400).send({
          ok: false,
          error: { message: "a duplicate report needs the other dog's code", code: "INVALID_OTHER_DOG" },
        });
      }
      otherDogId = other.id;
    }
    const device = deviceSubject ? reporterDeviceHash(deviceSubject) : null;
    const result = await withTx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(420040, hashtext($1))`, [dog.id]);
      // One report per reporter, dog and kind in 24 h: a repeat answers the first.
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM reports
          WHERE dog_id = $1 AND kind = $2 AND created_at >= now() - interval '24 hours'
            AND (($3::uuid IS NOT NULL AND reporter_feeder_id = $3::uuid) OR ($3::uuid IS NULL AND reporter_device = $4))
          LIMIT 1`,
        [dog.id, kind, feederId, device],
      );
      if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
      // A photo report pins the photo that was on the page when it was made,
      // so an admin can take exactly that one down from the report.
      const ins = await client.query<{ id: string }>(
        `INSERT INTO reports (kind, dog_id, other_dog_id, note, reporter_feeder_id, reporter_device, scan_id)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $1 = 'photo' THEN (SELECT p.id FROM scans p WHERE p.dog_id = $2 AND p.photo_s3_key IS NOT NULL
                                                 AND p.scan_type <> 'sos' AND p.review_status <> 'rejected' AND p.photo_hidden_at IS NULL
                                               ORDER BY p.received_at DESC LIMIT 1) END)
         RETURNING id`,
        [kind, dog.id, otherDogId, parsed.data.note ?? null, feederId, device],
      );
      return { id: ins.rows[0].id, created: true };
    });
    return reply.status(result.created ? 201 : 200).send({ ok: true, data: result });
  });

  // -------------------------------------------------------------------------
  // "Feeder noted": a feeder of the dog records care themselves
  // -------------------------------------------------------------------------
  app.post("/api/v1/dogs/:slug/health-notes", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (
      !enforceLimits(req.log, reply, [
        { limiter: feederWritePerAccount, key: `acct:${auth.feederId}`, name: "feederWritePerAccount", kind: "account" },
      ])
    ) {
      return reply;
    }
    const parsed = HealthNoteInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "body must be { type, date: YYYY-MM-DD, title?, vaccine?, brand?, batch?, dueOn?, note? }", code: "INVALID_HEALTH_NOTE" },
      });
    }
    const dog = await publicDogBySlug((req.params as { slug: string }).slug, auth.feederId);
    if (!dog) return notFound(reply);
    if (!(await isFeederOfDog(auth.feederId, dog))) {
      return reply
        .status(403)
        .send({ ok: false, error: { message: "only a feeder of this dog may do this", code: "NOT_A_FEEDER_OF_DOG" } });
    }
    const n = parsed.data;
    const title = n.title ?? (n.type === "vaccination" ? n.vaccine : undefined) ?? DEFAULT_TITLE[n.type];
    const input = MedicalRecordInput.safeParse({
      dogId: dog.id,
      recordType: n.type,
      ...(n.type === "vaccination" ? { vaccineName: n.vaccine ?? title, vaccineDate: n.date } : {}),
      ...(n.type === "sterilisation" ? { abcDate: n.date } : {}),
      ...(n.type === "treatment" || n.type === "other" || n.type === "deworming" ? { treatment: title } : {}),
    });
    if (!input.success) {
      return reply.status(400).send({ ok: false, error: { message: "invalid health note", code: "INVALID_HEALTH_NOTE" } });
    }
    const out = await withTx((client) =>
      appendMedicalRecord(client, {
        input: input.data,
        vetId: null,
        isVerified: false,
        vetSignature: null,
        v7: {
          recordSource: "feeder_noted",
          hashed: {
            source: "feeder_noted",
            title,
            givenOn: n.date,
            ...(n.dueOn ? { dueOn: n.dueOn } : {}),
            ...(n.brand ? { brand: n.brand } : {}),
            ...(n.batch ? { batch: n.batch } : {}),
            ...(n.note ? { note: n.note } : {}),
          },
          notedBy: auth.feederId,
        },
      }),
    );
    forgetDog(dog.slug);
    return reply.status(201).send({ ok: true, data: { recordId: out.id } });
  });

  // -------------------------------------------------------------------------
  // "Ask a vet to sign" (V4 -> V2 "Feeders asking you to sign")
  // Auth before body: the clinic slip makes this a photo-sized body.
  // -------------------------------------------------------------------------
  const signRequestCallers = new WeakMap<FastifyRequest, RoleAuth>();
  app.post(
    "/api/v1/dogs/:slug/sign-requests",
    {
      bodyLimit: PHOTO_ROUTE_BODY_LIMIT,
      onRequest: async (req, reply) => {
        const auth = await requireFeeder(req, reply);
        if (!auth) return reply;
        signRequestCallers.set(req, auth);
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const auth = signRequestCallers.get(req);
      if (!auth) return reply.status(401).send({ ok: false, error: { message: "sign in", code: "UNAUTHENTICATED" } });
      const dog = await publicDogBySlug((req.params as { slug: string }).slug, auth.feederId);
      if (!dog) return notFound(reply);
      if (
        !enforceLimits(req.log, reply, [
          { limiter: signRequestPerAccount, key: `acct:${auth.feederId}`, name: "signRequestPerAccount", kind: "account" },
          { limiter: signRequestPerDog, key: `dog:${dog.id}`, name: "signRequestPerDog", kind: "global" },
        ])
      ) {
        return reply;
      }
      const parsed = SignRequestInput.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: { message: "body must be { recordId } or { proposed }, with optional vetFeederId, note, evidencePhotoBase64", code: "INVALID_SIGN_REQUEST" },
        });
      }
      if (!(await isFeederOfDog(auth.feederId, dog))) {
        return reply
          .status(403)
          .send({ ok: false, error: { message: "only a feeder of this dog may do this", code: "NOT_A_FEEDER_OF_DOG" } });
      }
      const b = parsed.data;
      let proposed: VetRecordProposal | null = b.proposed ?? null;
      if (b.recordId) {
        const rec = await query<{ record_type: string; vaccine_name: string | null; payload: Record<string, unknown> | null; is_verified: boolean }>(
          `SELECT m.record_type, m.vaccine_name, m.payload, m.is_verified FROM medical_records m
            WHERE m.id = $1 AND m.dog_id IN (SELECT id FROM dogs WHERE id = $2 OR merged_into = $2)`,
          [b.recordId, dog.id],
        );
        const r = rec.rows[0];
        if (!r || r.is_verified) {
          return reply.status(400).send({
            ok: false,
            error: { message: "only a feeder-noted record of this dog can be sent to a vet", code: "INVALID_RECORD" },
          });
        }
        proposed = proposalFromRecord(r);
        if (!proposed) {
          return reply.status(400).send({
            ok: false,
            error: { message: "that record has no date a vet could sign; send a proposal instead", code: "INVALID_RECORD" },
          });
        }
        const open = await query(`SELECT 1 FROM sign_requests WHERE record_id = $1 AND status = 'open'`, [b.recordId]);
        if ((open.rowCount ?? 0) > 0) {
          return reply.status(409).send({ ok: false, error: { message: "a vet has already been asked", code: "SIGN_REQUEST_OPEN" } });
        }
      }
      if (b.vetFeederId && !(await isActiveVet(b.vetFeederId))) {
        return reply.status(400).send({ ok: false, error: { message: "that vet cannot sign records", code: "VET_NOT_VERIFIED" } });
      }
      // The clinic slip: decoded and stripped on the request path, bounded by
      // the photo gate, and stored ENCRYPTED with the documents (private dir),
      // never in the public photos directory (pre-deploy review). It is shown
      // only to the vets who may answer the request, the dog's feeders and
      // moderating admins, and deleted 30 days after the request is decided.
      let evidence: { id: string; bytes: Buffer; mime: string } | null = null;
      if (b.evidencePhotoBase64) {
        try {
          docsKey(app.config);
        } catch {
          return reply.status(503).send({ ok: false, error: { message: "photo upload is not available yet", code: "DOCUMENTS_UNAVAILABLE" } });
        }
        let release;
        try {
          release = await photoGate.acquire();
        } catch (err) {
          if (!(err instanceof PhotoBusyError)) throw err;
          return reply
            .status(503)
            .header("retry-after", String(PHOTO_BUSY_RETRY_AFTER_SEC))
            .send({ ok: false, error: { message: "photo processing is busy; try again shortly", code: "PHOTO_BUSY" } });
        }
        try {
          const img = decodePhotoUpload(b.evidencePhotoBase64);
          const id = randomUUID();
          const mime = img.ext === "png" ? "image/png" : img.ext === "webp" ? "image/webp" : "image/jpeg";
          await query(
            `INSERT INTO documents (id, owner_kind, uploaded_by, kind, mime, size_bytes, sha256, delete_after)
             VALUES ($1, 'pending', $2, 'evidence_photo', $3, $4, $5, now() + interval '1 day')`,
            [id, auth.feederId, mime, img.bytes.length, sha256Hex(img.bytes)],
          );
          const key = await writeDocument(app.config, id, img.bytes);
          await query(`UPDATE documents SET blob_key = $2 WHERE id = $1`, [id, key]);
          evidence = { id, bytes: img.bytes, mime };
        } catch (err) {
          if (!(err instanceof UnsupportedImageError)) throw err;
          return reply.status(400).send({ ok: false, error: { message: `photo rejected: ${err.message}`, code: "INVALID_PHOTO" } });
        } finally {
          release();
        }
      }
      const id = await withTx(async (client) => {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO sign_requests (dog_id, requested_by, vet_feeder_id, record_id, proposed, note, evidence_document_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id`,
          [dog.id, auth.feederId, b.vetFeederId ?? null, b.recordId ?? null, JSON.stringify(proposed), b.note ?? null, evidence?.id ?? null],
        );
        if (evidence) {
          // Kept while the request is open; the decision starts the 30-day clock.
          await client.query(
            `UPDATE documents SET owner_kind = 'sign_request', owner_id = $2, delete_after = NULL WHERE id = $1`,
            [evidence.id, ins.rows[0].id],
          );
        }
        const vets = b.vetFeederId
          ? [b.vetFeederId]
          : (await vetsForWard(dog.ward_id, 10)).map((v) => v.feederId).filter((v) => v !== auth.feederId);
        await enqueueFeederPush(client, vets, {
          kind: "v7",
          title: "Asked to sign a record",
          body: `A feeder asked you to sign ${dog.name ?? "a dog"}'s record.`,
          url: `/vet/dogs/${dog.slug}`,
          tag: `sign-request-${ins.rows[0].id}`,
        });
        return ins.rows[0].id;
      });
      return reply.status(201).send({ ok: true, data: { id } });
    },
  );

  // -------------------------------------------------------------------------
  // A4 feeder sign-off on an avatar
  // -------------------------------------------------------------------------
  app.get("/api/v1/dogs/:slug/avatar-signoff", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const dog = await publicDogBySlug((req.params as { slug: string }).slug, auth.feederId);
    if (!dog) return notFound(reply);
    if (!(await isFeederOfDog(auth.feederId, dog))) {
      return reply
        .status(403)
        .send({ ok: false, error: { message: "only a feeder of this dog may do this", code: "NOT_A_FEEDER_OF_DOG" } });
    }
    const r = await query<{ id: string; image_key: string; signoff_requested_at: Date; photo_key: string | null }>(
      `SELECT a.id, a.image_key, a.signoff_requested_at,
              (SELECT p.photo_s3_key FROM scans p WHERE p.dog_id = a.dog_id AND p.photo_s3_key IS NOT NULL
                  AND p.scan_type <> 'sos' AND p.review_status <> 'rejected' AND p.photo_hidden_at IS NULL
                ORDER BY p.received_at DESC LIMIT 1) AS photo_key
         FROM dog_avatars a
        WHERE a.dog_id = $1 AND a.signoff_of = $2 AND a.signoff_answered_at IS NULL
          AND a.status IN ('draft', 'published') AND a.image_key IS NOT NULL
        ORDER BY a.signoff_requested_at DESC LIMIT 1`,
      [dog.id, auth.feederId],
    );
    const a = r.rows[0];
    return {
      ok: true,
      data: {
        pending: a
          ? {
              avatarId: a.id,
              imageUrl: photoUrlFor(req, a.image_key),
              photoUrl: photoUrlFor(req, a.photo_key),
              requestedAt: new Date(a.signoff_requested_at).toISOString(),
            }
          : null,
      },
    };
  });

  app.post("/api/v1/dogs/:slug/avatar-signoff", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (
      !enforceLimits(req.log, reply, [
        { limiter: feederWritePerAccount, key: `acct:${auth.feederId}`, name: "feederWritePerAccount", kind: "account" },
      ])
    ) {
      return reply;
    }
    const parsed = z
      .strictObject({ avatarId: z.string().uuid(), answer: z.enum(["looks_right", "redo"]) })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "body must be { avatarId, answer: looks_right | redo }", code: "INVALID_SIGNOFF" } });
    }
    const dog = await publicDogBySlug((req.params as { slug: string }).slug, auth.feederId);
    if (!dog) return notFound(reply);
    const upd = await query(
      `UPDATE dog_avatars SET signoff_answer = $3, signoff_answered_at = now()
        WHERE id = $1 AND dog_id = $2 AND signoff_of = $4 AND signoff_answered_at IS NULL`,
      [parsed.data.avatarId, dog.id, parsed.data.answer, auth.feederId],
    );
    if ((upd.rowCount ?? 0) === 0) {
      return reply.status(404).send({ ok: false, error: { message: "nothing is waiting for you", code: "NOT_FOUND" } });
    }
    return { ok: true, data: { answered: true } };
  });

  // -------------------------------------------------------------------------
  // V1 / N1 documents. Auth before body (a ~7 MB limit), bounded by the
  // photo gate, encrypted before it touches the disk.
  // -------------------------------------------------------------------------
  const documentCallers = new WeakMap<FastifyRequest, RoleAuth>();
  app.post(
    "/api/v1/documents",
    {
      bodyLimit: DOCUMENT_ROUTE_BODY_LIMIT,
      onRequest: async (req, reply) => {
        const auth = await requireFeeder(req, reply);
        if (!auth) return reply;
        if (
          !enforceLimits(req.log, reply, [
            { limiter: documentUploadPerAccount, key: `acct:${auth.feederId}`, name: "documentUploadPerAccount", kind: "account" },
          ])
        ) {
          return reply;
        }
        try {
          docsKey(app.config);
        } catch {
          return reply.status(503).send({
            ok: false,
            error: { message: "document upload is not available yet", code: "DOCUMENTS_UNAVAILABLE" },
          });
        }
        documentCallers.set(req, auth);
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const auth = documentCallers.get(req);
      if (!auth) return reply.status(401).send({ ok: false, error: { message: "sign in", code: "UNAUTHENTICATED" } });
      const parsed = DocumentInput.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: { message: "body must be { kind, fileName, mime, base64 }", code: "INVALID_DOCUMENT" },
        });
      }
      let release;
      try {
        release = await photoGate.acquire();
      } catch (err) {
        if (!(err instanceof PhotoBusyError)) throw err;
        return reply
          .status(503)
          .header("retry-after", String(PHOTO_BUSY_RETRY_AFTER_SEC))
          .send({ ok: false, error: { message: "upload processing is busy; try again shortly", code: "PHOTO_BUSY" } });
      }
      try {
        const { bytes, mime } = decodeDocument(parsed.data.base64);
        const id = randomUUID();
        // Unattached uploads lapse after a day; attaching one to an
        // application clears this, and the decision sets it to +30 days.
        await query(
          `INSERT INTO documents (id, owner_kind, owner_id, uploaded_by, kind, mime, size_bytes, sha256, delete_after)
           VALUES ($1, 'pending', NULL, $2, $3, $4, $5, $6, now() + interval '1 day')`,
          [id, auth.feederId, parsed.data.kind, mime, bytes.length, sha256Hex(bytes)],
        );
        const key = await writeDocument(app.config, id, bytes);
        const row = await query<{ uploaded_at: Date }>(
          `UPDATE documents SET blob_key = $2 WHERE id = $1 RETURNING uploaded_at`,
          [id, key],
        );
        return reply.status(201).send({
          ok: true,
          data: {
            id,
            kind: parsed.data.kind,
            mime,
            sizeBytes: bytes.length,
            uploadedAt: new Date(row.rows[0].uploaded_at).toISOString(),
          },
        });
      } catch (err) {
        if (err instanceof DocumentRejectedError) {
          return reply.status(400).send({ ok: false, error: { message: err.message, code: "INVALID_DOCUMENT" } });
        }
        if (err instanceof DocumentsUnavailableError) {
          return reply.status(503).send({ ok: false, error: { message: "document upload is not available yet", code: "DOCUMENTS_UNAVAILABLE" } });
        }
        throw err;
      } finally {
        release();
      }
    },
  );
}
