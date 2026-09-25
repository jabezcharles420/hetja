/**
 * Design v7 admin portal, part 2 (A3, A4, A5 and the designed sections).
 * Same rules as routes/admin.ts: a permission per route, every write audited
 * in its own transaction, admin writes rate limited per account.
 *
 * Avatars (A3, A4)
 *   GET  /api/v1/admin/avatars/batches            POST /api/v1/admin/avatars/batches
 *   GET  /api/v1/admin/avatars/batches/:id        POST /api/v1/admin/avatars/batches/:id/files
 *   POST /api/v1/admin/avatars/batches/:id/publish
 *   GET  /api/v1/admin/avatars/:id                POST /api/v1/admin/avatars/:id/match | publish | file | ask-feeder | restore
 * Dogs, merges (A5), photos (D13)
 *   GET  /api/v1/admin/dogs  GET /api/v1/admin/dogs/:slug  POST /api/v1/admin/dogs/:slug/status
 *   GET  /api/v1/admin/duplicates  POST /api/v1/admin/dogs/merge  POST /api/v1/admin/duplicates/dismiss
 *   POST /api/v1/admin/photos/:scanId/hide
 * Feeders and devices (D13)
 *   GET  /api/v1/admin/feeders  GET /api/v1/admin/feeders/:id  POST .../suspend | unsuspend
 *   POST /api/v1/admin/devices/block | unblock
 * Collars
 *   GET  /api/v1/admin/collars  GET /api/v1/admin/collars/:slug  PATCH /api/v1/admin/collars/:slug
 * SOS cases (A1 "Assign a vet")
 *   GET  /api/v1/admin/sos  GET /api/v1/admin/sos/:id  GET /api/v1/admin/sos/:id/vets
 *   POST /api/v1/admin/sos/:id/assign-vet  POST /api/v1/admin/sos/:id/resolve
 * Reports
 *   GET  /api/v1/admin/reports  POST /api/v1/admin/reports/:id/resolve
 *
 * AVATAR MATCHING (adapted, CONTRACT.md): a file named with the dog's ID
 * ("r4n7kw2ab.png", dashes allowed) or its collar's batch number
 * ("HJ-0412.png") is matched; anything else is "No match · pick dog". There
 * is no photo similarity: the room cannot run an image model.
 *
 * MERGE (A5). The ledger is never rewritten: the merged dog's medical records
 * stay on it and are read with the kept dog's (lib/health.ts, routes/dogs.ts).
 * Its scans are moved onto the kept dog (scans.merged_from_dog_id keeps where
 * each came from), so feeds, feeders and the feeder rule follow at once; its
 * registrator becomes a feeder of the kept dog (lib/dog-feeders.ts) and every
 * feeder of it gets a note; its slug and collar answer the kept dog's page.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isBmcWardCode, wardDisplay } from "@hetja/contracts";
import { isValidSlug, query, withTx } from "@hetja/db";
import { adminCoversWard, requireAdmin, type AdminAuth } from "../lib/admin.js";
import { audit } from "../lib/audit.js";
import { avatarUploadPerAccount, enforceLimits } from "../lib/rate-limit.js";
import { enqueueFeederPush, feederIdsOfDog } from "../lib/dog-feeders.js";
import { healthRecords } from "../lib/health.js";
import { deviceHashOf, deviceRefOf, forgetDeviceBlocks } from "../lib/moderation-state.js";
import { AVATAR_SQL, PORTRAIT_SQL, photoUrlFor } from "../lib/photo-url.js";
import { firstName, publicName } from "../lib/public-name.js";
import { PHOTO_ROUTE_BODY_LIMIT } from "../lib/body-limits.js";
import { PHOTO_BUSY_RETRY_AFTER_SEC, PhotoBusyError, photoGate } from "../lib/photo-gate.js";
import { decodePhotoUpload, storePhoto, type StorageConfig } from "../lib/storage.js";
import { UnsupportedImageError } from "../lib/exif-strip.js";
import { inHours, kolkataMinute, regLabel, sosHoursOf } from "../lib/professionals.js";
import { dogSex } from "../lib/dog-feeders.js";
import { COLLAR_SQL, FEEDER_ROW_SQL, collarRowOf, dogRowOf, err, feederRowOf, iso, slugCode, uuidParam, writeLimited } from "./admin.js";
import { forgetDog } from "./dogs.js";

const ALL = "__all__";

function wardsOf(a: AdminAuth): string[] | null {
  return a.wards;
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/** "r4n-7kw-2ab.PNG" -> "r4n7kw2ab"; "HJ-0412.png" -> "hj-0412". */
export function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.[a-z0-9]{2,5}$/i, "").trim().toLowerCase();
}

/** Match a file name to a dog: by ID (slug), else by collar batch number. */
export async function matchFileName(fileName: string): Promise<{ dogId: string; kind: "id" | "collar" } | null> {
  const stem = fileStem(fileName);
  const asSlug = stem.replace(/[^a-z0-9]/g, "");
  if (asSlug.length === 9 && isValidSlug(asSlug)) {
    const d = await query<{ id: string }>(`SELECT id FROM dogs WHERE slug = $1 AND merged_into IS NULL`, [asSlug]);
    if (d.rows[0]) return { dogId: d.rows[0].id, kind: "id" };
  }
  const batch = stem.replace(/\s+/g, "");
  if (batch.length >= 3) {
    const c = await query<{ dog_id: string }>(
      `SELECT c.dog_id FROM collars c JOIN dogs d ON d.id = c.dog_id
        WHERE lower(replace(c.batch_no, ' ', '')) = $1 AND d.merged_into IS NULL AND c.retired_at IS NULL
        LIMIT 2`,
      [batch],
    );
    // A batch number that names two dogs is not a match.
    if (c.rows.length === 1) return { dogId: c.rows[0].dog_id, kind: "collar" };
  }
  return null;
}

const TILE_SQL = `
  SELECT a.id, a.batch_id, a.file_name, a.image_key, a.match_kind, a.status, a.uploaded_at, a.published_at, a.retired_at,
         a.signoff_requested_at, a.signoff_answer, sf.display_name AS signoff_name,
         d.slug, d.name, c.batch_no,
         p.photo_s3_key AS photo_key, p.received_at AS photo_at, pf.display_name AS photo_by,
         EXISTS (SELECT 1 FROM dog_avatars o WHERE o.dog_id = a.dog_id AND o.status = 'published' AND o.id <> a.id) AS replaces
    FROM dog_avatars a
    LEFT JOIN dogs d ON d.id = a.dog_id
    LEFT JOIN collars c ON c.dog_id = d.id
    LEFT JOIN feeders sf ON sf.id = a.signoff_of
    LEFT JOIN LATERAL (SELECT s.photo_s3_key, s.received_at, s.feeder_id FROM scans s
                        WHERE s.dog_id = d.id AND s.photo_s3_key IS NOT NULL AND s.scan_type <> 'sos'
                          AND s.review_status <> 'rejected' AND s.photo_hidden_at IS NULL
                        ORDER BY s.received_at DESC LIMIT 1) p ON true
    LEFT JOIN feeders pf ON pf.id = p.feeder_id`;

function tileOf(req: FastifyRequest, t: any) {
  return {
    id: t.id,
    batchId: t.batch_id,
    fileName: t.file_name,
    imageUrl: photoUrlFor(req, t.image_key),
    match: t.match_kind,
    dog: t.slug
      ? {
          slug: t.slug,
          name: t.name,
          photoUrl: photoUrlFor(req, t.photo_key),
          photoBy: t.photo_by ? firstName(t.photo_by, true) : null,
          photoAt: iso(t.photo_at),
          collarBatchNo: t.batch_no,
        }
      : null,
    replacesExisting: t.replaces && t.status !== "published",
    status: t.status,
    uploadedAt: t.uploaded_at.toISOString(),
    publishedAt: iso(t.published_at),
    signoff: t.signoff_requested_at
      ? { requestedAt: t.signoff_requested_at.toISOString(), feederName: firstName(t.signoff_name, true), answer: t.signoff_answer }
      : null,
  };
}

async function tile(req: FastifyRequest, id: string) {
  const r = await query<any>(`${TILE_SQL} WHERE a.id = $1`, [id]);
  return r.rows[0] ? tileOf(req, r.rows[0]) : null;
}

const BATCH_SQL = `
  SELECT b.id, b.number, b.created_at, b.status, f.display_name AS by,
         (SELECT count(*)::int FROM dog_avatars x WHERE x.batch_id = b.id AND x.status <> 'rejected') AS files,
         (SELECT count(*)::int FROM dog_avatars x WHERE x.batch_id = b.id AND x.dog_id IS NOT NULL AND x.status <> 'rejected') AS matched,
         (SELECT count(*)::int FROM dog_avatars x WHERE x.batch_id = b.id AND x.status = 'published') AS published
    FROM avatar_batches b LEFT JOIN feeders f ON f.id = b.created_by`;

const batchOf = (b: any) => ({
  id: b.id,
  number: b.number,
  createdAt: b.created_at.toISOString(),
  createdBy: b.by ? publicName(b.by) : null,
  files: b.files,
  matched: b.matched,
  published: b.published,
  status: b.status,
});

/** Publish one avatar: retire the dog's live one first (one published per dog). */
async function publishOne(client: any, avatarId: string, adminId: string): Promise<boolean> {
  const a = await client.query(`SELECT dog_id FROM dog_avatars WHERE id = $1 AND status IN ('draft', 'retired') AND dog_id IS NOT NULL AND image_key IS NOT NULL FOR UPDATE`, [avatarId]);
  const dogId = a.rows[0]?.dog_id;
  if (!dogId) return false;
  await client.query(`UPDATE dog_avatars SET status = 'retired', retired_at = now() WHERE dog_id = $1 AND status = 'published'`, [dogId]);
  await client.query(
    `UPDATE dog_avatars SET status = 'published', published_at = now(), published_by = $2, retired_at = NULL WHERE id = $1`,
    [avatarId, adminId],
  );
  return true;
}

