/**
 * When a tag breaks (design v5: F4 to F6, R6 to R8).
 *
 * POST /api/v1/dogs/:slug/tag-reports              anyone at the collar (device token or Bearer)
 * GET  /api/v1/dogs/:slug/tags                     feeder of the dog: open reports + history
 * POST /api/v1/dogs/:slug/tag-reports/:id/resolve  feeder of the dog
 * POST /api/v1/dogs/:slug/prints                   feeder of the dog: record a print
 * GET  /api/v1/dogs/:slug/collar                   registrator or feeder: signed collar URL
 * POST /api/v1/collars/batch                       the same for up to 8 dogs (R8)
 *
 * "Feeder of the dog" is lib/dog-feeders.ts. The enrolment desk (`enrol`
 * capability) may also read collars and tags, as it may read registrations.
 *
 * ABUSE, which shaped the report route more than anything else:
 *
 *   - A report can be filed by anyone holding a device token, so it is
 *     limited per device (or account), per IP (device tokens are minted, and
 *     each fresh one would otherwise bring a fresh budget) and per DOG
 *     (however many devices one person mints, one dog's feeders are not paged
 *     without bound). Every 429 logs { event, limiter, subjectKind } only.
 *   - Deduplicated per reporter, dog and kind for 24 h: a repeat answers the
 *     original report, 200, and pages nobody.
 *   - Only the FIRST report of a kind for a dog in 24 h pages its feeders;
 *     later ones (from other devices) are recorded and shown, not pushed.
 *   - 'wrong_dog' sets dogs.tag_review_since, which withholds feed TRUST on
 *     the dog (routes/scans.ts) and shows "Tag under review". It never pauses
 *     SOS: an anonymous report must not be able to switch off SOS for a dog
 *     (CONTRACT.md "Adapted, not verbatim"). Nothing in this file touches
 *     sos_cases, sos_eligible_at or the fan-out.
 *   - The reporter's device is stored only as SHA-256 of the canonical device
 *     id, to deduplicate; never the token, never the id. The response names
 *     the ward (INVARIANT 2), never a position, and never who the feeders are.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { wardDisplay } from "@hetja/contracts";
import { isValidSlug, query, withTx } from "@hetja/db";
import { deviceSubjectOf } from "../lib/anon-subject.js";
import { deviceBlockedBody, isDeviceBlocked, isSuspended, suspendedBody } from "../lib/moderation-state.js";
import { deviceTokenSubject } from "../lib/device.js";
import { collarUrl } from "../lib/enrol.js";
import { signSlug } from "../lib/hmac.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { parseUuidParam } from "../lib/params.js";
import { publicName } from "../lib/public-name.js";
import {
  enforceLimits,
  feederWritePerAccount,
  ipBucketKey,
  subjectKey,
  tagReportPerDog,
  tagReportPerIp,
  tagReportPerSubject,
} from "../lib/rate-limit.js";
import { capabilitiesFor, requireFeeder, type RoleAuth } from "../lib/require-role.js";
import {
  enqueueFeederPush,
  feederIdsOfDog,
  isFeederOfDog,
  loadDogBySlug,
  type DogRef,
} from "../lib/dog-feeders.js";
import { STURDIER_COLLAR_REPORTERS, forgetDog } from "./dogs.js";

/**
 * Advisory-lock key for the report dedupe (see the namespace table in
 * routes/registrations.ts): 420_030. `_xact_lock`, so two taps of "Report"
 * serialise and the second finds the first.
 */
const TAG_REPORT_LOCK_KEY = 420_030;

const TAG_KINDS = ["damaged", "found_on_ground", "wrong_dog", "too_tight"] as const;
// The device token normally arrives in the x-device-token HEADER (apps/scan,
// like POST /scans). `deviceToken` in the body is accepted too, as
// POST /reports accepts it; the header wins when both are present.
const TagReportInput = z.strictObject({ kind: z.enum(TAG_KINDS), deviceToken: z.string().max(256).optional() });
const ResolveInput = z.strictObject({ resolution: z.enum(["reprinted", "spare", "checked_ok"]) });
const PrintInput = z.strictObject({
  layout: z.enum(["tags", "notice", "batch"]),
  paper: z.enum(["a4", "letter"]),
  tagCount: z.number().int().min(1).max(48),
});
const BatchInput = z.strictObject({ slugs: z.array(z.string()).min(1).max(8) });

