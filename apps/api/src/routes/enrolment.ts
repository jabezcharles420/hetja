/**
 * Dog enrolment — the write half of the register (admin only).
 *
 * POST /api/v1/dogs           create a dog, mint its collar, return the QR URL
 * POST /api/v1/dogs/:slug/collar   re-issue a collar for an existing dog
 *
 * UNTIL NOW THERE WAS NO WAY TO ENROL A DOG AT ALL. No route created a `dogs`
 * row, no route created a `collars` row, and no operator tool existed. The only
 * paths in were `pnpm db:seed` — which mints fresh random slugs that match no
 * physical collar, and which is not idempotent despite claiming to be — or
 * hand-written SQL on the box. A system whose purpose is a city-scale register
 * of street dogs could not register a street dog.
 *
 * WHY ADMIN-ONLY, AND WHY THE ROLE IS GRANTED FROM A SHELL. Enrolling a dog
 * writes to the register that INVARIANT 1 and INVARIANT 2 exist to protect;
 * `docs/design/MEMORIAL-CONTENT.md` is blunt that in the wrong political
 * climate this data is a targeting list. So the role is granted by
 * `apps/api/src/cli/grant-admin.ts`, which requires a shell on the box — there
 * is deliberately no HTTP path to becoming an admin. See that file's header.
 *
 * WHAT THE CALLER GETS BACK, AND WHY IT MATTERS. The response carries the full
 * signed URL to encode in the QR:
 *
 *     https://hetja.in/d/<slug>?s=<base64url HMAC>
 *
 * That is the whole point of the endpoint. The slug alone is useless — the API
 * 404s any request without a valid `?s=`, so a collar printed with a bare slug
 * would fail the first time a stranger scanned it, standing over a dog. Handing
 * back the exact string to etch removes the step where a human reconstructs it.
 *
 * The signature is ALSO stored in `collars.hmac_sig`, which since PR #21 is
 * what verification consults first — so a collar minted here keeps working even
 * if HETJA_QR_SECRET is later lost or rotated.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isValidSlug, query, withTx } from "@hetja/db";
import { signSlug } from "../lib/hmac.js";
import { verifyAccessToken } from "../lib/jwt.js";
// The mint/insert half lives in lib/enrol.ts so this route and the public
// registrations route cannot drift apart — see that file's header.
import { collarUrl, createDogWithCollar } from "../lib/enrol.js";

const DogCreateInput = z.object({
  /** BMC ward code, e.g. "K-West". The one field with no sensible default. */
  wardId: z.string().min(1).max(16),
  name: z.string().min(1).max(80).optional(),
  sex: z.enum(["male", "female", "unknown"]).optional(),
  approxAge: z.number().int().min(0).max(30).optional(),
  coatPattern: z.string().max(120).optional(),
  temperament: z.string().max(120).optional(),
  /** Printing batch, for tracing a bad run of physical tags. */
  batchNo: z.string().min(1).max(40).default("manual"),
  material: z.string().min(1).max(40).default("TPU-Shore-95A"),
});

const CollarReissueInput = z.object({
  batchNo: z.string().min(1).max(40).default("manual"),
  material: z.string().min(1).max(40).default("TPU-Shore-95A"),
  /** Why the previous collar is being replaced. Recorded, not enforced. */
  reason: z.string().max(200).optional(),
});

/** Bearer auth plus an admin role check. Mirrors moderation.ts exactly. */
async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ feederId: string } | null> {
  const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  if (!rawAuth.startsWith("Bearer ")) {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "admin auth required", code: "UNAUTHENTICATED" } });
    return null;
  }
  let feederId: string;
  try {
    feederId = verifyAccessToken(rawAuth.slice(7), req.server.config.JWT_SECRET).sub as string;
  } catch {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
    return null;
  }
  const roleRes = await query<{ role: string }>(`SELECT role FROM feeders WHERE id = $1`, [feederId]);
  if ((roleRes.rows[0]?.role ?? null) !== "admin") {
    void reply
      .status(403)
      .send({ ok: false, error: { message: "admin role required", code: "FORBIDDEN" } });
    return null;
  }
  return { feederId };
}

