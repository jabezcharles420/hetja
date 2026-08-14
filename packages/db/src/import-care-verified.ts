/**
 * Hetja verified care-directory import (docs/VET-DATA-INTAKE.md §6).
 *
 * Ingests packages/db/data/dogs_mumbai.csv — 1,370 verified Mumbai
 * animal-welfare providers (NGOs, BMC/government facilities, charity
 * clinics) researched and verified 2026-08-13 by the maintainer. The CSV's
 * `evidence`/`sources` columns carry the per-row verification trail (live
 * site checks, maps listings); the committed CSV is the audit record, this
 * script is the mapping into care_providers.
 *
 * Field mapping (CSV → care_providers):
 *   name          → name
 *   category      → kind   (ngo→ngo; charity_clinic→charity_hospital;
 *                           bmc_veterinary/govt_vet_hospital/
 *                           govt_animal_welfare/govt_vet_dispensary→govt)
 *   cost_tier     → derived, NOT from the file (see ASSUMPTIONS below)
 *   phone         → phone_e164 via libphonenumber-js (IN); unparseable
 *                   numbers become NULL — a wrong number is worse than
 *                   none (0008's comment). Landlines included.
 *   phone_alt     → alt_phone_e164, same normalization
 *   area          → locality + locality centroid geo
 *   address       → geocoded when GEOCODE=1 (Nominatim batch, 1.1s/req),
 *                   cached in packages/db/data/geocode-cache.json so
 *                   imports are deterministic; otherwise locality centroid
 *   status        → listed (all rows verified_active)
 *   source        → 'verified-csv-2026-08'; source_ref = `dogs_mumbai.csv#N`
 *
 * NEVER touched: phone_verified_at (means "a human actually called this
 * number" — the CSV's verified_at is record-level research verification,
 * and its evidence column even flags needs_phone_fill rows). All rows are
 * imported with phone_verified_at = NULL.
 *
 * ASSUMPTIONS (flagged, not silently guessed — see docs/VET-DATA-INTAKE.md
 * §2 on cost_tier):
 *   - cost_tier: govt → 'free', ngo → 'free', charity_clinic →
 *     'subsidised'. The file carries no cost data; these are the
 *     conservative defaults for ordering (free surfaced first), to be
 *     confirmed per row by the maintainer.
 *   - has_ambulance/is_24x7/handles_wildlife: the CSV has no services or
 *     hours data (columns empty), so all default to false — the seed
 *     rule "not confirmed in research — do not claim it" applies.
 *   - geo precision: 'exact' only for addresses the geocoder resolved
 *     with confidence; everything else 'locality' (honest under-claim).
 *
 * Usage:
 *   pnpm --filter @hetja/db geocode:care   # one-time: build the cache
 *   pnpm --filter @hetja/db import:care    # idempotent (ON CONFLICT DO
 *                                          # NOTHING on the (name,
 *                                          # COALESCE(phone_e164,'')) index)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "..", "data", "dogs_mumbai.csv");
const GEOCODE_CACHE = path.join(__dirname, "..", "data", "geocode-cache.json");
const REJECTED_PATH = path.join(__dirname, "..", "data", "import-rejected.json");
const GEOCODE = process.env.GEOCODE === "1";

/**
 * Name-quality gate. The source dataset is a research sweep: ~11% of its
 * `name` values are search-engine artifacts (file titles, snippets, foreign
 * shelters, platform pages), not organisations. The emergency directory
 * serves whoever is standing over an injured dog, so a junk row is not
 * harmless — "The Times of India" with a phone number is a dead end with a
 * dial button. Three buckets:
 *   KEEP   — known-good names (curated prefixes, checked first).
 *   REJECT — unambiguous junk (patterns below).
 *   REVIEW — ambiguous (stopword-start, not matched by KEEP/REJECT):
 *            written to import-rejected.json and NOT imported. A wrong
 *            omission costs nothing; a wrong inclusion is live harm.
 */
const KEEP_PREFIXES = [
  "the bombay society for the prevention of cruelty to animals",
  "the bai sakarbai dinshaw petit",
  "the welfare of stray dogs",
  "in defence of animals",
  "in defense of animals",
  "a friends foundation",
  "the association for animal welfare advancement",
];

