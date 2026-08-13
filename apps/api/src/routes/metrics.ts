/**
 * Hetja WEB VITALS metrics endpoint (enhancement stack §M.16).
 *
 * POST /api/v1/metrics/web-vitals — anonymous ingestion of one Core Web
 *   Vitals sample from the browser. `path` must already be slug-stripped
 *   ("/d/:slug", not "/d/abc123def") so per-dog page identity is never
 *   collected; a name, a value and a rating carry nothing else — no feeder,
 *   no location, no slug — so nothing here needs INVARIANT 2 coarsening or
 *   feeder auth. Sink: migration 0013_web_vitals.sql.
 * GET  /api/v1/metrics/web-vitals?days=7 — feeder-authed counts grouped by
 *   name + rating over the last N days (same auth pattern as trust.ts and
 *   push.ts: any authenticated feeder may read the aggregate).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";

const WebVitalsName = z.enum(["LCP", "CLS", "INP", "TTFB"]);
const WebVitalsRating = z.enum(["good", "needs-improvement", "poor"]);

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
    // ("/d/:slug"). Reject anything carrying a real collar slug (9-char
    // code or an ?s= signature) so a buggy client can never leak per-dog
    // page identity into the metrics store (§M.16).
    .refine((p) => !/[a-km-z2-9]{9}/.test(p) && !p.includes("?s="), {
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
