import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { query } from "@straynet/db";

const config = loadConfig();

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function randomSlug(): string {
  let slug = "";
  for (let i = 0; i < 9; i++) {
    slug += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return slug;
}

interface TestFixture {
  dogId: string;
  dogSlug: string;
  feederId: string;
  feederToken: string;
  adminId: string;
  adminToken: string;
}

let fx: TestFixture;
const createdFeeders: string[] = [];

async function insertFeeder(role: "feeder" | "admin", trustScore: number): Promise<{ id: string; token: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (phone_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, $2, $3, $4, 'v1', FALSE) RETURNING id`,
    [randomUUID(), role === "admin" ? "Test Admin" : "Test Feeder", role, trustScore],
  );
  createdFeeders.push(res.rows[0].id);
  return { id: res.rows[0].id, token: signAccessToken(res.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL) };
}

beforeEach(async () => {
  const slug = randomSlug();
  const dogRes = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id)
     VALUES ($1, 'StoryTest', 'K-West') RETURNING id`,
    [slug],
  );
  const feeder = await insertFeeder("feeder", 50);
  const admin = await insertFeeder("admin", 80);
  fx = { dogId: dogRes.rows[0].id, dogSlug: slug, ...feeder, adminId: admin.id, adminToken: admin.token };
});

afterEach(async () => {
  await query(`DELETE FROM trust_events WHERE feeder_id = ANY($1::uuid[])`, [createdFeeders]);
  await query(`DELETE FROM dog_stories WHERE dog_id = $1`, [fx.dogId]);
  await query(`DELETE FROM feeders WHERE id = ANY($1::uuid[])`, [createdFeeders]);
  createdFeeders.length = 0;
  await query(`DELETE FROM dogs WHERE id = $1`, [fx.dogId]);
});

