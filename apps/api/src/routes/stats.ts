/**
 * Hetja IMPACT stats (public).
 *
 * GET /api/v1/stats/impact → { dogsTracked, feedsLogged, livesTouched }
 *
 * The landing "Impact" row was hardcoded value="—" for all three stats
 * (apps/web/app/page.tsx:97) — honest but inert. This route replaces it
 * with live counts, coarsened per INVARIANT 2: counts only, no geo, no
 * per-dog or per-feeder identity. Any agentic caller (LLM, scraper,
 * dashboard) gets the same three integers the human sees in the landing
 * strip, from the same source queries.
 *
 * Queries (all single-row count(*) variants, cheap even without a
 * dedicated index — dogs has dogs_ward_ix partial on status='active',
 * scans has scans_received_ix + scans_dog_ix):
 *
 *   dogsTracked  — SELECT count(*) FROM dogs WHERE status='active'
 *   feedsLogged  — SELECT count(*) FROM scans WHERE scan_type='feed'
 *   livesTouched — SELECT count(DISTINCT dog_id) FROM scans WHERE
 *                  scan_type='feed'
 *
 * Why livesTouched is DISTINCT dog_id not a raw count(*). Two
 * interpretations fit the label — "unique dogs ever fed" vs "human
 * volunteers who have fed". The distinct-dogs reading is the one tied
 * directly to street impact rather than account count, and also the one
 * that cannot be derived from the other two numbers (dogsTracked is
 * every active collar, feedsLogged is every feed event, livesTouched is
 * the set of dogs actually reached). If the product later wants a
 * volunteer count, that is SELECT count(*) FROM feeders and should be a
 * fourth field rather than a redefinition.
 *
 * No auth. Cache 60s in-process (LRU, like care.ts), since the numbers
 * change only on enrolment/activation and feed scans — seconds-level
 * freshness buys nothing and every GET avoids two COUNT(*) scans. Also
 * Cache-Control: public, max-age=60 so Caddy/Cloudflare can serve it.
 *
 * INVARIANT 2: only counts are returned, no coordinates. This file
 * contains no ST_X/ST_Y and selects no geo column.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LRUCache } from "lru-cache";
import { query } from "@hetja/db";

export interface ImpactStats {
  dogsTracked: number;
  feedsLogged: number;
  livesTouched: number;
}

// Single-key cache — only one row ("impact") is ever stored. 60s TTL
// matches both the route's Cache-Control and the web's
// next: { revalidate: 60 } so a stale landing render and a stale API
// response age out together rather than one masking the other.
export const impactCache = new LRUCache<string, ImpactStats>({
  max: 1,
  ttl: 60_000,
});

interface CountRow {
  n: number;
}

export default async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/stats/impact", async (_req: FastifyRequest, reply: FastifyReply) => {
    const cached = impactCache.get("impact");
    if (cached) {
      reply.header("Cache-Control", "public, max-age=60");
      return { ok: true, data: cached };
    }

    // Three independent count(*) queries — no joins, no geo, no ordering.
    // Promise.all keeps them concurrent; each is a single-row aggregate so
    // the extra round trip is cheaper than a multi-statement transaction.
    const [dogsRes, feedsRes, livesRes] = await Promise.all([
      query<CountRow>(`SELECT count(*)::int AS n FROM dogs WHERE status = 'active'`),
      query<CountRow>(`SELECT count(*)::int AS n FROM scans WHERE scan_type = 'feed'`),
      query<CountRow>(`SELECT count(DISTINCT dog_id)::int AS n FROM scans WHERE scan_type = 'feed'`),
    ]);

    const data: ImpactStats = {
      dogsTracked: dogsRes.rows[0]?.n ?? 0,
      feedsLogged: feedsRes.rows[0]?.n ?? 0,
      livesTouched: livesRes.rows[0]?.n ?? 0,
    };

    impactCache.set("impact", data);
    reply.header("Cache-Control", "public, max-age=60");
    return { ok: true, data };
  });
}
