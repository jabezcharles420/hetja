/**
 * Public care-directory route tests.
 *
 * 1. a valid query returns listed providers within range, nearest first.
 * 2. missing lat/lng is a 400.
 * 3. max_km above the 25km cap is rejected (400) rather than silently
 *    clamped — matches the heatmap route's convention (heatmap.test.ts)
 *    of rejecting out-of-range query params.
 * 4. an unlisted provider is never returned even when closest.
 * 5. the kind filter excludes providers of a different kind.
 * 6. geo_precision contract (migration 0009_care_geo_precision.sql): an
 *    "exact" row surfaces a real numeric distanceM; a "locality" row
 *    surfaces distanceM: null plus its locality label — the API must never
 *    present an estimated coordinate's distance as a measured fact.
 * 7. ordering puts exact-precision rows ahead of locality-precision rows
 *    even when a locality row is nominally nearer by raw ST_Distance.
 * 8. among locality-precision rows (no real distance to rank by), ordering
 *    is by has_ambulance/cost_tier/is_24x7 -- not by the fabricated
 *    ST_Distance -- so an ambulance-carrying free provider outranks a paid
 *    one even when the paid one is nominally closer.
 * 9. phone contract (lib/phone.ts + 0015_care_phone_e164_retry.sql): an
 *    already-canonical number passes through untouched, a number that cannot
 *    be parsed as Indian is returned as stored rather than blanked, and a
 *    provider with no number still reports null.
 *
 * Fixtures use a location far from Mumbai (and from any seeded directory
 * data) so this suite is independent of packages/db/src/seed-care.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { query } from "@hetja/db";
import { careCache } from "./care.js";

const config = loadConfig();

// Well away from Mumbai and from any real seeded provider.
const ORIGIN = { lat: 1.3521, lng: 103.8198 };

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

interface ProviderOverrides {
  name: string;
  kind?: "ngo" | "govt" | "charity_hospital" | "private_clinic";
  costTier?: "free" | "subsidised" | "paid";
  lat: number;
  lng: number;
  listed?: boolean;
  phone?: string | null;
  // Tests default to "exact" so pre-existing distance/ordering assertions
  // (written before geo_precision existed) keep measuring a real distance;
  // the null-distance contract is exercised explicitly via "locality" below.
  geoPrecision?: "exact" | "locality";
  locality?: string | null;
}

async function insertProvider(o: ProviderOverrides): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO care_providers (name, kind, cost_tier, phone_e164, geo, source, listed, geo_precision, locality)
     VALUES ($1, $2, $3, $4, $5::geography, 'curated', $6, $7, $8)
     RETURNING id`,
    [
      o.name,
      o.kind ?? "ngo",
      o.costTier ?? "free",
      // `?? default` would be wrong here: an EXPLICIT null means "this provider
      // publishes no number", which is a case 0008 allows and which the response
      // contract has to preserve. Only an omitted `phone` gets the placeholder.
      o.phone === undefined ? "+10000000000" : o.phone,
      geoWkt(o.lat, o.lng),
      o.listed ?? true,
      o.geoPrecision ?? "exact",
      o.locality ?? null,
    ],
  );
  return res.rows[0].id;
}

let app: FastifyInstance;
const createdIds: string[] = [];

beforeEach(async () => {
  // The 60s care cache (enhancement stack §M.1) is module-level state; tests
  // insert and delete providers per-case, so stale cache entries would make
  // one test see another test's rows.
  careCache.clear();
  app = buildServer(config);
  await app.ready();
});

afterEach(async () => {
  for (const id of createdIds) {
    await query(`DELETE FROM care_providers WHERE id = $1`, [id]);
  }
  createdIds.length = 0;
  await app.close();
});

describe("GET /api/v1/care", () => {
  it("returns listed providers within range, nearest first, with distanceM rounded to 100m", async () => {
    const near = await insertProvider({ name: "CareTest Near", lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng });
    const far = await insertProvider({ name: "CareTest Far", lat: ORIGIN.lat + 0.02, lng: ORIGIN.lng });
    createdIds.push(near, far);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const providers = body.data.providers as Array<{ id: string; distanceM: number | null; phoneVerifiedAt: string | null }>;
    const ids = providers.map((p) => p.id);
    expect(ids.indexOf(near)).toBeLessThan(ids.indexOf(far));

    const nearRow = providers.find((p) => p.id === near)!;
    expect(nearRow.distanceM).not.toBeNull();
    expect(nearRow.distanceM! % 100).toBe(0);
    // phone_verified_at was never set for the fixture -> must surface as null,
    // never silently hidden (plan: unconfirmed numbers are labelled, not dropped).
    expect(nearRow.phoneVerifiedAt).toBeNull();
  });

  it("rejects a query missing lat/lng with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/care" });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it("rejects max_km above the 25km cap with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=26`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("never returns an unlisted provider even when it is the closest", async () => {
    const unlisted = await insertProvider({
      name: "CareTest Unlisted",
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      listed: false,
    });
    const listed = await insertProvider({ name: "CareTest Listed", lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng });
    createdIds.push(unlisted, listed);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json().data.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids).not.toContain(unlisted);
    expect(ids).toContain(listed);
  });

  it("filters by kind", async () => {
    const ngo = await insertProvider({ name: "CareTest NGO", kind: "ngo", lat: ORIGIN.lat, lng: ORIGIN.lng + 0.001 });
    const govt = await insertProvider({
      name: "CareTest Govt",
      kind: "govt",
      lat: ORIGIN.lat,
      lng: ORIGIN.lng + 0.002,
    });
    createdIds.push(ngo, govt);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&kind=govt&max_km=5`,
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json().data.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(govt);
    expect(ids).not.toContain(ngo);
  });

  it("never reports a numeric distance for a locality-precision (estimated-coordinate) row", async () => {
    const guessed = await insertProvider({
      name: "CareTest Locality Guess",
      lat: ORIGIN.lat + 0.001,
      lng: ORIGIN.lng,
      geoPrecision: "locality",
      locality: "Testville",
    });
    createdIds.push(guessed);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });

    expect(res.statusCode).toBe(200);
    const providers = res.json().data.providers as Array<{
      id: string;
      distanceM: number | null;
      geoPrecision: string;
      locality: string | null;
    }>;
    const row = providers.find((p) => p.id === guessed)!;
    expect(row.geoPrecision).toBe("locality");
    expect(row.distanceM).toBeNull();
    expect(row.locality).toBe("Testville");
  });

  it("reports a real numeric distanceM for an exact-precision row", async () => {
    const exact = await insertProvider({
      name: "CareTest Exact",
      lat: ORIGIN.lat + 0.001,
      lng: ORIGIN.lng,
      geoPrecision: "exact",
    });
    createdIds.push(exact);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });

    expect(res.statusCode).toBe(200);
    const providers = res.json().data.providers as Array<{
      id: string;
      distanceM: number | null;
      geoPrecision: string;
    }>;
    const row = providers.find((p) => p.id === exact)!;
    expect(row.geoPrecision).toBe("exact");
    expect(typeof row.distanceM).toBe("number");
    expect(row.distanceM).not.toBeNull();
  });

  it("orders exact-precision rows ahead of a nominally-closer locality-precision row", async () => {
    const closerButGuessed = await insertProvider({
      name: "CareTest Closer Guess",
      lat: ORIGIN.lat + 0.0005,
      lng: ORIGIN.lng,
      geoPrecision: "locality",
      locality: "Testville",
    });
    const fartherButExact = await insertProvider({
      name: "CareTest Farther Exact",
      lat: ORIGIN.lat + 0.01,
      lng: ORIGIN.lng,
      geoPrecision: "exact",
    });
    createdIds.push(closerButGuessed, fartherButExact);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json().data.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids.indexOf(fartherButExact)).toBeLessThan(ids.indexOf(closerButGuessed));
  });

  it("returns an already-canonical Indian number byte-for-byte", async () => {
    // The E.164 CHECK constraint (0015_care_phone_e164_retry.sql) means every
    // stored number is already canonical, so `dialable()` must be a strict
    // no-op on the happy path — a normaliser that rewrites correct data is a
    // normaliser that can corrupt it. +912224137518 is the real Bombay SPCA
    // Parel landline, deliberately chosen: libphonenumber-js is imported as
    // `/min` rather than `/mobile` precisely so a landline survives this.
    const id = await insertProvider({
      name: "CareTest E164 Landline",
      lat: ORIGIN.lat + 0.001,
      lng: ORIGIN.lng,
      phone: "+912224137518",
    });
    createdIds.push(id);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });
    const row = (res.json().data.providers as Array<{ id: string; phoneE164: string | null }>).find(
      (p) => p.id === id,
    )!;
    expect(row.phoneE164).toBe("+912224137518");
  });

  it("never blanks a number it cannot parse as Indian", async () => {
    // A non-Indian number is not parseable by normalizeIndianPhone (it returns
    // null for a valid +1 number on purpose), and the response must still carry
    // it. On this surface a possibly-odd number beats no number: someone is
    // standing over an injured dog, and a missing line is a guaranteed dead end
    // where an unusual one is probably still dialable.
    const id = await insertProvider({
      name: "CareTest Foreign Number",
      lat: ORIGIN.lat + 0.001,
      lng: ORIGIN.lng,
      phone: "+6598765432",
    });
    createdIds.push(id);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });
    const row = (res.json().data.providers as Array<{ id: string; phoneE164: string | null }>).find(
      (p) => p.id === id,
    )!;
    expect(row.phoneE164).toBe("+6598765432");
  });

  it("still returns null for a provider that publishes no number at all", async () => {
    // 0008 allows phone_e164 NULL ("some publish only an address"). null must
    // stay null and must not become a string.
    const id = await insertProvider({
      name: "CareTest No Phone",
      lat: ORIGIN.lat + 0.001,
      lng: ORIGIN.lng,
      phone: null,
    });
    createdIds.push(id);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });
    const row = (res.json().data.providers as Array<{ id: string; phoneE164: string | null }>).find(
      (p) => p.id === id,
    )!;
    expect(row.phoneE164).toBeNull();
  });

  it("ranks locality-precision rows by has_ambulance/cost_tier/is_24x7 rather than a fabricated distance", async () => {
    // Neither row is geocoded ("locality" precision), and the paid provider
    // is deliberately placed nominally closer by raw ST_Distance -- this
    // proves the ordering no longer depends on that unmeasured number at all.
    const paidCloser = await insertProvider({
      name: "CareTest Paid Closer",
      costTier: "paid",
      lat: ORIGIN.lat + 0.0002,
      lng: ORIGIN.lng,
      geoPrecision: "locality",
      locality: "Testville",
    });
    const freeAmbulanceFarther = await insertProvider({
      name: "CareTest Free Ambulance Farther",
      costTier: "free",
      lat: ORIGIN.lat + 0.01,
      lng: ORIGIN.lng,
      geoPrecision: "locality",
      locality: "Testville",
    });
    createdIds.push(paidCloser, freeAmbulanceFarther);
    await query(`UPDATE care_providers SET has_ambulance = true WHERE id = $1`, [freeAmbulanceFarther]);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/care?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&max_km=5`,
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json().data.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids.indexOf(freeAmbulanceFarther)).toBeLessThan(ids.indexOf(paidCloser));
  });
});
