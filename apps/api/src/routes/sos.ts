/**
 * Hetja SOS — report + case state routes.
 *
 * POST /api/v1/reports        — anon-attested (device token, INVARIANT 7 caps)
 *                                OR feeder-authed (Bearer access token). Opens a
 *                                sos_case at tier 1. Severity routing:
 *                                minor/serious wait for validation before fan-out
 *                                (validation pipeline is out of Phase-0 scope, so
 *                                no responders are notified at report time);
 *                                critical fans out immediately via the canonical
 *                                query in docs/queries/sos_fanout.sql. Every report
 *                                enqueues the 8-min escalate_sos job.
 * GET  /api/v1/sos/cases/:id   — feeder-authed case state.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SLUG_REGEX, type SosSeverity } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { verifyDeviceToken } from "../lib/device.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { getNearbyCare } from "./care.js";

// INVARIANT 7 — anonymous SOS is capped per attested device token.
const SOS_DAILY_CAP = 2;
const SOS_WEEKLY_CAP = 5;

const SosReportInput = z.object({
  dogSlug: z.string().regex(SLUG_REGEX),
  severity: z.enum(["minor", "serious", "critical"]),
  note: z.string().max(500).optional(),
  deviceToken: z.string().min(1).max(256).optional(),
});

class SosRateLimitError extends Error {
  constructor() {
    super("sos report rate cap exceeded");
    this.name = "SosRateLimitError";
  }
}

class SosDogNotFoundError extends Error {
  constructor() {
    super("dog not found");
    this.name = "SosDogNotFoundError";
  }
}

interface DogRow {
  id: string;
  lat: number | null;
  lng: number | null;
}

interface CaseRow {
  id: string;
  severity: string;
  state: string;
  tier: number;
  opened_at: Date;
  acked_at: Date | null;
  escalated_at: Date | null;
  resolved_at: Date | null;
  resolution: string | null;
}

/** Minimal structural view of the pg client so helpers avoid a `pg` import. */
interface TxClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/** Deterministic UUID (v5-style) for offline replay idempotency of a report. */
function deterministicUuid(namespace: string, input: string): string {
  const hex = createHash("sha256").update(`${namespace}:${input}`).digest("hex");
  const bytes = hex.slice(0, 32).match(/.{2}/g)!.map((b) => parseInt(b, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return [bytes.slice(0, 4), bytes.slice(4, 6), bytes.slice(6, 8), bytes.slice(8, 10), bytes.slice(10, 16)]
    .map((part) => part.map(toHex).join(""))
    .join("-");
}

/**
 * Canonical SOS fan-out (docs/queries/sos_fanout.sql): eligible responders
 * within 2000m with sos_opt_in and trust >= floor (40 minor/serious, 60
 * critical), best-trust first, up to 15. Zero eligible → the case opens at
 * tier 2 immediately. Returns true when responders were notified.
 */
async function dispatchFanout(
  client: TxClient,
  caseId: string,
  lat: number | null,
  lng: number | null,
  severity: SosSeverity,
): Promise<boolean> {
  if (lat == null || lng == null) {
    await client.query(`UPDATE sos_cases SET tier = 2 WHERE id = $1`, [caseId]);
    return false;
  }
  const trustFloor = severity === "critical" ? 60 : 40;
  const res = await client.query<{ id: string }>(
    `SELECT f.id
     FROM feeders f
     WHERE ST_DWithin(f.last_known_geo, $1::geography, 2000)
       AND f.sos_opt_in
       AND f.trust_score >= $2
     ORDER BY f.trust_score DESC, f.last_seen_at DESC
     LIMIT 15`,
    [geoWkt(lat, lng), trustFloor],
  );
  if (res.rows.length === 0) {
    await client.query(`UPDATE sos_cases SET tier = 2 WHERE id = $1`, [caseId]);
    return false;
  }
  for (const row of res.rows) {
    await client.query(
      `INSERT INTO sos_notifications (case_id, feeder_id, channel) VALUES ($1, $2, 'push') ON CONFLICT DO NOTHING`,
      [caseId, row.id],
    );
  }
  return true;
}

export default async function sosRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/reports", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SosReportInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid sos report", code: "INVALID_SOS_REPORT" } });
    }
    const { dogSlug, severity, note, deviceToken } = parsed.data;

    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    let feederId: string | null = null;
    if (rawAuth.startsWith("Bearer ")) {
      try {
        feederId = verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub;
      } catch {
        return reply
          .status(401)
          .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
      }
    } else if (!deviceToken || !verifyDeviceToken(deviceToken, app.config.HETJA_DEVICE_SECRET)) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
    }

    // INVARIANT 5: deterministic client_uuid → replay of the same report is
    // idempotent (a re-submit while a case is open/acked never double-opens).
    const dedupeKey = deterministicUuid("sos-report", [deviceToken ?? "", dogSlug, severity, note ?? ""].join("|"));

    let result: { created: boolean; caseId: string; tier: number };
    try {
      result = await withTx(async (client) => {
        const existing = await client.query<{ id: string; state: string; tier: number }>(
          `SELECT c.id, c.state, c.tier
           FROM scans s
           JOIN sos_cases c ON c.scan_id = s.id
           WHERE s.client_uuid = $1
           ORDER BY c.opened_at DESC
           LIMIT 1`,
          [dedupeKey],
        );
        const replay = existing.rows[0];
        if (replay && (replay.state === "open" || replay.state === "acked")) {
          return { created: false, caseId: replay.id, tier: replay.tier };
        }

        // INVARIANT 7 — per-token caps apply to anon reports only.
        if (!feederId) {
          const counts = await client.query<{ today: number; week: number }>(
            `SELECT count(*) FILTER (WHERE received_at >= date_trunc('day', now()))::int AS today,
                    count(*) FILTER (WHERE received_at >= date_trunc('week', now()))::int AS week
             FROM scans
             WHERE scan_type = 'sos' AND device_token = $1`,
            [deviceToken],
          );
          if (counts.rows[0].today >= SOS_DAILY_CAP || counts.rows[0].week >= SOS_WEEKLY_CAP) {
            throw new SosRateLimitError();
          }
        }

        // SECURITY-GATE: public-coordinates -- read for internal use only. This
        // exact position feeds the ST_DWithin fan-out radius and is never placed
        // in a response body, so INVARIANT 2's coarsening requirement (which
        // governs what an anonymous caller RECEIVES) does not apply. Coarsening
        // here would silently widen the 2km responder radius.
        const dogRes = await client.query<DogRow>(
          `SELECT id, ST_Y(last_seen_geo::geometry) AS lat, ST_X(last_seen_geo::geometry) AS lng
           FROM dogs WHERE slug = $1`,
          [dogSlug],
        );
        const dog = dogRes.rows[0];
        if (!dog) throw new SosDogNotFoundError();

        const scanRes = await client.query<{ id: string }>(
          `INSERT INTO scans (dog_id, client_uuid, scan_type, device_token, captured_at, received_at, review_status)
           VALUES ($1, $2, 'sos', $3, now(), now(), 'pending')
           ON CONFLICT (client_uuid) DO NOTHING
           RETURNING id`,
          [dog.id, dedupeKey, deviceToken ?? null],
        );
        let scanId = scanRes.rows[0]?.id;
        if (!scanId) {
          const existingScan = await client.query<{ id: string }>(
            `SELECT id FROM scans WHERE client_uuid = $1`,
            [dedupeKey],
          );
          scanId = existingScan.rows[0].id;
        }

        const caseRes = await client.query<{ id: string }>(
          `INSERT INTO sos_cases (scan_id, dog_id, severity, state, tier)
           VALUES ($1, $2, $3, 'open', 1)
           RETURNING id`,
          [scanId, dog.id, severity],
        );
        const caseId = caseRes.rows[0].id;

        let tier = 1;
        if (severity === "critical") {
          tier = (await dispatchFanout(client, caseId, dog.lat, dog.lng, severity)) ? 1 : 2;
        }

        // 8-min escalation: worker's escalate_sos handler promotes unacked cases.
        await client.query(
          `INSERT INTO jobs (kind, payload, run_after)
           VALUES ('escalate_sos', $1::jsonb, now() + interval '8 minutes')`,
          [JSON.stringify({ caseId, dogId: dog.id })],
        );

        return { created: true, caseId, tier };
      });
    } catch (err) {
      if (err instanceof SosRateLimitError) {
        return reply
          .status(429)
          .send({ ok: false, error: { message: "sos report cap exceeded", code: "SOS_RATE_LIMITED" } });
      }
      if (err instanceof SosDogNotFoundError) {
        return reply
          .status(404)
          .send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
      }
      throw err;
    }

    // Emergency-path improvement (plan §2.4): return a callable number
    // in the same payload as the case id, so the reporter has something to
    // act on immediately rather than waiting out the 8-min escalation timer.
    // Existing response fields (created, caseId, tier) are left untouched.
    // SECURITY-GATE: public-coordinates -- internal only. Used to rank nearby
    // care providers by distance; the dog's own position is not echoed back.
    // Only the resulting provider list (published clinic addresses) is returned.
    const dogGeoRes = await query<{ lat: number | null; lng: number | null }>(
      `SELECT ST_Y(last_seen_geo::geometry) AS lat, ST_X(last_seen_geo::geometry) AS lng
       FROM dogs WHERE slug = $1`,
      [dogSlug],
    );
    const dogGeo = dogGeoRes.rows[0];
    const nearbyCare =
      dogGeo?.lat != null && dogGeo?.lng != null ? await getNearbyCare(dogGeo.lat, dogGeo.lng) : [];

    return { ok: true, data: { ...result, nearbyCare } };
  });

  app.get("/api/v1/sos/cases/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    if (!rawAuth.startsWith("Bearer ")) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "feeder auth required", code: "UNAUTHENTICATED" } });
    }
    try {
      verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET);
    } catch {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
    }

    const { id } = req.params as { id: string };
    const res = await query<CaseRow>(
      `SELECT id, severity, state, tier, opened_at, acked_at, escalated_at, resolved_at, resolution
       FROM sos_cases WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "case not found", code: "NOT_FOUND" } });
    }

    return {
      ok: true,
      data: {
        id: row.id,
        severity: row.severity,
        state: row.state,
        tier: row.tier,
        openedAt: new Date(row.opened_at).toISOString(),
        ackedAt: row.acked_at ? new Date(row.acked_at).toISOString() : null,
        escalatedAt: row.escalated_at ? new Date(row.escalated_at).toISOString() : null,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
        resolution: row.resolution ?? null,
      },
    };
  });
}
