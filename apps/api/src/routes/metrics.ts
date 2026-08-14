/**
 * Hetja WEB VITALS metrics endpoint (enhancement stack §M.16).
 *
 * POST /api/v1/metrics/web-vitals — anonymous ingestion of one Core Web
 *   Vitals sample from the browser. `path` must already be slug-stripped
 *   ("/d/:slug", not "/d/abc123def") so per-dog page identity is never
 *   collected; a name, a value and a rating carry nothing else — no feeder,
 *   no location, no slug — so nothing here needs INVARIANT 2 coarsening or
 *   feeder auth. It DOES need a cap: it is the only unauthenticated write in
 *   this API and there is no rate limiter in server.ts to fall back on, so a
 *   process-wide token bucket bounds it (see admitVitalsSample). That bounds
 *   the write RATE only — bounding total table SIZE needs a retention job
 *   (`0013_web_vitals.sql` creates a table and an index and nothing else);
 *   that job is owned outside this file.
 *   Sink: migration 0013_web_vitals.sql.
 * GET  /api/v1/metrics/web-vitals?days=7 — feeder-authed counts grouped by
 *   name + rating over the last N days (same auth pattern as trust.ts and
 *   push.ts: any authenticated feeder may read the aggregate).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isValidSlug, query } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";

const WebVitalsName = z.enum(["LCP", "CLS", "INP", "TTFB"]);
const WebVitalsRating = z.enum(["good", "needs-improvement", "poor"]);

// ---------------------------------------------------------------------------
// Ingest cap
// ---------------------------------------------------------------------------

/**
 * Telemetry ingest is the one unauthenticated write in this API, and until this
 * bucket existed it was also completely unbounded: no auth, no device token, no
 * cap, no dedupe, and no rate limiter anywhere in `server.ts` to fall back on
 * (`@fastify/rate-limit` is not a dependency of this package, whatever
 * `ops/caddy/Caddyfile` and `docs/CREDITS.md` say). A single `curl` loop could
 * fill `web_vitals` at thousands of rows/sec on the same 2 GB PostgreSQL
 * cluster that serves `dogs`, `scans` and `sos_cases` — so the real risk here
 * is not bad data, it is starving the SOS path of I/O on a shared cluster.
 *
 * WHY THE BUCKET IS GLOBAL AND NOT PER IP. INVARIANT 6 forbids per-IP limits
 * because Indian carriers do large-scale CGNAT: hundreds of real subscribers
 * behind one address means an IP limit either lets an abuser through as they
 * churn addresses, or locks out an entire carrier for one person's behaviour.
 * That invariant is written about *user actions*, and a `sendBeacon` of an LCP
 * measurement is not one. But the reasoning still decides the design, because
 * it is the reasoning — not the wording — that generalises: a per-IP bucket
 * here would be evadable by exactly the same address churn, and its false
 * positives would silently blind us to the performance of one carrier's whole
 * user base. One process-wide bucket has neither problem, and it bounds the
 * thing we actually care about — writes per second against the shared cluster —
 * directly rather than by proxy.
 *
 * WHY NOT PER PATH (with the `lru-cache` already in this package's deps): a
 * per-path bucket bounds nothing, because `path` is attacker-chosen. It would
 * only add an LRU that churns under exactly the flood it was meant to stop.
 *
 * WHAT WE GIVE UP: one abuser can drain the global budget and suppress everyone
 * else's samples for that window. That is an acceptable trade in a way the
 * alternative is not — losing telemetry is a monitoring gap, and unbounded
 * writes on this cluster is a life-safety availability risk.
 *
 * LIMITATION, stated plainly: the bucket is per process. Two API workers means
 * two buckets and twice the effective ceiling. That is fine at the sizing below
 * (one box, one process) and would need a shared counter if the API is ever
 * scaled out.
 */
export const INGEST_BURST = 600;
/**
 * 600-sample burst refilling at 10/s. A page load emits at most four samples
 * (LCP/CLS/INP/TTFB), so this sustains ~150 page loads a minute with a
 * ten-minute-quiet burst on top — orders of magnitude above pilot traffic, and
 * still a hard ceiling of 600 rows/minute on the table.
 */
export const INGEST_REFILL_PER_SEC = 10;

let ingestTokens = INGEST_BURST;
let ingestRefilledAt = Date.now();

/**
 * Exported so the bucket's arithmetic can be tested directly with an injected
 * clock, rather than by firing INGEST_BURST+1 real requests and inserting 600
 * rows to prove where the ceiling is.
 */
export function admitVitalsSample(now: number = Date.now()): boolean {
  const elapsedSec = (now - ingestRefilledAt) / 1000;
  if (elapsedSec > 0) {
    ingestTokens = Math.min(INGEST_BURST, ingestTokens + elapsedSec * INGEST_REFILL_PER_SEC);
    ingestRefilledAt = now;
  }
  if (ingestTokens < 1) return false;
  ingestTokens -= 1;
  return true;
}

/** Test-only: the bucket is module state, so a suite must be able to reset it. */
export function resetVitalsIngestBucket(): void {
  ingestTokens = INGEST_BURST;
  ingestRefilledAt = Date.now();
}

/** Test-only: put the bucket in the "over cap" state without 600 real inserts. */
export function drainVitalsIngestBucket(): void {
  ingestTokens = 0;
  ingestRefilledAt = Date.now();
}

// ---------------------------------------------------------------------------
// Privacy guard
// ---------------------------------------------------------------------------

