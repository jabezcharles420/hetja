import { BMC_WARD_CODES } from "./schemas.js";

export type BmcWardCode = (typeof BMC_WARD_CODES)[number];

/**
 * Human names for the 24 BMC administrative wards, keyed by the canonical
 * code in BMC_WARD_CODES. The name is the locality a Mumbaikar would say out
 * loud ("Andheri West"), not the administrative code ("K-West"), because the
 * code alone means nothing to most people standing over a dog.
 *
 * A ward covers several localities; the one or two listed are the best-known,
 * not an exhaustive boundary description. Keep this a Record over the code
 * type so adding a code to BMC_WARD_CODES without naming it is a type error.
 *
 * Ward-level only, by design (INVARIANT 2): nothing finer than a ward is ever
 * named on a public surface.
 */
export const BMC_WARD_NAMES: Readonly<Record<BmcWardCode, string>> = {
  A: "Colaba, Fort",
  B: "Sandhurst Road",
  C: "Marine Lines",
  D: "Grant Road, Malabar Hill",
  E: "Byculla",
  "F-North": "Matunga, Sion",
  "F-South": "Parel",
  "G-North": "Dadar, Mahim",
  "G-South": "Worli, Prabhadevi",
  "H-East": "Bandra East, Santacruz East",
  "H-West": "Bandra West, Khar",
  "K-East": "Andheri East",
  "K-West": "Andheri West",
  L: "Kurla",
  "M-East": "Govandi, Mankhurd",
  "M-West": "Chembur",
  N: "Ghatkopar",
  "P-North": "Malad",
  "P-South": "Goregaon",
  "R-Central": "Borivali",
  "R-North": "Dahisar",
  "R-South": "Kandivali",
  S: "Bhandup, Powai",
  T: "Mulund",
};

export function isBmcWardCode(value: string): value is BmcWardCode {
  return (BMC_WARD_CODES as readonly string[]).includes(value);
}

export interface WardDisplay {
  /** Short slash form as BMC signage writes it: "K-West" -> "K/W", "A" -> "A". */
  code: string;
  /** Locality name, or null for a ward id that is not one of the 24 codes. */
  name: string | null;
}

/**
 * Display form of a stored ward id.
 *
 * dogs.ward_id is free TEXT (see BmcWard in schemas.ts), and rows written
 * before the enum existed may hold a non-canonical spelling. Those come back
 * with the id unchanged as `code` and `name: null` rather than a guessed
 * locality: a wrong ward name on a dog's page is worse than no name.
 */
export function wardDisplay(wardId: string): WardDisplay {
  if (!isBmcWardCode(wardId)) return { code: wardId, name: null };
  const [letter, half] = wardId.split("-");
  return {
    code: half ? `${letter}/${half.charAt(0)}` : letter,
    name: BMC_WARD_NAMES[wardId],
  };
}

/** Ward name for a stored ward id, or null when it is not a canonical code. */
export function wardName(wardId: string | null | undefined): string | null {
  if (!wardId || !isBmcWardCode(wardId)) return null;
  return BMC_WARD_NAMES[wardId];
}

export interface WardCentroid {
  lat: number;
  lng: number;
}

/**
 * Approximate centre of each BMC ward, for placing ONE marker per ward on the
 * public map (screen 19). Hand-placed on the populated core of each ward, not
 * computed from boundary polygons: the map only needs a stable, sensible spot
 * for the ward's pill, and a polygon centroid can land in a creek or a
 * national park. Seventeen come from the map mock's own placements (merged
 * C/D split back into C and D), the other seven are placed the same way.
 *
 * A ward centre is not a dog's location and never becomes one: the map shows
 * counts per ward at these fixed points (INVARIANT 2).
 */
export const BMC_WARD_CENTROIDS: Readonly<Record<BmcWardCode, WardCentroid>> = {
  A: { lat: 18.918, lng: 72.828 },
  B: { lat: 18.957, lng: 72.836 },
  C: { lat: 18.948, lng: 72.826 },
  D: { lat: 18.96, lng: 72.808 },
  E: { lat: 18.978, lng: 72.836 },
  "F-North": { lat: 19.042, lng: 72.866 },
  "F-South": { lat: 19.004, lng: 72.845 },
  "G-North": { lat: 19.024, lng: 72.838 },
  "G-South": { lat: 19.0, lng: 72.816 },
  "H-East": { lat: 19.075, lng: 72.856 },
  "H-West": { lat: 19.06, lng: 72.83 },
  "K-East": { lat: 19.115, lng: 72.872 },
  "K-West": { lat: 19.132, lng: 72.828 },
  L: { lat: 19.072, lng: 72.884 },
  "M-East": { lat: 19.049, lng: 72.93 },
  "M-West": { lat: 19.058, lng: 72.899 },
  N: { lat: 19.088, lng: 72.909 },
  "P-North": { lat: 19.19, lng: 72.85 },
  "P-South": { lat: 19.164, lng: 72.848 },
  "R-Central": { lat: 19.232, lng: 72.858 },
  "R-North": { lat: 19.254, lng: 72.861 },
  "R-South": { lat: 19.208, lng: 72.852 },
  S: { lat: 19.14, lng: 72.925 },
  T: { lat: 19.172, lng: 72.955 },
};

/** Ward centre for a stored ward id, or null when it is not a canonical code. */
export function wardCentroid(wardId: string | null | undefined): WardCentroid | null {
  if (!wardId || !isBmcWardCode(wardId)) return null;
  return BMC_WARD_CENTROIDS[wardId];
}

/**
 * The one box Hetja's map lives in: Greater Mumbai (the 24 BMC wards). It is
 * the extent of BMC_WARD_CENTROIDS (18.918..19.254 N, 72.808..72.955 E) with
 * a ~4-5 km margin, so the whole corporation area from Colaba to Dahisar and
 * Mulund fits, and nothing much else. The web map pans and loads tiles only
 * inside it, and GET /api/v1/map/places clamps every query to it.
 */
export const MUMBAI_BOUNDS = { south: 18.88, west: 72.76, north: 19.3, east: 73.0 } as const;
