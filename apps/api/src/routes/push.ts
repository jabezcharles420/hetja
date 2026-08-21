/**
 * Hetja Web Push — subscription storage + the public VAPID key (plan §3).
 *
 * GET  /api/v1/push/vapid-public-key — public. The browser needs the public
 *                                       half to call pushManager.subscribe();
 *                                       the private half never leaves the
 *                                       server (it lives only in env, read
 *                                       directly from process.env here —
 *                                       config.ts is intentionally untouched).
 * POST /api/v1/push/subscribe         — feeder-authed. Upserts a subscription
 *                                       keyed by endpoint: re-subscribing the
 *                                       SAME account's endpoint updates in place
 *                                       rather than duplicating (UNIQUE (endpoint)
 *                                       in 0011_push_subscriptions.sql). The upsert
 *                                       is scoped so it can never re-assign an
 *                                       endpoint owned by a different feeder — a
 *                                       cross-account claim answers 409.
 * POST /api/v1/push/unsubscribe       — feeder-authed. Removes the caller's
 *                                       own subscription for that endpoint —
 *                                       never anyone else's.
 *
 * sos_notifications (see sos.ts) stays a delivery *record*; this table is
 * the credential store. The two are never merged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";

const PushSubscribeInput = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

const PushUnsubscribeInput = z.object({
  endpoint: z.string().url().max(2048),
});

/** Bearer feeder auth, same verification lib.ts already uses elsewhere (sos.ts, scans.ts). */
function requireFeeder(req: FastifyRequest, app: FastifyInstance): string | null {
  const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  if (!rawAuth.startsWith("Bearer ")) return null;
  try {
    return verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub;
  } catch {
    return null;
  }
}

export default async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/push/vapid-public-key", async (_req: FastifyRequest, reply: FastifyReply) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      // Never log the private key; this branch does not touch it at all.
      return reply
        .status(503)
        .send({ ok: false, error: { message: "push not configured", code: "PUSH_NOT_CONFIGURED" } });
    }
    return { ok: true, data: { publicKey } };
  });

  app.post("/api/v1/push/subscribe", async (req: FastifyRequest, reply: FastifyReply) => {
    const feederId = requireFeeder(req, app);
    if (!feederId) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "feeder auth required", code: "UNAUTHENTICATED" } });
    }
    const parsed = PushSubscribeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid push subscription", code: "INVALID_PUSH_SUBSCRIPTION" } });
    }
    const { endpoint, keys } = parsed.data;
    // The upsert is SCOPED so it cannot change ownership: `DO UPDATE` carries
    // a WHERE requiring the conflicting row to already belong to the caller,
    // so `feeder_id` is never rewritten. Without that scope, anyone who
    // learned another feeder's endpoint URL (it appears in push-service
    // delivery logs and is not a secret) could re-assign the subscription to
    // themselves with one request — and from then on receive that feeder's
    // SOS pushes: their locations, their dogs, their emergencies.
    await query(
      `INSERT INTO push_subscriptions (feeder_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
         WHERE push_subscriptions.feeder_id = EXCLUDED.feeder_id`,
      [feederId, endpoint, keys.p256dh, keys.auth],
    );
    // When the WHERE above suppressed the update (endpoint owned by someone
    // else), PostgreSQL reports success with zero changes — so ownership is
    // verified rather than assumed, and a would-be thief gets an explicit
    // conflict instead of a silent no-op.
    const owner = await query<{ feeder_id: string }>(
      `SELECT feeder_id FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint],
    );
    if (owner.rows[0]?.feeder_id !== feederId) {
      return reply.status(409).send({
        ok: false,
        error: {
          message: "this subscription endpoint is registered to another account",
          code: "PUSH_ENDPOINT_OWNED",
        },
      });
    }
    return { ok: true, data: { subscribed: true } };
  });

  app.post("/api/v1/push/unsubscribe", async (req: FastifyRequest, reply: FastifyReply) => {
    const feederId = requireFeeder(req, app);
    if (!feederId) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "feeder auth required", code: "UNAUTHENTICATED" } });
    }
    const parsed = PushUnsubscribeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid unsubscribe request", code: "INVALID_PUSH_UNSUBSCRIBE" } });
    }
    // Scoped to the caller's own row -- this can never delete a subscription
    // belonging to a different feeder, even if they happen to know the endpoint.
    await query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND feeder_id = $2`, [
      parsed.data.endpoint,
      feederId,
    ]);
    return { ok: true, data: { unsubscribed: true } };
  });
}
