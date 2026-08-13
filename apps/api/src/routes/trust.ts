/**
 * Hetja TRUST endpoints (feeder-authed).
 *
 * POST /api/v1/trust/events      — log a trust event (event_type from the
 *   TRUST_EVENTS catalog, delta derived from the catalog) with a reason.
 * POST /api/v1/trust/disputes    — {eventId, reason}: sets the event's
 *   dispute_state='open' and reverses its delta exactly via a reversing
 *   event (reverses_event_id).
 * GET  /api/v1/feeders/:id/trust — self-service: score + verification tier +
 *   pause state + recent events. Also triggers the INVARIANT 15 gate.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTx } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";
import {
  TRUST_EVENTS,
  TrustError,
  type TrustEventRow,
  getFeederTrust,
  logTrustEvent,
  openDispute,
  recomputeScore,
  type TrustEventType,
} from "../lib/trust.js";

const TrustEventInput = z.object({
  eventType: z.string().min(1).max(64),
  reason: z.string().min(1).max(200),
  refScanId: z.string().uuid().optional(),
});

const DisputeInput = z.object({
  eventId: z.string().uuid(),
  reason: z.string().min(1).max(200),
});

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

function sendTrustError(reply: FastifyReply, err: unknown): void {
  if (err instanceof TrustError) {
    void reply.status(err.status).send({ ok: false, error: { message: err.message, code: err.code } });
    return;
  }
  throw err;
}

function toEventPayload(row: TrustEventRow) {
  return {
    id: row.id,
    eventType: row.event_type,
    delta: row.delta,
    reason: row.reason,
    refScanId: row.ref_scan_id ?? undefined,
    reversesEventId: row.reverses_event_id ?? undefined,
    disputeState: row.dispute_state,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export default async function trustRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/trust/events", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = feederAuth(req, reply);
    if (!auth) return reply;

    const parsed = TrustEventInput.safeParse(req.body);
    if (!parsed.success || !(parsed.data.eventType in TRUST_EVENTS)) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "unknown or invalid trust event type", code: "INVALID_TRUST_EVENT" } });
    }
    const { eventType, reason, refScanId } = parsed.data;

    const { event, score } = await withTx(async (client) => {
      const row = await logTrustEvent(
        { feederId: auth.feederId, eventType: eventType as TrustEventType, reason, refScanId },
        client,
      );
      const next = await recomputeScore(auth.feederId, client);
      return { event: row, score: next };
    });

    return {
      ok: true,
      data: {
        event: toEventPayload(event),
        score,
      },
    };
  });

  app.post("/api/v1/trust/disputes", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = feederAuth(req, reply);
    if (!auth) return reply;

    const parsed = DisputeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid dispute payload", code: "INVALID_DISPUTE" } });
    }
    const { eventId, reason } = parsed.data;

    try {
      const result = await withTx(async (client) => openDispute(eventId, auth.feederId, reason, client));
      return {
        ok: true,
        data: {
          event: toEventPayload(result.original),
          reversal: toEventPayload(result.reversal),
          score: result.score,
        },
      };
    } catch (err) {
      sendTrustError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/v1/feeders/:id/trust",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const auth = feederAuth(req, reply);
      if (!auth) return reply;

      if (auth.feederId !== req.params.id) {
        return reply
          .status(403)
          .send({ ok: false, error: { message: "you can only view your own trust", code: "FORBIDDEN" } });
      }

      try {
        const view = await getFeederTrust(auth.feederId);
        return {
          ok: true,
          data: {
            feederId: view.feederId,
            score: view.score,
            verificationTier: view.verificationTier,
            paused: view.paused,
            serialRejects: view.serialRejects,
            autoPausedEventId: view.autoPausedEventId ?? undefined,
            events: view.events.map(toEventPayload),
          },
        };
      } catch (err) {
        sendTrustError(reply, err);
      }
    },
  );
}
