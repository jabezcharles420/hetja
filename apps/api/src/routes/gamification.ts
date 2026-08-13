/**
 * Hetja GAMIFICATION endpoints (feeder-authed).
 *
 * GET  /api/v1/feeders/me/streak            — current streak_days + the last
 *   feed's calendar day + a hint for the next earnable badge.
 * POST /api/v1/feeders/me/badges/check      — called by the client after a
 *   feed scan: evaluates the badge catalog against server-recorded state and
 *   grants (INSERTs into feeders.badges) any newly earned badges. Grants are
 *   idempotent — repeated calls never double-award.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTx } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";
import { evaluateBadges, GamificationError, getStreakView } from "../lib/gamification.js";

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

function sendGamificationError(reply: FastifyReply, err: unknown): void {
  if (err instanceof GamificationError) {
    void reply.status(err.status).send({ ok: false, error: { message: err.message, code: err.code } });
    return;
  }
  throw err;
}

export default async function gamificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/feeders/me/streak", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = feederAuth(req, reply);
    if (!auth) return reply;

    try {
      const view = await getStreakView(auth.feederId);
      return {
        ok: true,
        data: {
          streakDays: view.streakDays,
          lastFeedDate: view.lastFeedDate,
          nextBadgeHint: view.nextBadgeHint,
        },
      };
    } catch (err) {
      sendGamificationError(reply, err);
    }
  });

  app.post("/api/v1/feeders/me/badges/check", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = feederAuth(req, reply);
    if (!auth) return reply;

    try {
      const result = await withTx(async (client) => evaluateBadges(auth.feederId, client));
      return {
        ok: true,
        data: {
          awarded: result.awarded,
        },
      };
    } catch (err) {
      sendGamificationError(reply, err);
    }
  });
}
