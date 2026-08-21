/**
 * Moderation route tests (admin only).
 *
 * These focus on the :id path-parameter contract. The routes bind `:id`
 * straight into dog_stories.id (a uuid column); before lib/params.ts existed
 * a non-UUID value raised PostgreSQL 22P02 and rendered as "internal server
 * error" — a client mistake answered as a server fault.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { query, generateSlug } from "@hetja/db";

const config = loadConfig();

interface TestFixture {
  dogId: string;
  feederId: string;
  feederToken: string;
  adminId: string;
  adminToken: string;
}

let fx: TestFixture;
const createdFeeders: string[] = [];

async function insertFeeder(role: "feeder" | "admin"): Promise<{ id: string; token: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, $2, $3, 30, 'v1', FALSE) RETURNING id`,
    [randomUUID(), role === "admin" ? "Mod Admin" : "Mod Feeder", role],
  );
  createdFeeders.push(res.rows[0].id);
  return { id: res.rows[0].id, token: signAccessToken(res.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL) };
}

beforeEach(async () => {
  const dogRes = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id)
     VALUES ($1, 'ModTest', 'K-West') RETURNING id`,
    [generateSlug()],
  );
  const feeder = await insertFeeder("feeder");
  const admin = await insertFeeder("admin");
  fx = {
    dogId: dogRes.rows[0].id,
    feederId: feeder.id,
    feederToken: feeder.token,
    adminId: admin.id,
    adminToken: admin.token,
  };
});

afterEach(async () => {
  // A rejected story is DELETED by the route itself; approve leaves it, and
  // the pending-story cleanup below covers both.
  await query(`DELETE FROM dog_stories WHERE author_feeder_id = ANY($1::uuid[])`, [createdFeeders]);
  await query(`DELETE FROM trust_events WHERE feeder_id = ANY($1::uuid[])`, [createdFeeders]);
  await query(`DELETE FROM feeders WHERE id = ANY($1::uuid[])`, [createdFeeders]);
  createdFeeders.length = 0;
  await query(`DELETE FROM dogs WHERE id = $1`, [fx.dogId]);
});

async function insertPendingStory(): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO dog_stories (dog_id, author_feeder_id, paragraph, version)
     VALUES ($1, $2, 'A very good dog.', 1) RETURNING id`,
    [fx.dogId, fx.feederId],
  );
  return res.rows[0].id;
}

describe("POST /api/v1/moderation/:id/approve", () => {
  it("answers a non-UUID story id with 400, not a 500 from a raw 22P02", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/moderation/not-a-uuid/approve",
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_STORY_ID");
    await app.close();
  });

  it("still 404s for a well-formed UUID that matches no story", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/moderation/${randomUUID()}/approve`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("STORY_NOT_FOUND");
    await app.close();
  });

  it("approves a real story (the 400 above must not have broken the happy path)", async () => {
    const app = buildServer(config);
    const storyId = await insertPendingStory();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/moderation/${storyId}/approve`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(storyId);

    const row = await query<{ moderated_at: Date | null }>(
      `SELECT moderated_at FROM dog_stories WHERE id = $1`,
      [storyId],
    );
    expect(row.rows[0].moderated_at).not.toBeNull();
    await app.close();
  });
});

describe("POST /api/v1/moderation/:id/reject", () => {
  it("answers a non-UUID story id with 400, not a 500 from a raw 22P02", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/moderation/not-a-uuid/reject",
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_STORY_ID");
    await app.close();
  });
});
