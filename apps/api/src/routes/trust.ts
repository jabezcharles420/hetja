/**
 * Hetja TRUST endpoints (feeder-authed).
 *
 * POST /api/v1/trust/disputes            — {eventId, reason}: the event's
 *   OWNER sets dispute_state='open'. No score change; a human reviews.
 * POST /api/v1/trust/disputes/:id/resolve — ADMIN adjudicates an open
 *   dispute: the original delta is reversed exactly and the score recomputed.
 * GET  /api/v1/feeders/:id/trust          — self-service: score + verification
 *   tier + pause state + recent events. A pure read: the INVARIANT 15 pause is
 *   DERIVED here (readVerificationGate) and ENFORCED by routes/scans.ts, which
 *   is where the `auto_paused` flag gets written.
 * POST /api/v1/feeders/:id/trust/evaluate — records the gate explicitly
 *   (applyVerificationGate) without submitting a scan.
 *
 * There is deliberately no "log a trust event" endpoint. One used to live here
 * (POST /api/v1/trust/events) and it let any feeder mint any catalog delta for
 * themselves — feed alone took a fresh account from 30 to 90 in one request,
 * clearing every trust gate in the system. Every legitimate producer logs
 * server-side (scans.ts on feed creation, moderation.ts on story rejection,
 * the dispute path below), so an HTTP write path had only illegitimate
 * callers, and an endpoint whose only callers are illegitimate is not an
 * endpoint.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTx } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";
import { parseUuidParam } from "../lib/params.js";
import {
  TrustError,
  type TrustEventRow,
  applyVerificationGate,
  getFeederTrust,
  openDispute,
  resolveDispute,
} from "../lib/trust.js";

const DisputeInput = z.object({
  eventId: z.string().uuid(),
  reason: z.string().min(1).max(200),
});

const ResolveInput = z.object({
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
      // Opens the dispute only. The score does not move here — that is the
      // whole point of the split; see resolveDispute.
      const result = await withTx(async (client) => openDispute(eventId, auth.feederId, reason, client));
      return {
        ok: true,
        data: {
          event: toEventPayload(result.original),
        },
      };
    } catch (err) {
      sendTrustError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/trust/disputes/:id/resolve",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const auth = feederAuth(req, reply);
      if (!auth) return reply;

      const parsed = ResolveInput.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ ok: false, error: { message: "invalid resolve payload", code: "INVALID_DISPUTE" } });
      }

      // trust_events.id is a uuid column; a non-UUID :id would raise 22P02
      // inside the transaction and — since sendTrustError rethrows anything
      // that is not a TrustError — surface as a 500. See lib/params.ts.
      const eventId = parseUuidParam(req.params.id);
      if (!eventId) {
        return reply.status(400).send({
          ok: false,
          error: { message: "event id must be a UUID", code: "INVALID_TRUST_EVENT_ID" },
        });
      }

      try {
        // The admin check itself lives inside resolveDispute — the route only
        // authenticates who is calling, the lib enforces what they may do.
        const result = await withTx(async (client) =>
          resolveDispute(eventId, auth.feederId, parsed.data.reason, client),
        );
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
    },
  );

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

  /**
   * POST /api/v1/feeders/:id/trust/evaluate — explicit INVARIANT 15 gate.
   *
   * Evaluates applyVerificationGate transactionally (FOR UPDATE + idempotent
   * compare-and-set) and returns the gate payload, recording the `auto_paused`
   * flag if the feeder has crossed the threshold. The other writer is
   * routes/scans.ts, which runs the same gate before accepting a feeder's
   * scan; GET /feeders/:id/trust only reads.
   */
  app.post<{ Params: { id: string } }>(
    "/api/v1/feeders/:id/trust/evaluate",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const auth = feederAuth(req, reply);
      if (!auth) return reply;

      if (auth.feederId !== req.params.id) {
        return reply
          .status(403)
          .send({ ok: false, error: { message: "you can only evaluate your own trust", code: "FORBIDDEN" } });
      }

      try {
        const gate = await withTx((client) => applyVerificationGate(auth.feederId, client));
        return {
          ok: true,
          data: {
            feederId: auth.feederId,
            paused: gate.paused,
            serialRejects: gate.serialRejects,
            autoPausedEventId: gate.autoPausedEventId ?? undefined,
          },
        };
      } catch (err) {
        sendTrustError(reply, err);
      }
    },
  );
}
