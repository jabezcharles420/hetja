/**
 * StrayNet CARE directory (public).
 *
 * GET /api/v1/care?lat=&lng=&kind=&max_km=5 — nearest LISTED care providers
 * (NGOs, govt facilities, charity hospitals, private clinics), ordered
 * exact-precision first (by true distance); locality-precision rows after,
 * ranked by has_ambulance/cost_tier/is_24x7/name instead of a fabricated
 * distance (see the ordering comment on CARE_NEARBY_SQL below for why).
 * LIMIT 8. Canonical query: docs/queries/care_nearby.sql, reusing the
 * ST_DWithin pattern already in docs/queries/sos_fanout.sql. Supabase RPC
 * twin: public.get_nearby_care in ops/supabase/03_hardening.sql.
 *
 * distanceM is a fact we can only state when we can measure it. Most rows
 * in `care_providers` right now carry `geo_precision = 'locality'`
 * (migration 0009_care_geo_precision.sql): the seed's own coordinates are
 * ward/locality-centroid ESTIMATES, not geocoded addresses — 25 seeded
 * orgs collapse onto 18 distinct points, so a naive ST_Distance produced a
 * fabricated "0m away" for whichever two/four orgs happen to share a
 * centroid with the caller. On an emergency-adjacent surface (this route is
 * also embedded in the SOS report response, sos.ts), a phantom "0km" can
 * cause someone to skip a real hospital that is actually closer. So
 * `distanceM` is returned ONLY for `geo_precision = 'exact'` rows; every
 * other row returns `distanceM: null` and a human-readable `locality`
 * label instead ("Malad", "Parel", "Sewri") — an honest "distance unknown,
 * in <place>" rather than a confident-looking lie. `geoPrecision` is always
 * surfaced too, so a caller never has to guess which contract applies.
 *
 * INVARIANT 2 does not apply here — it protects *dog and feeder* locations,
 * and a clinic's address is public business information, so provider
 * coordinates are returned at full precision. What must not leak is the
 * *reporter's* position: the inbound lat/lng is never logged at full
 * precision. Fastify's default access log embeds the raw query string in
 * `req.url`, which the pino `redact` config (server.ts) cannot reach — key
 * -based redaction only strips top-level fields, not substrings of another
 * string field — so server.ts additionally strips query strings from logged
 * URLs. This route itself never logs `req.query`.
 *
 * phone_verified_at is surfaced (as `phoneVerifiedAt`, nullable) rather than
 * collapsed into a boolean, so a caller can be told a number is unconfirmed
 * instead of it being silently hidden (plan §2.1/§3.4) — "a possibly-stale
 * number beats none, but the user is told which it is."
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "@straynet/db";

const MAX_RESULTS = 8;
const MAX_KM_CAP = 25;
const DEFAULT_MAX_KM = 5;

const CareKind = z.enum(["ngo", "govt", "charity_hospital", "private_clinic"]);

const CareQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  kind: CareKind.optional(),
  max_km: z.coerce.number().positive().max(MAX_KM_CAP).default(DEFAULT_MAX_KM),
});

interface CareProviderRow {
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
  geo_precision: string;
  locality: string | null;
  lat: string;
  lng: string;
  distance_m: string;
}

export interface NearbyCareProvider {
  id: string;
  name: string;
  kind: string;
  costTier: string;
  phoneE164: string | null;
  altPhoneE164: string | null;
  hasAmbulance: boolean;
  is24x7: boolean;
  hoursNote: string | null;
  handlesWildlife: boolean;
  phoneVerifiedAt: string | null;
  geoPrecision: "exact" | "locality";
  locality: string | null;
  lat: number;
  lng: number;
  // Measured distance in metres, ONLY when geoPrecision is "exact". null
  // for a "locality" row means "unmeasured", not "zero" or "unknown but
  // close" — never render it as a number. Use `locality` instead.
  distanceM: number | null;
}

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

// Canonical query — kept in lockstep with docs/queries/care_nearby.sql and
// the Supabase RPC twin public.get_nearby_care (ops/supabase/03_hardening.sql).
//
// Ordering: exact-precision rows first (a real measurement is always worth
// surfacing ahead of a guess), true distance ascending within that group.
// Then locality-precision rows -- for THOSE, ST_Distance is not used for
// ordering at all (it is still selected, and dropped before the response
// leaves getNearbyCare() below, so it can never be mistaken for a measured
// value by a caller): with 25 of 25 seeded providers collapsed onto 18
// centroid points, ranking that group by a fabricated distance is ranking
// by noise while looking authoritative -- a caller reads position 1 as
// "nearest" regardless. Instead, locality-precision rows are ranked by what
// actually helps in an emergency: has_ambulance DESC, then cost_tier (the
// care_cost_tier enum's own declared order -- free, subsidised, paid --
// hence the unaliased, table-qualified `care_providers.cost_tier` below: a
// bare `cost_tier` in ORDER BY would resolve to this query's own
// `cost_tier::text` output alias instead and sort alphabetically -- free,
// paid, subsidised -- silently wrong), then is_24x7 DESC, then name for a
// stable order.
const CARE_NEARBY_SQL = `
SELECT
  id, name, kind::text AS kind, cost_tier::text AS cost_tier,
  phone_e164, alt_phone_e164, has_ambulance, is_24x7, hours_note,
  handles_wildlife, phone_verified_at,
  geo_precision::text AS geo_precision, locality,
  -- SECURITY-GATE: public-coordinates -- these are veterinary clinics and NGO
  -- offices, i.e. published business addresses, not dog or feeder locations.
  -- INVARIANT 2 coarsens the location of a *subject* of the register; a clinic
  -- is a destination the user is being sent to, and rounding it would break the
  -- directions link. The reporter's own coordinate is never stored, and the
  -- querystring is stripped from access logs (see the serializer in server.ts).
  ST_Y(geo::geometry) AS lat,
  ST_X(geo::geometry) AS lng,
  ST_Distance(geo, $1::geography) AS distance_m
FROM care_providers
WHERE listed
  AND ST_DWithin(geo, $1::geography, $2)
  AND ($3::care_kind IS NULL OR kind = $3::care_kind)
ORDER BY
  (geo_precision = 'exact') DESC,
  CASE WHEN geo_precision = 'exact' THEN ST_Distance(geo, $1::geography) END,
  has_ambulance DESC,
  care_providers.cost_tier,
  is_24x7 DESC,
  name
LIMIT ${MAX_RESULTS};
`;

/**
 * Nearest listed care providers for a point. Exact-precision rows carry a
 * real `distanceM` (rounded to the nearest 100m); locality-precision rows
 * carry `distanceM: null` plus a `locality` label. Shared by GET /api/v1/care
 * and POST /api/v1/reports (sos.ts) so an SOS report response can return a
 * callable number immediately, rather than the reporter waiting out the
 * 8-minute escalation timer (plan §2.4).
 */