const REJECT_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\[(pdf|video|image|photo)\]|\.pdf\b|\.docx?\b/i, reason: "file-artifact" },
  { re: /\|/, reason: "search-title-pipe" },
  { re: /^instagram\b|@[\w-]+\b|instagram photos and videos|\bon instagram\b|\bon facebook\b|\bon twitter\b|\bon x\b/i, reason: "platform-page" },
  { re: /^(check out|see more|support org|join the|watch|read |what is|how to|top \d|best \d|a look at|a closer look|a month on|a second chance|a small act|an appeal|a day at|for all|for more than|for the past|for animal|of ringling|on 6th|the global race|the growing problem|the mission|the proceeds|the shelter was|the phone number|the canines|the rescue|the tata trust|view email|view the|view our|view a|view an|view all|see what|see the|see our|see a|see an)/i, reason: "snippet-start" },
  { re: /^(contact|about|address|website|phone|map|directions|reviews|rating|read customer|get directions|open now|closed now|see all|view all|learn more|contact info)\b/i, reason: "label-prefix" },
  { re: /^open arms adoption\b/i, reason: "known-artifact" },
  { re: /\bnear me\b|\bnear\s+\w+(?:\s+\w+)?\s*$/i, reason: "near-fragment" },
  { re: /\bclick here\b|\bread more\b|\bwww\.\b|\bhttps?:\/\//i, reason: "cta-or-url" },
  { re: /^\d+[.)]\s+/, reason: "numbered-list" },
  { re: /\b(km|kms?)\s+(away|from|to)\b/i, reason: "distance-fragment" },
  { re: /the times of india|hindustan times|indian express|news18|ndtv\b/i, reason: "newspaper" },
  // Foreign geography — this is a Mumbai directory. (Names containing
  // "India" or Mumbai localities are unaffected.)
  { re: /\b(wichita|kansas|central florida|florida|new york|california|ohio|berlin|paris|buffalo|charlotte|cincinnati|fresno|lakewood|marion county|new haven|newport beach|plymouth|quad city|seattle|st\.?\s?hubert|humboldt|brownsville|jefferson|philippine|philippines|oregon|pennsylvania|new jersey|virginia|michigan|illinois|texas|arizona|colorado|georgia|carolina|tennessee|missouri|minnesota|wisconsin|louisiana|alabama|mississippi|kentucky|indiana|iowa|nebraska|arkansas|oklahoma|canada|australia|england|scotland|ireland|france|germany|spain|italy|switzerland|netherlands|austria|poland|sweden|norway|denmark|finland|japan|china|thailand|singapore|malaysia|dubai|uae|qatar|kuwait|south africa|brazil|mexico|argentina|chicago|austin|alexandria|nashville|houston|miami|denver|seattle|phoenix|memphis|boston|philadelphia|detroit|tampa|atlanta|dallas|los angeles|san diego|san francisco|thornberry|yoda|saginaw|sonoma|cheatham)\b/i, reason: "foreign-geography" },
  // Article-title verbs: "X is now open", "Y has a ...", "Z was ..."
  { re: /\b(is|are|was|were|has|have|had) (now|open|offering|being|a registered|an animal|a mumbai|animals?|recognised|recognized|here|home|the|their|a |an )\b/i, reason: "article-title" },
  { re: /\b(the|for|and|is|are|of|to|in|on|with|at|as|by|from|into|about)\s*$/, reason: "truncated-title" },
  { re: /^(the|a|an|of|for|in|on|and|to)\s+\w{1,4}\s*$/, reason: "too-vague" },
];

function nameQuality(name: string): { verdict: "keep" | "reject" | "review"; reason?: string } {
  if (/@/.test(name)) return { verdict: "reject", reason: "platform-handle" };
  const lower = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (KEEP_PREFIXES.some((p) => lower.startsWith(p))) return { verdict: "keep" };
  if (JUNK_NAME_RE.test(name)) return { verdict: "reject", reason: "junk-marker" };
  if (SENTENCE_RE.test(name)) return { verdict: "reject", reason: "sentence-fragment" };
  for (const { re, reason } of REJECT_PATTERNS) {
    if (re.test(name)) return { verdict: "reject", reason };
  }
  if (name.length < 5) return { verdict: "reject", reason: "too-short" };
  if (name.length > 90) return { verdict: "reject", reason: "too-long" };
  if (/^(the|a|an|of|for|in|on|and|to|at)\s/i.test(name)) return { verdict: "review", reason: "ambiguous-stopword-start" };
  return { verdict: "keep" };
}

