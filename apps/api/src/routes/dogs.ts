import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { coarsenToWard, type DogStatus } from "@straynet/contracts";
import { query } from "@straynet/db";
import { verifySlugSig } from "../lib/hmac.js";

interface DogRow {
  id: string;
  slug: string;
  name: string | null;
  status: string;
  ward_id: string;
  abc_status: string | null;
  last_seen_at: string | null;
  lat: number | null;
  lng: number | null;
}

interface StoryRow {
  paragraph: string;
}

interface VaccineRow {
  vaccine_name: string | null;
  vaccine_date: string | null;
}

interface PhotoRow {
  photo_s3_key: string | null;
}

/**
 * Render a pg DATE as YYYY-MM-DD.
 *
 * node-postgres returns DATE as a JS Date at local midnight, so string
 * interpolation yields the full "Wed Aug 12 2026 00:00:00 GMT+0530 (India
 * Standard Time)" form. toISOString() is not the fix either: local midnight in
 * IST is the previous day in UTC, so it would report the wrong date. Use the
 * local getters, which preserve the calendar date pg stored.
 */
function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ ok: false, error: { message: "not found", code: "NOT_FOUND" } });

export default async function dogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/dogs/:slug", async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    const { s: sig } = req.query as { s?: string };
    if (!sig || !verifySlugSig(slug, sig, app.config.HETJA_QR_SECRET)) {
      return notFound(reply);
    }

    const dogRes = await query<DogRow>(
      `SELECT d.id, d.slug, d.name, d.status, d.ward_id, d.abc_status, d.last_seen_at,
              ST_Y(d.last_seen_geo::geometry) AS lat,
              ST_X(d.last_seen_geo::geometry) AS lng
       FROM dogs d
       WHERE d.slug = $1`,
      [slug],
    );
    const dog = dogRes.rows[0];
    if (!dog) return notFound(reply);

    const [storyRes, vaccineRes, photoRes] = await Promise.all([
      query<StoryRow>(
        `SELECT paragraph FROM dog_stories WHERE dog_id = $1 ORDER BY created_at DESC, version DESC LIMIT 1`,
        [dog.id],
      ),
      query<VaccineRow>(
        `SELECT vaccine_name, vaccine_date FROM medical_records
         WHERE dog_id = $1 AND record_type IN ('vaccination', 'vaccine') AND is_verified
         ORDER BY created_at DESC LIMIT 1`,
        [dog.id],
      ),
      query<PhotoRow>(
        `SELECT photo_s3_key FROM scans
         WHERE dog_id = $1 AND photo_s3_key IS NOT NULL
         ORDER BY received_at DESC LIMIT 1`,
        [dog.id],
      ),
    ]);

    const story = storyRes.rows[0];
    const vaccine = vaccineRes.rows[0];
    const photo = photoRes.rows[0];
    const geo = dog.lat != null && dog.lng != null ? coarsenToWard(dog.lat, dog.lng) : undefined;

    return {
      ok: true,
      data: {
        slug: dog.slug,
        name: dog.name ?? null,
        status: dog.status as DogStatus,
        wardId: dog.ward_id,
        photoKey: photo?.photo_s3_key ?? null,
        abcStatus: dog.abc_status ?? null,
        vaccineStatus:
          vaccine?.vaccine_name || vaccine?.vaccine_date
            ? [vaccine.vaccine_name, isoDate(vaccine.vaccine_date)].filter(Boolean).join(" · ")
            : null,
        microStory: story?.paragraph ?? null,
        lastSeenAt: dog.last_seen_at ?? null,
        geo: geo ?? null,
      },
    };
  });
}