describe("POST /api/v1/dogs/:slug/stories (feeder auth)", () => {
  it("writes v1 then v2 with incrementing per-dog versions", async () => {
    const app = buildServer(config);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "Friendly soul with a happy tail." },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.version).toBe(1);
    expect(first.json().data.paragraph).toBe("Friendly soul with a happy tail.");
    expect(first.json().data.moderatedAt).toBeNull();

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "Update: still the happiest tail on the block." },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.version).toBe(2);

    const rows = await query<{ version: number }>(
      `SELECT version FROM dog_stories WHERE dog_id = $1 ORDER BY version ASC`,
      [fx.dogId],
    );
    expect(rows.rows.map((r) => r.version)).toEqual([1, 2]);

    await app.close();
  });

  it("401s anonymous writers", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      payload: { paragraph: "no auth here" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);
    await app.close();
  });

  it("404s for an unknown dog slug", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${randomSlug()}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "ghost dog" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("rejects an empty or oversized paragraph", async () => {
    const app = buildServer(config);
    const empty = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "" },
    });
    expect(empty.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "x".repeat(2001) },
    });
    expect(oversized.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/v1/dogs/:slug/stories (anon, moderated only)", () => {
  it("hides unmoderated stories and shows them after admin approval", async () => {
    const app = buildServer(config);

    const post = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "Waiting for a green light." },
    });
    const storyId = post.json().data.id as string;

    const hidden = await app.inject({ method: "GET", url: `/api/v1/dogs/${fx.dogSlug}/stories` });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().data.stories).toEqual([]);

    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/moderation/${storyId}/approve`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(approve.statusCode).toBe(200);

    const visible = await app.inject({ method: "GET", url: `/api/v1/dogs/${fx.dogSlug}/stories` });
    expect(visible.statusCode).toBe(200);
    const stories = visible.json().data.stories as Array<{ id: string; version: number; paragraph: string }>;
    expect(stories.length).toBe(1);
    expect(stories[0].id).toBe(storyId);
    expect(stories[0].version).toBe(1);
    expect(stories[0].paragraph).toBe("Waiting for a green light.");

    await app.close();
  });

  it("returns newest first and caps at 3 stories", async () => {
    const app = buildServer(config);
    const ids: string[] = [];
    for (const p of ["first", "second", "third", "fourth"]) {
      const post = await app.inject({
        method: "POST",
        url: `/api/v1/dogs/${fx.dogSlug}/stories`,
        headers: { authorization: `Bearer ${fx.feederToken}` },
        payload: { paragraph: p },
      });
      ids.push(post.json().data.id as string);
      await app.inject({
        method: "POST",
        url: `/api/v1/moderation/${post.json().data.id}/approve`,
        headers: { authorization: `Bearer ${fx.adminToken}` },
      });
    }

    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${fx.dogSlug}/stories` });
    const stories = res.json().data.stories as Array<{ version: number; paragraph: string }>;
    expect(stories.length).toBe(3);
    expect(stories.map((s) => s.paragraph)).toEqual(["fourth", "third", "second"]);
    expect(stories[0].version).toBe(4);

    await app.close();
  });

  it("404s for an unknown dog slug", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${randomSlug()}/stories` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("moderation queue (admin only)", () => {
  it("lists pending stories oldest first for admins", async () => {
    const app = buildServer(config);
    await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "pending one" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "pending two" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/moderation/queue",
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const queue = res.json().data.queue as Array<{ dogSlug: string; version: number; paragraph: string }>;
    expect(queue.length).toBe(2);
    expect(queue[0].version).toBe(1);
    expect(queue[1].version).toBe(2);
    expect(queue.every((q) => q.dogSlug === fx.dogSlug)).toBe(true);

    await app.close();
  });

  it("403s non-admin feeders and 401s anonymous callers", async () => {
    const app = buildServer(config);
    const asFeeder = await app.inject({
      method: "GET",
      url: "/api/v1/moderation/queue",
      headers: { authorization: `Bearer ${fx.feederToken}` },
    });
    expect(asFeeder.statusCode).toBe(403);

    const anon = await app.inject({ method: "GET", url: "/api/v1/moderation/queue" });
    expect(anon.statusCode).toBe(401);
    await app.close();
  });

  it("admin approval makes the story visible to anon GET", async () => {
    const app = buildServer(config);
    const post = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "approved tale" },
    });
    const storyId = post.json().data.id as string;

    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/moderation/${storyId}/approve`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().data.moderatedAt).toBeTruthy();

    const row = await query<{ moderated_at: Date }>(
      `SELECT moderated_at FROM dog_stories WHERE id = $1`,
      [storyId],
    );
    expect(row.rows[0].moderated_at).toBeTruthy();

    const anon = await app.inject({ method: "GET", url: `/api/v1/dogs/${fx.dogSlug}/stories` });
    expect(anon.json().data.stories.some((s: { id: string }) => s.id === storyId)).toBe(true);

    await app.close();
  });

  it("404s when approving or rejecting an unknown story id", async () => {
    const app = buildServer(config);
    const ghost = randomUUID();
    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/moderation/${ghost}/approve`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(approve.statusCode).toBe(404);
    const reject = await app.inject({
      method: "POST",
      url: `/api/v1/moderation/${ghost}/reject`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(reject.statusCode).toBe(404);
    await app.close();
  });
});

describe("admin rejection: full delete + trust penalty", () => {
  it("deletes the story row and writes a -5 trust_event for the author", async () => {
    const app = buildServer(config);
    const post = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "this one gets rejected" },
    });
    expect(post.statusCode).toBe(200);
    const storyId = post.json().data.id as string;

    const reject = await app.inject({
      method: "POST",
      url: `/api/v1/moderation/${storyId}/reject`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().data.deleted).toBe(true);
    expect(reject.json().data.trustDelta).toBe(-5);

    const remaining = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM dog_stories WHERE id = $1`,
      [storyId],
    );
    expect(Number(remaining.rows[0].n)).toBe(0);

    const events = await query<{ feeder_id: string; event_type: string; delta: number; reason: string }>(
      `SELECT feeder_id, event_type, delta, reason FROM trust_events WHERE feeder_id = $1 AND event_type = 'story_rejected'`,
      [fx.feederId],
    );
    expect(events.rows.length).toBe(1);
    expect(events.rows[0].delta).toBe(-5);
    expect(events.rows[0].reason).toBe("story_rejected");

    const feeder = await query<{ trust_score: number }>(`SELECT trust_score FROM feeders WHERE id = $1`, [
      fx.feederId,
    ]);
    expect(feeder.rows[0].trust_score).toBe(45);

    const anon = await app.inject({ method: "GET", url: `/api/v1/dogs/${fx.dogSlug}/stories` });
    expect(anon.json().data.stories).toEqual([]);

    await app.close();
  });

  it("clamps trust_score at 0 when the penalty would go negative", async () => {
    const app = buildServer(config);
    await query(`UPDATE feeders SET trust_score = 2 WHERE id = $1`, [fx.feederId]);

    const post = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${fx.dogSlug}/stories`,
      headers: { authorization: `Bearer ${fx.feederToken}` },
      payload: { paragraph: "low trust feeder" },
    });
    const storyId = post.json().data.id as string;

    const reject = await app.inject({
      method: "POST",
      url: `/api/v1/moderation/${storyId}/reject`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(reject.statusCode).toBe(200);

    const feeder = await query<{ trust_score: number }>(`SELECT trust_score FROM feeders WHERE id = $1`, [
      fx.feederId,
    ]);
    expect(feeder.rows[0].trust_score).toBe(0);

    await app.close();
  });
});
