// Hetja care-directory agent: shared gates and helpers.
//
// These mirror the INTENT of packages/db/src/import-care-verified.ts, which is
// the authoritative one-off importer, without importing it: that module builds
// a pg Pool at import time, which must not happen in a script that never
// touches the database.
//
// The final authority on ward, geometry, kind, cost tier and phone is still
// `pnpm --filter @hetja/db import:care`. These gates only prune obvious noise
// before a human reads the file, so everything that survives here is still
// just a candidate.

/** The one box Hetja's map lives in (packages/contracts MUMBAI_BOUNDS). */
export const MUMBAI_BOUNDS = { south: 18.88, west: 72.76, north: 19.3, east: 73.0 };

/** The 24 BMC ward codes, as care_providers.ward_id stores them. */
export const BMC_WARD_CODES = [
  "A", "B", "C", "D", "E", "F-North", "F-South", "G-North", "G-South",
  "H-East", "H-West", "K-East", "K-West", "L", "M-East", "M-West",
  "N", "P-North", "P-South", "R-Central", "R-North", "R-South", "S", "T",
];

/** Human names, for the per-ward discovery search. */
export const BMC_WARD_NAMES = {
  A: "Colaba Fort", B: "Sandhurst Road", C: "Marine Lines",
  D: "Grant Road Malabar Hill", E: "Byculla", "F-North": "Matunga Sion",
  "F-South": "Parel", "G-North": "Dadar Mahim", "G-South": "Worli Prabhadevi",
  "H-East": "Bandra East Santacruz East", "H-West": "Bandra West Khar",
  "K-East": "Andheri East", "K-West": "Andheri West", L: "Kurla",
  "M-East": "Govandi Mankhurd", "M-West": "Chembur", N: "Ghatkopar",
  "P-North": "Malad", "P-South": "Goregaon", "R-Central": "Borivali",
  "R-North": "Dahisar", "R-South": "Kandivali", S: "Bhandup Powai",
  T: "Mulund",
};

export function inMumbai(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= MUMBAI_BOUNDS.south &&
    lat <= MUMBAI_BOUNDS.north &&
    lng >= MUMBAI_BOUNDS.west &&
    lng <= MUMBAI_BOUNDS.east
  );
}

/** Case/punctuation-insensitive key: "The Welfare Of Stray Dogs" === "welfare of stray dogs". */
export function normalizeName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Stable id from a name: lowercase, non-alphanumerics to single dashes. */
export function slug(name) {
  return normalizeName(name).replace(/\s+/g, "-");
}

const FOREIGN =
  /\b(wichita|kansas|florida|new york|california|ohio|berlin|paris|seattle|st\.?\s?hubert|oregon|pennsylvania|new jersey|virginia|michigan|illinois|texas|arizona|colorado|georgia|carolina|tennessee|missouri|minnesota|wisconsin|louisiana|alabama|mississippi|kentucky|indiana|iowa|nebraska|arkansas|oklahoma|canada|australia|england|scotland|ireland|france|germany|spain|italy|switzerland|netherlands|austria|poland|sweden|norway|denmark|finland|japan|china|thailand|singapore|malaysia|dubai|uae|qatar|kuwait|south africa|brazil|mexico|argentina|philippines|nepal|sri lanka|bangladesh)\b/i;

const NEWS = /the times of india|hindustan times|indian express|news18|ndtv|mid-day|mumbai mirror/i;

const JUNK =
  /company profile|get notified|privacy policy|terms of use|contact us|about us|donate|donation|donate supplies|toll free|customer service|contact details|contact information|adoption fee|adoptions|images and|photo by|stock photos|wikipedia|justdial|practo|sulekha|faq\b|list of |top \d|best \d|near me\b|click here|read more/i;

const STOP_START = /^(the|a|an|of|for|in|on|and|to|at)\s/i;

// A real organisation name is a noun phrase; lowercase mid-string stopwords are
// the tell that this is a sentence or article title.
const SENTENCE =
  / (is|are|was|were|has|have|had) (now|open|a |an |the |being|offering|a registered|an animal|animals?|here|home|their|recognised|recognized)\b/i;

const TRUNCATED = /\b(the|for|and|is|are|of|to|in|on|with|at|as|by|from|into|about)\s*$/i;

/**
 * Is this a plausible organisation name? Returns { ok, reason }.
 * Reason is one of: empty, too-short, too-long, handle, foreign, news,
 * junk, stopword-start, sentence-fragment, truncated.
 */
export function nameGate(name) {
  const raw = String(name ?? "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return { ok: false, reason: "empty" };
  if (raw.length < 5) return { ok: false, reason: "too-short" };
  if (raw.length > 90) return { ok: false, reason: "too-long" };
  if (raw.includes("@")) return { ok: false, reason: "handle" };
  if (FOREIGN.test(raw)) return { ok: false, reason: "foreign" };
  if (NEWS.test(raw)) return { ok: false, reason: "news" };
  if (JUNK.test(raw)) return { ok: false, reason: "junk" };
  if (SENTENCE.test(raw)) return { ok: false, reason: "sentence-fragment" };
  if (TRUNCATED.test(raw)) return { ok: false, reason: "truncated" };
  if (STOP_START.test(raw)) return { ok: false, reason: "stopword-start" };
  if (lower === "mumbai" || lower === "india") return { ok: false, reason: "too-short" };
  return { ok: true, reason: "" };
}

/** Research-note provenance that screams "wrong country scrape". */
export function notesLookForeign(notes) {
  const n = String(notes ?? "");
  if (!n) return false;
  if (/via search:/i.test(n)) return /\b(california|florida|texas|new york|ohio|illinois|canada|australia|dubai|singapore|denver|seattle|houston|chicago|boston|miami|dallas)\b/i.test(n);
  if (/via directory crawl:/i.test(n) || /https?:\/\//i.test(n)) {
    const isIndia = /\/mumbai|\/india|karmayog|awbptrust/i.test(n);
    const isForeign = /\.(us|uk|ca|au)\b|zoominfo|mass\.gov|adoptapet|bestfriends|petfinder|nextdoor|yelp|cityof|countyof/i.test(n);
    return isForeign && !isIndia;
  }
  return false;
}

const WARD_RE = /^([A-Z])[/\-]?(N|S|E|W|C|NORTH|SOUTH|EAST|WEST|CENTRAL)$/;

/** "K/W", "K-West", "k west", "KW" -> "K-West"; "A" -> "A"; anything else null. */
export function normaliseWard(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const exact = BMC_WARD_CODES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const m = raw.toUpperCase().replace(/\s+/g, "").match(WARD_RE);
  if (!m) return null;
  const half = { N: "North", S: "South", E: "East", W: "West", C: "Central" }[m[2].charAt(0)];
  const code = `${m[1]}-${half}`;
  return BMC_WARD_CODES.includes(code) ? code : null;
}

/** Digits only, for comparison and de-duplication (not for storage). */
export function phoneDigits(value) {
  return String(value ?? "").replace(/\D+/g, "");
}

/** A phone is usable when it has 10 to 13 digits and starts like an Indian number. */
export function phoneUsable(value) {
  const d = phoneDigits(value);
  if (d.length === 10) return /^[6-9]/.test(d) || /^[1-9]/.test(d);
  if (d.length === 11 && d.startsWith("0")) return true;
  if (d.length === 12 && d.startsWith("91")) return true;
  if (d.length === 13 && d.startsWith("091")) return true;
  return false;
}

export function kmBetween(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** RFC 4180-ish CSV parse: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** One CSV field, quoted only when it must be. */
export function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values) {
  return values.map(csvField).join(",");
}
