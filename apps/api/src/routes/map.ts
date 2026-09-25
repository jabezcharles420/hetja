/**
 * Hetja MAP (public): the data behind screen 19, the map of Mumbai.
 *
 *   GET /api/v1/map/wards           every BMC ward with its counts, at a fixed
 *                                   ward centre (never a dog's position)
 *   GET /api/v1/map/wards/:wardId   one ward: counts, its open SOS cases
 *                                   (severity, time, state; nothing else) and
 *                                   up to three care providers in or near it
 *   GET /api/v1/map/places?bbox=    listed vets and NGOs with a real
 *                                   (geocoded) point inside a box, for pins;
 *                                   the box is clamped to MUMBAI_BOUNDS and
 *                                   one entirely outside Mumbai is a 400
 *
 * WARD-LEVEL ONLY (INVARIANT 2). Dogs and SOS cases are only ever counted per
 * ward; the lat/lng on a ward row is the static centre from @hetja/contracts
 * (BMC_WARD_CENTROIDS), the same for every request, so it cannot leak where
 * any dog, reporter or feeder is. No SOS row carries a note, a reporter, a
 * photo or a position.
 *
 * NO PERSONAL CONTACT INFO (INVARIANT 3). The only phone numbers here are the
 * published numbers of organisations in care_providers, exactly as
 * GET /api/v1/care serves them.
 *
 * DEFINITIONS, so the numbers mean one thing everywhere:
 *   dogs         dogs.status = 'active' in the ward
 *   notFedToday  active dogs with no non-rejected feed scan captured since
 *                midnight in Mumbai (Asia/Kolkata), whatever the server's own
 *                time zone is
 *   sosOpen      sos_cases in open / acked / escalated for the ward's dogs
 *                (any dog status: a dog marked lost can still be hurt)
 *
 * CASE IDS ARE NOT PUBLIC. POST /api/v1/sos/cases/:id/ack is first writer
 * wins, and a claimed case stops escalating (worker escalate_sos only promotes
 * state = 'open'), so publishing case ids on an anonymous map would invite
 * anyone to claim them. The ack route now enforces the responder rules itself
 * (lib/sos-eligibility.ts, hardening batch 1), and this read applies the same
 * rules: the ward detail returns `caseId: null` unless the caller presents a
 * valid access token AND meets them (sos_opt_in and trust_score >= 40, or
 * >= 60 for critical), or already holds the case.
 *
 * CACHING (hardening batch 1, T8). Three separate read-through LRUs, so a
 * flood of one kind of request cannot evict the others:
 *
 *   wards list      60 s, one entry
 *   ward detail     30 s, one entry per ward (24 at most). The SHARED base
 *                   (counts, cases, nearby) is cached for every caller and the
 *                   per-viewer overlay (which case ids this caller may see) is
 *                   applied on each request. Anonymous answers are
 *                   `public, max-age=30`; a signed-in answer is
 *                   `private, no-store`, because its case ids are the caller's.
 *   places          60 s, one entry per pin kind (all, vet, ngo): every exact
 *                   pin in Mumbai is loaded ONCE and each bbox is filtered in
 *                   memory, so arbitrary boxes cannot each cost a query or fill
 *                   the cache with one-off keys.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LRUCache } from "lru-cache";
import { z } from "zod";
import { BMC_WARD_CENTROIDS, BMC_WARD_CODES, MUMBAI_BOUNDS, isBmcWardCode, wardDisplay } from "@hetja/contracts";
import { query } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";
import { normalizeIndianPhone } from "../lib/phone.js";
import { TRUST_FLOOR, canRespond as canRespondShared } from "../lib/sos-eligibility.js";

const CACHE_TTL_MS = 60_000;
/** Ward detail carries open SOS state, so it turns over twice as fast. */
const WARD_DETAIL_TTL_MS = 30_000;
const MAX_PLACES = 200;
/** "Near" a ward, for the ward sheet's list: within this of its centre. */
const NEARBY_RADIUS_M = 4000;
const NEARBY_LIMIT = 3;
type Severity = keyof typeof TRUST_FLOOR;

export interface MapWard {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  dogs: number;
  notFedToday: number;
  sosOpen: number;
  latestSos: { severity: Severity; raisedAt: string } | null;
}

export interface MapSos {
  caseId: string | null;
  severity: Severity;
  raisedAt: string;
  state: "open" | "acked" | "escalated";
  /** Responders were paged for it (a feeder notification exists). */
  feedersTold: boolean;
  /** The caller holds this case (only ever true for a signed-in caller). */
  mine: boolean;
  dogName: string | null;
  taken: boolean;
}