async function forgetDogById(id: string | null) {
  if (!id) return;
  const r = await query<{ slug: string }>(`SELECT slug FROM dogs WHERE id = $1 OR merged_into = $1`, [id]);
  for (const x of r.rows) forgetDog(x.slug);
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

/** Lower case, letters only, doubled letters collapsed: "Kaalu" and "Kalu" agree. */
export function normaliseName(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1");
}

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** pg_trgm's similarity(), in JS: shared trigrams over the union. */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = trigrams(na);
  const tb = trigrams(nb);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export const SIMILAR_NAME_THRESHOLD = 0.5;

async function dupDog(id: string) {
  const r = await query<any>(
    `SELECT d.slug, d.name, d.ward_id, d.created_at, rf.display_name AS added_by, c.batch_no, c.qr_code,
            (SELECT count(*)::int FROM scans s WHERE s.dog_id = d.id AND s.scan_type = 'feed') AS feeds,
            (SELECT count(*)::int FROM medical_records m WHERE m.dog_id = d.id AND m.is_verified AND m.record_type <> 'withdrawal') AS signed,
            ${PORTRAIT_SQL} AS photo_key
       FROM dogs d LEFT JOIN feeders rf ON rf.id = d.registered_by LEFT JOIN collars c ON c.dog_id = d.id
      WHERE d.id = $1 LIMIT 1`,
    [id],
  );
  const d = r.rows[0];
  const names = await feederIdsOfDog(id, null);
  const nameRows = names.length
    ? (await query<{ display_name: string }>(`SELECT display_name FROM feeders WHERE id = ANY($1::uuid[])`, [names])).rows
    : [];
  return {
    id,
    slug: d.slug,
    name: d.name,
    wardId: d.ward_id,
    addedAt: d.created_at.toISOString(),
    addedBy: d.added_by ? publicName(d.added_by) : null,
    collar: d.qr_code ? (d.batch_no && d.batch_no !== "self-serve" ? d.batch_no : slugCode(d.qr_code)) : null,
    feeds: d.feeds,
    signedRecords: d.signed,
    photoUrl: d.photo_key as string | null,
    feederNames: nameRows.map((n) => publicName(n.display_name) ?? "").filter(Boolean),
  };
}

/**
 * Candidate pairs: open duplicate reports first, then same-ward dogs whose
 * names are the same after normalising, or close (trigram similarity), that
 * nobody has dismissed. Each dog id pair appears once.
 */
export async function duplicateCandidates(): Promise<
  Array<{ a: Awaited<ReturnType<typeof dupDog>>; b: Awaited<ReturnType<typeof dupDog>>; reason: "report" | "similar_name"; reportId: string | null; score: number | null }>
> {
  const seen = new Set<string>();
  const pairs: Array<{ a: string; b: string; reason: "report" | "similar_name"; reportId: string | null; score: number | null }> = [];
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const reported = await query<{ id: string; dog_id: string; other_dog_id: string }>(
    `SELECT r.id, r.dog_id, r.other_dog_id FROM reports r
       JOIN dogs a ON a.id = r.dog_id AND a.merged_into IS NULL JOIN dogs b ON b.id = r.other_dog_id AND b.merged_into IS NULL
      WHERE r.status = 'open' AND r.kind = 'duplicate_dog' ORDER BY r.created_at LIMIT 50`,
  );
  for (const r of reported.rows) {
    const k = key(r.dog_id, r.other_dog_id);
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push({ a: r.dog_id, b: r.other_dog_id, reason: "report", reportId: r.id, score: null });
  }
  const dismissed = new Set(
    (await query<{ dog_a: string; dog_b: string }>(`SELECT dog_a, dog_b FROM duplicate_dismissals`)).rows.map((d) => key(d.dog_a, d.dog_b)),
  );
  const dogs = await query<{ id: string; name: string; ward_id: string }>(
    `SELECT id, name, ward_id FROM dogs WHERE status IN ('active', 'lost') AND merged_into IS NULL AND name IS NOT NULL
      ORDER BY ward_id, created_at LIMIT 20000`,
  );
  const byWard = new Map<string, { id: string; name: string }[]>();
  for (const d of dogs.rows) byWard.set(d.ward_id, [...(byWard.get(d.ward_id) ?? []), d]);
  const similar: typeof pairs = [];
  for (const list of byWard.values()) {
    if (list.length > 800) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = key(list[i].id, list[j].id);
        if (seen.has(k) || dismissed.has(k)) continue;
        const s = nameSimilarity(list[i].name, list[j].name);
        if (s >= SIMILAR_NAME_THRESHOLD) {
          seen.add(k);
          similar.push({ a: list[i].id, b: list[j].id, reason: "similar_name", reportId: null, score: Math.round(s * 100) / 100 });
        }
      }
    }
  }
  similar.sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
  const out = [];
  for (const p of [...pairs, ...similar].slice(0, 30)) out.push({ ...p, a: await dupDog(p.a), b: await dupDog(p.b) });
  return out;
}

