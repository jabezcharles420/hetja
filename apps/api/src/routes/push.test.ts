/**
 * Push subscription storage (plan §3.2/§3.3): POST /api/v1/push/subscribe,
 * POST /api/v1/push/unsubscribe, and the public VAPID key endpoint the
 * client needs before it can call pushManager.subscribe(). Before this
 * route existed, Notification.requestPermission() had nowhere to send its
 * result -- there was no server-side credential store at all.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { query } from "@hetja/db";

const config = loadConfig();

const createdFeeders: string[] = [];

async function makeFeeder(displayName: string): Promise<{ id: string; accessToken: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, $2, 'feeder', 40, 'v1', FALSE) RETURNING id`,
    [randomUUID(), displayName],
  );
  const id = res.rows[0].id;
  createdFeeders.push(id);
  return { id, accessToken: signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL) };
}

afterEach(async () => {
  if (createdFeeders.length > 0) {
    await query(`DELETE FROM push_subscriptions WHERE feeder_id = ANY($1::uuid[])`, [createdFeeders]);
    await query(`DELETE FROM feeders WHERE id = ANY($1::uuid[])`, [createdFeeders]);
    createdFeeders.length = 0;
  }
});

describe("GET /api/v1/push/vapid-public-key", () => {
  it("returns the configured public key", async () => {
    const prev = process.env.VAPID_PUBLIC_KEY;
    process.env.VAPID_PUBLIC_KEY = "test-public-key-value";
    try {
      const app = buildServer(config);
      const res = await app.inject({ method: "GET", url: "/api/v1/push/vapid-public-key" });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(res.json().data.publicKey).toBe("test-public-key-value");
      await app.close();
    } finally {
      if (prev === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = prev;
    }
  });

  it("503s when push is not configured, and never touches the private key", async () => {
    const prev = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    try {
      const app = buildServer(config);
      const res = await app.inject({ method: "GET", url: "/api/v1/push/vapid-public-key" });
      expect(res.statusCode).toBe(503);
      expect(res.json().ok).toBe(false);
      await app.close();
    } finally {
      if (prev === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = prev;
    }
  });
});

describe("POST /api/v1/push/subscribe", () => {
  it("stores a new subscription for the authenticated feeder", async () => {
    const feeder = await makeFeeder("Push Subscriber");
    const app = buildServer(config);
    const endpoint = `https://push.example.com/ep/${randomUUID()}`;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { authorization: `Bearer ${feeder.accessToken}` },
      payload: { endpoint, keys: { p256dh: "p256dh-value", auth: "auth-value" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const row = await query<{ feeder_id: string; p256dh: string; auth: string }>(
      `SELECT feeder_id, p256dh, auth FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].feeder_id).toBe(feeder.id);
    expect(row.rows[0].p256dh).toBe("p256dh-value");
    expect(row.rows[0].auth).toBe("auth-value");

    await app.close();
  });

  it("upserts on endpoint for the SAME owner -- re-subscribing does not duplicate or change ownership", async () => {
    const owner = await makeFeeder("Original Owner");
    const app = buildServer(config);
    const endpoint = `https://push.example.com/ep/${randomUUID()}`;

    const firstRes = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { endpoint, keys: { p256dh: "p1", auth: "a1" } },
    });
    expect(firstRes.statusCode).toBe(200);

    const secondRes = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { endpoint, keys: { p256dh: "p2", auth: "a2" } },
    });
    expect(secondRes.statusCode).toBe(200);

    const rows = await query<{ feeder_id: string; p256dh: string }>(
      `SELECT feeder_id, p256dh FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].feeder_id).toBe(owner.id);
    expect(rows.rows[0].p256dh).toBe("p2");

    await app.close();
  });

  it("refuses to re-assign an endpoint owned by another feeder (subscription theft)", async () => {
    // The unscoped upsert let anyone who learned another feeder's endpoint URL
    // reassign that subscription to themselves with one request — and then
    // receive their SOS pushes. Ownership is now frozen at first claim; a
    // cross-account subscriber gets an explicit 409 rather than a silent
    // no-op, and the row is left untouched.
    const owner = await makeFeeder("Rightful Owner");
    const attacker = await makeFeeder("Attacker");
    const app = buildServer(config);
    const endpoint = `https://push.example.com/ep/${randomUUID()}`;

    await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { endpoint, keys: { p256dh: "p-owner", auth: "a-owner" } },
    });

    const steal = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { authorization: `Bearer ${attacker.accessToken}` },
      payload: { endpoint, keys: { p256dh: "p-attacker", auth: "a-attacker" } },
    });
    expect(steal.statusCode).toBe(409);
    expect(steal.json().error.code).toBe("PUSH_ENDPOINT_OWNED");

    const rows = await query<{ feeder_id: string; p256dh: string; auth: string }>(
      `SELECT feeder_id, p256dh, auth FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].feeder_id).toBe(owner.id);
    // Keys are untouched too: nothing about the subscription changed.
    expect(rows.rows[0].p256dh).toBe("p-owner");
    expect(rows.rows[0].auth).toBe("a-owner");

    await app.close();
  });

  it("401s without feeder auth", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      payload: { endpoint: "https://push.example.com/ep/x", keys: { p256dh: "p", auth: "a" } },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("400s on a malformed subscription body", async () => {
    const feeder = await makeFeeder("Bad Body");
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { authorization: `Bearer ${feeder.accessToken}` },
      payload: { endpoint: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /api/v1/push/unsubscribe", () => {
  it("removes only the caller's own subscription, never someone else's", async () => {
    const owner = await makeFeeder("Owner");
    const stranger = await makeFeeder("Stranger");
    const app = buildServer(config);
    const endpoint = `https://push.example.com/ep/${randomUUID()}`;

    await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { endpoint, keys: { p256dh: "p", auth: "a" } },
    });

    const strangerAttempt = await app.inject({
      method: "POST",
      url: "/api/v1/push/unsubscribe",
      headers: { authorization: `Bearer ${stranger.accessToken}` },
      payload: { endpoint },
    });
    expect(strangerAttempt.statusCode).toBe(200);
    const stillThere = await query(`SELECT 1 FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    expect(stillThere.rows.length).toBe(1);

    const ownerAttempt = await app.inject({
      method: "POST",
      url: "/api/v1/push/unsubscribe",
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { endpoint },
    });
    expect(ownerAttempt.statusCode).toBe(200);
    const gone = await query(`SELECT 1 FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    expect(gone.rows.length).toBe(0);

    await app.close();
  });

  it("401s without feeder auth", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/push/unsubscribe",
      payload: { endpoint: "https://push.example.com/ep/x" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
