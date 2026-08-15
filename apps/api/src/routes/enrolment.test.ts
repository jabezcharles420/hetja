/**
 * Dog enrolment (admin only).
 *
 * Until this route existed there was NO way to enrol a dog: no endpoint created
 * a `dogs` row or a `collars` row, and the only paths in were a seed script
 * that mints slugs matching no physical collar, or hand-written SQL on the box.
 *
 * These tests care about two things above all:
 *
 *   1. that a non-admin cannot write to the register — it holds the location of
 *      every tagged stray in a city, and the project's own design notes are
 *      explicit that in the wrong hands that is a targeting list;
 *   2. that the URL handed back for etching actually resolves, because a collar
 *      is printed once and glued to an animal. A tag that 404s is discovered by
 *      a stranger standing over an injured dog.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { generateSlug, pool, query } from "@hetja/db";
import type { FastifyInstance } from "fastify";

const config = loadConfig();
let app: FastifyInstance;
let adminToken: string;
let feederToken: string;

/** Creates a feeder with the given role and returns a signed access token. */
async function makeFeeder(role: "admin" | "feeder"): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, $2, $3, 30, '1', false) RETURNING id`,
    [`enrol-test-${randomUUID()}`, `Enrol ${role}`, role],
  );
  return signAccessToken(res.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL);
}

beforeAll(async () => {
  app = buildServer(config);
  await app.ready();
  adminToken = await makeFeeder("admin");
  feederToken = await makeFeeder("feeder");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("POST /api/v1/dogs — access control", () => {
  it("401s with no token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/dogs", payload: { wardId: "K-West" } });
    expect(res.statusCode).toBe(401);
  });

  it("401s with a malformed token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/dogs",
      headers: { authorization: "Bearer garbage" },
      payload: { wardId: "K-West" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for an ordinary feeder — the register is not writable by any signed-in user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/dogs",
      headers: { authorization: `Bearer ${feederToken}` },
      payload: { wardId: "K-West" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("400s on a payload with no ward", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/dogs",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/v1/dogs — enrolment", () => {
  it("creates the dog and its collar, and returns a URL that actually resolves", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/dogs",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { wardId: "K-West", name: "Rosie", sex: "female", approxAge: 3 },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data as { id: string; slug: string; collarUrl: string };

    // A collar row must exist and carry the signature, so verification survives
    // a lost or rotated HETJA_QR_SECRET.
    const collar = await query<{ hmac_sig: string; status: string }>(
      `SELECT c.hmac_sig, c.status FROM collars c WHERE c.qr_code = $1`,
      [data.slug],
    );
    expect(collar.rowCount).toBe(1);
    expect(collar.rows[0].hmac_sig.length).toBeGreaterThan(0);

    // THE ASSERTION THAT MATTERS: take the URL we would etch onto a physical
    // tag, and fetch it. A collar is printed once and glued to an animal; a tag
    // that 404s is found by a stranger standing over an injured dog.
    const url = new URL(data.collarUrl);
    const profile = await app.inject({
      method: "GET",
      url: `/api/v1/dogs/${data.slug}${url.search}`,
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().data.slug).toBe(data.slug);
    expect(profile.json().data.name).toBe("Rosie");
  });

  it("mints a random slug, never a sequential one (INVARIANT 1)", async () => {
    const slugs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/dogs",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { wardId: "L-East" },
      });
      slugs.push((res.json().data as { slug: string }).slug);
    }
    expect(new Set(slugs).size).toBe(3);
    // A sequential scheme would make consecutive slugs adjacent; a random one
    // makes that vanishingly unlikely. Enumerability is the harm INVARIANT 1
    // exists to prevent.
    expect(slugs[0].slice(0, 4)).not.toBe(slugs[1].slice(0, 4));
  });

  it("the returned URL 404s without its signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/dogs",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { wardId: "M-East" },
    });
    const { slug } = res.json().data as { slug: string };
    // Bare slug, no ?s= — this is what a tag printed from the slug alone would
    // produce, and it must not resolve.
    const bare = await app.inject({ method: "GET", url: `/api/v1/dogs/${slug}` });
    expect(bare.statusCode).toBe(404);
  });
});

describe("POST /api/v1/dogs/:slug/collar — re-issue", () => {
  it("keeps the same slug so previously printed tags keep working", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/dogs",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { wardId: "K-West", name: "Bruno" },
    });
    const original = created.json().data as { slug: string; collarUrl: string };

    const reissued = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${original.slug}/collar`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { batchNo: "P2-0007", reason: "tag chewed through" },
    });
    expect(reissued.statusCode).toBe(200);
    const replacement = reissued.json().data as { slug: string; collarUrl: string };

    // The slug identifies the DOG, not the piece of plastic. If a re-issue
    // changed it, every tag already in the field for this dog would go dead.
    expect(replacement.slug).toBe(original.slug);
    expect(replacement.collarUrl).toBe(original.collarUrl);

    const still = await app.inject({
      method: "GET",
      url: `/api/v1/dogs/${original.slug}${new URL(original.collarUrl).search}`,
    });
    expect(still.statusCode).toBe(200);
  });

  it("404s for a well-formed slug that belongs to no dog", async () => {
    // Generated rather than hand-written: the slug carries a check character,
    // so an invented string like "abc234567" is rejected as MALFORMED (400)
    // before existence is ever considered — which would make this test pass for
    // the wrong reason.
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/dogs/${generateSlug()}/collar`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s on a malformed slug, before any lookup", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/dogs/abc234567/collar",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_SLUG");
  });

  it("403s for an ordinary feeder", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/dogs/abc234567/collar",
      headers: { authorization: `Bearer ${feederToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});