export default async function adminContentRoutes(app: FastifyInstance): Promise<void> {
  const storageCfg = () => app.config as unknown as StorageConfig;

  async function withPhoto(reply: FastifyReply, base64: string, fn: (key: string) => Promise<unknown>) {
    let release;
    try {
      release = await photoGate.acquire();
    } catch (e) {
      if (!(e instanceof PhotoBusyError)) throw e;
      void reply
        .status(503)
        .header("retry-after", String(PHOTO_BUSY_RETRY_AFTER_SEC))
        .send({ ok: false, error: { message: "photo processing is busy; try again shortly", code: "PHOTO_BUSY" } });
      return null;
    }
    try {
      const key = await storePhoto(decodePhotoUpload(base64), storageCfg());
      return await fn(key);
    } catch (e) {
      if (!(e instanceof UnsupportedImageError)) throw e;
      void err(reply, 400, "INVALID_PHOTO", `image rejected: ${e.message}`);
      return null;
    } finally {
      release();
    }
  }

  // --- A3 batches -------------------------------------------------------------
  app.get("/api/v1/admin/avatars/batches", async (req, reply) => {
    const a = await requireAdmin(req, reply, "avatars");
    if (!a) return reply;
    const r = await query<any>(`${BATCH_SQL} ORDER BY b.created_at DESC LIMIT 50`);
    return { ok: true, data: { batches: r.rows.map(batchOf) } };
  });

  app.post("/api/v1/admin/avatars/batches", async (req, reply) => {
    const a = await requireAdmin(req, reply, "avatars");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const id = await withTx(async (client) => {
      const b = await client.query<{ id: string; number: number }>(`INSERT INTO avatar_batches (created_by) VALUES ($1) RETURNING id, number`, [a.feederId]);
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "avatar.batch_create",
        subjectType: "avatar_batch",
        subjectId: b.rows[0].id,
        summary: `started avatar batch #${b.rows[0].number}`,
      });
      return b.rows[0].id;
    });
    const r = await query<any>(`${BATCH_SQL} WHERE b.id = $1`, [id]);
    return reply.status(201).send({ ok: true, data: batchOf(r.rows[0]) });
  });

  app.get("/api/v1/admin/avatars/batches/:id", async (req, reply) => {
    const a = await requireAdmin(req, reply, "avatars");
    if (!a) return reply;
    const id = uuidParam(req);
    const b = id ? await query<any>(`${BATCH_SQL} WHERE b.id = $1`, [id]) : null;
    if (!b?.rows[0]) return err(reply, 404, "NOT_FOUND", "no such batch");
    const t = await query<any>(`${TILE_SQL} WHERE a.batch_id = $1 AND a.status <> 'rejected' ORDER BY (a.dog_id IS NULL) DESC, a.uploaded_at`, [id]);
    const tiles = t.rows.map((x) => tileOf(req, x));
    return {
      ok: true,
      data: {
        batch: batchOf(b.rows[0]),
        tiles,
        counts: {
          all: tiles.length,
          byId: tiles.filter((x) => x.match === "id").length,
          byCollar: tiles.filter((x) => x.match === "collar").length,
          manual: tiles.filter((x) => x.match === "manual").length,
          noMatch: tiles.filter((x) => x.match === "none").length,
          replaces: tiles.filter((x) => x.replacesExisting).length,
        },
      },
    };
  });

  const Upload = z.strictObject({ fileName: z.string().trim().min(1).max(200), imageBase64: z.string().min(1) });

  app.post("/api/v1/admin/avatars/batches/:id/files", { bodyLimit: PHOTO_ROUTE_BODY_LIMIT }, async (req, reply) => {
    const a = await requireAdmin(req, reply, "avatars");
    if (!a) return reply;
    if (
      !enforceLimits(req.log, reply, [
        { limiter: avatarUploadPerAccount, key: `acct:${a.feederId}`, name: "avatarUploadPerAccount", kind: "account" },
      ])
    ) {
      return reply;
    }
    const id = uuidParam(req);
    const b = Upload.safeParse(req.body ?? {});
    if (!id || !b.success) return err(reply, 400, "INVALID_AVATAR", "body must be { fileName, imageBase64 }");
    const batch = await query(`SELECT 1 FROM avatar_batches WHERE id = $1 AND status = 'open'`, [id]);
    if ((batch.rowCount ?? 0) === 0) return err(reply, 404, "NOT_FOUND", "no such open batch");
    const match = await matchFileName(b.data.fileName);
    const tileId = await withPhoto(reply, b.data.imageBase64, async (key) => {
      const ins = await query<{ id: string }>(
        `INSERT INTO dog_avatars (batch_id, dog_id, file_name, image_key, match_kind, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, match?.dogId ?? null, b.data.fileName, key, match?.kind ?? "none", a.feederId],
      );
      return ins.rows[0].id;
    });
    if (!tileId) return reply;
    return reply.status(201).send({ ok: true, data: await tile(req, tileId as string) });
  });

  app.post("/api/v1/admin/avatars/batches/:id/publish", async (req, reply) => {
    const a = await requireAdmin(req, reply, "avatars");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const id = uuidParam(req);
    if (!id) return err(reply, 400, "INVALID_ID", "bad id");
    const out = await withTx(async (client) => {
      const drafts = await client.query<{ id: string; dog_id: string }>(
        `SELECT DISTINCT ON (dog_id) id, dog_id FROM dog_avatars
          WHERE batch_id = $1 AND status = 'draft' AND dog_id IS NOT NULL ORDER BY dog_id, uploaded_at DESC`,
        [id],
      );
      let n = 0;
      for (const d of drafts.rows) if (await publishOne(client, d.id, a.feederId)) n++;
      await client.query(
        `UPDATE avatar_batches SET status = 'published' WHERE id = $1
            AND NOT EXISTS (SELECT 1 FROM dog_avatars WHERE batch_id = $1 AND status = 'draft')`,
        [id],
      );
      const num = await client.query<{ number: number }>(`SELECT number FROM avatar_batches WHERE id = $1`, [id]);
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "avatar.publish_batch",
        subjectType: "avatar_batch",
        subjectId: id,
        summary: `published ${n} avatars from batch #${num.rows[0]?.number ?? "?"}`,
      });
      return { n, dogs: drafts.rows.map((d) => d.dog_id) };
    });
    for (const d of out.dogs) await forgetDogById(d);
    return { ok: true, data: { published: out.n } };
  });

  app.get("/api/v1/admin/avatars/:id", async (req, reply) => {
    const a = await requireAdmin(req, reply, "avatars");
    if (!a) return reply;
    const id = uuidParam(req);
    const t = id ? await tile(req, id) : null;
    if (!t) return err(reply, 404, "NOT_FOUND", "no such avatar");
    return { ok: true, data: t };
  });

  const avatarAction = (
    action: string,
    run: (client: any, a: AdminAuth, id: string, body: unknown) => Promise<{ ok: true; summary: string; dogId: string | null } | { ok: false; code: string; message: string }>,
  ) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await requireAdmin(req, reply, "avatars");
      if (!a) return reply;
      if (!writeLimited(req, reply, a)) return reply;
      const id = uuidParam(req);
      if (!id) return err(reply, 400, "INVALID_ID", "bad id");
      const out = await withTx(async (client) => {
        const r = await run(client, a, id, req.body ?? {});
        if (r.ok) {
          await audit(client, { actorId: a.feederId, actorKind: "admin", action, subjectType: "dog_avatar", subjectId: id, summary: r.summary });
        }
        return r;
      });
      if (!out.ok) return err(reply, out.code === "NOT_FOUND" ? 404 : 409, out.code, out.message);
      await forgetDogById(out.dogId);
      return { ok: true, data: await tile(req, id) };
    };

  app.post(
    "/api/v1/admin/avatars/:id/match",
    avatarAction("avatar.match", async (client, _a, id, body) => {
      const b = z.strictObject({ dogSlug: z.string().nullable() }).safeParse(body);
      if (!b.success) return { ok: false, code: "INVALID_AVATAR", message: "body must be { dogSlug | null }" };
      let dogId: string | null = null;
      let name = "no dog";
      if (b.data.dogSlug) {
        const d = await client.query(`SELECT id, name FROM dogs WHERE slug = $1 AND merged_into IS NULL`, [b.data.dogSlug]);
        if (!d.rows[0]) return { ok: false, code: "NOT_FOUND", message: "no such dog" };
        dogId = d.rows[0].id;
        name = d.rows[0].name ?? b.data.dogSlug;
      }
      const u = await client.query(
        `UPDATE dog_avatars SET dog_id = $2, match_kind = CASE WHEN $2::uuid IS NULL THEN 'none' ELSE 'manual' END
          WHERE id = $1 AND status = 'draft'`,
        [id, dogId],
      );
      if ((u.rowCount ?? 0) === 0) return { ok: false, code: "AVATAR_NOT_DRAFT", message: "only a draft can be matched" };
      return { ok: true, summary: `matched an avatar to ${name}`, dogId };
    }),
  );

  app.post(
    "/api/v1/admin/avatars/:id/publish",
    avatarAction("avatar.publish", async (client, a, id) => {
      const d = await client.query(`SELECT a.dog_id, d.name FROM dog_avatars a LEFT JOIN dogs d ON d.id = a.dog_id WHERE a.id = $1`, [id]);
      if (!d.rows[0]) return { ok: false, code: "NOT_FOUND", message: "no such avatar" };
      if (!(await publishOne(client, id, a.feederId))) return { ok: false, code: "AVATAR_NOT_READY", message: "match it to a dog first" };
      return { ok: true, summary: `published an avatar for ${d.rows[0].name ?? "a dog"}`, dogId: d.rows[0].dog_id };
    }),
  );

  app.post(
    "/api/v1/admin/avatars/:id/restore",
    avatarAction("avatar.restore", async (client, a, id) => {
      const d = await client.query(
        `SELECT dog_id FROM dog_avatars WHERE id = $1 AND status = 'retired' AND retired_at > now() - interval '30 days'`,
        [id],
      );
      if (!d.rows[0]) return { ok: false, code: "AVATAR_NOT_RESTORABLE", message: "only an avatar retired in the last 30 days can be restored" };
      await publishOne(client, id, a.feederId);
      return { ok: true, summary: "restored a previous avatar", dogId: d.rows[0].dog_id };
    }),
  );

  app.post(
    "/api/v1/admin/avatars/:id/ask-feeder",
    avatarAction("avatar.ask_feeder", async (client, _a, id) => {
      const d = await client.query(
        `SELECT a.dog_id, d.slug, d.name, d.registered_by FROM dog_avatars a JOIN dogs d ON d.id = a.dog_id
          WHERE a.id = $1 AND a.status IN ('draft', 'published')`,
        [id],
      );
      const row = d.rows[0];
      if (!row) return { ok: false, code: "NOT_FOUND", message: "match the avatar to a dog first" };
      const feeders = await feederIdsOfDog(row.dog_id, null, client);
      const who = row.registered_by && feeders.includes(row.registered_by) ? row.registered_by : (feeders[0] ?? row.registered_by);
      if (!who) return { ok: false, code: "NO_FEEDER", message: "this dog has no feeder to ask" };
      await client.query(
        `UPDATE dog_avatars SET signoff_requested_at = now(), signoff_of = $2, signoff_answer = NULL, signoff_answered_at = NULL WHERE id = $1`,
        [id, who],
      );
      await enqueueFeederPush(client, [who], {
        kind: "v7",
        title: `Does this look like ${row.name ?? "your dog"}?`,
        body: "Hetja made a picture for the map and share cards. Tell us if it looks right.",
        url: `/me/dogs/${row.slug}/avatar`,
        tag: `avatar-${id}`,
      });
      return { ok: true, summary: `asked a feeder to check ${row.name ?? "a dog"}'s avatar`, dogId: row.dog_id };
    }),
  );

  app.post("/api/v1/admin/avatars/:id/file", { bodyLimit: PHOTO_ROUTE_BODY_LIMIT }, async (req, reply) => {
    const a = await requireAdmin(req, reply, "avatars");
    if (!a) return reply;
    if (
      !enforceLimits(req.log, reply, [
        { limiter: avatarUploadPerAccount, key: `acct:${a.feederId}`, name: "avatarUploadPerAccount", kind: "account" },
      ])
    ) {
      return reply;
    }
    const id = uuidParam(req);
    const b = Upload.safeParse(req.body ?? {});
    if (!id || !b.success) return err(reply, 400, "INVALID_AVATAR", "body must be { fileName, imageBase64 }");
    const cur = await query<{ status: string }>(`SELECT status FROM dog_avatars WHERE id = $1`, [id]);
    if (!cur.rows[0]) return err(reply, 404, "NOT_FOUND", "no such avatar");
    if (cur.rows[0].status !== "draft") return err(reply, 409, "AVATAR_NOT_DRAFT", "only a draft's file can be replaced");
    const done = await withPhoto(reply, b.data.imageBase64, async (key) =>
      withTx(async (client) => {
        await client.query(`UPDATE dog_avatars SET image_key = $2, file_name = $3, uploaded_at = now() WHERE id = $1`, [id, key, b.data.fileName]);
        await audit(client, {
          actorId: a.feederId,
          actorKind: "admin",
          action: "avatar.replace_file",
          subjectType: "dog_avatar",
          subjectId: id,
          summary: "uploaded a different avatar file",
        });
        return true;
      }),
    );
    if (!done) return reply;
    return { ok: true, data: await tile(req, id) };
  });

  // --- Dogs ------------------------------------------------------------------------
  const DOG_ROW_SQL = `
    SELECT d.slug, d.name, d.ward_id, d.status::text AS status, d.created_at, ${PORTRAIT_SQL} AS photo_key, ${AVATAR_SQL} AS avatar_key,
           c.qr_code, c.batch_no,
           (SELECT count(DISTINCT s.feeder_id)::int FROM scans s WHERE s.dog_id = d.id AND s.scan_type = 'feed' AND s.feeder_id IS NOT NULL) AS feeders,
           (SELECT max(s.captured_at) FROM scans s WHERE s.dog_id = d.id AND s.scan_type = 'feed' AND s.review_status <> 'rejected') AS last_fed_at
      FROM dogs d LEFT JOIN collars c ON c.dog_id = d.id`;

  app.get("/api/v1/admin/dogs", async (req, reply) => {
    const a = await requireAdmin(req, reply, "dogs");
    if (!a) return reply;
    const q = z
      .object({ q: z.string().max(60).optional(), ward: z.string().max(16).optional(), status: z.string().max(24).optional() })
      .safeParse(req.query ?? {});
    if (!q.success) return err(reply, 400, "INVALID_QUERY", "bad query");
    const text = (q.data.q ?? "").trim();
    const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const slugish = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wards = wardsOf(a);
    const r = await query<any>(
      `${DOG_ROW_SQL}
        WHERE d.merged_into IS NULL
          AND ($1 = '' OR d.name ILIKE $2 OR (length($3) >= 3 AND d.slug LIKE $3 || '%'))
          AND ($4::text IS NULL OR d.ward_id = $4) AND ($5::text IS NULL OR d.status::text = $5)
          AND ($6::text[] IS NULL OR d.ward_id = ANY($6::text[]))
        ORDER BY d.created_at DESC LIMIT 100`,
      [text, like, slugish, q.data.ward ?? null, q.data.status ?? null, wards],
    );
    return { ok: true, data: { dogs: r.rows.map((d) => dogRowOf(req, d)) } };
  });

  async function dogIdBySlug(slug: string): Promise<{ id: string; ward_id: string; merged_into: string | null } | null> {
    if (!isValidSlug(slug)) return null;
    const r = await query<{ id: string; ward_id: string; merged_into: string | null }>(`SELECT id, ward_id, merged_into FROM dogs WHERE slug = $1`, [slug]);
    return r.rows[0] ?? null;
  }

  app.get("/api/v1/admin/dogs/:slug", async (req, reply) => {
    const a = await requireAdmin(req, reply, "dogs");
    if (!a) return reply;
    const ref = await dogIdBySlug((req.params as { slug: string }).slug);
    if (!ref || !adminCoversWard(a, ref.ward_id)) return err(reply, 404, "NOT_FOUND", "no such dog");
    const id = ref.id;
    const [row, extra, photos, avatars, feeders, mergedFrom, reports, sos, health, feeds] = await Promise.all([
      query<any>(`${DOG_ROW_SQL} WHERE d.id = $1 LIMIT 1`, [id]),
      query<any>(
        `SELECT d.registered_by, rf.display_name AS rname, d.registered_at, d.verified_at, d.tag_review_since, d.sex, d.markings,
                k.slug AS into_slug, k.name AS into_name
           FROM dogs d LEFT JOIN feeders rf ON rf.id = d.registered_by LEFT JOIN dogs k ON k.id = d.merged_into WHERE d.id = $1`,
        [id],
      ),
      query<any>(
        `SELECT s.id, s.photo_s3_key, s.received_at, f.display_name, s.photo_hidden_at FROM scans s LEFT JOIN feeders f ON f.id = s.feeder_id
          WHERE s.dog_id = $1 AND s.photo_s3_key IS NOT NULL AND s.scan_type <> 'sos' ORDER BY s.received_at DESC LIMIT 30`,
        [id],
      ),
      query<any>(`SELECT id, image_key, status, published_at, retired_at FROM dog_avatars WHERE dog_id = $1 AND status IN ('published', 'retired') ORDER BY COALESCE(published_at, uploaded_at) DESC LIMIT 20`, [id]),
      feederIdsOfDog(id, null),
      query<any>(`SELECT d.slug, d.name, m.merged_at FROM dog_merges m JOIN dogs d ON d.id = m.merged_dog_id WHERE m.kept_dog_id = $1 ORDER BY m.merged_at`, [id]),
      query<any>(
        `SELECT r.id, r.kind, r.note, r.created_at, r.status, r.outcome, o.slug AS other_slug, o.name AS other_name, f.display_name AS reporter
           FROM reports r LEFT JOIN dogs o ON o.id = r.other_dog_id LEFT JOIN feeders f ON f.id = r.reporter_feeder_id
          WHERE (r.dog_id = $1 OR r.other_dog_id = $1) AND r.status = 'open' ORDER BY r.created_at DESC LIMIT 20`,
        [id],
      ),
      query<any>(`SELECT id, severity::text AS severity, state::text AS state, opened_at FROM sos_cases WHERE dog_id = $1 ORDER BY opened_at DESC LIMIT 20`, [id]),
      healthRecords(id),
      query<{ n: number }>(`SELECT count(*)::int AS n FROM scans WHERE dog_id = $1 AND scan_type = 'feed'`, [id]),
    ]);
    const e = extra.rows[0];
    const feederNames = feeders.length
      ? (await query<{ id: string; display_name: string }>(`SELECT id, display_name FROM feeders WHERE id = ANY($1::uuid[])`, [feeders])).rows
      : [];
    const version = (v: any) => ({
      id: v.id,
      imageUrl: photoUrlFor(req, v.image_key),
      status: v.status,
      publishedAt: iso(v.published_at),
      retiredAt: iso(v.retired_at),
      restorableUntil: v.status === "retired" && v.retired_at ? new Date(v.retired_at.getTime() + 30 * 86_400_000).toISOString() : null,
    });
    const dogRow = dogRowOf(req, row.rows[0]);
    return {
      ok: true,
      data: {
        ...dogRow,
        registeredBy: e.registered_by ? { feederId: e.registered_by, name: publicName(e.rname) ?? "" } : null,
        registeredAt: iso(e.registered_at),
        verified: e.verified_at !== null,
        tagUnderReview: e.tag_review_since !== null,
        sex: dogSex(e.sex),
        markings: e.markings ?? [],
        photos: photos.rows.map((p) => ({
          scanId: p.id,
          url: photoUrlFor(req, p.photo_s3_key),
          at: p.received_at.toISOString(),
          byName: p.display_name ? publicName(p.display_name) : null,
          hidden: p.photo_hidden_at !== null,
        })),
        avatar: {
          current: avatars.rows.filter((v) => v.status === "published").map(version)[0] ?? null,
          history: avatars.rows.filter((v) => v.status === "retired").map(version),
        },
        health: { records: health, viewerIsVet: false },
        feedsTotal: feeds.rows[0].n,
        feederList: feederNames.map((f) => ({ feederId: f.id, name: publicName(f.display_name) ?? "" })),
        mergedFrom: mergedFrom.rows.map((m) => ({ slug: m.slug, name: m.name, mergedAt: m.merged_at.toISOString() })),
        mergedInto: e.into_slug ? { slug: e.into_slug, name: e.into_name } : null,
        openReports: reports.rows.map((r) => ({
          id: r.id,
          source: "report",
          kind: r.kind,
          dog: { slug: dogRow.slug, name: dogRow.name, photoUrl: dogRow.photoUrl },
          otherDog: r.other_slug ? { slug: r.other_slug, name: r.other_name } : null,
          note: r.note,
          reporter: r.reporter ? publicName(r.reporter) : null,
          createdAt: r.created_at.toISOString(),
          status: r.status,
          outcome: r.outcome,
        })),
        sos: sos.rows.map((c) => ({ caseId: c.id, severity: c.severity, state: c.state, openedAt: c.opened_at.toISOString() })),
      },
    };
  });

  app.post("/api/v1/admin/dogs/:slug/status", async (req, reply) => {
    const a = await requireAdmin(req, reply, "merge");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const b = z
      .strictObject({ status: z.enum(["active", "lost", "adopted", "deceased", "relocated"]), reason: z.string().trim().min(3).max(300) })
      .safeParse(req.body ?? {});
    const ref = await dogIdBySlug((req.params as { slug: string }).slug);
    if (!b.success) return err(reply, 400, "INVALID_STATUS", "body must be { status, reason }");
    if (!ref || ref.merged_into) return err(reply, 404, "NOT_FOUND", "no such dog");
    await withTx(async (client) => {
      const d = await client.query<{ name: string | null; status: string }>(`SELECT name, status::text AS status FROM dogs WHERE id = $1`, [ref.id]);
      await client.query(`UPDATE dogs SET status = $2::dog_status WHERE id = $1`, [ref.id, b.data.status]);
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "dog.status",
        subjectType: "dog",
        subjectId: ref.id,
        summary: `set ${d.rows[0].name ?? "a dog"} to ${b.data.status} · reason: ${b.data.reason}`,
        detail: { from: d.rows[0].status, to: b.data.status },
      });
    });
    await forgetDogById(ref.id);
    return { ok: true, data: { status: b.data.status } };
  });

  // --- A5 duplicates and merge ----------------------------------------------------
  app.get("/api/v1/admin/duplicates", async (req, reply) => {
    const a = await requireAdmin(req, reply, "merge");
    if (!a) return reply;
    const c = await duplicateCandidates();
    return {
      ok: true,
      data: {
        candidates: c.map((x) => ({
          reason: x.reason,
          reportId: x.reportId,
          score: x.score,
          a: { ...x.a, id: undefined, photoUrl: photoUrlFor(req, x.a.photoUrl) },
          b: { ...x.b, id: undefined, photoUrl: photoUrlFor(req, x.b.photoUrl) },
        })),
      },
    };
  });

  app.post("/api/v1/admin/dogs/merge", async (req, reply) => {
    const a = await requireAdmin(req, reply, "merge");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const b = z
      .strictObject({
        keepSlug: z.string(),
        mergeSlug: z.string(),
        name: z.string().trim().min(1).max(60).nullable().optional(),
        reportId: z.string().uuid().nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_MERGE", "body must be { keepSlug, mergeSlug, name?, reportId? }");
    const keep = await dogIdBySlug(b.data.keepSlug);
    const merge = await dogIdBySlug(b.data.mergeSlug);
    if (!keep || !merge) return err(reply, 404, "NOT_FOUND", "no such dog");
    if (keep.id === merge.id) return err(reply, 400, "SAME_DOG", "a dog cannot be merged into itself");
    if (keep.merged_into || merge.merged_into) return err(reply, 409, "ALREADY_MERGED", "one of these dogs was already merged");
    const toTell = await feederIdsOfDog(merge.id, a.feederId);
    const out = await withTx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(420050, hashtext($1)), pg_advisory_xact_lock(420050, hashtext($2))`, [
        keep.id < merge.id ? keep.id : merge.id,
        keep.id < merge.id ? merge.id : keep.id,
      ]);
      const cur = await client.query<{ id: string; merged_into: string | null; name: string | null; slug: string; last_seen_at: Date | null }>(
        `SELECT id, merged_into, name, slug, last_seen_at FROM dogs WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [[keep.id, merge.id]],
      );
      if (cur.rows.some((r) => r.merged_into)) return null;
      const k = cur.rows.find((r) => r.id === keep.id)!;
      const m = cur.rows.find((r) => r.id === merge.id)!;
      const beforeKeepFeeders = new Set(await feederIdsOfDog(keep.id, null, client));
      const moved = await client.query(
        `UPDATE scans SET merged_from_dog_id = dog_id, dog_id = $1 WHERE dog_id = $2`,
        [keep.id, merge.id],
      );
      // One hop only: anything merged into the merged dog now points at the kept one.
      await client.query(`UPDATE dogs SET merged_into = $1 WHERE merged_into = $2`, [keep.id, merge.id]);
      await client.query(`UPDATE dogs SET merged_into = $1, merged_at = now(), status = 'merged' WHERE id = $2`, [keep.id, merge.id]);
      // INVARIANT 4: the fresher sighting wins, by when it was seen.
      await client.query(
        `UPDATE dogs k SET last_seen_geo = m.last_seen_geo, last_seen_at = m.last_seen_at, last_seen_received_at = m.last_seen_received_at
           FROM dogs m
          WHERE k.id = $1 AND m.id = $2 AND m.last_seen_at IS NOT NULL AND (k.last_seen_at IS NULL OR m.last_seen_at > k.last_seen_at)`,
        [keep.id, merge.id],
      );
      await client.query(
        `UPDATE dogs k SET verified_at = COALESCE(k.verified_at, m.verified_at), verified_by = COALESCE(k.verified_by, m.verified_by),
                           verified_via = COALESCE(k.verified_via, m.verified_via), name = COALESCE($3, k.name)
           FROM dogs m WHERE k.id = $1 AND m.id = $2`,
        [keep.id, merge.id, b.data.name ?? null],
      );
      await client.query(
        `INSERT INTO dog_merges (kept_dog_id, merged_dog_id, kept_name, moved_scans, merged_by, report_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [keep.id, merge.id, b.data.name ?? k.name, moved.rowCount ?? 0, a.feederId, b.data.reportId ?? null],
      );
      await client.query(
        `UPDATE reports SET status = 'resolved', resolved_by = $3, resolved_at = now(), outcome = 'merged'
          WHERE status = 'open' AND kind = 'duplicate_dog'
            AND ((dog_id = $1 AND other_dog_id = $2) OR (dog_id = $2 AND other_dog_id = $1) OR id = $4)`,
        [keep.id, merge.id, a.feederId, b.data.reportId ?? null],
      );
      const keptName = b.data.name ?? k.name ?? "the dog";
      await enqueueFeederPush(client, toTell, {
        kind: "v7",
        title: `${m.name ?? "A dog"} is now ${keptName}`,
        body: `Hetja found ${m.name ?? "this dog"} and ${keptName} are the same dog. You're a feeder of ${keptName} now.`,
        url: `/dog/${k.slug}`,
        tag: `merge-${merge.id}`,
      });
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "dog.merge",
        subjectType: "dog",
        subjectId: keep.id,
        summary: `merged ${m.name ?? m.slug} into ${keptName}`,
        detail: { keptSlug: k.slug, mergedSlug: m.slug, movedScans: moved.rowCount ?? 0 },
      });
      const after = await feederIdsOfDog(keep.id, null, client);
      const counts = await client.query<{ feeds: number; signed: number }>(
        `SELECT (SELECT count(*)::int FROM scans WHERE dog_id = $1 AND scan_type = 'feed') AS feeds,
                (SELECT count(*)::int FROM medical_records WHERE dog_id = ANY($2::uuid[]) AND is_verified AND record_type <> 'withdrawal') AS signed`,
        [keep.id, [keep.id, merge.id]],
      );
      return {
        keptSlug: k.slug,
        mergedSlug: m.slug,
        feeds: counts.rows[0].feeds,
        signedRecords: counts.rows[0].signed,
        feedersAdded: after.filter((f) => !beforeKeepFeeders.has(f)).length,
      };
    });
    if (!out) return err(reply, 409, "ALREADY_MERGED", "one of these dogs was already merged");
    forgetDog(out.keptSlug);
    forgetDog(out.mergedSlug);
    return { ok: true, data: out };
  });

  app.post("/api/v1/admin/duplicates/dismiss", async (req, reply) => {
    const a = await requireAdmin(req, reply, "merge");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const b = z.strictObject({ aSlug: z.string(), bSlug: z.string(), reportId: z.string().uuid().nullable().optional() }).safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_DISMISS", "body must be { aSlug, bSlug, reportId? }");
    const x = await dogIdBySlug(b.data.aSlug);
    const y = await dogIdBySlug(b.data.bSlug);
    if (!x || !y || x.id === y.id) return err(reply, 404, "NOT_FOUND", "no such pair");
    const [lo, hi] = x.id < y.id ? [x.id, y.id] : [y.id, x.id];
    await withTx(async (client) => {
      await client.query(`INSERT INTO duplicate_dismissals (dog_a, dog_b, dismissed_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [lo, hi, a.feederId]);
      await client.query(
        `UPDATE reports SET status = 'resolved', resolved_by = $3, resolved_at = now(), outcome = 'different'
          WHERE status = 'open' AND kind = 'duplicate_dog'
            AND ((dog_id = $1 AND other_dog_id = $2) OR (dog_id = $2 AND other_dog_id = $1) OR id = $4)`,
        [lo, hi, a.feederId, b.data.reportId ?? null],
      );
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "dog.not_duplicate",
        subjectType: "dog",
        subjectId: lo,
        summary: `said two dogs are different (${b.data.aSlug}, ${b.data.bSlug})`,
      });
    });
    return { ok: true, data: { dismissed: true } };
  });

  app.post("/api/v1/admin/photos/:scanId/hide", async (req, reply) => {
    const a = await requireAdmin(req, reply, "reports");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const id = uuidParam(req, "scanId");
    const b = z.strictObject({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body ?? {});
    if (!id || !b.success) return err(reply, 400, "INVALID_HIDE", "body must be { reason }");
    const dogId = await withTx(async (client) => {
      const u = await client.query<{ dog_id: string }>(
        `UPDATE scans SET photo_hidden_at = COALESCE(photo_hidden_at, now()), photo_hidden_by = $2
          WHERE id = $1 AND photo_s3_key IS NOT NULL RETURNING dog_id`,
        [id, a.feederId],
      );
      if (!u.rows[0]) return null;
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "photo.hide",
        subjectType: "scan",
        subjectId: id,
        summary: `took a photo down · reason: ${b.data.reason}`,
      });
      return u.rows[0].dog_id;
    });
    if (!dogId) return err(reply, 404, "NOT_FOUND", "no such photo");
    await forgetDogById(dogId);
    return { ok: true, data: { hidden: true } };
  });

  // --- Feeders and devices (D13) ----------------------------------------------------
  app.get("/api/v1/admin/feeders", async (req, reply) => {
    const a = await requireAdmin(req, reply, "feeders");
    if (!a) return reply;
    const q = String((req.query as { q?: string }).q ?? "").trim().slice(0, 60);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const r = await query<any>(
      `${FEEDER_ROW_SQL} WHERE f.deleted_at IS NULL AND ($1 = '' OR f.display_name ILIKE $2)
        ORDER BY (f.suspended_at IS NOT NULL) DESC, f.created_at DESC LIMIT 100`,
      [q, like],
    );
    return { ok: true, data: { feeders: r.rows.map(feederRowOf) } };
  });

  /** Canonical device ids an account has used (never returned: only their refs). */
  async function devicesOf(feederId: string): Promise<{ subject: string; lastSeenAt: Date }[]> {
    const r = await query<{ subject: string; last: Date }>(
      `SELECT subject, max(at) AS last FROM (
         SELECT device_token AS subject, received_at AS at FROM scans WHERE feeder_id = $1 AND device_token IS NOT NULL
         UNION ALL
         SELECT registered_device_id, registered_at FROM dogs WHERE registered_by = $1 AND registered_device_id IS NOT NULL) x
       GROUP BY subject ORDER BY last DESC LIMIT 20`,
      [feederId],
    );
    return r.rows.map((x) => ({ subject: x.subject, lastSeenAt: x.last }));
  }

  app.get("/api/v1/admin/feeders/:id", async (req, reply) => {
    const a = await requireAdmin(req, reply, "feeders");
    if (!a) return reply;
    const id = uuidParam(req);
    const r = id ? await query<any>(`${FEEDER_ROW_SQL} WHERE f.id = $1`, [id]) : null;
    if (!r?.rows[0]) return err(reply, 404, "NOT_FOUND", "no such feeder");
    const [extra, trust, dogs, feeds, reportsAgainst, devices, vet, ngo] = await Promise.all([
      query<any>(`SELECT f.role::text AS role, f.suspended_at, f.suspended_reason, s.display_name AS by FROM feeders f LEFT JOIN feeders s ON s.id = f.suspended_by WHERE f.id = $1`, [id]),
      query<any>(`SELECT created_at, event_type, delta, reason FROM trust_events WHERE feeder_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
      query<any>(
        `SELECT DISTINCT d.slug, d.name FROM dogs d WHERE d.merged_into IS NULL
            AND (d.registered_by = $1 OR EXISTS (SELECT 1 FROM scans s WHERE s.dog_id = d.id AND s.feeder_id = $1 AND s.scan_type = 'feed'))
          LIMIT 50`,
        [id],
      ),
      query<any>(
        `SELECT s.id, d.slug, d.name, s.captured_at, s.photo_s3_key, s.photo_hidden_at FROM scans s JOIN dogs d ON d.id = s.dog_id
          WHERE s.feeder_id = $1 AND s.scan_type = 'feed' ORDER BY s.received_at DESC LIMIT 20`,
        [id],
      ),
      query<{ n: number }>(`SELECT count(*)::int AS n FROM reports r JOIN dogs d ON d.id = r.dog_id WHERE d.registered_by = $1`, [id]),
      devicesOf(id!),
      query<any>(`SELECT status FROM vet_profiles WHERE feeder_id = $1`, [id]),
      query<any>(`SELECT n.name, m.role FROM ngo_members m JOIN ngos n ON n.id = m.ngo_id WHERE m.feeder_id = $1 AND m.left_at IS NULL`, [id]),
    ]);
    const blocked = new Set(
      (
        await query<{ device_hash: string }>(`SELECT device_hash FROM blocked_devices WHERE lifted_at IS NULL AND device_hash = ANY($1::text[])`, [
          devices.map((d) => deviceHashOf(d.subject)),
        ])
      ).rows.map((b) => b.device_hash),
    );
    const e = extra.rows[0];
    return {
      ok: true,
      data: {
        ...feederRowOf(r.rows[0]),
        role: e.role,
        trustEvents: trust.rows.map((t) => ({ at: t.created_at.toISOString(), type: t.event_type, delta: t.delta, reason: t.reason })),
        dogList: dogs.rows.map((d) => ({ slug: d.slug, name: d.name })),
        recentFeeds: feeds.rows.map((f) => ({
          scanId: f.id,
          dog: { slug: f.slug, name: f.name },
          at: f.captured_at.toISOString(),
          photoUrl: photoUrlFor(req, f.photo_s3_key),
          hidden: f.photo_hidden_at !== null,
        })),
        reportsAgainst: reportsAgainst.rows[0].n,
        suspension: e.suspended_at ? { at: e.suspended_at.toISOString(), reason: e.suspended_reason, byName: e.by ? publicName(e.by) : null } : null,
        devices: devices.map((d) => ({ deviceRef: deviceRefOf(d.subject), lastSeenAt: d.lastSeenAt.toISOString(), blocked: blocked.has(deviceHashOf(d.subject)) })),
        vet: vet.rows[0] ? { status: vet.rows[0].status } : null,
        ngo: ngo.rows[0] ? { name: ngo.rows[0].name, role: ngo.rows[0].role } : null,
      },
    };
  });

  const suspend = (on: boolean) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await requireAdmin(req, reply, "feeders");
      if (!a) return reply;
      if (!writeLimited(req, reply, a)) return reply;
      const id = uuidParam(req);
      if (!id) return err(reply, 400, "INVALID_ID", "bad id");
      if (id === a.feederId) return err(reply, 409, "CANNOT_SUSPEND_SELF", "you cannot suspend yourself");
      let reason: string | null = null;
      if (on) {
        const b = z.strictObject({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body ?? {});
        if (!b.success) return err(reply, 400, "REASON_REQUIRED", "type a reason");
        reason = b.data.reason;
      } else {
        const b = z.strictObject({ reason: z.string().trim().max(300).optional() }).safeParse(req.body ?? {});
        if (!b.success) return err(reply, 400, "INVALID_REASON", "body may carry { reason }");
        reason = b.data.reason ?? null;
      }
      const name = await withTx(async (client) => {
        const u = await client.query<{ display_name: string }>(
          on
            ? `UPDATE feeders SET suspended_at = now(), suspended_reason = $2, suspended_by = $3 WHERE id = $1 AND deleted_at IS NULL RETURNING display_name`
            : `UPDATE feeders SET suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL WHERE id = $1 AND deleted_at IS NULL RETURNING display_name`,
          on ? [id, reason, a.feederId] : [id],
        );
        if (!u.rows[0]) return null;
        if (on) {
          // A suspended account holds no SOS case: each one goes back to open,
          // with the release event, re-page and escalation clock (routes/sos.ts).
          const { releaseCase } = await import("./sos.js");
          const held = await client.query<{ id: string }>(
            `SELECT id FROM sos_cases WHERE acked_by = $1 AND resolved_at IS NULL FOR UPDATE`,
            [id],
          );
          for (const c of held.rows) await releaseCase(client, c.id, id);
        }
        await audit(client, {
          actorId: a.feederId,
          actorKind: "admin",
          action: on ? "feeder.suspend" : "feeder.unsuspend",
          subjectType: "feeder",
          subjectId: id,
          summary: `${on ? "suspended" : "lifted the suspension of"} ${publicName(u.rows[0].display_name)}${reason ? ` · reason: ${reason}` : ""}`,
        });
        return u.rows[0].display_name;
      });
      if (!name) return err(reply, 404, "NOT_FOUND", "no such feeder");
      return { ok: true, data: { suspended: on } };
    };
  app.post("/api/v1/admin/feeders/:id/suspend", suspend(true));
  app.post("/api/v1/admin/feeders/:id/unsuspend", suspend(false));

  /** A device reference (from a feeder's page, a scan or a case) to its canonical id, or null. */
  async function resolveDevice(b: { deviceRef?: string; scanId?: string; caseId?: string }): Promise<string | null> {
    if (b.scanId) {
      const r = await query<{ device_token: string | null }>(`SELECT device_token FROM scans WHERE id = $1`, [b.scanId]);
      return r.rows[0]?.device_token ?? null;
    }
    if (b.caseId) {
      const r = await query<{ device_token: string | null }>(`SELECT s.device_token FROM sos_cases c JOIN scans s ON s.id = c.scan_id WHERE c.id = $1`, [b.caseId]);
      return r.rows[0]?.device_token ?? null;
    }
    if (b.deviceRef) {
      const r = await query<{ subject: string }>(
        `SELECT DISTINCT device_token AS subject FROM scans WHERE device_token IS NOT NULL AND received_at >= now() - interval '180 days'
         UNION SELECT registered_device_id FROM dogs WHERE registered_device_id IS NOT NULL`,
      );
      return r.rows.find((x) => deviceRefOf(x.subject) === b.deviceRef)?.subject ?? null;
    }
    return null;
  }

  app.post("/api/v1/admin/devices/block", async (req, reply) => {
    const a = await requireAdmin(req, reply, "feeders");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const b = z
      .strictObject({
        deviceRef: z.string().regex(/^[0-9a-f]{16}$/).optional(),
        scanId: z.string().uuid().optional(),
        caseId: z.string().uuid().optional(),
        reason: z.string().trim().min(3).max(300),
      })
      .refine((x) => [x.deviceRef, x.scanId, x.caseId].filter(Boolean).length === 1)
      .safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_BLOCK", "body must be { deviceRef | scanId | caseId, reason }");
    const subject = await resolveDevice(b.data);
    if (!subject) return err(reply, 404, "NOT_FOUND", "no device behind that reference");
    const ref = deviceRefOf(subject);
    await withTx(async (client) => {
      await client.query(
        `INSERT INTO blocked_devices (device_hash, reason, blocked_by) VALUES ($1, $2, $3) ON CONFLICT (device_hash) WHERE lifted_at IS NULL DO NOTHING`,
        [deviceHashOf(subject), b.data.reason, a.feederId],
      );
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "device.block",
        subjectType: "device",
        subjectId: ref,
        summary: `blocked a device · reason: ${b.data.reason}`,
      });
    });
    forgetDeviceBlocks();
    return { ok: true, data: { blocked: true, deviceRef: ref } };
  });

  app.post("/api/v1/admin/devices/unblock", async (req, reply) => {
    const a = await requireAdmin(req, reply, "feeders");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const b = z.strictObject({ deviceRef: z.string().regex(/^[0-9a-f]{16}$/) }).safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_BLOCK", "body must be { deviceRef }");
    const n = await withTx(async (client) => {
      const u = await client.query(`UPDATE blocked_devices SET lifted_at = now(), lifted_by = $2 WHERE left(device_hash, 16) = $1 AND lifted_at IS NULL`, [
        b.data.deviceRef,
        a.feederId,
      ]);
      if ((u.rowCount ?? 0) > 0) {
        await audit(client, { actorId: a.feederId, actorKind: "admin", action: "device.unblock", subjectType: "device", subjectId: b.data.deviceRef, summary: "unblocked a device" });
      }
      return u.rowCount ?? 0;
    });
    forgetDeviceBlocks();
    if (n === 0) return err(reply, 404, "NOT_FOUND", "that device is not blocked");
    return { ok: true, data: { blocked: false } };
  });

  // --- Collars ------------------------------------------------------------------------
  app.get("/api/v1/admin/collars", async (req, reply) => {
    const a = await requireAdmin(req, reply, "collars");
    if (!a) return reply;
    const q = z.object({ q: z.string().max(60).optional(), ward: z.string().max(16).optional() }).safeParse(req.query ?? {});
    if (!q.success) return err(reply, 400, "INVALID_QUERY", "bad query");
    const text = (q.data.q ?? "").trim();
    const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const slugish = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const r = await query<any>(
      `${COLLAR_SQL}
        WHERE d.merged_into IS NULL AND ($1 = '' OR c.batch_no ILIKE $2 OR d.name ILIKE $2 OR (length($3) >= 3 AND c.qr_code LIKE $3 || '%'))
          AND ($4::text IS NULL OR d.ward_id = $4) AND ($5::text[] IS NULL OR d.ward_id = ANY($5::text[]))
        ORDER BY c.issued_at DESC LIMIT 100`,
      [text, like, slugish, q.data.ward ?? null, wardsOf(a)],
    );
    return { ok: true, data: { collars: r.rows.map(collarRowOf) } };
  });

  async function collarDetail(slug: string, a: AdminAuth) {
    if (!isValidSlug(slug)) return null;
    const r = await query<any>(`${COLLAR_SQL} WHERE d.slug = $1`, [slug]);
    const c = r.rows[0];
    if (!c || !adminCoversWard(a, c.ward_id)) return null;
    const [prints, reissues] = await Promise.all([
      query<any>(`SELECT p.printed_at, p.layout, p.paper, p.tag_count, f.display_name FROM tag_prints p JOIN dogs d ON d.id = p.dog_id LEFT JOIN feeders f ON f.id = p.printed_by WHERE d.slug = $1 ORDER BY p.printed_at DESC LIMIT 50`, [slug]),
      query<any>(`SELECT r.reissued_at, r.previous_batch_no, r.new_batch_no, r.reason, f.display_name FROM collar_reissues r LEFT JOIN feeders f ON f.id = r.reissued_by WHERE r.slug = $1 ORDER BY r.reissued_at DESC LIMIT 50`, [slug]),
    ]);
    return {
      ...collarRowOf(c),
      printList: prints.rows.map((p) => ({ at: p.printed_at.toISOString(), layout: p.layout, paper: p.paper, tagCount: p.tag_count, byName: p.display_name ? publicName(p.display_name) : null })),
      reissueList: reissues.rows.map((x) => ({ at: x.reissued_at.toISOString(), previousBatchNo: x.previous_batch_no, newBatchNo: x.new_batch_no, reason: x.reason, byName: x.display_name ? publicName(x.display_name) : null })),
    };
  }

  app.get("/api/v1/admin/collars/:slug", async (req, reply) => {
    const a = await requireAdmin(req, reply, "collars");
    if (!a) return reply;
    const d = await collarDetail((req.params as { slug: string }).slug, a);
    if (!d) return err(reply, 404, "NOT_FOUND", "no such collar");
    return { ok: true, data: d };
  });

  app.patch("/api/v1/admin/collars/:slug", async (req, reply) => {
    const a = await requireAdmin(req, reply, "collars");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const slug = (req.params as { slug: string }).slug;
    const b = z.strictObject({ batchNo: z.string().trim().min(1).max(40) }).safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_COLLAR", "body must be { batchNo }");
    const cur = await collarDetail(slug, a);
    if (!cur) return err(reply, 404, "NOT_FOUND", "no such collar");
    await withTx(async (client) => {
      await client.query(`UPDATE collars SET batch_no = $2 WHERE qr_code = $1`, [slug, b.data.batchNo]);
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "collar.batch_no",
        subjectType: "collar",
        subjectId: slug,
        summary: `set collar ${b.data.batchNo} on ${cur.dogName ?? slug}`,
        detail: { from: cur.batchNo, to: b.data.batchNo },
      });
    });
    const d = await collarDetail(slug, a);
    return { ok: true, data: d };
  });

  // --- SOS cases -----------------------------------------------------------------------
  const SOS_ROW_SQL = `
    SELECT c.id, d.slug, d.name, COALESCE(c.ward_id, d.ward_id) AS ward_id, c.severity::text AS severity, c.state::text AS state,
           c.opened_at, c.acked_at, c.escalated_at, c.resolved_at, c.acked_by, c.note, c.outcome,
           rf.display_name AS rname, rf.show_first_name AS rshow, rf.deleted_at AS rdel,
           af.display_name AS aname, af.show_first_name AS ashow, af.deleted_at AS adel,
           n.id AS ngo_id, n.name AS ngo_name,
           (SELECT x.member_feeder_id FROM sos_dispatches x WHERE x.case_id = c.id AND x.kind = 'admin_vet' ORDER BY x.sent_at DESC LIMIT 1) AS vet_id,
           (SELECT vf.display_name FROM sos_dispatches x JOIN feeders vf ON vf.id = x.member_feeder_id
             WHERE x.case_id = c.id AND x.kind = 'admin_vet' ORDER BY x.sent_at DESC LIMIT 1) AS vet_name
      FROM sos_cases c
      LEFT JOIN dogs d ON d.id = c.dog_id
      JOIN scans s ON s.id = c.scan_id
      LEFT JOIN feeders rf ON rf.id = s.feeder_id
      LEFT JOIN feeders af ON af.id = c.acked_by
      LEFT JOIN ngos n ON n.id = c.ngo_id`;

  const sosRowOf = (c: any) => ({
    id: c.id,
    dog: c.slug ? { slug: c.slug, name: c.name } : null,
    wardId: c.ward_id,
    wardCode: c.ward_id ? wardDisplay(c.ward_id).code : null,
    severity: c.severity,
    state: c.state,
    openedAt: c.opened_at.toISOString(),
    ackedAt: iso(c.acked_at),
    escalatedAt: iso(c.escalated_at),
    resolvedAt: iso(c.resolved_at),
    raisedBy: firstName(c.rname, c.rshow, c.rdel),
    responder: c.acked_by ? firstName(c.aname, c.ashow, c.adel) : null,
    unassignedMin: !c.acked_by && !c.resolved_at ? Math.floor((Date.now() - c.opened_at.getTime()) / 60_000) : null,
    ngo: c.ngo_id ? { id: c.ngo_id, name: c.ngo_name } : null,
    assignedVet: c.vet_id ? { feederId: c.vet_id, name: c.vet_name } : null,
  });

  app.get("/api/v1/admin/sos", async (req, reply) => {
    const a = await requireAdmin(req, reply, "sos");
    if (!a) return reply;
    const state = String((req.query as { state?: string }).state ?? "open");
    const where: Record<string, string> = {
      open: `c.resolved_at IS NULL AND c.state IN ('open', 'acked', 'escalated')`,
      unassigned: `c.resolved_at IS NULL AND c.acked_by IS NULL AND c.state IN ('open', 'escalated')`,
      escalated: `c.resolved_at IS NULL AND c.escalated_at IS NOT NULL`,
      closed: `c.resolved_at IS NOT NULL`,
      all: `TRUE`,
    };
    if (!where[state]) return err(reply, 400, "INVALID_STATE", "state must be open | unassigned | escalated | closed | all");
    const r = await query<any>(
      `${SOS_ROW_SQL} WHERE ${where[state]} AND ($1::text[] IS NULL OR COALESCE(c.ward_id, d.ward_id) = ANY($1::text[]))
        ORDER BY (c.acked_by IS NULL AND c.resolved_at IS NULL) DESC, c.opened_at DESC LIMIT 200`,
      [wardsOf(a)],
    );
    return { ok: true, data: { cases: r.rows.map(sosRowOf) } };
  });

  async function sosFor(a: AdminAuth, id: string | null) {
    if (!id) return null;
    const r = await query<any>(`${SOS_ROW_SQL} WHERE c.id = $1`, [id]);
    const c = r.rows[0];
    if (!c || !adminCoversWard(a, c.ward_id)) return null;
    return c;
  }

  app.get("/api/v1/admin/sos/:id", async (req, reply) => {
    const a = await requireAdmin(req, reply, "sos");
    if (!a) return reply;
    const c = await sosFor(a, uuidParam(req));
    if (!c) return err(reply, 404, "NOT_FOUND", "no such case");
    const [told, events, dispatches] = await Promise.all([
      query<any>(
        `SELECT count(*) FILTER (WHERE n.route IS NULL AND n.feeder_id IS NOT NULL AND n.channel = 'push')::int AS feeders,
                count(*) FILTER (WHERE n.delivered_at IS NOT NULL AND (n.vet_id IS NOT NULL OR n.route IN ('vet_escalation', 'admin_assign')))::int AS vets,
                count(*) FILTER (WHERE n.delivered_at IS NOT NULL AND n.route IN ('ngo_coordinator', 'ngo_dispatch'))::int AS ngos
           FROM sos_notifications n WHERE n.case_id = $1`,
        [c.id],
      ),
      query<any>(`SELECT kind, note, created_at FROM sos_case_events WHERE case_id = $1 ORDER BY created_at`, [c.id]),
      query<any>(
        `SELECT x.*, f.display_name AS member_name FROM sos_dispatches x JOIN feeders f ON f.id = x.member_feeder_id
          WHERE x.case_id = $1 ORDER BY x.sent_at`,
        [c.id],
      ),
    ]);
    const timeline: { at: string; kind: string; detail: string | null }[] = [{ at: c.opened_at.toISOString(), kind: "raised", detail: c.severity }];
    if (c.escalated_at) timeline.push({ at: c.escalated_at.toISOString(), kind: "escalated", detail: null });
    if (c.acked_at) timeline.push({ at: c.acked_at.toISOString(), kind: "taken", detail: firstName(c.aname, c.ashow, c.adel) });
    for (const e of events.rows) timeline.push({ at: e.created_at.toISOString(), kind: e.kind, detail: e.kind === "reporter_update" ? e.note : null });
    for (const x of dispatches.rows) timeline.push({ at: x.sent_at.toISOString(), kind: "dispatched", detail: publicName(x.member_name) });
    if (c.resolved_at) timeline.push({ at: c.resolved_at.toISOString(), kind: "resolved", detail: c.outcome ?? c.state });
    timeline.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    return {
      ok: true,
      data: {
        ...sosRowOf(c),
        note: c.note,
        outcome: c.outcome,
        timeline,
        told: told.rows[0],
        dispatches: dispatches.rows.map((x) => ({
          id: x.id,
          caseId: x.case_id,
          ngoId: x.ngo_id,
          kind: x.kind,
          memberName: publicName(x.member_name) ?? "",
          withAmbulance: x.with_ambulance,
          etaMin: x.eta_min,
          sentAt: x.sent_at.toISOString(),
          acceptedAt: iso(x.accepted_at),
          declinedAt: iso(x.declined_at),
        })),
      },
    };
  });

  app.get("/api/v1/admin/sos/:id/vets", async (req, reply) => {
    const a = await requireAdmin(req, reply, "sos");
    if (!a) return reply;
    const c = await sosFor(a, uuidParam(req));
    if (!c) return err(reply, 404, "NOT_FOUND", "no such case");
    const r = await query<any>(
      `SELECT v.feeder_id, f.display_name, v.council, v.reg_no, v.clinic, v.wards, v.sos_available, v.sos_start, v.sos_end, v.phone_e164
         FROM vet_profiles v JOIN feeders f ON f.id = v.feeder_id AND f.deleted_at IS NULL AND f.suspended_at IS NULL
        WHERE v.status = 'verified'
        ORDER BY ($1::text IS NOT NULL AND v.wards @> ARRAY[$1]::text[]) DESC, v.sos_available DESC, f.display_name LIMIT 50`,
      [c.ward_id],
    );
    const minute = kolkataMinute();
    return {
      ok: true,
      data: {
        vets: r.rows.map((v) => ({
          feederId: v.feeder_id,
          name: v.display_name,
          regLabel: regLabel(v.council, v.reg_no) ?? v.council,
          clinic: v.clinic,
          wards: v.wards ?? [],
          coversWard: !!c.ward_id && (v.wards ?? []).includes(c.ward_id),
          sosAvailable: v.sos_available,
          inHours: inHours(v.sos_start, v.sos_end, minute),
          sosHours: sosHoursOf(v.sos_start, v.sos_end),
          publicPhone: v.phone_e164,
        })),
      },
    };
  });

  app.post("/api/v1/admin/sos/:id/assign-vet", async (req, reply) => {
    const a = await requireAdmin(req, reply, "sos");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const c = await sosFor(a, uuidParam(req));
    if (!c) return err(reply, 404, "NOT_FOUND", "no such case");
    if (c.resolved_at) return err(reply, 409, "SOS_CASE_CLOSED", "the case is closed");
    if (c.acked_by) return err(reply, 409, "SOS_ALREADY_ACKED", "someone has already taken this case");
    const b = z.strictObject({ vetFeederId: z.string().uuid() }).safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_ASSIGN", "body must be { vetFeederId }");
    const v = await query<{ display_name: string }>(
      `SELECT f.display_name FROM vet_profiles v JOIN feeders f ON f.id = v.feeder_id
        WHERE v.feeder_id = $1 AND v.status = 'verified' AND f.deleted_at IS NULL AND f.suspended_at IS NULL`,
      [b.data.vetFeederId],
    );
    if (!v.rows[0]) return err(reply, 400, "VET_NOT_VERIFIED", "only a verified vet can be assigned");
    const d = await withTx(async (client) => {
      const ins = await client.query<any>(
        `INSERT INTO sos_dispatches (case_id, kind, member_feeder_id, sent_by) VALUES ($1, 'admin_vet', $2, $3) RETURNING *`,
        [c.id, b.data.vetFeederId, a.feederId],
      );
      await client.query(
        `INSERT INTO sos_notifications (case_id, feeder_id, channel, route) VALUES ($1, $2, 'push', 'admin_assign') ON CONFLICT DO NOTHING`,
        [c.id, b.data.vetFeederId],
      );
      await client.query(
        `UPDATE sos_notifications SET notify_only = FALSE, route = COALESCE(route, 'admin_assign'), delivered_at = NULL
          WHERE case_id = $1 AND feeder_id = $2 AND channel = 'push' AND notify_only`,
        [c.id, b.data.vetFeederId],
      );
      await client.query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('send_sos_push', $1::jsonb, now())`, [JSON.stringify({ caseId: c.id })]);
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "sos.assign_vet",
        subjectType: "sos_case",
        subjectId: c.id,
        summary: `assigned ${v.rows[0].display_name} to an SOS${c.name ? ` for ${c.name}` : ""}`,
      });
      return ins.rows[0];
    });
    return reply.status(201).send({
      ok: true,
      data: {
        id: d.id,
        caseId: c.id,
        ngoId: null,
        kind: "admin_vet",
        memberName: v.rows[0].display_name,
        withAmbulance: false,
        etaMin: null,
        sentAt: d.sent_at.toISOString(),
        acceptedAt: null,
        declinedAt: null,
      },
    });
  });

  app.post("/api/v1/admin/sos/:id/resolve", async (req, reply) => {
    const a = await requireAdmin(req, reply, "sos");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const c = await sosFor(a, uuidParam(req));
    if (!c) return err(reply, 404, "NOT_FOUND", "no such case");
    const b = z
      .strictObject({
        outcome: z.enum(["resolved", "false_alarm", "taken_to_vet", "treated_on_spot", "not_found", "died"]),
        resolution: z.string().trim().min(1).max(500).optional(),
        vetName: z.string().trim().min(1).max(80).optional(),
      })
      .safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_SOS_RESOLUTION", "body must be { outcome, resolution?, vetName? }");
    const state = b.data.outcome === "false_alarm" ? "false_alarm" : "resolved";
    const done = await withTx(async (client) => {
      const u = await client.query(
        `UPDATE sos_cases SET state = $2::case_state, resolved_at = now(), resolution = $3, outcome = $4, vet_name = $5
          WHERE id = $1 AND resolved_at IS NULL`,
        [c.id, state, b.data.resolution ?? b.data.outcome.replace(/_/g, " "), b.data.outcome, b.data.outcome === "taken_to_vet" ? (b.data.vetName ?? null) : null],
      );
      if ((u.rowCount ?? 0) === 0) return false;
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "sos.resolve",
        subjectType: "sos_case",
        subjectId: c.id,
        summary: `closed an SOS${c.name ? ` for ${c.name}` : ""} · ${b.data.outcome.replace(/_/g, " ")}`,
      });
      return true;
    });
    if (!done) return err(reply, 409, "SOS_CASE_CLOSED", "the case is already closed");
    return { ok: true, data: { id: c.id, state, outcome: b.data.outcome } };
  });

  // --- Reports ------------------------------------------------------------------------
  app.get("/api/v1/admin/reports", async (req, reply) => {
    const a = await requireAdmin(req, reply, "reports");
    if (!a) return reply;
    const status = String((req.query as { status?: string }).status ?? "open");
    if (!["open", "resolved", "all"].includes(status)) return err(reply, 400, "INVALID_STATUS", "status must be open | resolved | all");
    const [reports, tags] = await Promise.all([
      query<any>(
        `SELECT r.id, r.kind, r.note, r.created_at, r.status, r.outcome, d.slug, d.name, ${PORTRAIT_SQL} AS photo_key,
                o.slug AS other_slug, o.name AS other_name, f.display_name AS reporter,
                r.scan_id, rs.photo_s3_key AS reported_photo, rs.photo_hidden_at AS reported_hidden
           FROM reports r JOIN dogs d ON d.id = r.dog_id LEFT JOIN dogs o ON o.id = r.other_dog_id
           LEFT JOIN feeders f ON f.id = r.reporter_feeder_id LEFT JOIN scans rs ON rs.id = r.scan_id
          WHERE ($1 = 'all' OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`,
        [status],
      ),
      query<any>(
        `SELECT t.id, t.kind, t.created_at, t.resolved_at, t.resolution, t.admin_outcome, d.slug, d.name, ${PORTRAIT_SQL} AS photo_key, f.display_name AS reporter
           FROM tag_reports t JOIN dogs d ON d.id = t.dog_id LEFT JOIN feeders f ON f.id = t.reporter_feeder_id
          WHERE ($1 = 'all' OR ($1 = 'open') = (t.resolved_at IS NULL)) ORDER BY t.created_at DESC LIMIT 200`,
        [status],
      ),
    ]);
    const rows = [
      ...reports.rows.map((r) => ({
        id: r.id,
        source: "report",
        kind: r.kind,
        dog: { slug: r.slug, name: r.name, photoUrl: photoUrlFor(req, r.photo_key) },
        otherDog: r.other_slug ? { slug: r.other_slug, name: r.other_name } : null,
        note: r.note,
        reporter: r.reporter ? publicName(r.reporter) : null,
        createdAt: r.created_at.toISOString(),
        status: r.status,
        outcome: r.outcome,
        // Photo reports: the photo that was on the page when it was reported,
        // so "take it down" (POST /admin/photos/:scanId/hide) works from here.
        scanId: r.scan_id,
        photoUrl: photoUrlFor(req, r.reported_photo),
        photoHidden: r.reported_hidden != null,
      })),
      ...tags.rows.map((t) => ({
        id: t.id,
        source: "tag",
        kind: t.kind,
        dog: { slug: t.slug, name: t.name, photoUrl: photoUrlFor(req, t.photo_key) },
        otherDog: null,
        note: null,
        reporter: t.reporter ? publicName(t.reporter) : null,
        createdAt: t.created_at.toISOString(),
        status: t.resolved_at ? "resolved" : "open",
        outcome: t.admin_outcome ?? t.resolution,
        scanId: null,
        photoUrl: null,
        photoHidden: false,
      })),
    ].sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
    return { ok: true, data: { reports: rows } };
  });

  app.post("/api/v1/admin/reports/:id/resolve", async (req, reply) => {
    const a = await requireAdmin(req, reply, "reports");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const id = uuidParam(req);
    const b = z
      .strictObject({ outcome: z.enum(["merged", "different", "photo_removed", "no_action", "fixed"]), note: z.string().trim().max(300).optional() })
      .safeParse(req.body ?? {});
    if (!id || !b.success) return err(reply, 400, "INVALID_RESOLVE", "body must be { outcome, note? }");
    const done = await withTx(async (client) => {
      const u = await client.query<{ kind: string }>(
        `UPDATE reports SET status = 'resolved', resolved_by = $2, resolved_at = now(), outcome = $3
          WHERE id = $1 AND status = 'open' RETURNING kind`,
        [id, a.feederId, b.data.outcome],
      );
      if (!u.rows[0]) return false;
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "report.resolve",
        subjectType: "report",
        subjectId: id,
        summary: `closed a ${u.rows[0].kind.replace("_", " ")} report · ${b.data.outcome.replace("_", " ")}`,
        detail: { note: b.data.note ?? null },
      });
      return true;
    });
    if (!done) return err(reply, 404, "NOT_FOUND", "no open report");
    const r = await query<any>(
      `SELECT r.id, r.kind, r.note, r.created_at, r.status, r.outcome, d.slug, d.name, ${PORTRAIT_SQL} AS photo_key,
              o.slug AS other_slug, o.name AS other_name
         FROM reports r JOIN dogs d ON d.id = r.dog_id LEFT JOIN dogs o ON o.id = r.other_dog_id WHERE r.id = $1`,
      [id],
    );
    const x = r.rows[0];
    return {
      ok: true,
      data: {
        id: x.id,
        source: "report",
        kind: x.kind,
        dog: { slug: x.slug, name: x.name, photoUrl: photoUrlFor(req, x.photo_key) },
        otherDog: x.other_slug ? { slug: x.other_slug, name: x.other_name } : null,
        note: x.note,
        reporter: null,
        createdAt: x.created_at.toISOString(),
        status: x.status,
        outcome: x.outcome,
      },
    };
  });

  /** Reports: an admin closes a TAG report (fake tags, wrong dog, damaged). Audited. */
  app.post("/api/v1/admin/tag-reports/:id/resolve", async (req, reply) => {
    const a = await requireAdmin(req, reply, "reports");
    if (!a) return reply;
    if (!writeLimited(req, reply, a)) return reply;
    const id = uuidParam(req);
    const b = z
      .strictObject({
        outcome: z.enum(["reprinted", "spare", "checked_ok", "fake_tag", "no_action"]),
        note: z.string().trim().max(300).optional(),
      })
      .safeParse(req.body ?? {});
    if (!id || !b.success) return err(reply, 400, "INVALID_RESOLVE", "body must be { outcome: reprinted | spare | checked_ok | fake_tag | no_action, note? }");
    // tag_reports.resolution keeps the feeder's three values (0026's CHECK);
    // the admin's own outcome is admin_outcome beside it.
    const resolution = b.data.outcome === "reprinted" || b.data.outcome === "spare" ? b.data.outcome : "checked_ok";
    const out = await withTx(async (client) => {
      const u = await client.query<{ dog_id: string; kind: string; slug: string; name: string | null }>(
        `UPDATE tag_reports t SET resolved_at = now(), resolved_by = $2, resolution = $3, admin_outcome = $4
           FROM dogs d WHERE t.id = $1 AND d.id = t.dog_id AND t.resolved_at IS NULL
          RETURNING t.dog_id, t.kind, d.slug, d.name`,
        [id, a.feederId, resolution, b.data.outcome],
      );
      const row = u.rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE dogs SET tag_review_since = NULL
          WHERE id = $1 AND tag_review_since IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM tag_reports WHERE dog_id = $1 AND kind = 'wrong_dog' AND resolved_at IS NULL)`,
        [row.dog_id],
      );
      await audit(client, {
        actorId: a.feederId,
        actorKind: "admin",
        action: "tag_report.resolve",
        subjectType: "tag_report",
        subjectId: id,
        summary: `closed a tag report on ${row.name ?? row.slug} · ${b.data.outcome.replace("_", " ")}`,
        detail: { kind: row.kind, note: b.data.note ?? null },
      });
      return row;
    });
    if (!out) return err(reply, 404, "NOT_FOUND", "no open tag report");
    forgetDog(out.slug);
    return { ok: true, data: { id, status: "resolved", outcome: b.data.outcome } };
  });

  void ALL;
  void isBmcWardCode;
}