/** A collar slug is exactly 9 chars of the reduced base32 alphabet (INVARIANT 1). */
const SLUG_SHAPED_SEGMENT = /^[a-km-z2-9]{9}$/;

/**
 * Path segments that are followed by a dog slug in a real URL: the collar
 * landing is `/d/<slug>?s=<sig>` and the feeder PWA's page is
 * `apps/web/app/dog/[slug]`.
 */
const DOG_PAGE_SEGMENTS = new Set(["d", "dog", "dogs"]);

/**
 * The server-side half of INVARIANT 2 for telemetry: `web_vitals` must never
 * learn which dog's page was being measured, because per-dog page identity is
 * per-feeder location by another route.
 *
 * This used to be `!/[a-km-z2-9]{9}/.test(p)` — unanchored, so it matched a
 * 9-character run *anywhere* in the string. Every character of `dashboard` is
 * in the slug alphabet and there are exactly nine of them, so `/dashboard`
 * 400'd; so did `/leaderboard` (on `eaderboard`), `/gamification` and
 * `/territories`. No route in the app trips it today, which is the only reason
 * this was latent rather than live: the first route added with a nine-letter
 * name would have silently lost all of its telemetry behind a 400 that a
 * `sendBeacon` cannot report to anyone.
 *
 * Anchoring is per path *segment*, and strictness is preserved by two rules
 * rather than one:
 *
 *   1. A slug-shaped segment sitting in a slug *position* (directly after
 *      `d`/`dog`/`dogs`) is rejected regardless of its check character. At that
 *      position the value is per-dog page identity whether or not the dog
 *      exists, which is the thing we refuse to collect.
 *   2. A slug-shaped segment anywhere else is rejected only if it passes the
 *      INVARIANT 1 check character, i.e. only if it is a real collar slug
 *      rather than an ordinary nine-letter route name. This is what keeps the
 *      guard strict against a future URL shape we have not anchored, without
 *      it firing on English words.
 *
 * `?s=` is rejected outright: that is the collar's HMAC signature, and it
 * identifies a dog just as precisely as the slug does.
 */
export function pathCarriesDogIdentity(path: string): boolean {
  if (/[?&]s=/.test(path)) return true;
  const [pathname = ""] = path.split("?");
  const segments = pathname.split("/").filter((s) => s.length > 0);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!SLUG_SHAPED_SEGMENT.test(segment)) continue;
    if (i > 0 && DOG_PAGE_SEGMENTS.has(segments[i - 1])) return true;
    if (isValidSlug(segment)) return true;
  }
  return false;
}

// value bounds: a real CLS is ~0–1, LCP/INP/TTFB are milliseconds and rarely
// exceed a couple of minutes; a 10-minute cap rejects garbage without ever
// rejecting a genuine sample.
const WebVitalsInput = z.object({
  path: z
    .string()
    .min(1)
    .max(256)
    .startsWith("/")
    // Privacy guard: the client contract is that paths are slug-stripped
    // ("/d/:slug"). Reject anything carrying a real collar slug (a 9-char
    // code at a slug position, or an ?s= signature) so a buggy client can
    // never leak per-dog page identity into the metrics store (§M.16).
    // See pathCarriesDogIdentity for why this is anchored per segment.
    .refine((p) => !pathCarriesDogIdentity(p), {
      message: "path must be slug-stripped",
    }),
  name: WebVitalsName,
  value: z.number().nonnegative().max(600_000),
  rating: WebVitalsRating,
});

const WebVitalsQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});

function feederAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): { feederId: string } | null {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "feeder auth required", code: "UNAUTHENTICATED" } });
    return null;
  }
  try {
    const payload = verifyAccessToken(token, req.server.config.JWT_SECRET);
    return { feederId: payload.sub as string };
  } catch {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
    return null;
  }
}

interface WebVitalsCountRow {
  name: string;
  rating: string;
  count: number;
}

export default async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/metrics/web-vitals", async (req: FastifyRequest, reply: FastifyReply) => {
    // The cap is checked before parsing, so a flood costs one clock read and
    // nothing else — no zod pass, and above all no INSERT. 204 rather than 429
    // on purpose: this is a `navigator.sendBeacon` (see apps/web/lib/web-vitals.ts),
    // and a beacon neither reads the response nor retries, so an error status
    // would communicate with nobody while making the drop look like a client
    // failure in any proxy log in front of us. A dropped performance sample is
    // not an error condition; it is the cap working.
    if (!admitVitalsSample()) {
      return reply.status(204).send();
    }

    const parsed = WebVitalsInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { message: "invalid web-vitals payload", code: "INVALID_WEB_VITALS" },
      });
    }
    const { path, name, value, rating } = parsed.data;

    await query(
      `INSERT INTO web_vitals (path, name, value, rating) VALUES ($1, $2, $3, $4)`,
      [path, name, value, rating],
    );

    return { ok: true, data: { recorded: true } };
  });

  app.get("/api/v1/metrics/web-vitals", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = feederAuth(req, reply);
    if (!auth) return reply;

    const parsed = WebVitalsQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid metrics query", code: "INVALID_METRICS_QUERY" } });
    }
    const { days } = parsed.data;

    const res = await query<WebVitalsCountRow>(
      `SELECT name, rating, count(*)::int AS count
       FROM web_vitals
       WHERE created_at >= now() - ($1::int * interval '1 day')
       GROUP BY name, rating
       ORDER BY name, rating`,
      [days],
    );

    return {
      ok: true,
      data: {
        days,
        counts: res.rows,
      },
    };
  });
}