export default async function enrolmentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/dogs", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireAdmin(req, reply);
    if (!auth) return reply;

    const parsed = DogCreateInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "invalid dog payload", code: "INVALID_DOG" },
      });
    }
    const input = parsed.data;

    // One transaction: a dog without a collar is an unreachable row, and a
    // collar without a dog violates its foreign key. Either both exist or
    // neither does. The slug is minted inside the insert (ON CONFLICT retry in
    // lib/enrol.ts), so uniqueness is the constraint's job, not a SELECT's.
    const { dogId: created, slug, sig } = await withTx((client) =>
      createDogWithCollar(
        client,
        {
          name: input.name ?? null,
          sex: input.sex ?? null,
          approxAge: input.approxAge ?? null,
          coatPattern: input.coatPattern ?? null,
          temperament: input.temperament ?? null,
          wardId: input.wardId,
          status: "active",
          registeredBy: null,
          registeredDeviceId: null,
        },
        { batchNo: input.batchNo, material: input.material },
        app.config.HETJA_QR_SECRET,
      ),
    );

    req.log.info({ dogId: created, slug, wardId: input.wardId }, "dog enrolled");

    return reply.status(201).send({
      ok: true,
      data: {
        id: created,
        slug,
        wardId: input.wardId,
        // The string to encode in the QR. Everything else here is metadata.
        collarUrl: collarUrl(slug, sig),
      },
    });
  });

  /**
   * Re-issue a collar for a dog that already exists — a tag that fell off, was
   * chewed through, or came out of a bad print run.
   *
   * The slug does NOT change. It identifies the dog, not the piece of plastic,
   * so a replacement tag carries the same code and the same signature and every
   * previously-printed tag for that dog keeps working.
   *
   * HISTORY IS A SEPARATE TABLE, NOT A SECOND COLLAR ROW. `collars.qr_code` is
   * UNIQUE and equals the slug, so there can only ever be one collars row per
   * slug — an earlier version of this comment claimed the old row was "retired
   * rather than deleted" while the code overwrote that one row in place and
   * sent the admin's `reason` to the pino log only (BUGS P2-8). Every re-issue
   * now writes a `collar_reissues` row (migration 0023) carrying the provenance
   * about to be overwritten — previous batch, material and issue date — plus
   * what replaced it, why, and which admin did it. Tracing a bad print run six
   * months later is a query, not a log search.
   */
  app.post("/api/v1/dogs/:slug/collar", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireAdmin(req, reply);
    if (!auth) return reply;

    const { slug } = req.params as { slug: string };
    if (!isValidSlug(slug)) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid slug", code: "INVALID_SLUG" } });
    }
    const parsed = CollarReissueInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid collar payload", code: "INVALID_COLLAR" } });
    }
    const input = parsed.data;

    const dogRes = await query<{ id: string }>(`SELECT id FROM dogs WHERE slug = $1`, [slug]);
    const dog = dogRes.rows[0];
    if (!dog) {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "not found", code: "DOG_NOT_FOUND" } });
    }

    const sig = signSlug(slug, app.config.HETJA_QR_SECRET);
    const reissueId = await withTx(async (client) => {
      // Any OTHER collar row this dog still holds active (a legacy row under a
      // different qr_code) is retired; the row for this slug is handled below.
      await client.query(
        `UPDATE collars SET status = 'retired', retired_at = now()
          WHERE dog_id = $1 AND qr_code <> $2 AND status = 'active'`,
        [dog.id, slug],
      );

      // The one row this slug can have, locked so two concurrent re-issues
      // record two history rows in a definite order rather than racing.
      const current = await client.query<{
        id: string;
        batch_no: string;
        material: string;
        issued_at: Date;
      }>(
        `SELECT id, batch_no, material, issued_at FROM collars
          WHERE dog_id = $1 AND qr_code = $2
          FOR UPDATE`,
        [dog.id, slug],
      );
      const prev = current.rows[0];

      if (!prev) {
        // A dog with no collar row for its own slug (seeded by hand, or a row
        // that was never minted). This is a first issue, not a re-issue: there
        // is no provenance to record, so no history row is written.
        await client.query(
          `INSERT INTO collars (dog_id, qr_code, hmac_sig, batch_no, material)
           VALUES ($1, $2, $3, $4, $5)`,
          [dog.id, slug, sig, input.batchNo, input.material],
        );
        return null;
      }

      // History first, then the overwrite — same transaction, so a re-issue
      // can never exist without its provenance row or vice versa.
      const history = await client.query<{ id: string }>(
        `INSERT INTO collar_reissues
           (collar_id, dog_id, slug, previous_batch_no, previous_material, previous_issued_at,
            new_batch_no, new_material, reason, reissued_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          prev.id,
          dog.id,
          slug,
          prev.batch_no,
          prev.material,
          prev.issued_at,
          input.batchNo,
          input.material,
          input.reason ?? null,
          auth.feederId,
        ],
      );
      // The signature is rewritten too, which is what lets a re-issue pick up
      // a rotated HETJA_QR_SECRET (verification consults the stored value
      // first — routes/dogs.ts).
      await client.query(
        `UPDATE collars
            SET hmac_sig = $2, batch_no = $3, material = $4,
                status = 'active', retired_at = NULL, issued_at = now()
          WHERE id = $1`,
        [prev.id, sig, input.batchNo, input.material],
      );
      return history.rows[0].id;
    });

    req.log.info({ slug, reissueId, reason: input.reason ?? null }, "collar re-issued");

    return { ok: true, data: { slug, collarUrl: collarUrl(slug, sig), reissueId } };
  });
}
