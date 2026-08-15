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
import { generateSlug, isValidSlug, query, withTx } from "@hetja/db";
import { signSlug } from "../lib/hmac.js";
import { verifyAccessToken } from "../lib/jwt.js";

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

/**
 * The public origin a collar URL points at.
 *
 * Deliberately NOT derived from the request's Host header: a collar is etched
 * once and glued to an animal, so the URL must be the canonical public origin
 * regardless of which hostname the operator happened to call the API on. An
 * admin who ran this against `127.0.0.1:8080` would otherwise print a thousand
 * tags pointing at loopback.
 */
const PUBLIC_ORIGIN = (process.env.HETJA_PUBLIC_ORIGIN ?? "https://hetja.in").replace(/\/+$/, "");

function collarUrl(slug: string, sig: string): string {
  return `${PUBLIC_ORIGIN}/d/${slug}?s=${encodeURIComponent(sig)}`;
}

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

/**
 * A slug that is not already taken.
 *
 * `generateSlug` draws from 5 random bytes, so a collision is remote — but
 * "remote" is not "impossible", and the failure mode of a collision here is
 * that two physical collars resolve to the same dog. Retrying a handful of
 * times costs nothing and removes the case entirely.
 */
async function mintUnusedSlug(attempts = 5): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const slug = generateSlug();
    const clash = await query(`SELECT 1 FROM dogs WHERE slug = $1`, [slug]);
    if (clash.rowCount === 0) return slug;
  }
  throw new Error(`could not mint an unused slug in ${attempts} attempts`);
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
    const slug = await mintUnusedSlug();
    const sig = signSlug(slug, app.config.HETJA_QR_SECRET);

    // One transaction: a dog without a collar is an unreachable row, and a
    // collar without a dog violates its foreign key. Either both exist or
    // neither does.
    const created = await withTx(async (client) => {
      const dog = await client.query<{ id: string }>(
        `INSERT INTO dogs (slug, name, sex, approx_age, coat_pattern, temperament, ward_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         RETURNING id`,
        [
          slug,
          input.name ?? null,
          input.sex ?? null,
          input.approxAge ?? null,
          input.coatPattern ?? null,
          input.temperament ?? null,
          input.wardId,
        ],
      );
      const dogId = dog.rows[0].id;
      await client.query(
        `INSERT INTO collars (dog_id, qr_code, hmac_sig, batch_no, material)
         VALUES ($1, $2, $3, $4, $5)`,
        [dogId, slug, sig, input.batchNo, input.material],
      );
      return dogId;
    });

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
   * previously-printed tag for that dog keeps working. The old collar row is
   * retired rather than deleted, so the physical history of a dog's tags stays
   * auditable.
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
    await withTx(async (client) => {
      await client.query(
        `UPDATE collars SET status = 'retired', retired_at = now()
          WHERE dog_id = $1 AND status = 'active'`,
        [dog.id],
      );
      await client.query(
        // qr_code is UNIQUE and equals the slug, so a re-issue for the same dog
        // updates the existing row's provenance rather than inserting a
        // duplicate. The signature is rewritten too, which is what lets a
        // re-issue pick up a rotated HETJA_QR_SECRET.
        `INSERT INTO collars (dog_id, qr_code, hmac_sig, batch_no, material)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (qr_code) DO UPDATE
           SET hmac_sig = EXCLUDED.hmac_sig,
               batch_no = EXCLUDED.batch_no,
               material = EXCLUDED.material,
               status = 'active',
               retired_at = NULL,
               issued_at = now()`,
        [dog.id, slug, sig, input.batchNo, input.material],
      );
    });

    req.log.info({ slug, reason: input.reason ?? null }, "collar re-issued");

    return { ok: true, data: { slug, collarUrl: collarUrl(slug, sig) } };
  });
}