export interface MapPlace {
  id: string;
  name: string;
  kind: "vet" | "ngo";
  careKind: string;
  wardId: string | null;
  locality: string | null;
  lat: number;
  lng: number;
  hoursNote: string | null;
  is24x7: boolean;
  hasAmbulance: boolean;
  phoneE164: string | null;
  /** A human confirmed the number with the provider (phone_verified_at). */
  confirmed: boolean;
  /** Also a contracted partner clinic, which SOS escalation pages. */
  partner: boolean;
}

/** GET /map/wards. */
export const mapCache = new LRUCache<string, object>({ max: 4, ttl: CACHE_TTL_MS });
/** GET /map/wards/:wardId, the shared (viewer-independent) base per ward. */
export const wardDetailCache = new LRUCache<string, WardDetailBase>({ max: 32, ttl: WARD_DETAIL_TTL_MS });
/** GET /map/places, every exact pin in Mumbai per pin kind. */
export const placesCache = new LRUCache<string, MapPlace[]>({ max: 4, ttl: CACHE_TTL_MS });

/** Test seam: empty every map cache. */
export function clearMapCaches(): void {
  mapCache.clear();
  wardDetailCache.clear();
  placesCache.clear();
}

/** Mumbai midnight, as a timestamptz, computed in SQL so the server TZ never matters. */
const IST_MIDNIGHT_SQL = `(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;

const WARD_COUNTS_SQL = `
WITH dog_counts AS (
  SELECT d.ward_id,
         count(*)::int AS dogs,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM scans s
            WHERE s.dog_id = d.id
              AND s.scan_type = 'feed'
              AND s.review_status <> 'rejected'
              AND s.captured_at >= ${IST_MIDNIGHT_SQL}
         ))::int AS not_fed
    FROM dogs d
   WHERE d.status = 'active' AND d.ward_id = ANY($1::text[])
   GROUP BY d.ward_id
),
open_cases AS (
  -- LEFT JOIN + COALESCE (design v6): a dogless SOS has a ward and no dog.
  SELECT COALESCE(c.ward_id, d.ward_id) AS ward_id, c.severity::text AS severity, c.opened_at
    FROM sos_cases c
    LEFT JOIN dogs d ON d.id = c.dog_id
   WHERE c.state IN ('open', 'acked', 'escalated') AND COALESCE(c.ward_id, d.ward_id) = ANY($1::text[])
),
sos_counts AS (
  SELECT ward_id, count(*)::int AS sos_open FROM open_cases GROUP BY ward_id
),
latest AS (
  SELECT DISTINCT ON (ward_id) ward_id, severity, opened_at
    FROM open_cases
   ORDER BY ward_id, opened_at DESC
)
SELECT w.ward_id,
       COALESCE(dc.dogs, 0) AS dogs,
       COALESCE(dc.not_fed, 0) AS not_fed,
       COALESCE(sc.sos_open, 0) AS sos_open,
       l.severity AS latest_severity,
       l.opened_at AS latest_opened_at
  FROM unnest($1::text[]) AS w(ward_id)
  LEFT JOIN dog_counts dc ON dc.ward_id = w.ward_id
  LEFT JOIN sos_counts sc ON sc.ward_id = w.ward_id
  LEFT JOIN latest l ON l.ward_id = w.ward_id
`;

interface WardCountRow {
  ward_id: string;
  dogs: number;
  not_fed: number;
  sos_open: number;
  latest_severity: string | null;
  latest_opened_at: Date | null;
}

const WARD_CASES_SQL = `
SELECT c.id, c.severity::text AS severity, c.state::text AS state, c.opened_at, c.acked_by,
       d.name AS dog_name,
       EXISTS (SELECT 1 FROM sos_notifications n
                WHERE n.case_id = c.id AND n.feeder_id IS NOT NULL) AS feeders_told
  FROM sos_cases c
  LEFT JOIN dogs d ON d.id = c.dog_id
 WHERE COALESCE(c.ward_id, d.ward_id) = $1 AND c.state IN ('open', 'acked', 'escalated')
 ORDER BY (c.severity = 'critical') DESC, c.opened_at DESC
 LIMIT 20
