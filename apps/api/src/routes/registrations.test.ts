/**
 * Self-serve registration (wave 6) — routes/registrations.ts + the activation
 * and corroboration halves of routes/scans.ts.
 *
 * Patterned on enrolment.test.ts, and like it this file cares most about the
 * PHYSICAL OBJECT: one test takes the collarUrl out of the 201 response and
 * fetches it, because a tag is printed once and glued to an animal, and a URL
 * that 404s is discovered by a stranger standing over a dog.
 *
 * The rest of the matrix maps the abuse model one-to-one: a plain feeder gets
 * nothing; a disabled account gets nothing; two pending registrations are the
 * ceiling per ACCOUNT and per DEVICE; and the inert-until-scanned lifecycle —
 * pending → activated by the first geotagged scan of anyone → corroborated by
 * a second distinct subject — including the replay and expired-tag corners.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { issueDeviceToken } from "../lib/device.js";
import { pool, query } from "@hetja/db";
import type { FastifyInstance } from "fastify";

const config = loadConfig();
let app: FastifyInstance;

interface TestFeeder {
  id: string;
  token: string;
}

/** Creates a feeder with the given role and returns its id + a signed token. */
async function makeFeeder(role: "admin" | "feeder" | "registrator"): Promise<TestFeeder> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, $2, $3, 30, '1', false) RETURNING id`,
    [`reg-test-${randomUUID()}`, `Reg ${role}`, role],
  );
  const id = res.rows[0].id;
  return { id, token: signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL) };
}

/** Removes every row a test dog accumulated (scans first: they reference it). */
async function destroyDog(slug: string): Promise<void> {
  await query(
    `DELETE FROM scans WHERE dog_id IN (SELECT id FROM dogs WHERE slug = $1)`,
    [slug],
  );
  await query(`DELETE FROM collars WHERE dog_id IN (SELECT id FROM dogs WHERE slug = $1)`, [slug]);
  await query(`DELETE FROM dogs WHERE slug = $1`, [slug]);
}

const slugsToClean: string[] = [];

afterEach(async () => {
  while (slugsToClean.length) {
    await destroyDog(slugsToClean.pop() as string);
  }
});

beforeAll(async () => {
  app = buildServer(config);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

/** Registers a dog for `feeder` using `deviceToken`; returns the 201 body. */
async function register(feederToken: string, deviceToken: string, wardId = "K-West") {
  return app.inject({
    method: "POST",
    url: "/api/v1/registrations",
    headers: {
      authorization: `Bearer ${feederToken}`,
      "x-device-token": deviceToken,
    },
    payload: { wardId },
  });
}

describe("POST /api/v1/registrations — access control", () => {
  it("401s with no token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/registrations",
      payload: { wardId: "K-West" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a plain feeder — the register capability is not everyone's", async () => {
    const feeder = await makeFeeder("feeder");
    // Even WITH a valid attested device: the capability gate binds first, so
    // possession of a PoW token alone buys no step toward minting identifiers.
    const res = await register(feeder.token, issueDeviceToken(config.HETJA_DEVICE_SECRET));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("401s for a registrator with no attested device token", async () => {
    const registrator = await makeFeeder("registrator");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/registrations",
      headers: { authorization: `Bearer ${registrator.token}` },
      payload: { wardId: "K-West" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED_DEVICE");
  });

  it("401s for a registrator with a forged device token", async () => {
    const registrator = await makeFeeder("registrator");
    const res = await register(registrator.token, "not-a-real-token.sig");
    expect(res.statusCode).toBe(401);
  });

  it("400s on a non-canonical ward — free-text wards are how the heatmap goes blind", async () => {
    const registrator = await makeFeeder("registrator");
    const res = await register(
      registrator.token,
      issueDeviceToken(config.HETJA_DEVICE_SECRET),
      "kwest" as string,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REGISTRATION");
  });
});

describe("POST /api/v1/registrations — the mint", () => {
  it("creates an inert registration whose printed URL resolves — the assertion that protects a physical object", async () => {
    const registrator = await makeFeeder("registrator");
    const res = await register(
      registrator.token,
      issueDeviceToken(config.HETJA_DEVICE_SECRET),
    );
    expect(res.statusCode).toBe(201);

    const data = res.json().data as {
      slug: string;
      status: string;
      wardId: string;
      registeredAt: string;
      expiresAt: string;
      collarUrl: string;
      budget: { pending: number; max: number };
    };
    slugsToClean.push(data.slug);

    // Born inert: visible to nobody until a geotagged scan proves presence.
    expect(data.status).toBe("pending_activation");
    expect(data.wardId).toBe("K-West");
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(new Date(data.registeredAt).getTime());
    expect(data.budget).toEqual({ pending: 1, max: 2 });

    // The signature lives on the collar row too, so verification survives a
    // lost or rotated HETJA_QR_SECRET.
    const collar = await query<{ hmac_sig: string }>(
      `SELECT c.hmac_sig FROM collars c JOIN dogs d ON d.id = c.dog_id WHERE d.slug = $1`,
      [data.slug],
    );
    expect(collar.rowCount).toBe(1);
    expect(collar.rows[0].hmac_sig.length).toBeGreaterThan(0);

    // THE ASSERTION THAT MATTERS: take the exact URL we would etch onto the
    // tag and fetch it. A collar is printed once and glued to an animal; a
    // tag that 404s is found by a stranger standing over an injured dog.
    const url = new URL(data.collarUrl);
    const profile = await app.inject({
      method: "GET",
      url: `/api/v1/dogs/${data.slug}${url.search}`,
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().data.status).toBe("pending_activation");

    // And the print page's own door returns the same signed URL, behind auth.
    const print = await app.inject({
      method: "GET",
      url: `/api/v1/registrations/${data.slug}`,
      headers: { authorization: `Bearer ${registrator.token}` },
    });
    expect(print.statusCode).toBe(200);
    expect(print.json().data.collarUrl).toBe(data.collarUrl);
  });

  it("the dog carries the canonical device subject, never the bearer token", async () => {
    const registrator = await makeFeeder("registrator");
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const res = await register(registrator.token, token);
    const { slug } = res.json().data as { slug: string };
    slugsToClean.push(slug);

    // Same rule as scans.device_token: the stored value must be the derived
    // deviceId (deviceTokenSubject's return), so a leak of this column hands
    // over no replayable credential — and no padded/punctuated token variant
    // can mint a second budget subject.
    const row = await query<{ registered_device_id: string; sos_eligible_at: Date | null }>(
      `SELECT registered_device_id, sos_eligible_at FROM dogs WHERE slug = $1`,
      [slug],
    );
    const canonicalSubject = Buffer.from(token.split(".")[0], "base64url").toString("utf8");
    expect(row.rows[0].registered_device_id).toBe(canonicalSubject);
    expect(row.rows[0].registered_device_id).not.toContain(".");
    expect(row.rows[0].registered_device_id).not.toBe(token);
    expect(row.rows[0].sos_eligible_at).toBeNull();
  });

  it("429s on a third pending registration for the same ACCOUNT", async () => {
    const registrator = await makeFeeder("registrator");
    const tokenA = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const tokenB = issueDeviceToken(config.HETJA_DEVICE_SECRET);

    expect((await register(registrator.token, tokenA)).statusCode).toBe(201);
    expect((await register(registrator.token, tokenB)).statusCode).toBe(201);
    // Fresh device, same account: the ACCOUNT budget is what binds here.
    const third = await register(registrator.token, issueDeviceToken(config.HETJA_DEVICE_SECRET));
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe("REGISTRATION_BUDGET_EXCEEDED");

    const pendings = await query<{ slug: string }>(
      `SELECT slug FROM dogs WHERE registered_by = $1 AND status = 'pending_activation'`,
      [registrator.id],
    );
    for (const row of pendings.rows) slugsToClean.push(row.slug);
  });

  it("429s on a third pending registration for the same DEVICE — ten aliases buy nothing", async () => {
    // Account A fills ITS budget on device X; account B — brand new, zero
    // registrations of its own — then presents the SAME device X and is told
    // the phone, not the inbox, is out of budget.
    const accountA = await makeFeeder("registrator");
    const sharedToken = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    expect((await register(accountA.token, sharedToken)).statusCode).toBe(201);
    expect((await register(accountA.token, sharedToken)).statusCode).toBe(201);

    const accountB = await makeFeeder("registrator");
    const res = await register(accountB.token, sharedToken);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("DEVICE_REGISTRATION_BUDGET_EXCEEDED");

    const pendings = await query<{ slug: string }>(
      `SELECT slug FROM dogs WHERE registered_by = $1 AND status = 'pending_activation'`,
      [accountA.id],
    );
    for (const row of pendings.rows) slugsToClean.push(row.slug);
  });

  it("403s REGISTRATION_DISABLED when the operator flag is off — without touching the role", async () => {
    const registrator = await makeFeeder("registrator");
    await query(`UPDATE feeders SET can_register = FALSE WHERE id = $1`, [registrator.id]);

    const res = await register(registrator.token, issueDeviceToken(config.HETJA_DEVICE_SECRET));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("REGISTRATION_DISABLED");

    // The point of the separate flag: the account keeps its registrator
    // surface, streak and trust. Only the write is refused.
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/feeders/me",
      headers: { authorization: `Bearer ${registrator.token}` },
    });
    expect(me.json().data.role).toBe("registrator");
    expect(me.json().data.canRegister).toBe(false);
  });
});

describe("GET /api/v1/registrations — my registrations", () => {
  it("lists only the caller's registrations, with no coordinates anywhere", async () => {
    const mine = await makeFeeder("registrator");
    const theirs = await makeFeeder("registrator");

    const r1 = await register(mine.token, issueDeviceToken(config.HETJA_DEVICE_SECRET), "M-West");
    const r2 = await register(theirs.token, issueDeviceToken(config.HETJA_DEVICE_SECRET));
    slugsToClean.push((r1.json().data as { slug: string }).slug);
    slugsToClean.push((r2.json().data as { slug: string }).slug);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/registrations",
      headers: { authorization: `Bearer ${mine.token}` },
    });
    expect(res.statusCode).toBe(200);
    const registrations = res.json().data.registrations as Array<{
      slug: string;
      status: string;
      wardId: string;
    }>;
    expect(registrations).toHaveLength(1);
    expect(registrations[0].wardId).toBe("M-West");
    expect(registrations[0].status).toBe("pending_activation");

    // INVARIANT 2 is not engaged on this route BY CONSTRUCTION: no coordinate
    // field may exist anywhere in the payload, so there is nothing to coarsen
    // and nothing to leak by forgetting to.
    expect(JSON.stringify(res.json())).not.toMatch(/"(lat|lng|latitude|longitude|geo)"/i);
  });

  it("403s NOT_YOUR_REGISTRATION for another registrator — self-election grants no authority over others", async () => {
    const owner = await makeFeeder("registrator");
    const stranger = await makeFeeder("registrator");
    const created = await register(owner.token, issueDeviceToken(config.HETJA_DEVICE_SECRET));
    const { slug } = created.json().data as { slug: string };
    slugsToClean.push(slug);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/registrations/${slug}`,
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_YOUR_REGISTRATION");

    // …but the enrolment desk (admin holds `enrol`) can still read any
    // registration — support and audit need the door the public lacks.
    const admin = await makeFeeder("admin");
    const adminView = await app.inject({
      method: "GET",
      url: `/api/v1/registrations/${slug}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(adminView.statusCode).toBe(200);
    expect(adminView.json().data.collarUrl).toBeTruthy();
  });
});

describe("POST /api/v1/feeders/me/surface — self-election", () => {
  it("a plain feeder becomes a registrator and can immediately register", async () => {
    const feeder = await makeFeeder("feeder");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/feeders/me/surface",
      headers: { authorization: `Bearer ${feeder.token}` },
      payload: { surface: "register" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe("registrator");
    expect(res.json().data.capabilities).toContain("register");

    // Live role read means the very next write succeeds with no re-login.
    const created = await register(feeder.token, issueDeviceToken(config.HETJA_DEVICE_SECRET));
    expect(created.statusCode).toBe(201);
    slugsToClean.push((created.json().data as { slug: string }).slug);
  });

  it("re-electing as a registrator is idempotent success, not an error", async () => {
    const registrator = await makeFeeder("registrator");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/feeders/me/surface",
      headers: { authorization: `Bearer ${registrator.token}` },
      payload: { surface: "register" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe("registrator");
  });

  it("409s ROLE_NOT_ELECTABLE for roles that already hold the capability — electing would demote them", async () => {
    const admin = await makeFeeder("admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/feeders/me/surface",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { surface: "register" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ROLE_NOT_ELECTABLE");
  });

  it("400s on an unknown surface", async () => {
    const feeder = await makeFeeder("feeder");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/feeders/me/surface",
      headers: { authorization: `Bearer ${feeder.token}` },
      payload: { surface: "moderation" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("activation + corroboration (routes/scans.ts)", () => {
  /** Files a registration and returns the slug (tracked for cleanup). */
  async function registerDog(wardId = "S"): Promise<string> {
    const owner = await makeFeeder("registrator");
    const res = await register(owner.token, issueDeviceToken(config.HETJA_DEVICE_SECRET), wardId);
    expect(res.statusCode).toBe(201);
    const { slug } = res.json().data as { slug: string };
    slugsToClean.push(slug);
    return slug;
  }

  async function dogState(slug: string) {
    const res = await query<{
      status: string;
      activated_at: Date | null;
      activation_scan_id: string | null;
      sos_eligible_at: Date | null;
    }>(
      `SELECT status, activated_at, activation_scan_id, sos_eligible_at FROM dogs WHERE slug = $1`,
      [slug],
    );
    return res.rows[0];
  }

  interface ScanOpts {
    geo?: { lat: number; lng: number };
  }

  /** Posts a retag scan against the dog, as an authenticated feeder. */
  async function retagAsFeeder(slug: string, feederToken: string, opts: ScanOpts = {}) {
    return app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: `Bearer ${feederToken}` },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: slug,
        type: "retag",
        ...(opts.geo ? { geo: opts.geo } : {}),
        capturedAt: new Date().toISOString(),
      },
    });
  }

  /** Posts a retag scan as an anonymous-but-attested device. */
  async function retagAsDevice(slug: string, deviceToken: string, opts: ScanOpts = {}) {
    return app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": deviceToken },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: slug,
        type: "retag",
        ...(opts.geo ? { geo: opts.geo } : {}),
        capturedAt: new Date().toISOString(),
      },
    });
  }

  const MUMBAI = { lat: 19.076, lng: 72.8777 };

  it("an ungeotagged retag does NOT activate; a geotagged one by ANYONE does", async () => {
    const slug = await registerDog();

    // Presence is the anti-abuse value: a scan with no location proves a
    // camera, not a person standing next to the dog.
    await retagAsFeeder(slug, (await makeFeeder("feeder")).token);
    let state = await dogState(slug);
    expect(state.status).toBe("pending_activation");
    expect(state.activated_at).toBeNull();

    // A DIFFERENT person's geotagged scan activates — identity is not the
    // gate, physical presence is (and registered_by can be NULL post-erasure).
    const stranger = await makeFeeder("feeder");
    const activating = await retagAsFeeder(slug, stranger.token, { geo: MUMBAI });
    expect(activating.statusCode).toBe(200);
    expect(activating.json().data.created).toBe(true);

    state = await dogState(slug);
    expect(state.status).toBe("active");
    expect(state.activated_at).not.toBeNull();
    expect(state.activation_scan_id).not.toBeNull();
  });

  it("a device-token scan also activates — the attested phone standing there counts", async () => {
    const slug = await registerDog();
    const res = await retagAsDevice(slug, issueDeviceToken(config.HETJA_DEVICE_SECRET), {
      geo: MUMBAI,
    });
    expect(res.json().data.created).toBe(true);
    expect((await dogState(slug)).status).toBe("active");
  });

  it("a replayed scan yields created:false and never re-stamps activated_at", async () => {
    const slug = await registerDog();
    const payload = {
      clientUuid: randomUUID(),
      dogSlug: slug,
      type: "retag" as const,
      geo: MUMBAI,
      capturedAt: new Date().toISOString(),
    };
    const headers = { "x-device-token": issueDeviceToken(config.HETJA_DEVICE_SECRET) };

    await app.inject({ method: "POST", url: "/api/v1/scans", headers, payload });
    const first = await dogState(slug);
    expect(first.status).toBe("active");

    // INVARIANT 5's replay path: the second presentation must be a no-op for
    // the lifecycle stamps, not a fresh activation event.
    await app.inject({ method: "POST", url: "/api/v1/scans", headers, payload });
    expect((await dogState(slug)).activated_at?.getTime()).toBe(first.activated_at?.getTime());
  });

  it("one distinct subject leaves sos_eligible_at NULL; a second sets it — once", async () => {
    const slug = await registerDog();

    // Subject #1 (a device): activates the dog, but one phone is not
    // corroboration — the SOS fan-out must stay off.
    await retagAsDevice(slug, issueDeviceToken(config.HETJA_DEVICE_SECRET), { geo: MUMBAI });
    let state = await dogState(slug);
    expect(state.sos_eligible_at).toBeNull();

    // Subject #2 (a feeder account): two independent witnesses.
    await retagAsFeeder(slug, (await makeFeeder("feeder")).token, { geo: MUMBAI });
    state = await dogState(slug);
    expect(state.sos_eligible_at).not.toBeNull();
    const stampedAt = state.sos_eligible_at?.getTime();

    // Set once, NEVER cleared or re-stamped — more scans change nothing.
    await retagAsFeeder(slug, (await makeFeeder("admin")).token, { geo: MUMBAI });
    expect((await dogState(slug)).sos_eligible_at?.getTime()).toBe(stampedAt);
  });

  it("a verified feeder alone corroborates — one trusted witness suffices", async () => {
    const slug = await registerDog();
    const verifier = await makeFeeder("feeder");
    // What cli/grant-verified.ts writes from the box; done inline here so the
    // test exercises the corroboration predicate, not the CLI plumbing.
    await query(`UPDATE feeders SET verification_tier = 'verified' WHERE id = $1`, [verifier.id]);

    await retagAsFeeder(slug, verifier.token, { geo: MUMBAI });
    expect((await dogState(slug)).sos_eligible_at).not.toBeNull();
  });

  it("an EXPIRED tag reactivates on a geotagged scan — day-32 attach beats day-30 expiry", async () => {
    const slug = await registerDog();

    // What the wave-9 expiry sweep will do to a pending registration past its
    // window (dogs_pending_expiry_ix finds these).
    await query(`UPDATE dogs SET status = 'expired' WHERE slug = $1`, [slug]);

    // "Never reused" forbids giving the slug to a DIFFERENT dog; the SAME dog
    // showing up late gets its row back.
    await retagAsDevice(slug, issueDeviceToken(config.HETJA_DEVICE_SECRET), { geo: MUMBAI });
    const state = await dogState(slug);
    expect(state.status).toBe("active");
    expect(state.activated_at).not.toBeNull();
  });

  it("the pending dog is absent from GET /heatmap before activation and stays k-anonymous after", async () => {
    const slug = await registerDog("T");

    async function cellCount(): Promise<number> {
      const res = await app.inject({ method: "GET", url: "/api/v1/heatmap?ward=T&days=7" });
      expect(res.statusCode).toBe(200);
      return (res.json().data.cells as unknown[]).length;
    }

    // Pending: excluded by the heatmap's `d.status = 'active'` join predicate
    // with ZERO code changes — the whole reason this shipped as a status VALUE.
    expect(await cellCount()).toBe(0);

    // Activate it and give it a real geotagged feed: the dog is now active and
    // scanned, yet still yields no cell — k-anonymity (≥3 dogs) holds, and a
    // pending population could only ever have reduced counts, never raised
    // them.
    const feeder = await makeFeeder("feeder");
    const feed = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: `Bearer ${feeder.token}` },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: slug,
        type: "feed",
        geo: MUMBAI,
        capturedAt: new Date().toISOString(),
      },
    });
    expect(feed.json().data.created).toBe(true);
    expect(await cellCount()).toBe(0);
  });
});