const KIND_WORDS: Record<(typeof TAG_KINDS)[number], string> = {
  damaged: "is damaged",
  found_on_ground: "was found on the ground",
  wrong_dog: "may be on the wrong dog",
  too_tight: "looks too tight",
};

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });

const forbidden = (reply: FastifyReply) =>
  reply.status(403).send({
    ok: false,
    error: { message: "only a feeder of this dog may do this", code: "NOT_A_FEEDER_OF_DOG" },
  });

export function deviceHash(deviceSubject: string): string {
  return createHash("sha256").update(`tag-report|${deviceSubject}`).digest("hex");
}

/** Distinct reporters of a dog's tag in the last 7 days, and all reports. */
export async function tagReportCounts(dogId: string): Promise<{ reports: number; reporters: number }> {
  const res = await query<{ reports: number; reporters: number }>(
    `SELECT count(*)::int AS reports,
            count(DISTINCT COALESCE(reporter_feeder_id::text, reporter_device))::int AS reporters
       FROM tag_reports WHERE dog_id = $1 AND created_at >= now() - interval '7 days'`,
    [dogId],
  );
  return res.rows[0] ?? { reports: 0, reporters: 0 };
}

/**
 * Loads the dog and checks the caller is a feeder of it (or holds `enrol`).
 * Sends the 400/404/403 itself and returns null when the caller should stop.
 */
async function dogForFeeder(
  req: FastifyRequest,
  reply: FastifyReply,
  auth: RoleAuth,
): Promise<DogRef | null> {
  const { slug } = req.params as { slug: string };
  if (!isValidSlug(slug)) {
    void notFound(reply);
    return null;
  }
  const dog = await loadDogBySlug(slug);
  if (!dog) {
    void notFound(reply);
    return null;
  }
  if (capabilitiesFor(auth.role).has("enrol")) return dog;
  if (!(await isFeederOfDog(auth.feederId, dog))) {
    void forbidden(reply);
    return null;
  }
  return dog;
}

function writeBudget(req: FastifyRequest, reply: FastifyReply, auth: RoleAuth): boolean {
  return enforceLimits(req.log, reply, [
    { limiter: feederWritePerAccount, key: `acct:${auth.feederId}`, name: "feederWritePerAccount", kind: "account" },
  ]);
}