`;

interface WardCaseRow {
  id: string;
  severity: string;
  state: string;
  opened_at: Date;
  acked_by: string | null;
  feeders_told: boolean;
  dog_name: string | null;
}

// Design v6 (M1): the city summary line. Counts only, never a position.
// "Not logged today" rather than "not fed": Hetja knows what was logged.
const CITY_SUMMARY_SQL = `
SELECT count(*)::int AS dogs,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM collars k WHERE k.dog_id = d.id AND k.status = 'active'))::int
         AS with_collars,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM scans s
          WHERE s.dog_id = d.id AND s.scan_type = 'feed' AND s.review_status <> 'rejected'
            AND s.captured_at >= ${IST_MIDNIGHT_SQL}))::int AS fed_today,
       (SELECT count(DISTINCT s.feeder_id)::int FROM scans s
         WHERE s.scan_type = 'feed' AND s.feeder_id IS NOT NULL AND s.review_status <> 'rejected'
           AND s.received_at >= now() - interval '60 days') AS feeders
  FROM dogs d
 WHERE d.status = 'active'
`;

// M1 SOS rows: the dog's name and whether someone took it. No case id on
// this public, cached read (case ids are handed out per viewer on the ward
// detail only), no note, no reporter, no position.
const CITY_SOS_SQL = `
SELECT COALESCE(c.ward_id, d.ward_id) AS ward_id, c.severity::text AS severity, c.opened_at,
       d.name AS dog_name, c.acked_by IS NOT NULL AS taken
  FROM sos_cases c
  LEFT JOIN dogs d ON d.id = c.dog_id
 WHERE c.state IN ('open', 'acked', 'escalated')
 ORDER BY (c.severity = 'critical') DESC, c.opened_at DESC
 LIMIT 20
`;

// M2 / M6: the ward's dogs by name, and the ones nobody logged today with
// when they were last logged. Names and times: ward level (INVARIANT 2).
const WARD_DOGS_SQL = `
SELECT d.slug, d.name,
       (SELECT max(s.captured_at) FROM scans s
         WHERE s.dog_id = d.id AND s.scan_type = 'feed' AND s.review_status <> 'rejected') AS last_logged_at
  FROM dogs d
 WHERE d.status = 'active' AND d.ward_id = $1
 ORDER BY d.name NULLS LAST, d.slug
 LIMIT 200
`;

// Columns every provider read selects. Same public fields as GET /api/v1/care.
const PROVIDER_COLUMNS = `
  id, name, kind::text AS kind, cost_tier::text AS cost_tier,
  phone_e164, alt_phone_e164, has_ambulance, is_24x7, hours_note,
  handles_wildlife, phone_verified_at, vet_id IS NOT NULL AS partner,
  geo_precision::text AS geo_precision, locality, ward_id,
  -- SECURITY-GATE: public-coordinates -- veterinary clinics and NGO offices,
  -- i.e. published business addresses, not dog or feeder locations (the same
  -- justification as routes/care.ts). Dogs are never selected here.
  ST_Y(geo::geometry) AS lat,
  ST_X(geo::geometry) AS lng`;

// Nearby for a ward: in the ward, or within NEARBY_RADIUS_M of its centre.
// A locality-precision row whose locality is only "Mumbai" sits on the city
// centroid, which is "near" whichever wards surround that point by accident,
// so it only counts when its ward_id says so. Ranked like care.ts ranks rows
// it cannot measure: ambulance first, then the cost tier's declared order
// (free, subsidised, paid; table-qualified so the enum order is used), then
// 24x7, then real points ahead of estimates, then distance, then name.
const NEARBY_SQL = `
SELECT ${PROVIDER_COLUMNS}
  FROM care_providers
 WHERE listed
   AND (ward_id = $1
        OR (ST_DWithin(geo, $2::geography, ${NEARBY_RADIUS_M})
            AND NOT (geo_precision = 'locality' AND COALESCE(locality, 'Mumbai') = 'Mumbai')))
 ORDER BY has_ambulance DESC,
          care_providers.cost_tier,
          is_24x7 DESC,
          (geo_precision = 'exact') DESC,
          ST_Distance(geo, $2::geography),
          name
 LIMIT ${NEARBY_LIMIT}
`;

// Pins: exact points only. A locality-precision row would be drawn on a
// centroid guess, i.e. in the wrong place, so it never gets a pin. Loaded for
// the whole Mumbai box at once (see CACHING above); $1..$4 are MUMBAI_BOUNDS.
// The LIMIT is a sanity ceiling far above the curated directory's size.
const PLACES_SQL = `
SELECT ${PROVIDER_COLUMNS}
  FROM care_providers
 WHERE listed
   AND geo_precision = 'exact'
   AND ST_Intersects(geo, ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography)
   AND ($5::text IS NULL
        OR ($5 = 'ngo' AND kind = 'ngo')
        OR ($5 = 'vet' AND kind <> 'ngo'))
 ORDER BY has_ambulance DESC, is_24x7 DESC, name, id
 LIMIT 5000
