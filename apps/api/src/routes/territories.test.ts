/**
 * Territory route tests.
 *
 * 1. admin creates a geofence from a Polygon GeoJSON (201 + persisted row)
 * 2. a feeder claims a geofence as primary; GET lists it first (is_primary)
 * 3. a second feeder cannot claim the same geofence as primary (409)
 * 4. a feeder cannot read another feeder's territories (403) / non-admin
 *    cannot create geofences (403)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { query } from "@hetja/db";
import { signAccessToken } from "../lib/jwt.js";

const config = loadConfig();

const POLYGON = {
  type: "Polygon",
  coordinates: [[
    [72.86, 19.07],
    [72.88, 19.07],
    [72.88, 19.09],
    [72.86, 19.09],
    [72.86, 19.07],
  ]],
};

interface Fixture {
  app: FastifyInstance;
  adminId: string;
  feeder1Id: string;
  feeder2Id: string;
  geofenceId: string;
}

function bearerToken(feederId: string): string {
  return `Bearer ${signAccessToken(feederId, config.JWT_SECRET, config.JWT_ACCESS_TTL)}`;
}

async function insertFeeder(role: string): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version)
     VALUES ($1, 'TerritoryTest', $2, 30, 'v1.0') RETURNING id`,
    [`territory-test-${randomUUID()}`, role],
  );
  return res.rows[0].id;
}

async function insertGeofence(): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO geofences (name, boundary, ward_id, alert_radius_m)
     VALUES ($1, ST_GeomFromGeoJSON($2)::geography, $3, $4) RETURNING id`,
    ["Fixture Geofence", JSON.stringify(POLYGON), "H/West", 2000],
  );
  return res.rows[0].id;
}

async function cleanup(fixture: Fixture): Promise<void> {
  await query(
    `DELETE FROM feeder_territories
     WHERE feeder_id = ANY($1::uuid[]) OR geofence_id = $2`,
    [[fixture.adminId, fixture.feeder1Id, fixture.feeder2Id], fixture.geofenceId],
  );
  await query(`DELETE FROM geofences WHERE id = $1`, [fixture.geofenceId]);
  await query(
    `DELETE FROM feeders WHERE id = ANY($1::uuid[])`,
    [[fixture.adminId, fixture.feeder1Id, fixture.feeder2Id]],
  );
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = {
    app: buildServer(config),
    adminId: await insertFeeder("admin"),
    feeder1Id: await insertFeeder("feeder"),
    feeder2Id: await insertFeeder("feeder"),
    geofenceId: await insertGeofence(),
  };
  await fixture.app.ready();
});

afterEach(async () => {
  await cleanup(fixture);
  await fixture.app.close();
});

describe("POST /api/v1/territories (admin)", () => {
  it("creates a geofence and persists it", async () => {
    const res = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/territories",
      headers: { authorization: bearerToken(fixture.adminId) },
      payload: { name: "Test Zone", wardId: "H/East", boundaryGeoJson: POLYGON, alertRadiusM: 1500 },
    });

    expect(res.statusCode).toBe(201);
    const id = res.json().data.geofence.id as string;
    expect(id).toBeTruthy();

    const row = await query<{ name: string; ward_id: string; alert_radius_m: number }>(
      `SELECT name, ward_id, alert_radius_m FROM geofences WHERE id = $1`,
      [id],
    );
    expect(row.rows[0].name).toBe("Test Zone");
    expect(row.rows[0].ward_id).toBe("H/East");
    expect(row.rows[0].alert_radius_m).toBe(1500);

    await query(`DELETE FROM geofences WHERE id = $1`, [id]);
  });

  it("rejects a non-admin feeder with 403", async () => {
    const res = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/territories",
      headers: { authorization: bearerToken(fixture.feeder1Id) },
      payload: { name: "Nope", wardId: "H/East", boundaryGeoJson: POLYGON, alertRadiusM: 1500 },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/territories/claim", () => {
  it("lets a feeder claim a geofence as primary", async () => {
    const claim = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/territories/claim",
      headers: { authorization: bearerToken(fixture.feeder1Id) },
      payload: { geofenceId: fixture.geofenceId },
    });
    expect(claim.statusCode).toBe(200);

    const list = await fixture.app.inject({
      method: "GET",
      url: `/api/v1/territories/${fixture.feeder1Id}`,
      headers: { authorization: bearerToken(fixture.feeder1Id) },
    });
    expect(list.statusCode).toBe(200);
    const territories = list.json().data.territories as Array<{
      geofenceId: string;
      name: string;
      wardId: string;
      isPrimary: boolean;
    }>;
    expect(territories).toHaveLength(1);
    expect(territories[0].geofenceId).toBe(fixture.geofenceId);
    expect(territories[0].name).toBe("Fixture Geofence");
    expect(territories[0].wardId).toBe("H/West");
    expect(territories[0].isPrimary).toBe(true);
  });

  it("returns 409 when a second feeder claims the same geofence as primary", async () => {
    const first = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/territories/claim",
      headers: { authorization: bearerToken(fixture.feeder1Id) },
      payload: { geofenceId: fixture.geofenceId },
    });
    expect(first.statusCode).toBe(200);

    const second = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/territories/claim",
      headers: { authorization: bearerToken(fixture.feeder2Id) },
      payload: { geofenceId: fixture.geofenceId },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().ok).toBe(false);
    expect(second.json().error.code).toBe("TERRITORY_ALREADY_CLAIMED");
  });
});

describe("GET /api/v1/territories/:feederId", () => {
  it("forbids a feeder from reading another feeder's territories", async () => {
    const res = await fixture.app.inject({
      method: "GET",
      url: `/api/v1/territories/${fixture.feeder2Id}`,
      headers: { authorization: bearerToken(fixture.feeder1Id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows an admin to read any feeder's territories", async () => {
    await fixture.app.inject({
      method: "POST",
      url: "/api/v1/territories/claim",
      headers: { authorization: bearerToken(fixture.feeder1Id) },
      payload: { geofenceId: fixture.geofenceId },
    });

    const res = await fixture.app.inject({
      method: "GET",
      url: `/api/v1/territories/${fixture.feeder1Id}`,
      headers: { authorization: bearerToken(fixture.adminId) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.territories).toHaveLength(1);
  });
});