export default async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/dogs/:slug/tag-reports", async (req: FastifyRequest, reply: FastifyReply) => {
    // Bearer when presented (and then it must be valid), else a device token.
    let feederId: string | null = null;
    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    if (rawAuth.startsWith("Bearer ")) {
      try {
        feederId = verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub;
      } catch {
        return reply
          .status(401)
          .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
      }
    }
    const bodyToken = (req.body as { deviceToken?: unknown } | undefined)?.deviceToken;
    const deviceSubject = feederId
      ? null
      : (deviceSubjectOf(req) ??
        (typeof bodyToken === "string" && bodyToken.length > 0 && bodyToken.length <= 256
          ? deviceTokenSubject(bodyToken, app.config.HETJA_DEVICE_SECRET)
          : null));
    if (!feederId && !deviceSubject) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
    }
    // Design v7 (D13): a blocked device or a suspended account files nothing here.
    if (feederId ? await isSuspended(feederId) : await isDeviceBlocked(deviceSubject)) {
      return reply.status(403).send(feederId ? suspendedBody : deviceBlockedBody);
    }

    const { slug } = req.params as { slug: string };
    if (!isValidSlug(slug)) return notFound(reply);

    if (
      !enforceLimits(
        req.log,
        reply,
        [
          {
            limiter: tagReportPerSubject,
            key: subjectKey(feederId, deviceSubject),
            name: "tagReportPerSubject",
            kind: feederId ? "account" : "device",
          },
          { limiter: tagReportPerIp, key: ipBucketKey(req.ip), name: "tagReportPerIp", kind: "ip" },
          { limiter: tagReportPerDog, key: `dog:${slug}`, name: "tagReportPerDog", kind: "global" },
        ],
        "too many tag reports; try again later",
      )
    ) {
      return reply;
    }

    const parsed = TagReportInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: `body must be { kind: ${TAG_KINDS.join(" | ")} }`, code: "INVALID_TAG_REPORT" },
      });
    }
    const { kind } = parsed.data;

    const dog = await loadDogBySlug(slug);
    // Same 404 as an unknown code for a dog no public surface shows.
    if (!dog || !["active", "lost"].includes(dog.status)) return notFound(reply);

    // A signed-in reporter who is not a live account is refused like a bad token.
    if (feederId) {
      const live = await query(`SELECT 1 FROM feeders WHERE id = $1 AND deleted_at IS NULL`, [feederId]);
      if (live.rowCount === 0) {
        return reply
          .status(401)
          .send({ ok: false, error: { message: "account no longer exists", code: "FEEDER_GONE" } });
      }
    }
    const reporterDevice = deviceSubject ? deviceHash(deviceSubject) : null;
    const reporterKey = feederId ? `acct:${feederId}` : `dev:${reporterDevice}`;

    const outcome = await withTx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [
        TAG_REPORT_LOCK_KEY,
        `${dog.id}|${kind}|${reporterKey}`,
      ]);
      const dup = await client.query<{ id: string }>(
        `SELECT id FROM tag_reports
          WHERE dog_id = $1 AND kind = $2 AND created_at >= now() - interval '24 hours'
            AND (($3::uuid IS NOT NULL AND reporter_feeder_id = $3::uuid)
                 OR ($4::text IS NOT NULL AND reporter_device = $4::text))
          ORDER BY created_at DESC LIMIT 1`,
        [dog.id, kind, feederId, reporterDevice],
      );
      if (dup.rows[0]) return { created: false as const, reportId: dup.rows[0].id, notified: 0 };

      // Whether another report of this kind is already recent: only the first
      // in 24 h pages anyone.
      const recentSameKind = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tag_reports
          WHERE dog_id = $1 AND kind = $2 AND created_at >= now() - interval '24 hours'`,
        [dog.id, kind],
      );
      const ins = await client.query<{ id: string }>(
        `INSERT INTO tag_reports (dog_id, kind, reporter_feeder_id, reporter_device)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [dog.id, kind, feederId, reporterDevice],
      );
      if (kind === "wrong_dog") {
        await client.query(`UPDATE dogs SET tag_review_since = COALESCE(tag_review_since, now()) WHERE id = $1`, [
          dog.id,
        ]);
      }
      const feeders = await feederIdsOfDog(dog.id, feederId, client);
      if ((recentSameKind.rows[0]?.n ?? 0) === 0) {
        await enqueueFeederPush(client, feeders, {
          kind: "tag",
          title: `${dog.name ?? "A dog"}'s tag ${KIND_WORDS[kind]}`,
          body: "Someone at the collar reported it. Open to reprint or check the tag.",
          url: `/me/dogs/${dog.slug}/tag`,
          tag: `tag-${dog.slug}-${kind}`,
        });
      }
      return { created: true as const, reportId: ins.rows[0].id, notified: feeders.length };
    });

    if (outcome.created) forgetDog(dog.slug);
    req.log.info({ event: "tag_report", kind, created: outcome.created }, "tag report");
    return reply.status(outcome.created ? 201 : 200).send({
      ok: true,
      data: {
        reportId: outcome.reportId,
        feedersNotified: outcome.notified,
        wardCode: wardDisplay(dog.ward_id).code,
      },
    });
  });

  app.get("/api/v1/dogs/:slug/tags", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    const dog = await dogForFeeder(req, reply, auth);
    if (!dog) return reply;

    const [reports, prints, registered, counts] = await Promise.all([
      query<{
        id: string;
        kind: string;
        created_at: Date;
        resolved_at: Date | null;
        resolution: string | null;
        reporter_name: string | null;
        reporter_deleted: Date | null;
        reporter_id: string | null;
        resolver_name: string | null;
        resolver_deleted: Date | null;
      }>(
        `SELECT t.id, t.kind, t.created_at, t.resolved_at, t.resolution,
                rf.display_name AS reporter_name, rf.deleted_at AS reporter_deleted, t.reporter_feeder_id AS reporter_id,
                sf.display_name AS resolver_name, sf.deleted_at AS resolver_deleted
           FROM tag_reports t
           LEFT JOIN feeders rf ON rf.id = t.reporter_feeder_id
           LEFT JOIN feeders sf ON sf.id = t.resolved_by
          WHERE t.dog_id = $1
          ORDER BY t.created_at DESC LIMIT 50`,
        [dog.id],
      ),
      query<{ tag_count: number; printed_at: Date; name: string | null; deleted_at: Date | null }>(
        `SELECT p.tag_count, p.printed_at, f.display_name AS name, f.deleted_at
           FROM tag_prints p LEFT JOIN feeders f ON f.id = p.printed_by
          WHERE p.dog_id = $1 ORDER BY p.printed_at DESC LIMIT 50`,
        [dog.id],
      ),
      query<{ registered_at: Date | null; created_at: Date; name: string | null; deleted_at: Date | null }>(
        `SELECT d.registered_at, d.created_at, f.display_name AS name, f.deleted_at
           FROM dogs d LEFT JOIN feeders f ON f.id = d.registered_by WHERE d.id = $1`,
        [dog.id],
      ),
      tagReportCounts(dog.id),
    ]);

    const reporterOf = (r: (typeof reports.rows)[number]) =>
      r.reporter_id ? (publicName(r.reporter_name, r.reporter_deleted) ?? "a feeder") : "a passer-by";

    const history: Array<{ kind: string; at: string; detail: string | null; byName: string | null }> = [];
    for (const r of reports.rows) {
      history.push({ kind: "reported", at: r.created_at.toISOString(), detail: r.kind, byName: reporterOf(r) });
      if (r.resolved_at) {
        history.push({
          kind: "resolved",
          at: r.resolved_at.toISOString(),
          detail: r.resolution,
          byName: publicName(r.resolver_name, r.resolver_deleted),
        });
      }
    }
    for (const p of prints.rows) {
      history.push({
        kind: "printed",
        at: p.printed_at.toISOString(),
        detail: `${p.tag_count} ${p.tag_count === 1 ? "tag" : "tags"}`,
        byName: publicName(p.name, p.deleted_at),
      });
    }
    const reg = registered.rows[0];
    if (reg) {
      history.push({
        kind: "registered",
        at: (reg.registered_at ?? reg.created_at).toISOString(),
        detail: null,
        byName: publicName(reg.name, reg.deleted_at),
      });
    }
    history.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      data: {
        open: reports.rows
          .filter((r) => r.resolved_at === null)
          .map((r) => ({ id: r.id, kind: r.kind, createdAt: r.created_at.toISOString(), reporter: reporterOf(r) })),
        history: history.slice(0, 50),
        reportsThisWeek: counts.reports,
        sturdierCollarSuggested: counts.reporters >= STURDIER_COLLAR_REPORTERS,
      },
    };
  });

  /**
   * Resolving a report. The review a 'wrong_dog' report opened ends when no
   * open 'wrong_dog' report is left for the dog: normally by resolving it
   * `checked_ok` (a feeder looked and the tag is on the right dog), and also
   * when the last one is closed another way (a reprint put a new tag on).
   * Resolving some OTHER kind of report never clears it. A retry of the same
   * resolution answers the stored one.
   */
  app.post("/api/v1/dogs/:slug/tag-reports/:id/resolve", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!writeBudget(req, reply, auth)) return reply;
    const dog = await dogForFeeder(req, reply, auth);
    if (!dog) return reply;
    const id = parseUuidParam((req.params as { id: string }).id);
    if (!id) {
      return reply.status(400).send({ ok: false, error: { message: "report id must be a UUID", code: "INVALID_REPORT_ID" } });
    }
    const parsed = ResolveInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "body must be { resolution: reprinted | spare | checked_ok }", code: "INVALID_RESOLUTION" },
      });
    }
    const { resolution } = parsed.data;

    const result = await withTx(async (client) => {
      const upd = await client.query<{ id: string; resolution: string }>(
        `UPDATE tag_reports SET resolved_at = now(), resolved_by = $3, resolution = $4
          WHERE id = $1 AND dog_id = $2 AND resolved_at IS NULL
          RETURNING id, resolution`,
        [id, dog.id, auth.feederId, resolution],
      );
      if (!upd.rows[0]) {
        const cur = await client.query<{ id: string; resolution: string | null }>(
          `SELECT id, resolution FROM tag_reports WHERE id = $1 AND dog_id = $2`,
          [id, dog.id],
        );
        return cur.rows[0] ? { id: cur.rows[0].id, resolution: cur.rows[0].resolution ?? resolution } : null;
      }
      await client.query(
        `UPDATE dogs SET tag_review_since = NULL
          WHERE id = $1 AND tag_review_since IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM tag_reports
                             WHERE dog_id = $1 AND kind = 'wrong_dog' AND resolved_at IS NULL)`,
        [dog.id],
      );
      return upd.rows[0];
    });
    if (!result) {
      return reply.status(404).send({ ok: false, error: { message: "report not found", code: "REPORT_NOT_FOUND" } });
    }
    forgetDog(dog.slug);
    return { ok: true, data: { id: result.id, resolution: result.resolution } };
  });

  app.post("/api/v1/dogs/:slug/prints", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!writeBudget(req, reply, auth)) return reply;
    const dog = await dogForFeeder(req, reply, auth);
    if (!dog) return reply;
    const parsed = PrintInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          message: "body must be { layout: tags | notice | batch, paper: a4 | letter, tagCount: 1..48 }",
          code: "INVALID_PRINT",
        },
      });
    }
    const { layout, paper, tagCount } = parsed.data;
    const ins = await query<{ id: string }>(
      `INSERT INTO tag_prints (dog_id, printed_by, layout, paper, tag_count) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [dog.id, auth.feederId, layout, paper, tagCount],
    );
    return reply.status(201).send({ ok: true, data: { id: ins.rows[0].id } });
  });

  /**
   * The signed collar URL for a reprint. Same credential GET
   * /registrations/:slug serves the registrator, widened to the dog's feeders
   * (a feeder standing next to a dog whose tag came off is exactly who
   * reprints it). Signed NOW under the current secret; collars.hmac_sig stays
   * the verification-first path, so this is correct across a rotation.
   */
  app.get("/api/v1/dogs/:slug/collar", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!writeBudget(req, reply, auth)) return reply;
    const dog = await dogForFeeder(req, reply, auth);
    if (!dog) return reply;
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      data: {
        slug: dog.slug,
        name: dog.name ?? null,
        wardId: dog.ward_id,
        collarUrl: collarUrl(dog.slug, signSlug(dog.slug, app.config.HETJA_QR_SECRET)),
      },
    };
  });

  /**
   * R8 batch sheet: up to 8 dogs in one call. A slug the caller may not print
   * (unknown, malformed, or not their dog) is listed in `skipped` rather than
   * failing the sheet, and the answer does not say which reason applied, so
   * the batch cannot be used to probe which slugs exist.
   */
  app.post("/api/v1/collars/batch", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireFeeder(req, reply);
    if (!auth) return reply;
    if (!writeBudget(req, reply, auth)) return reply;
    const parsed = BatchInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "body must be { slugs: string[] } with 1 to 8 slugs", code: "INVALID_BATCH" },
      });
    }
    const enrol = capabilitiesFor(auth.role).has("enrol");
    const dogs: Array<{ slug: string; name: string | null; wardId: string; collarUrl: string }> = [];
    const skipped: string[] = [];
    for (const slug of [...new Set(parsed.data.slugs)]) {
      const dog = isValidSlug(slug) ? await loadDogBySlug(slug) : null;
      if (!dog || (!enrol && !(await isFeederOfDog(auth.feederId, dog)))) {
        skipped.push(slug);
        continue;
      }
      dogs.push({
        slug: dog.slug,
        name: dog.name ?? null,
        wardId: dog.ward_id,
        collarUrl: collarUrl(dog.slug, signSlug(dog.slug, app.config.HETJA_QR_SECRET)),
      });
    }
    reply.header("Cache-Control", "no-store");
    return { ok: true, data: { dogs, skipped } };
  });
}
