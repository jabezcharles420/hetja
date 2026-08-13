/**
 * Hetja dog MICRO-STORIES.
 *
 * POST /api/v1/dogs/:slug/stories  — feeder-authed. The story is feeder-written
 *   ONLY (INVARIANT: never AI-generated). Versioning is per-dog: version =
 *   count+1 computed under a per-dog row lock inside a transaction, with a
 *   UNIQUE (dog_id, version) index as the concurrency backstop. New stories
 *   start UNMODERATED and stay hidden from the public feed until a moderator
 *   approves them.
 * GET  /api/v1/dogs/:slug/stories  — anon. MODERATED stories only
 *   (moderated_at IS NOT NULL), newest first, max 3 (micro = short).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StoryInput } from "@straynet/contracts";
import { query, withTx } from "@straynet/db";
import { verifyAccessToken } from "../lib/jwt.js";

interface DogIdRow {
  id: string;
}

interface StoryRow {
  id: string;
  dog_id: string;
  version: number;
  paragraph: string;
  moderated_at: Date | null;
  created_at: Date;
}

const STORIES_MAX = 3;

function requireFeeder(
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

function toStoryPayload(row: StoryRow) {
  return {
    id: row.id,
    version: row.version,
    paragraph: row.paragraph,
    moderatedAt: row.moderated_at ? new Date(row.moderated_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export default async function storyRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { slug: string } }>(
    "/api/v1/dogs/:slug/stories",
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const auth = requireFeeder(req, reply);
      if (!auth) return reply;

      const parsed = StoryInput.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ ok: false, error: { message: "paragraph must be 1..2000 chars", code: "INVALID_STORY" } });
      }

      // Feeder-written ONLY — the paragraph is authored by the authenticated
      // feeder verbatim; no AI/generated content is ever accepted here.
      const paragraph = parsed.data.paragraph;

      // Versioned write, concurrency-safe: the dog row lock serializes
      // count+1 per dog, and UNIQUE (dog_id, version) rejects any racing
      // duplicate at the DB level.
      const story = await withTx(async (client) => {
        const dogRes = await client.query<DogIdRow>(`SELECT id FROM dogs WHERE slug = $1 FOR UPDATE`, [
          req.params.slug,
        ]);
        const dog = dogRes.rows[0];
        if (!dog) return null;

        const versionRes = await client.query<{ next: number }>(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM dog_stories WHERE dog_id = $1`,
          [dog.id],
        );
        const version = versionRes.rows[0].next;

        const ins = await client.query<StoryRow>(
          `INSERT INTO dog_stories (dog_id, author_feeder_id, paragraph, version)
           VALUES ($1, $2, $3, $4)
           RETURNING id, dog_id, version, paragraph, moderated_at, created_at`,
          [dog.id, auth.feederId, paragraph, version],
        );
        return ins.rows[0];
      });

      if (!story) {
        return reply
          .status(404)
          .send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
      }

      return { ok: true, data: toStoryPayload(story) };
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/api/v1/dogs/:slug/stories",
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const dogRes = await query<DogIdRow>(`SELECT id FROM dogs WHERE slug = $1`, [req.params.slug]);
      const dog = dogRes.rows[0];
      if (!dog) {
        return reply
          .status(404)
          .send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
      }

      // MODERATED only — pending/rejected stories are never shown to the public.
      const res = await query<StoryRow>(
        `SELECT id, dog_id, version, paragraph, moderated_at, created_at
           FROM dog_stories
          WHERE dog_id = $1 AND moderated_at IS NOT NULL
          ORDER BY created_at DESC, version DESC
          LIMIT $2`,
        [dog.id, STORIES_MAX],
      );

      return { ok: true, data: { stories: res.rows.map(toStoryPayload) } };
    },
  );
}