/**
 * Provenance gate — the strongest junk signal is the research notes column.
 * "via directory crawl: <url>" / "via search: <query>" record where a row
 * came from. US state/city directories (mass.gov, illinoiscomptroller.gov,
 * cityof*, adoptapet, bestfriends, zoominfo, ...) and foreign-city searches
 * (miami fl, houston, denver, san francisco, ...) are scraped debris, not
 * Mumbai providers — the sweep evidently picked up Google results for the
 * wrong country. India-path crawls (e.g. myfurries.com/.../mumbai) are kept.
 */
const FOREIGN_CRAWL_RE = /via directory crawl: https?:\/\/[^\/\s]*?(?:zoominfo|mass\.gov|in\.gov|illinoiscomptroller|lakewoodoh|adoptapet|bestfriends|petfinder|nextdoor|yelp|angieslist|bbb\.org|healthgrades|cityof|countyof|usda|spcawake|dnb\.com|\.gov|\.us|\.mil)/i;
// India-path crawls (myfurries.com/.../mumbai) are kept — segment-anchored so
// "animal-welfare-board-of-india" inside a zoominfo URL does not count.
const INDIA_PATH_RE = /\/(?:mumbai|india|bangalore|pune|delhi|hyderabad|chennai|kolkata|karmayog|awbptrust)(?:\/|$)/i;
const FOREIGN_SEARCH_Q_RE = /via search: .*\b(?:california|florida|texas|new york|ohio|illinois|massachusetts|indiana|michigan|wisconsin|minnesota|iowa|nebraska|kansas|missouri|oklahoma|arkansas|louisiana|mississippi|alabama|georgia|carolina|tennessee|kentucky|virginia|maryland|pennsylvania|new jersey|connecticut|rhode island|new hampshire|vermont|maine|delaware|colorado|arizona|utah|nevada|idaho|montana|wyoming|dakota|oregon|washington|alaska|hawaii|canada|australia|united kingdom|dubai|singapore|denver|seattle|phoenix|memphis|chicago|boston|houston|philadelphia|detroit|tampa|atlanta|miami|dallas|los angeles|san diego|san francisco|austin|indianapolis|el paso|fort worth|fort-worth|pikes peak|wake county|rocky mountain|new england)\b/i;

