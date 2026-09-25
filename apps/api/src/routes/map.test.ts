/**
 * Map routes (screen 19): ward aggregates, ward detail, place pins.
 *
 * The suite shares one database with every other API suite (run one file at a
 * time, see vitest.config.ts), and other suites leave dogs behind, so every
 * count below is asserted as a DELTA against a reading taken before this test
 * inserted anything. Place fixtures sit in a quiet corner of the Mumbai box
 * (SG below) and are deleted afterwards.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { BMC_WARD_CENTROIDS, BMC_WARD_CODES, MUMBAI_BOUNDS } from "@hetja/contracts";
import { generateSlug, query } from "@hetja/db";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { clampToMumbai, clearMapCaches, pinKind } from "./map.js";

const config = loadConfig();
let app: FastifyInstance;

const dogs: string[] = [];
const feeders: string[] = [];
const providers: string[] = [];

// A quiet corner inside MUMBAI_BOUNDS (Thane creek, east of Mulund): no real
// provider is pinned there, and a pin outside Mumbai cannot be queried at all.
const SG = { lat: 19.27, lng: 72.975 };
const SINGAPORE = { lat: 1.3521, lng: 103.8198 };

function wkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

async function insertDog(wardId: string, status = "active"): Promise<{ id: string; slug: string }> {
  const slug = generateSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, status, last_seen_geo)
     VALUES ($1, 'MapTest', $2, $3::dog_status, $4::geography) RETURNING id`,
    [slug, wardId, status, wkt(19.2541, 72.8613)],
  );
  dogs.push(res.rows[0].id);
  return { id: res.rows[0].id, slug };
}

async function scan(
  dogId: string,
  capturedAt: string | Date,
  opts: { type?: string; review?: string } = {},
): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, captured_at, received_at, review_status)
     VALUES ($1, $2, $3::scan_type, $4::geography, $5, now(), $6::review_status) RETURNING id`,
    [dogId, randomUUID(), opts.type ?? "feed", wkt(19.2541, 72.8613), capturedAt, opts.review ?? "pending"],
  );
  return res.rows[0].id;
}

async function openCase(
  dogId: string,
  severity: "minor" | "serious" | "critical",
  state: "open" | "acked" | "escalated" | "resolved" = "open",
  openedAgoMin = 5,
  ackedBy: string | null = null,
): Promise<string> {
  const scanId = await scan(dogId, new Date(), { type: "sos" });
  const res = await query<{ id: string }>(
    `INSERT INTO sos_cases (scan_id, dog_id, severity, state, opened_at, acked_by)
     VALUES ($1, $2, $3::severity_t, $4::case_state, now() - ($5::int * interval '1 minute'), $6) RETURNING id`,
    [scanId, dogId, severity, state, openedAgoMin, ackedBy],
  );
  return res.rows[0].id;
}

async function insertFeeder(trust: number, sosOptIn: boolean): Promise<{ id: string; auth: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, sos_opt_in)
     VALUES ($1, 'MapTest Responder', 'feeder', $2, 'v1.0', $3) RETURNING id`,
    [`map-${randomUUID()}`, trust, sosOptIn],
  );
  feeders.push(res.rows[0].id);
  return {
    id: res.rows[0].id,
    auth: `Bearer ${signAccessToken(res.rows[0].id, config.JWT_SECRET, config.JWT_ACCESS_TTL)}`,
  };
}

interface ProviderFixture {
  name: string;
  lat: number;
  lng: number;
  kind?: "ngo" | "govt" | "charity_hospital" | "private_clinic";
  costTier?: "free" | "subsidised" | "paid";
  precision?: "exact" | "locality";
  locality?: string | null;
  wardId?: string | null;
  listed?: boolean;
  ambulance?: boolean;
  phone?: string | null;
}

async function insertProvider(p: ProviderFixture): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO care_providers
       (name, kind, cost_tier, phone_e164, geo, ward_id, has_ambulance, source, listed, geo_precision, locality)
     VALUES ($1, $2, $3, $4, $5::geography, $6, $7, 'map-test', $8, $9, $10) RETURNING id`,
    [
      p.name,
      p.kind ?? "private_clinic",
      p.costTier ?? "paid",
      p.phone === undefined ? `+9122${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` : p.phone,
      wkt(p.lat, p.lng),
      p.wardId ?? null,
      p.ambulance ?? false,
      p.listed ?? true,
      p.precision ?? "exact",
      p.locality ?? null,
    ],
  );
  providers.push(res.rows[0].id);
  return res.rows[0].id;
}

async function getWards(): Promise<Array<Record<string, any>>> {
  clearMapCaches();
  const res = await app.inject({ method: "GET", url: "/api/v1/map/wards" });
  expect(res.statusCode).toBe(200);
  return res.json().data.wards;
}

async function ward(id: string): Promise<Record<string, any>> {
  return (await getWards()).find((w) => w.id === id)!;
}

async function istMidnight(): Promise<Date> {
  const res = await query<{ m: Date }>(
    `SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS m`,
  );
  return new Date(res.rows[0].m);
}

beforeEach(async () => {
  clearMapCaches();
  app = buildServer(config);
  await app.ready();
});

afterEach(async () => {
  for (const id of dogs.splice(0)) {
    await query(`DELETE FROM sos_notifications WHERE case_id IN (SELECT id FROM sos_cases WHERE dog_id = $1)`, [id]);
    await query(`DELETE FROM sos_cases WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM scans WHERE dog_id = $1`, [id]);
    await query(`DELETE FROM dogs WHERE id = $1`, [id]);
  }
  for (const id of feeders.splice(0)) await query(`DELETE FROM feeders WHERE id = $1`, [id]);
  for (const id of providers.splice(0)) await query(`DELETE FROM care_providers WHERE id = $1`, [id]);
  await app.close();
});

describe("GET /api/v1/map/wards", () => {
  it("lists all 24 BMC wards with display code, name and the static ward centre", async () => {
    const wards = await getWards();
    expect(wards).toHaveLength(24);
    expect(wards.map((w) => w.id)).toEqual([...BMC_WARD_CODES]);
    const kw = wards.find((w) => w.id === "K-West")!;
    expect(kw).toMatchObject({ code: "K/W", name: "Andheri West", ...BMC_WARD_CENTROIDS["K-West"] });
    for (const w of wards) {
      expect(Object.keys(w).sort()).toEqual(
        ["code", "dogs", "id", "lat", "latestSos", "lng", "name", "notFedToday", "sosOpen"].sort(),
      );
    }
  });

  it("counts active dogs only, and not-fed-today from Mumbai midnight, ignoring rejected feeds and non-feed scans", async () => {
    const before = await ward("R-North");
    const midnight = await istMidnight();

    const fedYesterday = await insertDog("R-North");
    await scan(fedYesterday.id, new Date(midnight.getTime() - 60_000));
    const fedToday = await insertDog("R-North");
    await scan(fedToday.id, new Date(midnight.getTime() + 1000));
    const rejected = await insertDog("R-North");
    await scan(rejected.id, new Date(midnight.getTime() + 60_000), { review: "rejected" });
    const viewedOnly = await insertDog("R-North");
    await scan(viewedOnly.id, new Date(midnight.getTime() + 60_000), { type: "view" });
    const autoPassed = await insertDog("R-North");
    await scan(autoPassed.id, new Date(midnight.getTime() + 120_000), { review: "auto_passed" });
    // Not active: never counted, fed or not.
    await insertDog("R-North", "deceased");

    const after = await ward("R-North");
    expect(after.dogs - before.dogs).toBe(5);
    expect(after.notFedToday - before.notFedToday).toBe(3);
  });

  it("counts open, acked and escalated cases (not resolved), with the latest open one's severity and time", async () => {
    const before = await ward("R-North");
    const d1 = await insertDog("R-North");
    const d2 = await insertDog("R-North");
    await openCase(d1.id, "serious", "open", 30);
    await openCase(d2.id, "critical", "escalated", 3);
    await openCase(d2.id, "minor", "resolved", 1);
    const acker = await insertFeeder(80, true);
    await openCase(d1.id, "minor", "acked", 60, acker.id);

    const after = await ward("R-North");
    expect(after.sosOpen - before.sosOpen).toBe(3);
    expect(after.latestSos.severity).toBe("critical");
    expect(Date.now() - new Date(after.latestSos.raisedAt).getTime()).toBeLessThan(4 * 60_000);
  });

  it("is ward-level only: no dog, scan, reporter or feeder identifier and no finer position", async () => {
    const d = await insertDog("R-North");
    await openCase(d.id, "critical", "open");
    clearMapCaches();
    const res = await app.inject({ method: "GET", url: "/api/v1/map/wards" });
    expect(res.body).not.toContain(d.id);
    expect(res.body).not.toContain(d.slug);
    expect(res.body).not.toContain("19.2541");
    expect(res.body).not.toMatch(/phone|email|note|slug/i);
    const rn = res.json().data.wards.find((w: any) => w.id === "R-North");
    expect({ lat: rn.lat, lng: rn.lng }).toEqual(BMC_WARD_CENTROIDS["R-North"]);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("serves from a 60 s cache: a new dog is not visible until the cache turns over", async () => {
    clearMapCaches();
    const first = (await app.inject({ method: "GET", url: "/api/v1/map/wards" })).json().data.wards;
    await insertDog("R-North");
    const second = (await app.inject({ method: "GET", url: "/api/v1/map/wards" })).json().data.wards;
    expect(second).toEqual(first);
  });
});

describe("GET /api/v1/map/wards/:wardId", () => {
  it("404s a ward that is not one of the 24 codes, including the K/W display form", async () => {
    for (const id of ["K%2FW", "kwest", "Z"]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/map/wards/${id}` });
      expect(res.statusCode).toBe(404);
    }
  });

  it("returns counts plus SOS rows with severity, time and state only, and no case id for anonymous callers", async () => {
    const d = await insertDog("R-North");
    await openCase(d.id, "critical", "open", 8);
    await openCase(d.id, "serious", "open", 25);
    await openCase(d.id, "minor", "resolved", 2);
    const res = await app.inject({ method: "GET", url: "/api/v1/map/wards/R-North" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ id: "R-North", code: "R/N", name: "Dahisar" });
    const mine = data.sos.filter((s: any) => Date.now() - new Date(s.raisedAt).getTime() < 26 * 60_000);
    expect(mine.map((s: any) => s.severity)).toEqual(["critical", "serious"]);
    for (const s of data.sos) {
      expect(Object.keys(s).sort()).toEqual(["caseId", "feedersTold", "mine", "raisedAt", "severity", "state"]);
      expect(s.caseId).toBeNull();
    }
    expect(data.viewer).toBeNull();
    expect(res.body).not.toContain(d.slug);
    expect(res.body).not.toContain(d.id);
  });

  it("hands the case id only to a caller who meets the responder rules for that severity", async () => {
    const d = await insertDog("R-North");
    const critical = await openCase(d.id, "critical", "open", 4);
    const serious = await openCase(d.id, "serious", "open", 6);

    const ids = async (auth: string) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/map/wards/R-North", headers: { authorization: auth } });
      expect(res.headers["cache-control"]).toBe("private, no-store");
      const sos = res.json().data.sos as Array<{ caseId: string | null }>;
      return sos.map((s) => s.caseId).filter(Boolean);
    };

    const trusted = await insertFeeder(70, true);
    expect(await ids(trusted.auth)).toEqual(expect.arrayContaining([critical, serious]));

    const middling = await insertFeeder(50, true);
    const mid = await ids(middling.auth);
    expect(mid).toContain(serious);
    expect(mid).not.toContain(critical);

    const notOptedIn = await insertFeeder(90, false);
    expect(await ids(notOptedIn.auth)).toEqual([]);

    const newbie = await insertFeeder(10, true);
    expect(await ids(newbie.auth)).toEqual([]);

    // A garbage token is simply anonymous, never a 401 on a public read.
    const bad = await app.inject({ method: "GET", url: "/api/v1/map/wards/R-North", headers: { authorization: "Bearer nope" } });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().data.viewer).toBeNull();
  });

  it("shows a case already taken as acked, with its id only to the one who took it", async () => {
    const d = await insertDog("R-North");
    const acker = await insertFeeder(70, true);
    const other = await insertFeeder(70, true);
    const taken = await openCase(d.id, "serious", "acked", 3, acker.id);

    const forAcker = await app.inject({ method: "GET", url: "/api/v1/map/wards/R-North", headers: { authorization: acker.auth } });
    const row = forAcker.json().data.sos.find((s: any) => s.caseId === taken);
    expect(row).toMatchObject({ state: "acked", mine: true });

    const forOther = await app.inject({ method: "GET", url: "/api/v1/map/wards/R-North", headers: { authorization: other.auth } });
    expect(forOther.body).not.toContain(taken);
    expect(forOther.body).not.toContain(acker.id);
  });

  it("lists at most three providers in or near the ward, ambulance and free first, never an unlisted or city-centroid guess", async () => {
    const c = BMC_WARD_CENTROIDS["R-North"];
    const paidNear = await insertProvider({ name: "MapTest Paid Near", lat: c.lat + 0.001, lng: c.lng, costTier: "paid" });
    const ambulance = await insertProvider({
      name: "MapTest Ambulance",
      lat: c.lat + 0.02,
      lng: c.lng,
      kind: "ngo",
      costTier: "free",
      ambulance: true,
    });
    const freeClinic = await insertProvider({ name: "MapTest Free", lat: c.lat + 0.01, lng: c.lng, costTier: "free" });
    await insertProvider({ name: "MapTest Unlisted", lat: c.lat, lng: c.lng, costTier: "free", ambulance: true, listed: false });
    await insertProvider({
      name: "MapTest Mumbai Centroid",
      lat: c.lat,
      lng: c.lng,
      costTier: "free",
      ambulance: true,
      precision: "locality",
      locality: "Mumbai",
    });
    await insertProvider({ name: "MapTest Far", lat: c.lat + 0.2, lng: c.lng, costTier: "free", ambulance: true });

    const res = await app.inject({ method: "GET", url: "/api/v1/map/wards/R-North" });
    const nearby = res.json().data.nearby as Array<Record<string, any>>;
    expect(nearby.length).toBeLessThanOrEqual(3);
    const mine = nearby.filter((p) => p.name.startsWith("MapTest"));
    expect(mine.map((p) => p.id)).toEqual([ambulance, freeClinic, paidNear].slice(0, mine.length));
    expect(mine[0]).toMatchObject({ kind: "ngo", careKind: "ngo", hasAmbulance: true, distanceM: null, geoPrecision: "exact" });
    for (const p of nearby) {
      expect(p.name).not.toMatch(/Unlisted|Mumbai Centroid|Far/);
      for (const k of ["phoneE164", "hoursNote", "is24x7", "costTier", "phoneVerifiedAt", "locality", "lat", "lng"]) {
        expect(p).toHaveProperty(k);
      }
    }
  });
});

describe("GET /api/v1/map/places", () => {
  const box = `${SG.lng - 0.02},${SG.lat - 0.02},${SG.lng + 0.02},${SG.lat + 0.02}`;

  it("returns exact, listed providers inside the box, with the vet/ngo pin kind", async () => {
    const clinic = await insertProvider({ name: "MapTest Clinic", ...SG, kind: "private_clinic" });
    const govt = await insertProvider({ name: "MapTest Govt", lat: SG.lat + 0.01, lng: SG.lng, kind: "govt" });
    const ngo = await insertProvider({ name: "MapTest NGO", lat: SG.lat - 0.01, lng: SG.lng, kind: "ngo", ambulance: true });
    await insertProvider({ name: "MapTest Locality", ...SG, precision: "locality", locality: "Somewhere" });
    await insertProvider({ name: "MapTest Hidden", ...SG, listed: false });
    await insertProvider({ name: "MapTest Outside", lat: SG.lat - 0.1, lng: SG.lng });

    const res = await app.inject({ method: "GET", url: `/api/v1/map/places?bbox=${box}` });
    expect(res.statusCode).toBe(200);
    const places = res.json().data.places as Array<Record<string, any>>;
    const mine = places.filter((p) => p.name.startsWith("MapTest"));
    expect(mine.map((p) => p.id).sort()).toEqual([clinic, govt, ngo].sort());
    expect(mine[0].id).toBe(ngo); // ambulance first
    const byId = Object.fromEntries(places.map((p) => [p.id, p]));
    expect(byId[clinic].kind).toBe("vet");
    expect(byId[govt].kind).toBe("vet");
    expect(byId[ngo].kind).toBe("ngo");
    expect(Object.keys(byId[clinic]).sort()).toEqual(
      [
        "careKind", "confirmed", "hasAmbulance", "hoursNote", "id", "is24x7", "kind", "lat", "lng",
        "locality", "name", "partner", "phoneE164", "wardId",
      ].sort(),
    );
    expect(res.json().data.truncated).toBe(false);

    const vets = (await app.inject({ method: "GET", url: `/api/v1/map/places?bbox=${box}&kind=vet` })).json().data.places;
    expect(vets.map((p: any) => p.id).sort()).toEqual([clinic, govt].sort());
    const ngos = (await app.inject({ method: "GET", url: `/api/v1/map/places?bbox=${box}&kind=ngo` })).json().data.places;
    expect(ngos.map((p: any) => p.id)).toEqual([ngo]);
  });

  it("caps a response at 200 pins and says it was truncated", async () => {
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < 205; i++) {
      params.push(`MapTest Bulk ${String(i).padStart(3, "0")}`, wkt(SG.lat - 0.015 + (i % 15) * 0.002, SG.lng - 0.015 + Math.floor(i / 15) * 0.002));
      values.push(`($${params.length - 1}, 'ngo', 'free', NULL, $${params.length}::geography, 'map-test', TRUE, 'exact')`);
    }
    const res = await query<{ id: string }>(
      `INSERT INTO care_providers (name, kind, cost_tier, phone_e164, geo, source, listed, geo_precision)
       VALUES ${values.join(",")} RETURNING id`,
      params,
    );
    providers.push(...res.rows.map((r) => r.id));

    const out = (await app.inject({ method: "GET", url: `/api/v1/map/places?bbox=${box}` })).json().data;
    expect(out.places).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });

  it("refuses a box entirely outside Mumbai, and clamps one that overlaps it", async () => {
    const outside = await insertProvider({ name: "MapTest Singapore", ...SINGAPORE });
    const inside = await insertProvider({ name: "MapTest Inside", ...SG });
    const sg = `${SINGAPORE.lng - 0.05},${SINGAPORE.lat - 0.05},${SINGAPORE.lng + 0.05},${SINGAPORE.lat + 0.05}`;
    const res = await app.inject({ method: "GET", url: `/api/v1/map/places?bbox=${sg}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("OUTSIDE_MUMBAI");

    // A box the size of half of Asia overlaps Mumbai: clamped to Mumbai, never widened.
    const huge = await app.inject({ method: "GET", url: "/api/v1/map/places?bbox=60,0,110,30" });
    expect(huge.statusCode).toBe(200);
    const got = huge.json().data.places as Array<{ id: string; lat: number; lng: number }>;
    expect(got.map((p) => p.id)).not.toContain(outside);
    expect(got.map((p) => p.id)).toContain(inside);
    for (const p of got) {
      expect(p.lat).toBeGreaterThanOrEqual(MUMBAI_BOUNDS.south);
      expect(p.lat).toBeLessThanOrEqual(MUMBAI_BOUNDS.north);
      expect(p.lng).toBeGreaterThanOrEqual(MUMBAI_BOUNDS.west);
      expect(p.lng).toBeLessThanOrEqual(MUMBAI_BOUNDS.east);
    }
    expect(clampToMumbai([72.9, 19.2, 73.5, 19.8])).toEqual([72.9, 19.2, 73.0, 19.3]);
    expect(clampToMumbai([73.1, 19.0, 73.5, 19.2])).toBeNull();
  });

  it("rejects a malformed or inverted bbox and an unknown kind", async () => {
    for (const q of [
      "",
      "bbox=1,2,3",
      "bbox=a,b,c,d",
      `bbox=${SG.lng + 0.01},${SG.lat},${SG.lng},${SG.lat + 0.01}`,
      `bbox=${box}&kind=clinic`,
    ]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/map/places?${q}` });
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error.code).toBe("INVALID_MAP_QUERY");
    }
  });

  it("maps care kinds onto the two pin kinds", () => {
    expect(pinKind("ngo")).toBe("ngo");
    for (const k of ["private_clinic", "charity_hospital", "govt"]) expect(pinKind(k)).toBe("vet");
  });
});

describe("map caches (hardening batch 1, T8)", () => {
  it("ward detail: one shared 30 s base, public max-age=30 anonymously, private no-store with the viewer's overlay", async () => {
    const d = await insertDog("R-North");
    const early = await openCase(d.id, "serious", "open", 3);
    const anon = await app.inject({ method: "GET", url: "/api/v1/map/wards/R-North" });
    expect(anon.headers["cache-control"]).toBe("public, max-age=30");

    // A case opened after the base was cached is not in it, for anyone.
    const late = await openCase(d.id, "serious", "open", 1);
    const trusted = await insertFeeder(70, true);
    const signedIn = await app.inject({
      method: "GET",
      url: "/api/v1/map/wards/R-North",
      headers: { authorization: trusted.auth },
    });
    expect(signedIn.headers["cache-control"]).toBe("private, no-store");
    const ids = (signedIn.json().data.sos as Array<{ caseId: string | null }>).map((s) => s.caseId);
    expect(ids).toContain(early); // the per-viewer overlay still applies to the shared base
    expect(ids).not.toContain(late);
    const again = await app.inject({ method: "GET", url: "/api/v1/map/wards/R-North" });
    expect((again.json().data.sos as Array<{ caseId: string | null }>).every((s) => s.caseId === null)).toBe(true);

    clearMapCaches();
    const fresh = await app.inject({
      method: "GET",
      url: "/api/v1/map/wards/R-North",
      headers: { authorization: trusted.auth },
    });
    expect((fresh.json().data.sos as Array<{ caseId: string | null }>).map((s) => s.caseId)).toContain(late);
  });

  it("places: all of Mumbai is loaded once per kind and every bbox is filtered from it", async () => {
    const boxA = `${SG.lng - 0.02},${SG.lat - 0.02},${SG.lng},${SG.lat}`;
    const boxB = `${SG.lng},${SG.lat},${SG.lng + 0.02},${SG.lat + 0.02}`;
    expect((await app.inject({ method: "GET", url: `/api/v1/map/places?bbox=${boxA}` })).statusCode).toBe(200);
    // Inserted after the first load, inside a DIFFERENT box: a per-bbox query
    // would find it; the shared all-Mumbai list does not until it turns over.
    const late = await insertProvider({ name: "MapTest Late", lat: SG.lat + 0.01, lng: SG.lng + 0.01 });
    const b1 = await app.inject({ method: "GET", url: `/api/v1/map/places?bbox=${boxB}` });
    expect(b1.headers["cache-control"]).toBe("public, max-age=60");
    expect((b1.json().data.places as Array<{ id: string }>).map((p) => p.id)).not.toContain(late);
    clearMapCaches();
    const b2 = await app.inject({ method: "GET", url: `/api/v1/map/places?bbox=${boxB}` });
    const got = b2.json().data.places as Array<{ id: string; lat: number; lng: number }>;
    expect(got.map((p) => p.id)).toContain(late);
    for (const p of got) {
      expect(p.lng).toBeGreaterThanOrEqual(SG.lng);
      expect(p.lat).toBeGreaterThanOrEqual(SG.lat);
    }
  });
});
