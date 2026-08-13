/**
 * Hetja micro-story MODERATION (admin only).
 *
 * GET  /api/v1/moderation/queue           — pending stories (moderated_at IS
 *   NULL), oldest first.
 * POST /api/v1/moderation/:id/approve     — sets moderated_at = now(); the
 *   story becomes public.
 * POST /api/v1/moderation/:id/reject      — DELETES the story row outright
 *   (stories are NOT append-only). The deletion is audited via
 *   app.log (no moderation_audit table yet) and the author loses 5 trust
 *   points: a trust_event (delta -5, reason 'story_rejected') is inserted and
 *   feeders.trust_score is decremented (clamped at 0).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query, withTx } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";

const TRUST_PENALTY = 5;

interface QueueRow {
  id: string;
  dog_slug: string;
  version: number;
  paragraph: string;
  author_feeder_id: string;
  author_name: string;
  created_at: Date;
}

interface StoryRow {
  id: string;
  dog_id: string;
  author_feeder_id: string;
  version: number;
  paragraph: string;
  moderated_at: Date | null;
}

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

async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ feederId: string } | null> {
  const auth = feederAuth(req, reply);
  if (!auth) return null;
  const roleRes = await query<{ role: string }>(`SELECT role FROM feeders WHERE id = $1`, [auth.feederId]);
  const role = roleRes.rows[0]?.role ?? null;
  if (role !== "admin") {
    void reply
      .status(403)
      .send({ ok: false, error: { message: "admin role required", code: "FORBIDDEN" } });
    return null;
  }
  return auth;
}

export default async function moderationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/moderation/queue", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireAdmin(req, reply);
    if (!auth) return reply;

    const res = await query<QueueRow>(
      `SELECT s.id, d.slug AS dog_slug, s.version, s.paragraph,
              s.author_feeder_id, f.display_name AS author_name, s.created_at
         FROM dog_stories s
         JOIN dogs d ON d.id = s.dog_id
         JOIN feeders f ON f.id = s.author_feeder_id
        WHERE s.moderated_at IS NULL
        ORDER BY s.created_at ASC, s.version ASC`,
    );

    return {
      ok: true,
      data: {
        queue: res.rows.map((row) => ({
          id: row.id,
          dogSlug: row.dog_slug,
          version: row.version,
          paragraph: row.paragraph,
          authorFeederId: row.author_feeder_id,
          authorName: row.author_name,
          createdAt: new Date(row.created_at).toISOString(),
        })),
      },
    };
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/moderation/:id/approve",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const auth = await requireAdmin(req, reply);
      if (!auth) return reply;

      const existing = await query<{ id: string }>(`SELECT id FROM dog_stories WHERE id = $1`, [
        req.params.id,
      ]);
      if (existing.rowCount === 0) {
        return reply
          .status(404)
          .send({ ok: false, error: { message: "story not found", code: "STORY_NOT_FOUND" } });
      }

      const res = await query<StoryRow>(
        `UPDATE dog_stories SET moderated_at = now()
          WHERE id = $1
          RETURNING id, dog_id, author_feeder_id, version, paragraph, moderated_at`,
        [req.params.id],
      );
      const story = res.rows[0];

      return {
        ok: true,
        data: {
          id: story.id,
          version: story.version,
          paragraph: story.paragraph,
          moderatedAt: story.moderated_at ? new Date(story.moderated_at).toISOString() : null,
        },
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/moderation/:id/reject",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const auth = await requireAdmin(req, reply);
      if (!auth) return reply;

      // Full delete (NOT append-only) + trust penalty, atomic.
      const result = await withTx(async (client) => {
        const storyRes = await client.query<StoryRow>(
          `SELECT id, dog_id, author_feeder_id, version, paragraph, moderated_at
             FROM dog_stories WHERE id = $1 FOR UPDATE`,
          [req.params.id],
        );
        const story = storyRes.rows[0];
        if (!story) return null;

        await client.query(`DELETE FROM dog_stories WHERE id = $1`, [story.id]);

        // Trust coupling: the author loses 5 points.
        await client.query(
          `INSERT INTO trust_events (feeder_id, event_type, delta, reason)
           VALUES ($1, 'story_rejected', $2, 'story_rejected')`,
          [story.author_feeder_id, -TRUST_PENALTY],
        );
        await client.query(
          `UPDATE feeders SET trust_score = GREATEST(0, trust_score - $1) WHERE id = $2`,
          [TRUST_PENALTY, story.author_feeder_id],
        );

        return story;
      });

      if (!result) {
        return reply
          .status(404)
          .send({ ok: false, error: { message: "story not found", code: "STORY_NOT_FOUND" } });
      }

      app.log.info(
        { storyId: result.id, dogId: result.dog_id, authorFeederId: result.author_feeder_id, delta: -TRUST_PENALTY },
        "moderation audit: story rejected and deleted",
      );

      return { ok: true, data: { id: result.id, deleted: true, trustDelta: -TRUST_PENALTY } };
    },
  );
}
