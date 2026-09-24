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
