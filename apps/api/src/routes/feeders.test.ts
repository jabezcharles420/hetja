/**
 * Design-v4 read endpoints:
 *
 *   GET /api/v1/feeders/me/dogs   the caller's own fed dogs, no coordinates
 *   GET /api/v1/wards             the static 24-ward list
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { BMC_WARD_CODES } from "@hetja/contracts";
import { query, generateSlug } from "@hetja/db";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";

const config = loadConfig();

let app: FastifyInstance;
const feeders: string[] = [];
const dogs: string[] = [];

async function insertFeeder(): Promise<{ id: string; auth: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version)
     VALUES ($1, 'MyDogsTest', 'feeder', 30, 'v1.0') RETURNING id`,
    [`my-dogs-${randomUUID()}`],
  );
  const id = res.rows[0].id;
  feeders.push(id);
  return { id, auth: `Bearer ${signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL)}` };
}

async function insertDog(name: string, wardId: string): Promise<{ id: string; slug: string }> {
  const slug = generateSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, last_seen_geo)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(72.8361, 19.1197), 4326)::geography) RETURNING id`,
    [slug, name, wardId],
  );
  dogs.push(res.rows[0].id);
  return { id: res.rows[0].id, slug };
}

async function feed(dogId: string, feederId: string | null, capturedAt: string, type = "feed"): Promise<void> {
  await query(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, feeder_id, geo, captured_at, received_at, review_status)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(72.8361, 19.1197), 4326)::geography, $5, now(), 'pending')`,
    [dogId, randomUUID(), type, feederId, capturedAt],
  );
}

beforeEach(async () => {
  app = buildServer(config);
  await app.ready();
});

afterEach(async () => {
  for (const id of dogs.splice(0)) {
    await query(`DELETE FROM scans WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM dogs WHERE id = $1`, [id]);
  }
  for (const id of feeders.splice(0)) {
    await query(`DELETE FROM scans WHERE feeder_id = $1`, [id]);
    await query(`DELETE FROM feeders WHERE id = $1`, [id]);
  }
  await app.close();
});

describe("GET /api/v1/feeders/me/dogs", () => {
  it("lists distinct dogs from the caller's own feeds, most recent first, with no coordinates", async () => {
    const me = await insertFeeder();
    const other = await insertFeeder();
    const bruno = await insertDog("Bruno", "K-West");
    const kalu = await insertDog("Kalu", "H-West");
    const notMine = await insertDog("Stranger", "A");

    await feed(bruno.id, me.id, "2026-09-10T06:00:00.000Z");
    await feed(bruno.id, me.id, "2026-09-12T06:00:00.000Z");
    await feed(kalu.id, me.id, "2026-09-11T06:00:00.000Z");
    // Someone else fed Kalu later: lastFedAt reflects it, the order does not.
    await feed(kalu.id, other.id, "2026-09-13T06:00:00.000Z");
    await feed(notMine.id, other.id, "2026-09-14T06:00:00.000Z");
    // A view scan by me is not a feed.
    await feed(notMine.id, me.id, "2026-09-15T06:00:00.000Z", "view");

    const res = await app.inject({ method: "GET", url: "/api/v1/feeders/me/dogs", headers: { authorization: me.auth } });
    expect(res.statusCode).toBe(200);
    const list = res.json().data.dogs as Array<Record<string, unknown>>;
    expect(list.map((d) => d.slug)).toEqual([bruno.slug, kalu.slug]);
    expect(list[0]).toEqual({
      slug: bruno.slug,
      name: "Bruno",
      wardId: "K-West",
      wardName: "Andheri West",
      lastFedAt: "2026-09-12T06:00:00.000Z",
      myLastFedAt: "2026-09-12T06:00:00.000Z",
    });
    expect(list[1].lastFedAt).toBe("2026-09-13T06:00:00.000Z");
    expect(list[1].myLastFedAt).toBe("2026-09-11T06:00:00.000Z");

    // No position of any kind, and nothing about the other feeder.
    expect(res.body).not.toMatch(/"(lat|lng|geo)"/);
    expect(res.body).not.toContain(other.id);
  });

  it("returns an empty list for a feeder with no feeds, and 401 without auth", async () => {
    const me = await insertFeeder();
    const res = await app.inject({ method: "GET", url: "/api/v1/feeders/me/dogs", headers: { authorization: me.auth } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.dogs).toEqual([]);

    const anon = await app.inject({ method: "GET", url: "/api/v1/feeders/me/dogs" });
    expect(anon.statusCode).toBe(401);
  });

  it("caps the list at 50", async () => {
    const me = await insertFeeder();
    const base = Date.parse("2026-09-01T00:00:00.000Z");
    for (let i = 0; i < 52; i++) {
      const dog = await insertDog(`Dog${i}`, "T");
      await feed(dog.id, me.id, new Date(base + i * 60_000).toISOString());
    }
    const res = await app.inject({ method: "GET", url: "/api/v1/feeders/me/dogs", headers: { authorization: me.auth } });
    const list = res.json().data.dogs as Array<{ name: string }>;
    expect(list).toHaveLength(50);
    expect(list[0].name).toBe("Dog51");
  });
});

describe("GET /api/v1/wards", () => {
  it("returns all 24 wards as { id, code, name }, publicly cacheable", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/wards" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    const wards = res.json().data.wards as Array<{ id: string; code: string; name: string }>;
    expect(wards.map((w) => w.id)).toEqual([...BMC_WARD_CODES]);
    expect(wards.find((w) => w.id === "K-West")).toEqual({ id: "K-West", code: "K/W", name: "Andheri West" });
    expect(wards.find((w) => w.id === "A")).toEqual({ id: "A", code: "A", name: "Colaba, Fort" });
    for (const w of wards) expect(w.name.length).toBeGreaterThan(0);
  });
});

describe("PATCH /api/v1/feeders/me homeWard (map: Get alerts for a ward)", () => {
  it("sets a canonical ward with SOS opt-in in one call, and GET /me reads it back", async () => {
    const me = await insertFeeder();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/feeders/me",
      headers: { authorization: me.auth },
      payload: { homeWard: "K-West", sosOptIn: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ homeWard: "K-West", sosOptIn: true });

    const row = await query<{ home_ward: string | null; sos_opt_in: boolean }>(
      `SELECT home_ward, sos_opt_in FROM feeders WHERE id = $1`,
      [me.id],
    );
    expect(row.rows[0]).toEqual({ home_ward: "K-West", sos_opt_in: true });

    const got = await app.inject({ method: "GET", url: "/api/v1/feeders/me", headers: { authorization: me.auth } });
    expect(got.json().data.homeWard).toBe("K-West");
  });

  it("clears it with null", async () => {
    const me = await insertFeeder();
    await query(`UPDATE feeders SET home_ward = 'A' WHERE id = $1`, [me.id]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/feeders/me",
      headers: { authorization: me.auth },
      payload: { homeWard: null },
    });
    expect(res.statusCode).toBe(200);
    const row = await query<{ home_ward: string | null }>(`SELECT home_ward FROM feeders WHERE id = $1`, [me.id]);
    expect(row.rows[0].home_ward).toBeNull();
  });

  it("rejects the display form, free text and non-strings with a 400, writing nothing", async () => {
    const me = await insertFeeder();
    for (const homeWard of ["K/W", "Andheri West", "kwest", "", 7]) {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/feeders/me",
        headers: { authorization: me.auth },
        payload: { homeWard },
      });
      expect(res.statusCode).toBe(400);
    }
    const row = await query<{ home_ward: string | null }>(`SELECT home_ward FROM feeders WHERE id = $1`, [me.id]);
    expect(row.rows[0].home_ward).toBeNull();
    expect(BMC_WARD_CODES).toContain("K-West");
  });

  it("still needs a signed-in feeder", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/feeders/me", payload: { homeWard: "A" } });
    expect(res.statusCode).toBe(401);
  });
});
