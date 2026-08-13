/**
 * Hetja TERRITORIES endpoints.
 *
 * GET  /api/v1/territories/:feederId — the feeder's sponsored geofences
 *   (is_primary first). The target feeder themselves, or any admin, may read.
 * POST /api/v1/territories          — admin creates a geofence.
 * POST /api/v1/territories/claim    — a feeder claims a ward geofence as
 *   primary. One primary per geofence is enforced by the unique partial
 *   index feeder_territories_primary_uix (0005_territory_primary.sql) AND
 *   checked in a transaction here so a conflicting claim returns 409.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query, withTx } from "@straynet/db";
import { verifyAccessToken } from "../lib/jwt.js";

const DEFAULT_ALERT_RADIUS_M = 2000;

const ringClosed = (ring: [number, number][]): boolean => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
};

const GeoJsonPolygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(
      z.array(z.tuple([z.number(), z.number()])).min(4).refine(ringClosed, "ring must be closed"),
    )
    .min(1),
});

const CreateGeofenceInput = z.object({
  name: z.string().min(1).max(80),
  wardId: z.string().min(1).max(16),
  boundaryGeoJson: GeoJsonPolygon,
  alertRadiusM: z.number().int().min(0).max(100_000).optional(),
});

const ClaimInput = z.object({
  geofenceId: z.string().uuid(),
});

interface AuthCtx {
  feederId: string;
  role: string;
}

async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthCtx | null> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "feeder auth required", code: "UNAUTHENTICATED" } });
    return null;
  }
  let feederId: string;
  try {
    feederId = verifyAccessToken(token, req.server.config.JWT_SECRET).sub as string;
  } catch {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
    return null;
  }
  const res = await query<{ role: string }>(`SELECT role FROM feeders WHERE id = $1`, [feederId]);
  const feeder = res.rows[0];
  if (!feeder) {
    void reply
      .status(401)
      .send({ ok: false, error: { message: "feeder not found", code: "FEEDER_NOT_FOUND" } });
    return null;
  }
  return { feederId, role: feeder.role };
}

const forbidden = (reply: FastifyReply) =>
  reply.status(403).send({ ok: false, error: { message: "forbidden", code: "FORBIDDEN" } });

interface TerritoryRow {
  id: string;
  name: string;
  ward_id: string;
  role: string;
  is_primary: boolean;
  since: Date;
  until: Date | null;
}

function toTerritory(row: TerritoryRow) {
  return {
    geofenceId: row.id,
    name: row.name,
    wardId: row.ward_id,
    role: row.role,
    isPrimary: row.is_primary,
    since: new Date(row.since).toISOString(),
    until: row.until ? new Date(row.until).toISOString() : null,
  };
}

export default async function territoryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { feederId: string } }>(
    "/api/v1/territories/:feederId",
    async (req: FastifyRequest<{ Params: { feederId: string } }>, reply: FastifyReply) => {
      const auth = await authenticate(req, reply);
      if (!auth) return reply;
      const targetId = req.params.feederId;
      if (auth.feederId !== targetId && auth.role !== "admin") {
        return forbidden(reply);
      }

      const res = await query<TerritoryRow>(
        `SELECT g.id, g.name, g.ward_id, ft.role, ft.is_primary, ft.since, ft.until
         FROM feeder_territories ft
         JOIN geofences g ON g.id = ft.geofence_id
         WHERE ft.feeder_id = $1 AND ft.until IS NULL
         ORDER BY ft.is_primary DESC NULLS LAST, ft.since ASC`,
        [targetId],
      );

      return {
        ok: true,
        data: { feederId: targetId, territories: res.rows.map(toTerritory) },
      };
    },
  );

  app.post("/api/v1/territories", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return reply;
    if (auth.role !== "admin") return forbidden(reply);

    const parsed = CreateGeofenceInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid geofence payload", code: "INVALID_GEOFENCE" } });
    }
    const { name, wardId, boundaryGeoJson, alertRadiusM } = parsed.data;
    const boundaryJson = JSON.stringify(boundaryGeoJson);

    const validity = await query<{ valid: boolean }>(
      `SELECT ST_IsValid(ST_GeomFromGeoJSON($1)::geometry) AS valid`,
      [boundaryJson],
    );
    if (!validity.rows[0].valid) {
      return reply.status(400).send({
        ok: false,
        error: { message: "boundary polygon is not valid", code: "INVALID_GEOFENCE_BOUNDARY" },
      });
    }

    const radius = alertRadiusM ?? DEFAULT_ALERT_RADIUS_M;
    const res = await query<{ id: string }>(
      `INSERT INTO geofences (name, boundary, ward_id, alert_radius_m)
       VALUES ($1, ST_GeomFromGeoJSON($2)::geography, $3, $4) RETURNING id`,
      [name, boundaryJson, wardId, radius],
    );

    return reply.status(201).send({
      ok: true,
      data: { geofence: { id: res.rows[0].id, name, wardId, alertRadiusM: radius } },
    });
  });

  app.post("/api/v1/territories/claim", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return reply;

    const parsed = ClaimInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid claim payload", code: "INVALID_CLAIM" } });
    }
    const { geofenceId } = parsed.data;

    type ClaimResult = { kind: "ok" } | { kind: "not_found" } | { kind: "conflict" };

    try {
      const result = await withTx<ClaimResult>(async (client): Promise<ClaimResult> => {
        const exists = await client.query<{ id: string }>(
          `SELECT id FROM geofences WHERE id = $1`,
          [geofenceId],
        );
        if (!exists.rows[0]) return { kind: "not_found" };

        const primary = await client.query<{ feeder_id: string }>(
          `SELECT feeder_id FROM feeder_territories
           WHERE geofence_id = $1 AND is_primary AND until IS NULL
           FOR UPDATE`,
          [geofenceId],
        );
        if (primary.rows[0] && primary.rows[0].feeder_id !== auth.feederId) {
          return { kind: "conflict" };
        }

        await client.query(
          `INSERT INTO feeder_territories (feeder_id, geofence_id, role, is_primary, since, until)
           VALUES ($1, $2, 'sponsor', TRUE, now(), NULL)
           ON CONFLICT (feeder_id, geofence_id)
           DO UPDATE SET is_primary = TRUE, role = EXCLUDED.role, until = NULL`,
          [auth.feederId, geofenceId],
        );
        return { kind: "ok" };
      });

      if (result.kind === "not_found") {
        return reply
          .status(404)
          .send({ ok: false, error: { message: "geofence not found", code: "GEOFENCE_NOT_FOUND" } });
      }
      if (result.kind === "conflict") {
        return reply.status(409).send({
          ok: false,
          error: { message: "geofence already claimed as primary", code: "TERRITORY_ALREADY_CLAIMED" },
        });
      }
      return { ok: true, data: { geofenceId } };
    } catch (err) {
      // Fallback guard: the unique partial index is the final arbiter if two
      // claims race the transaction-level check.
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
        return reply.status(409).send({
          ok: false,
          error: { message: "geofence already claimed as primary", code: "TERRITORY_ALREADY_CLAIMED" },
        });
      }
      throw err;
    }
  });
}
