/**
 * Hetja dog MICRO-STORIES.
 *
 * POST /api/v1/dogs/:slug/stories:   feeder-authed. The story is feeder-written
 *   ONLY (INVARIANT: never AI-generated). Versioning is per-dog: version =
 *   count+1 computed under a per-dog row lock inside a transaction, with a
 *   UNIQUE (dog_id, version) index as the concurrency backstop. New stories
 *   start UNMODERATED and stay hidden from the public feed until a moderator
 *   approves them.
 * GET  /api/v1/dogs/:slug/stories:   anon. MODERATED stories only
 *   (moderated_at IS NOT NULL), newest first, max 3 (micro = short).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StoryInput } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { requireFeeder } from "../lib/require-role.js";
import { logRateLimited, storyPerAccount } from "../lib/rate-limit.js";

interface DogIdRow {
  id: string;
}

interface DogStatusRow {
  id: string;
  status: string;
}

/** Statuses dogs.ts hides from the public: a story on one would confirm it exists. */
const HIDDEN_STATUSES = new Set(["pending_activation", "expired"]);

class DogNotActiveError extends Error {
  constructor(public readonly hidden: boolean) {
    super("dog is not active");
    this.name = "DogNotActiveError";
  }
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
      // The shared live-role gate (lib/require-role.ts), not a local JWT-only
      // copy: dog_stories.author_feeder_id references feeders, so a still-valid
      // token for an erased account used to reach the INSERT, hit FK 23503 and
      // surface as a 500. It is a 401 FEEDER_GONE now, like every other route.
      const auth = await requireFeeder(req, reply);
      if (!auth) return reply;

      // 5 stories a day per account (hardening batch 1, T3). Every story lands
      // in the moderation queue, so an unbounded writer is a way to bury the
      // queue a human has to read.
      const budget = storyPerAccount.consume(`acct:${auth.feederId}`);
      if (!budget.allowed) {
        logRateLimited(req.log, "storyPerAccount", "account");
        return reply
          .status(429)
          .header("retry-after", String(budget.retryAfterSec))
          .send({ ok: false, error: { message: "story limit reached for today", code: "RATE_LIMITED" } });
      }

      const parsed = StoryInput.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ ok: false, error: { message: "paragraph must be 1..2000 chars", code: "INVALID_STORY" } });
      }

      // Feeder-written ONLY: the paragraph is authored by the authenticated
      // feeder verbatim; no AI/generated content is ever accepted here.
      const paragraph = parsed.data.paragraph;

      // Versioned write, concurrency-safe: the dog row lock serializes
      // count+1 per dog, and UNIQUE (dog_id, version) rejects any racing
      // duplicate at the DB level.
      // Stories only on ACTIVE dogs (hardening batch 1, T3). A pending or
      // expired registration answers the same 404 as an unknown slug, so the
      // write path confirms no more than GET /dogs/:slug does; a lost,
      // adopted, relocated or deceased dog is 409 DOG_NOT_ACTIVE.
      let story;
      try {
        story = await withTx(async (client) => {
        const dogRes = await client.query<DogStatusRow>(
          `SELECT id, status::text AS status FROM dogs WHERE slug = $1 FOR UPDATE`,
          [req.params.slug],
        );
        const dog = dogRes.rows[0];
        if (!dog) return null;
        if (dog.status !== "active") throw new DogNotActiveError(HIDDEN_STATUSES.has(dog.status));

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
      } catch (err) {
        if (!(err instanceof DogNotActiveError)) throw err;
        if (err.hidden) {
          return reply
            .status(404)
            .send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
        }
        return reply.status(409).send({
          ok: false,
          error: { message: "stories can only be added to an active dog", code: "DOG_NOT_ACTIVE" },
        });
      }

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

      // MODERATED only: pending/rejected stories are never shown to the public.
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