/** High-precision junk markers — no real organisation name contains these. */
const JUNK_NAME_RE = /company profile|get notified|what industry|privacy policy|office locations|no obligation|hotline|amendments to the|department of|division of|consumer services|veterinary services company|national veterinary links|adoption fee|adoptions|donating|language in the|the veterinary division|veterinary doctors list|animal emergency info|data collected by|index of contact|compare (?:similar|insights)|some of the|you may call the|today, the|here at the|welcome to |our team of|our shelter needs|choosing to adopt|just like |similarly, the|from july|rescue squad$|regional animal services|free pet rescue|animal care services$|veterinary links|new phone number|about us|did you know|contact us|faq\b|donation|donate|foster \/|stock photos|images and|photo by |customer service|toll free|contact details|contact information|helpline numbers|company contact|npos? in the united|newborn adoption|pet refuge|sandy dr|plumbers|mityana|meet india|ministry of animal|government helpline|local animal control|make a service request|list of |list of animal|kutchery road|established in|every paw|every release|easetrip|chewy|donate supplies|wish list|paw life|mumbai news$|mumbai educational|mumbai through|indian institute of|india customer|india, involving|indian charities|kentuckiana|long beach|manahawkin|humane society of lebanon|friends of southern ocean|dogg? s at play|indian$|^indian$|nawb raises|naresh kadyvan|park 2\.|palam ,|kannaan|kvafsu|darjeeling|kalimpong|paaws chicago|need help |help finding|meet india|animal welfare\.|animal welfare group|animal husbandry$|animals$|^animals$|^indian$|yolo county|san diego humane|va caregiver|white settlement|food animal|mumbai media contacts|today marks|humane society of harrisburg|philippine|all-star|cedar rapids|application for dog|people for animal|please donate|stray dog population|navi mumbai company|redemption road|metro nashville|peta, american|general overview|shelter and pet adoption|ngo support|find important animal|mumbai media|tata trust$|tata trusts$|\banimal control\b|\banimal services\b|\banimal health division\b|tipline|welfare charitable|2nd floor|\bsector \d|call center|call us|caregiver support|\bhotel\b|\bcounty\b|\bissues\b|dig defence|dig barrier|\(@|\bofficial$|\brgv\b|saginaw|\badoption\b|foundation lead|\binc\.?\b|\bllc\.?\b|spay|neuter|programme$|,\s*animal\s*$|diagnostics imaging|surgical center|makes |customer support|\bkannan\b|^support |pet animal welfare|\bsupport$|\binformation$|\bdivision$|\bcentre$|dry injections|why collecting/i;

/**
 * Sentence-fragment gate: a real organisation's name is a noun phrase
 * ("BMC Veterinary Dispensary, Andheri"), never a sentence ("The Welfare Of
 * Stray Dogs is a Mumbai based ..."). Lowercase mid-string stopwords are the
 * tell. Safe because (1) the curated KEEP prefixes bypass it and (2) the
 * case-insensitive dedupe key keeps the canonical Title-Case variant of any
 * org whose snippet form is caught here.
 */
const SENTENCE_RE = / (?:the|in|at|for|of|to|from|with|and|is|are|was|were|has|have|you|your|our|this|that|or|but|so|as|by|on|into|about|its|their|them|they|who|what|where|when|why|how|will|would|can|could|should|may|might|must|not|no|yes|please|thank|help|every|all|any|some|more|most|one|two|three|new|old|first|last|next|other|such|same|very|just|also|only|even|still|already|ever|never|always|often|usually|maybe|perhaps|really|actually|today|now|here|there|then|than|because|although|though|while|during|after|before|until|since|if|unless|except|between|among|through|across|along|behind|below|above|under|over|off|out|up|down|away|back|forward|toward|towards|inside|outside|around|about)\s/i;

function foreignProvenance(notes: string): boolean {
  if (!notes) return false;
  if (FOREIGN_CRAWL_RE.test(notes) && !INDIA_PATH_RE.test(notes)) return true;
  if (FOREIGN_SEARCH_Q_RE.test(notes)) return true;
  return false;
}

/** Case/punctuation-insensitive dedupe key — the CSV lists the same org
 *  under name variants ("The Welfare Of Stray Dogs" × 4). First wins. */
function dedupeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const KIND_MAP: Record<string, "ngo" | "govt" | "charity_hospital" | "private_clinic"> = {
  ngo: "ngo",
  charity_clinic: "charity_hospital",
  bmc_veterinary: "govt",
  govt_vet_hospital: "govt",
  govt_animal_welfare: "govt",
  govt_vet_dispensary: "govt",
};

/** Locality centroids — the honest 'locality' fallback for every row.
 *  Values are locality/ward centroids, NOT geocoded addresses. Rows whose
 *  address geocodes with confidence get geo_precision='exact' instead. */
const LOCALITY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Fort: { lat: 18.935, lng: 72.832 },
  Sion: { lat: 19.043, lng: 72.862 },
  Parel: { lat: 19.0067, lng: 72.8397 },
  Colaba: { lat: 18.906, lng: 72.812 },
  Khar: { lat: 19.072, lng: 72.839 },
  Malad: { lat: 19.179, lng: 72.848 },
  Andheri: { lat: 19.1197, lng: 72.8464 },
  Thane: { lat: 19.2237, lng: 72.9647 },
  "Navi Mumbai": { lat: 19.033, lng: 73.017 },
  Mulund: { lat: 19.172, lng: 72.956 },
  Worli: { lat: 19.0, lng: 72.817 },
  Dadar: { lat: 19.0178, lng: 72.8478 },
  Ghatkopar: { lat: 19.086, lng: 72.91 },
  Churchgate: { lat: 18.933, lng: 72.826 },
  Vashi: { lat: 19.076, lng: 72.999 },
  Borivali: { lat: 19.2307, lng: 72.8567 },
  Byculla: { lat: 18.9783, lng: 72.8337 },
  Dahisar: { lat: 19.2457, lng: 72.8617 },
  Kandivali: { lat: 19.2, lng: 72.84 },
  Kurla: { lat: 19.073, lng: 72.886 },
  Turbhe: { lat: 19.067, lng: 73.007 },
  Bandra: { lat: 19.0596, lng: 72.8295 },
  Chembur: { lat: 19.055, lng: 72.8985 },
  Deonar: { lat: 19.0433, lng: 72.9105 },
  Jogeshwari: { lat: 19.125, lng: 72.85 },
  Mahim: { lat: 19.044, lng: 72.84 },
  Nerul: { lat: 19.032, lng: 73.016 },
  Mahalaxmi: { lat: 18.979, lng: 72.823 },
  "Marine Lines": { lat: 18.942, lng: 72.826 },
  Dombivli: { lat: 19.216, lng: 73.086 },
  Vikhroli: { lat: 19.111, lng: 72.928 },
  Kalyan: { lat: 19.24, lng: 73.13 },
  Koparkhairane: { lat: 19.109, lng: 73.007 },
  "Kala Ghoda": { lat: 18.929, lng: 72.831 },
};

