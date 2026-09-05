/**
 * Hetja HEATMAP endpoint (public).
 *
 * GET /api/v1/heatmap?ward=<id>&days=7 — public hunger heatmap per the
 * canonical query (docs/queries/heatmap.sql, kept byte-for-byte in step with
 * CELL_SQL below; ops/check-queries.sh EXPLAINs that file, so it must be the
 * query that actually ships).
 *
 * Cells are 500 m ST_SnapToGrid squares, snapped in EPSG:3857 so the size is
 * metres rather than degrees. 500 m is INVARIANT 2's floor ("snaps geo to ward
 * or a ≥500 m grid cell") — this used to be 200 m, which the invariant forbids
 * outright; coarsening the *output* to 2 decimals did not repair that, because
 * the k-anonymity floor was still being applied per 200 m cell.
 *
 * fed_ratio = feed scans / (distinct dogs fed × days in the window), clamped
 * to [0, 1]: the share of dog-days in the window that saw a feed. 1 means
 * every dog in the cell was fed every day; 0.14 means roughly once a week.
 * It used to be feeds ÷ dogs, which is feeds-per-dog and climbs past 1 as
 * soon as any dog is fed twice — while `@hetja/contracts` HeatmapCell declares
 * `fedRatio: z.number().min(0).max(1)`. A ratio that violates its own
 * contract cannot be rendered as a colour scale, which is the only thing a
 * heatmap consumer does with it. feedCount and dogCount stay raw.
 *
 * INVARIANT 2: only cell centroids are exposed (never point geometry) and
 * coordinates carry at most 2 decimals.
 * RESEARCH-1 E2 (k-anonymity): cells with fewer than 3 distinct dogs are
 * dropped so a single dog's feeding route cannot be re-derived.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "@hetja/db";

// INVARIANT 2 floor. Do not lower without changing the invariant first.
const CELL_SIZE_M = 500;
const K_ANON_MIN_ACTIVE_DOGS = 3;

const HeatmapQuery = z.object({
  ward: z.string().min(1).max(16),
  days: z.coerce.number().int().min(1).max(30).default(7),
});

interface HeatmapRow {
  lat: string;
  lng: string;
  fed_ratio: string;
  feed_count: number;
  dog_count: number;
}

const CELL_SQL = `
SELECT
  round(ST_Y(ST_Centroid(cell))::numeric, 2) AS lat,
  round(ST_X(ST_Centroid(cell))::numeric, 2) AS lng,
  round(
    LEAST(
      1,
      count(*)::numeric / (NULLIF(count(DISTINCT dog_id), 0) * $2)::numeric
    ),
    3
  ) AS fed_ratio,
  count(*)::int AS feed_count,
  count(DISTINCT dog_id)::int AS dog_count
FROM (
  SELECT
    ST_Transform(ST_SnapToGrid(ST_Transform(s.geo::geometry, 3857), ${CELL_SIZE_M}), 4326) AS cell,
    s.dog_id
  FROM scans s
  JOIN dogs d ON d.id = s.dog_id AND d.status = 'active'
  WHERE d.ward_id = $1
    AND s.scan_type = 'feed'
    AND s.geo IS NOT NULL
    AND s.captured_at >= now() - ($2::int * interval '1 day')
) cell_scans
GROUP BY cell
HAVING count(DISTINCT dog_id) >= ${K_ANON_MIN_ACTIVE_DOGS}
ORDER BY cell;
`;

export default async function heatmapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/heatmap", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = HeatmapQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid heatmap query", code: "INVALID_HEATMAP_QUERY" } });
    }
    const { ward, days } = parsed.data;

    const res = await query<HeatmapRow>(CELL_SQL, [ward, days]);
    reply.header("Cache-Control", "public, max-age=300");

    return {
      ok: true,
      data: {
        cells: res.rows.map((row) => ({
          lat: Number(row.lat),
          lng: Number(row.lng),
          fedRatio: Number(row.fed_ratio),
          feedCount: row.feed_count,
          dogCount: row.dog_count,
        })),
      },
    };
  });
}