`;

interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  cost_tier: string;
  phone_e164: string | null;
  alt_phone_e164: string | null;
  has_ambulance: boolean;
  is_24x7: boolean;
  hours_note: string | null;
  handles_wildlife: boolean;
  phone_verified_at: Date | string | null;
  partner: boolean;
  geo_precision: string;
  locality: string | null;
  ward_id: string | null;
  lat: string | number;
  lng: string | number;
}

/** Same read-path normalisation as care.ts: E.164 when parseable, else as stored. */
function dialable(stored: string | null): string | null {
  if (stored === null) return null;
  return normalizeIndianPhone(stored) ?? stored;
}

/** private_clinic / charity_hospital / govt -> "vet"; ngo -> "ngo" (the mock's two pins). */
export function pinKind(careKind: string): "vet" | "ngo" {
  return careKind === "ngo" ? "ngo" : "vet";
}

function toPlace(row: ProviderRow): MapPlace {
  return {
    id: row.id,
    name: row.name,
    kind: pinKind(row.kind),
    careKind: row.kind,
    wardId: row.ward_id && isBmcWardCode(row.ward_id) ? row.ward_id : null,
    locality: row.locality,
    lat: Number(row.lat),
    lng: Number(row.lng),
    hoursNote: row.hours_note,
    is24x7: row.is_24x7,
    hasAmbulance: row.has_ambulance,
    phoneE164: dialable(row.phone_e164),
    confirmed: row.phone_verified_at !== null,
    partner: row.partner,
  };
}

/** The GET /api/v1/care shape, plus the map's pin kind and ward. */
function toNearby(row: ProviderRow) {
  return {
    ...toPlace(row),
    costTier: row.cost_tier,
    altPhoneE164: dialable(row.alt_phone_e164),
    handlesWildlife: row.handles_wildlife,
    phoneVerifiedAt: row.phone_verified_at ? new Date(row.phone_verified_at).toISOString() : null,
    geoPrecision: row.geo_precision === "exact" ? ("exact" as const) : ("locality" as const),
    // Distance from a ward centre is not a distance from the caller: never stated.
    distanceM: null,
  };
}

function asSeverity(value: string | null): Severity {
  return value === "critical" || value === "serious" || value === "minor" ? value : "serious";
}

async function wardCounts(ids: readonly string[]): Promise<Map<string, WardCountRow>> {
  const res = await query<WardCountRow>(WARD_COUNTS_SQL, [ids]);
  return new Map(res.rows.map((r) => [r.ward_id, r]));
}

function toWard(id: string, row: WardCountRow | undefined): MapWard {
  const display = wardDisplay(id);
  const centre = BMC_WARD_CENTROIDS[id as keyof typeof BMC_WARD_CENTROIDS];
  return {
    id,
    code: display.code,
    name: display.name ?? id,
    lat: centre.lat,
    lng: centre.lng,
    dogs: row?.dogs ?? 0,
    notFedToday: row?.not_fed ?? 0,
    sosOpen: row?.sos_open ?? 0,
    latestSos:
      row?.latest_opened_at
        ? { severity: asSeverity(row.latest_severity), raisedAt: new Date(row.latest_opened_at).toISOString() }
        : null,
  };
}

interface Viewer {
  feederId: string;
  sosOptIn: boolean;
  trustScore: number;
  /** Design v5: feeders.wards; the ward rule in lib/sos-eligibility.ts. */
  wards: string[];
  /** Design v6: a paused feeder has no standing (lib/sos-eligibility.ts). */
  pausedUntil: Date | null;
}

/**
 * The caller, when they present a valid access token for an account that still
 * exists; otherwise null. Never a 401: this is a public read, and an expired
 * token simply gets the anonymous answer.
 */
async function optionalViewer(req: FastifyRequest): Promise<Viewer | null> {
  const raw = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  if (!raw.startsWith("Bearer ")) return null;
  let feederId: string;
  try {
    feederId = verifyAccessToken(raw.slice(7), req.server.config.JWT_SECRET).sub as string;
  } catch {
    return null;
  }
  const res = await query<{ sos_opt_in: boolean; trust_score: number; wards: string[]; sos_paused_until: Date | null }>(
    `SELECT sos_opt_in, trust_score, wards, sos_paused_until FROM feeders WHERE id = $1 AND deleted_at IS NULL`,
    [feederId],
  );
  const row = res.rows[0];
  return row
    ? {
        feederId,
        sosOptIn: row.sos_opt_in,
        trustScore: row.trust_score,
        wards: row.wards ?? [],
        pausedUntil: row.sos_paused_until,
      }
    : null;
}

/** The shared responder rule (lib/sos-eligibility.ts), re-exported for existing callers. */
export function canRespond(
  viewer: (Pick<Viewer, "sosOptIn" | "trustScore"> & { wards?: string[]; pausedUntil?: Date | null }) | null,
  severity: Severity,
  wardId?: string | null,
): boolean {
  return canRespondShared(viewer, severity, wardId);
}

interface WardDetailBase {
  ward: MapWard;
  cases: WardCaseRow[];
  nearby: ReturnType<typeof toNearby>[];
  dogNames: string[];
  notLoggedToday: { name: string | null; lastLoggedAt: string | null }[];
}

const BboxQuery = z.object({
  bbox: z
    .string()
    .max(120)
    .transform((s) => s.split(",").map((v) => Number(v)))
    .refine((a) => a.length === 4 && a.every((n) => Number.isFinite(n)), "bbox needs four numbers")
    .refine(
      ([minLng, minLat, maxLng, maxLat]) =>
        minLng >= -180 && maxLng <= 180 && minLat >= -90 && maxLat <= 90 && minLng < maxLng && minLat < maxLat,
      "bbox must be minLng,minLat,maxLng,maxLat",
    ),
  kind: z.enum(["vet", "ngo"]).optional(),
});

/** The part of a bbox inside MUMBAI_BOUNDS, or null when they do not overlap. */
export function clampToMumbai(b: readonly number[]): [number, number, number, number] | null {
  const minLng = Math.max(b[0], MUMBAI_BOUNDS.west);
  const minLat = Math.max(b[1], MUMBAI_BOUNDS.south);
  const maxLng = Math.min(b[2], MUMBAI_BOUNDS.east);
  const maxLat = Math.min(b[3], MUMBAI_BOUNDS.north);
  return minLng < maxLng && minLat < maxLat ? [minLng, minLat, maxLng, maxLat] : null;
}

async function readThrough<V extends object>(
  cache: LRUCache<string, V>,
  key: string,
  load: () => Promise<V>,
): Promise<V> {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = await load();
  cache.set(key, value);
  return value;
}

/** A place whose pin lies inside [minLng, minLat, maxLng, maxLat] (edges included). */
function inBox(p: MapPlace, box: readonly [number, number, number, number]): boolean {
  return p.lng >= box[0] && p.lat >= box[1] && p.lng <= box[2] && p.lat <= box[3];
}

export default async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/map/wards", async (_req: FastifyRequest, reply: FastifyReply) => {
    const data = await readThrough(mapCache, "wards", async () => {
      const [counts, summary, sos] = await Promise.all([
        wardCounts(BMC_WARD_CODES),
        query<{ dogs: number; with_collars: number; fed_today: number; feeders: number }>(CITY_SUMMARY_SQL),
        query<{ ward_id: string | null; severity: string; opened_at: Date; dog_name: string | null; taken: boolean }>(
          CITY_SOS_SQL,
        ),
      ]);
      const sum = summary.rows[0];
      return {
        wards: BMC_WARD_CODES.map((id) => toWard(id, counts.get(id))),
        // Design v6 (M1).
        summary: {
          dogs: sum?.dogs ?? 0,
          withCollars: sum?.with_collars ?? 0,
          feeders: sum?.feeders ?? 0,
          fedToday: sum?.fed_today ?? 0,
          notLoggedToday: Math.max(0, (sum?.dogs ?? 0) - (sum?.fed_today ?? 0)),
        },
        sos: sos.rows
          .filter((r) => r.ward_id && isBmcWardCode(r.ward_id))
          .map((r) => ({
            wardId: r.ward_id as string,
            wardCode: wardDisplay(r.ward_id as string).code,
            severity: asSeverity(r.severity),
            raisedAt: new Date(r.opened_at).toISOString(),
            dogName: r.dog_name ?? null,
            taken: r.taken,
          })),
      };
    });
    reply.header("Cache-Control", "public, max-age=60");
    return { ok: true, data };
  });

  app.get("/api/v1/map/wards/:wardId", async (req: FastifyRequest, reply: FastifyReply) => {
    const wardId = (req.params as { wardId: string }).wardId;
    if (!isBmcWardCode(wardId)) {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "no such ward", code: "UNKNOWN_WARD" } });
    }

    const viewer = await optionalViewer(req);
    const centre = BMC_WARD_CENTROIDS[wardId];
    // The base is the same for every caller and shared through the 30 s cache;
    // only the overlay below (which case ids THIS caller may see) is per viewer.
    const base = await readThrough(wardDetailCache, wardId, async (): Promise<WardDetailBase> => {
      const [counts, cases, nearby, wardDogs, midnight] = await Promise.all([
        wardCounts([wardId]),
        query<WardCaseRow>(WARD_CASES_SQL, [wardId]),
        query<ProviderRow>(NEARBY_SQL, [wardId, `SRID=4326;POINT(${centre.lng} ${centre.lat})`]),
        query<{ slug: string; name: string | null; last_logged_at: Date | null }>(WARD_DOGS_SQL, [wardId]),
        query<{ at: Date }>(`SELECT ${IST_MIDNIGHT_SQL} AS at`),
      ]);
      const since = midnight.rows[0].at.getTime();
      return {
        ward: toWard(wardId, counts.get(wardId)),
        cases: cases.rows,
        nearby: nearby.rows.map(toNearby),
        dogNames: wardDogs.rows.map((d) => d.name).filter((n): n is string => !!n),
        notLoggedToday: wardDogs.rows
          .filter((d) => !d.last_logged_at || d.last_logged_at.getTime() < since)
          .slice(0, 30)
          // Names and times, no slugs: this read is public and cached, and a
          // slug list per ward would be the register without a rate limit
          // (GET /wards/:id/dogs is the rate-limited way to a slug).
          .map((d) => ({
            name: d.name ?? null,
            lastLoggedAt: d.last_logged_at ? d.last_logged_at.toISOString() : null,
          })),
      };
    });
    reply.header("Cache-Control", viewer ? "private, no-store" : "public, max-age=30");

    const sos: MapSos[] = base.cases.map((c) => {
      const severity = asSeverity(c.severity);
      const mine = !!viewer && c.acked_by === viewer.feederId;
      const claimable = c.acked_by === null && canRespond(viewer, severity, wardId);
      return {
        caseId: mine || claimable ? c.id : null,
        severity,
        raisedAt: new Date(c.opened_at).toISOString(),
        state: c.state as MapSos["state"],
        feedersTold: c.feeders_told,
        mine,
        // Design v6 (M2): the dog's name and whether someone took it.
        dogName: c.dog_name ?? null,
        taken: c.acked_by !== null,
      };
    });

    return {
      ok: true,
      data: {
        ...base.ward,
        sos,
        nearby: base.nearby,
        dogNames: base.dogNames,
        notLoggedToday: base.notLoggedToday,
        viewer: viewer
          ? {
              sosOptIn: viewer.sosOptIn,
              trustScore: viewer.trustScore,
              canRespond: (["minor", "serious", "critical"] as const).filter((s) => canRespond(viewer, s, wardId)),
            }
          : null,
      },
    };
  });

  app.get("/api/v1/map/places", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = BboxQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          message: "invalid places query: bbox=minLng,minLat,maxLng,maxLat, kind=vet|ngo",
          code: "INVALID_MAP_QUERY",
        },
      });
    }
    // Mumbai only: a box that misses Mumbai is refused, a box that overlaps it
    // is clamped to it, so no query ever reaches past the BMC area.
    const box = clampToMumbai(parsed.data.bbox);
    if (!box) {
      return reply.status(400).send({
        ok: false,
        error: { message: "bbox is outside Mumbai; the map covers the 24 BMC wards only", code: "OUTSIDE_MUMBAI" },
      });
    }
    const kind = parsed.data.kind ?? null;
    const all = await readThrough(placesCache, kind ?? "all", async () => {
      const res = await query<ProviderRow>(PLACES_SQL, [
        MUMBAI_BOUNDS.west,
        MUMBAI_BOUNDS.south,
        MUMBAI_BOUNDS.east,
        MUMBAI_BOUNDS.north,
        kind,
      ]);
      return res.rows.map(toPlace);
    });
    // Already in the SQL order (ambulance, 24x7, name, id), so filtering keeps it.
    const inside = all.filter((p) => inBox(p, box));
    reply.header("Cache-Control", "public, max-age=60");
    return {
      ok: true,
      data: { places: inside.slice(0, MAX_PLACES), truncated: inside.length > MAX_PLACES },
    };
  });
}