interface CsvRow {
  name: string;
  category: string;
  area: string;
  address: string;
  phone: string;
  phone_alt: string;
  status: string;
  notes: string;
}

function parseCsv(): CsvRow[] {
  const raw = readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0].split(",");
  const idx = (name: string) => header.indexOf(name);
  const pick = (row: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? (row[i] ?? "").trim() : "";
  };
  return lines.slice(1).map((line) => {
    // Proper CSV parsing for quoted fields (addresses/evidence contain
    // commas). Hand-rolled minimal state machine: quotes double inside.
    const fields: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { fields.push(cur); cur = ""; }
      else cur += ch;
    }
    fields.push(cur);
    return {
      name: pick(fields, "name"),
      category: pick(fields, "category"),
      area: pick(fields, "area"),
      address: pick(fields, "address"),
      phone: pick(fields, "phone"),
      phone_alt: pick(fields, "phone_alt"),
      status: pick(fields, "status"),
      notes: pick(fields, "notes"),
    };
  });
}

function normalizeIndianPhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), "IN");
  if (!parsed || !parsed.isValid() || parsed.country !== "IN") return null;
  return parsed.number;
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  // Photon (komoot) — free, no key, solid India street coverage. Nominatim
  // soft-throttles datacenter IPs (returns [] for queries that resolve
  // fine elsewhere), which is why this does not use it.
  const url = `https://photon.komoot.io/api/?limit=1&lang=en&q=${encodeURIComponent(address + ", Mumbai")}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "hetja-care-import/1.0 (care-directory maintainer)" } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{ geometry: { coordinates: [number, number] } }>;
    };
    const first = data.features?.[0]?.geometry?.coordinates;
    if (!first) return null;
    return { lat: first[1], lng: first[0] };
  } catch {
    return null;
  }
}

/** Great-circle distance in km — sanity bound for geocoder hits. */
function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

export async function importCareVerified(): Promise<{
  inserted: number;
  skipped: number;
  noPhone: number;
  geocoded: number;
  rejected: Array<{ row: number; name: string; reason: string }>;
}> {
  const rows = parseCsv();
  const cache: Record<string, { lat: number; lng: number }> = existsSync(GEOCODE_CACHE)
    ? JSON.parse(readFileSync(GEOCODE_CACHE, "utf8"))
    : {};

  let inserted = 0;
  let skipped = 0;
  let noPhone = 0;
  let geocoded = 0;
  let cacheDirty = false;
  const rejected: Array<{ row: number; name: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const [i, row] of rows.entries()) {
    if (!row.name) continue;

    const quality = nameQuality(row.name);
    if (quality.verdict !== "keep") {
      rejected.push({ row: i + 2, name: row.name, reason: quality.reason ?? "unknown" });
      skipped++;
      continue;
    }
    if (foreignProvenance(row.notes ?? "")) {
      rejected.push({ row: i + 2, name: row.name, reason: "foreign-provenance" });
      skipped++;
      continue;
    }
    const key = dedupeKey(row.name);
    if (seen.has(key)) {
      rejected.push({ row: i + 2, name: row.name, reason: "duplicate-of-earlier-row" });
      skipped++;
      continue;
    }
    seen.add(key);

    const kind = KIND_MAP[row.category];
    if (!kind) {
      console.warn(`row ${i + 2}: unknown category "${row.category}" — skipping`);
      skipped++;
      continue;
    }

    const phone = normalizeIndianPhone(row.phone);
    const altPhone = row.phone_alt ? normalizeIndianPhone(row.phone_alt) : null;
    // The directory's whole point is a number to call in an emergency (docs/
    // VET-DATA-INTAKE.md §2: "a row with no number and no ambulance is close
    // to useless"). The source sweep also contains thousands of junk rows
    // that happen to have clean names; requiring a real phone (or a
    // government facility, or a curated-allowlist org) is the strongest
    // curation signal available — junk rows rarely carry one, and the few
    // that do are caught by the filters above.
    if (!phone && kind !== "govt" && !KEEP_PREFIXES.some((p) => row.name.toLowerCase().replace(/\s+/g, " ").trim().startsWith(p))) {
      rejected.push({ row: i + 2, name: row.name, reason: "no-phone-not-govt" });
      skipped++;
      continue;
    }
    if (!phone) noPhone++;

    const locality = row.area || "Mumbai";
    const centroid = LOCALITY_CENTROIDS[locality] ?? LOCALITY_CENTROIDS["Mumbai"];

    // Geocode the address when asked; anything unresolved stays locality.
    let lat = centroid.lat;
    let lng = centroid.lng;
    let geoPrecision: "exact" | "locality" = "locality";
    if (row.address) {
      if (cache[row.address]) {
        lat = cache[row.address].lat;
        lng = cache[row.address].lng;
        geoPrecision = "exact";
        geocoded++;
      } else if (GEOCODE) {
        const pt = await geocodeAddress(row.address);
        // Sanity bound: reject geocoder hits that land absurdly far from the
        // row's own locality — a "Sewri" row geocoded to Pune is garbage,
        // and under-claiming (locality) beats over-claiming (wrong point).
        if (pt && kmBetween(pt, centroid) <= 12) {
          cache[row.address] = pt;
          cacheDirty = true;
          lat = pt.lat;
          lng = pt.lng;
          geoPrecision = "exact";
          geocoded++;
        }
        await new Promise((r) => setTimeout(r, 300)); // Photon: be polite, stay fast
      }
    }

    const costTier = kind === "charity_hospital" ? "subsidised" : "free";

    const res = await pool.query(
      `INSERT INTO care_providers
         (name, kind, cost_tier, phone_e164, alt_phone_e164, geo, ward_id,
          has_ambulance, is_24x7, hours_note, handles_wildlife,
          source, source_ref, phone_verified_at, listed,
          geo_precision, locality)
       VALUES
         ($1, $2, $3, $4, $5, $6::geography, NULL,
          FALSE, FALSE, NULL, FALSE,
          'verified-csv-2026-08', $7, NULL, TRUE,
          $8, $9)
       ON CONFLICT (name, (COALESCE(phone_e164, '')))
       -- DO UPDATE (not DO NOTHING) for geo/geo_precision/locality only, the
       -- same backfill pattern seed-care.ts uses: a re-run after a better
       -- geocode pass upgrades rows in place. phone_verified_at and every
       -- other column are never touched on conflict.
       DO UPDATE SET geo = EXCLUDED.geo, geo_precision = EXCLUDED.geo_precision,
                     locality = EXCLUDED.locality
       RETURNING (xmax = 0) AS inserted`,
      [
        row.name,
        kind,
        costTier,
        phone,
        altPhone,
        geoWkt(lat, lng),
        `dogs_mumbai.csv#${i + 2}`,
        geoPrecision,
        locality,
      ],
    );
    if (res.rows[0]?.inserted) inserted++;
    else skipped++;
  }

  if (cacheDirty) writeFileSync(GEOCODE_CACHE, JSON.stringify(cache, null, 2) + "\n");
  writeFileSync(REJECTED_PATH, JSON.stringify(rejected, null, 2) + "\n");

  return { inserted, skipped, noPhone, geocoded, rejected };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  importCareVerified()
    .then((r) => {
      console.log(
        `care import complete: ${r.inserted} inserted, ${r.skipped} skipped (junk/dupes/already present), ` +
          `${r.noPhone} without a usable phone, ${r.geocoded} exact-precision geocodes, ` +
          `${r.rejected.length} rejected (see data/import-rejected.json)`,
      );
      return pool.end();
    })
    .catch((err) => {
      console.error("care import failed:", err);
      process.exit(1);
    });
}