export async function getNearbyCare(
  lat: number,
  lng: number,
  maxKm: number = DEFAULT_MAX_KM,
  kind?: string | null,
): Promise<NearbyCareProvider[]> {
  const cappedKm = Math.min(maxKm, MAX_KM_CAP);
  const res = await query<CareProviderRow>(CARE_NEARBY_SQL, [
    geoWkt(lat, lng),
    cappedKm * 1000,
    kind ?? null,
  ]);
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    costTier: row.cost_tier,
    phoneE164: row.phone_e164,
    altPhoneE164: row.alt_phone_e164,
    hasAmbulance: row.has_ambulance,
    is24x7: row.is_24x7,
    hoursNote: row.hours_note,
    handlesWildlife: row.handles_wildlife,
    phoneVerifiedAt: row.phone_verified_at ? new Date(row.phone_verified_at).toISOString() : null,
    geoPrecision: row.geo_precision === "exact" ? "exact" : "locality",
    locality: row.locality,
    lat: Number(row.lat),
    lng: Number(row.lng),
    distanceM:
      row.geo_precision === "exact" ? Math.round(Number(row.distance_m) / 100) * 100 : null,
  }));
}

export default async function careRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/care", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = CareQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid care query", code: "INVALID_CARE_QUERY" } });
    }
    const { lat, lng, kind, max_km } = parsed.data;

    const providers = await getNearbyCare(lat, lng, max_km, kind);

    return { ok: true, data: { providers } };
  });
}
