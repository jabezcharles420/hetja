/**
 * Hetja care-directory seed (docs/PLAN-v2.md §2.2) — ~25 real Mumbai
 * animal-welfare organisations, committed as reviewable data. Idempotent
 * against care_providers_name_phone_uq (migration 0008_care_providers.sql):
 * a conflicting row is never re-inserted, and the only columns touched on
 * conflict are geo_precision/locality (see the INSERT below) so re-running
 * this after 0009_care_geo_precision.sql backfills those two columns onto
 * rows seeded before that migration existed, without disturbing anything
 * else (notably phone_verified_at).
 *
 * Every number in CARE_SEED must already be E.164 ("+91" + the 10-digit
 * national number, landlines included). `assertSeedPhonesAreE164()` below
 * refuses to seed otherwise, before the first INSERT — see its comment for why
 * the check lives here in this shape rather than parsing with
 * libphonenumber-js.
 *
 * Every row ships `phone_verified_at = NULL`. None of these numbers have
 * been called to confirm they still work — phone_verified_at is set only
 * once a human actually rings the line (see the migration's comment on why
 * that column exists). Do not backfill it here.
 *
 * Coordinates: none of these were geocoded from an authoritative source
 * this session. Each uses a plausible locality/ward-centroid coordinate
 * (public general geography, ~100m precision) and is marked
 * `// TODO: geocode` — a real address lookup should replace it before the
 * directory is trusted for turn-by-turn directions.
 *
 * Because that coordinate is an estimate, every row also ships
 * `geoPrecision: "locality"` (migration 0009_care_geo_precision.sql) plus a
 * human-readable `locality` label — the API (apps/api/src/routes/care.ts)
 * uses this to withhold a computed distance for these rows rather than
 * present a phantom "Xm away" as measured fact. `geoPrecision` only ever
 * becomes `"exact"` for a row whose coordinate came from an actual geocoded
 * street address; do not flip it without one — guessing defeats the point.
 *
 * `source_ref` holds the citation URL for curated rows (not an OSM id —
 * that field is reused here for traceability; see migration comment).
 */
import { pool } from "./pool.js";

type CareKind = "ngo" | "govt" | "charity_hospital" | "private_clinic";
type CostTier = "free" | "subsidised" | "paid";
type GeoPrecision = "exact" | "locality";

interface CareSeedRow {
  name: string;
  kind: CareKind;
  costTier: CostTier;
  phone: string | null;
  altPhone?: string | null;
  lat: number;
  lng: number;
  // Human-readable place label shown when geoPrecision is "locality" —
  // the honest substitute for a distance we cannot actually measure.
  locality: string;
  // Every row here is "locality" (centroid guess) unless a specific one is
  // confirmed against a real geocoded address — see header comment.
  geoPrecision?: GeoPrecision;
  ward?: string | null;
  hasAmbulance?: boolean;
  is24x7?: boolean;
  hoursNote?: string | null;
  handlesWildlife?: boolean;
  sourceUrl: string;
  note?: string;
}

const HOMEGROWN_GUIDE =
  "https://homegrown.co.in/homegrown-explore/a-handy-guide-to-bird-animal-helplines-across-mumbai";

const CARE_SEED: CareSeedRow[] = [
  // --- explicitly researched, individually sourced -------------------------
  {
    // source: https://www.wsdindia.org/
    name: "Welfare of Stray Dogs (WSD) — Sewri OPD",
    kind: "ngo",
    costTier: "free",
    phone: "+918976022838",
    lat: 19.0176,
    lng: 72.8562, // TODO: geocode (Sewri OPD street address)
    locality: "Sewri",
    hasAmbulance: false, // not confirmed in research — do not claim it
    sourceUrl: "https://www.wsdindia.org/",
  },
  {
    // source: https://bombayspca.org/
    name: "Bombay SPCA — Bai Sakarbai Dinshaw Petit Hospital for Animals",
    kind: "charity_hospital",
    costTier: "subsidised",
    phone: "+912224137518",
    lat: 19.0067,
    lng: 72.8397, // TODO: geocode (Parel)
    locality: "Parel",
    hasAmbulance: true,
    sourceUrl: "https://bombayspca.org/",
  },
  {
    // source: https://www.utkarshglobalfoundation.org/animal-welfare-movement
    // No confirmed phone number found for this entry — publishing NULL
    // rather than guessing (plan: "some publish only an address").
    name: "Utkarsh Global Foundation — Utkarsh Animal Hospital, Bhandup",
    kind: "ngo",
    costTier: "free",
    phone: null,
    lat: 19.1449,
    lng: 72.9358, // TODO: geocode (Bhandup)
    locality: "Bhandup",
    hasAmbulance: true,
    sourceUrl: "https://www.utkarshglobalfoundation.org/animal-welfare-movement",
  },
  {
    // source: https://amtmindia.org/
    name: "Animals Matter To Me (AMTM)",
    kind: "ngo",
    costTier: "free",
    phone: "+919967795660",
    altPhone: "+919920737737",
    lat: 19.1663,
    lng: 72.8296, // TODO: geocode (Marve Road, Malad West)
    locality: "Malad West",
    hasAmbulance: true,
    sourceUrl: "https://amtmindia.org/",
  },
  {
    // source: https://homegrown.co.in/homegrown-explore/a-handy-guide-to-bird-animal-helplines-across-mumbai
    name: "Thane SPCA",
    kind: "charity_hospital",
    costTier: "subsidised",
    phone: "+918767612344",
    lat: 19.2237,
    lng: 72.9647, // TODO: geocode (N.K.T. Compound, Kolshet Road, Thane)
    locality: "Thane",
    is24x7: true,
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    // source: https://homegrown.co.in/homegrown-explore/a-handy-guide-to-bird-animal-helplines-across-mumbai
    name: "Karuna Night Ambulance",
    kind: "ngo",
    costTier: "free",
    phone: "+919665355404",
    lat: 19.0330,
    lng: 72.8397, // TODO: geocode — no fixed clinic address; central-Mumbai dispatch point
    locality: "Central Mumbai (mobile dispatch, no fixed clinic)",
    hasAmbulance: true,
    hoursNote: "9pm-3am only",
    note: "Covers Dahisar to Colaba / V.T. to Ghatkopar; maggot-wound cases per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    // source: https://homegrown.co.in/homegrown-explore/a-handy-guide-to-bird-animal-helplines-across-mumbai
    name: "RAWW (Resqink Association for Wildlife Welfare)",
    kind: "ngo",
    costTier: "free",
    phone: "+917666680202",
    lat: 19.1972,
    lng: 72.9704, // TODO: geocode (Thane)
    locality: "Thane",
    handlesWildlife: true,
    is24x7: true,
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    // source: https://homegrown.co.in/homegrown-explore/a-handy-guide-to-bird-animal-helplines-across-mumbai
    // NOTE: sources disagree on this number. The Homegrown guide instead
    // lists +919870252558 (marked "WhatsApp only") for YODA. Both are kept
    // (primary + alt) until someone calls both and confirms which is live.
    name: "YODA (Youth Organisation in Defence of Animals)",
    kind: "ngo",
    costTier: "free",
    phone: "+918062689333",
    altPhone: "+919870252558",
    lat: 19.0596,
    lng: 72.8295, // TODO: geocode (Union Park, Khar/Bandra)
    locality: "Khar / Bandra",
    note: "Phone number conflict across sources — see comment above.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    // source: https://strayicare.org/helpline
    name: "StrayiCare (helpline aggregator)",
    kind: "ngo",
    costTier: "free",
    phone: "+919987013144",
    lat: 18.9750,
    lng: 72.8258, // TODO: geocode — this is a directory/aggregator, not a single physical site
    locality: "Mumbai (helpline aggregator, no fixed site)",
    note: "Cross-references the other helplines in this seed rather than operating its own clinic.",
    sourceUrl: "https://strayicare.org/helpline",
  },

  // --- from the Homegrown helpline guide (also cross-referenced by StrayiCare) --
  {
    name: "PAWS Dombivali",
    kind: "ngo",
    costTier: "subsidised",
    phone: "+919820161114",
    lat: 19.2183,
    lng: 73.0983, // TODO: geocode (Thakurli/Kalyan/Titwada/Vittalwadi/Shahad/Ambivli)
    locality: "Dombivali",
    hasAmbulance: true,
    hoursNote: "Mon-Sat noon-3:30pm",
    note: "Donation ₹300-500 typical per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "JeevDAYA Foundation / Steel Association",
    kind: "ngo",
    costTier: "free",
    phone: "+919324760564",
    altPhone: "+919892461664",
    lat: 19.0728,
    lng: 72.8826, // TODO: geocode — covers all areas per the source guide
    locality: "Mumbai (mobile on-road treatment, no fixed clinic)",
    hoursNote: "Mon-Sun 8am-5pm, Sun half-day; on-road treatment only",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "SOS Save Our Strays",
    kind: "ngo",
    costTier: "free",
    phone: "+919820141310",
    lat: 19.0596,
    lng: 72.8295, // TODO: geocode (Bandra to Dahisar East/West)
    locality: "Bandra to Dahisar",
    note: "Dog/cat sterilisation focus per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "IDA Deonar",
    kind: "ngo",
    costTier: "free",
    phone: "+919320056581",
    lat: 19.0546,
    lng: 72.9083, // TODO: geocode (Deonar)
    locality: "Deonar",
    ward: "M-East",
    hasAmbulance: true,
    hoursNote: "Van 9am-noon & 1:30-5pm; admission 10am-3:30pm; closed Sun",
    note: "Covers Kurla, Govandi, Mankurd, Chembur, Sion, Ghatkopar, Vikroli, Bhandup, Mulund, Deonar, Kanjurmarg.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "World For All (WFA)",
    kind: "ngo",
    costTier: "subsidised",
    phone: "+919820001506",
    lat: 19.1197,
    lng: 72.8468, // TODO: geocode (Andheri/Goregaon/Jogeshwari East/Juhu)
    locality: "Andheri",
    ward: "K-West",
    hoursNote: "Mon-Fri 8am-6pm, Sat 8:30am-2pm",
    note: "Cat sterilisation and adoption per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "BHL Bird Helpline",
    kind: "ngo",
    costTier: "free",
    phone: "+918655370005",
    lat: 19.0760,
    lng: 72.8777, // TODO: geocode — covers all Mumbai per the source guide
    locality: "Mumbai (helpline, no fixed clinic)",
    handlesWildlife: true,
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "ASHA",
    kind: "ngo",
    costTier: "subsidised",
    phone: "+919820127085",
    lat: 19.1197,
    lng: 72.8468, // TODO: geocode (Andheri/Jogeshwari/Goregaon/Parla/Santacruz)
    locality: "Andheri",
    ward: "K-West",
    hoursNote: "Mon-Sat 10am-6pm",
    note: "Admission fee ~₹500 per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "Vardhaman Sanskar",
    kind: "ngo",
    costTier: "free",
    phone: "+919930106106",
    lat: 19.1663,
    lng: 72.8296, // TODO: geocode (Goregaon/Kandivali/Malad, excl. Malwani)
    locality: "Malad",
    hoursNote: "10am-7pm; on-road treatment only",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "IDA Panvel",
    kind: "ngo",
    costTier: "free",
    phone: "+919320056589",
    lat: 18.9894,
    lng: 73.1175, // TODO: geocode (Panvel/Khandeshwar/Kalamboli/Kharghar/Taloja/Ulave/Karanjade/Kalundri)
    locality: "Panvel",
    hoursNote: "9am-5pm; no night service",
    note: "Dog sterilisation per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "IDA Turbe (NMMC)",
    kind: "ngo",
    costTier: "free",
    phone: "+919320056585",
    lat: 19.1073,
    lng: 73.0107, // TODO: geocode (Belapur/Nerul/Vashi/Turbe/Koparkhairane/Ghansoli/Airoli/Juinagar/Sanpada/Seawoods/Rabale/Diga)
    locality: "Turbe",
    hasAmbulance: true,
    hoursNote: "Night van available",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "Udaan",
    kind: "ngo",
    costTier: "free",
    phone: "+918898101015",
    lat: 19.1663,
    lng: 72.8296, // TODO: geocode (Malad West)
    locality: "Malad West",
    handlesWildlife: true,
    is24x7: true,
    note: "Bird rescue per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "SAARP Mumbai",
    kind: "ngo",
    costTier: "free",
    phone: "+919821134056",
    altPhone: "+918108902286",
    lat: 19.0760,
    lng: 72.8777, // TODO: geocode — covers all Mumbai/Thane/Palghar per the source guide
    locality: "Mumbai (helpline, no fixed clinic)",
    handlesWildlife: true,
    is24x7: true,
    note: "Reptile rescue per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "HAB (Help Animals & Birds)",
    kind: "charity_hospital",
    costTier: "subsidised",
    phone: "+919223333338",
    altPhone: "+919322333338",
    lat: 18.9506,
    lng: 72.8390, // TODO: geocode (Masjid Bundar East)
    locality: "Masjid Bunder East",
    handlesWildlife: true,
    hoursNote: "10am-7pm",
    note: "Admission fee ~₹800 per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "Ahimsa (Evershine Nagar)",
    kind: "charity_hospital",
    costTier: "subsidised",
    phone: "+912228804195",
    lat: 19.1663,
    lng: 72.8296, // TODO: geocode (Evershine Nagar, Malad West)
    locality: "Evershine Nagar, Malad West",
    hoursNote: "OPD 10am-1pm",
    note: "Admission fee ~₹500 per the source guide.",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "AHINSA Charitable Trust",
    kind: "ngo",
    costTier: "free",
    phone: "+919821391283",
    lat: 19.2952,
    lng: 72.8544, // TODO: geocode (Mira Road / Bhayandar West)
    locality: "Mira Road",
    hoursNote: "9am-6pm, closed Sun; on-road treatment",
    sourceUrl: HOMEGROWN_GUIDE,
  },
  {
    name: "SRLC",
    kind: "ngo",
    costTier: "free",
    phone: "+919822921100",
    lat: 19.0728,
    lng: 72.8826, // TODO: geocode (Andheri/Khar/Vile Parle/Sion/Bandra/Santacruz/Wadala)
    locality: "Mumbai (mobile, multiple wards)",
    hoursNote: "10am-5pm; SMS/WhatsApp; on-road treatment",
    sourceUrl: HOMEGROWN_GUIDE,
  },
];

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/**
 * E.164: '+', a non-zero country-code digit, 8-15 digits total. Identical to
 * the regex in `care_providers_phone_e164_valid_check`
 * (0015_care_phone_e164_retry.sql) on purpose — this check exists to produce a
 * good error message for the same rule the database enforces, not a second,
 * subtly different rule.
 */
const E164_RE = /^\+[1-9][0-9]{7,14}$/;

/**
 * Refuses to seed if any number in CARE_SEED is not already E.164.
 *
 * This file is the only writer to `care_providers` today, and
 * `care_providers.phone_e164` is the number a stranger taps while standing over
 * an injured dog — a malformed one is a life-safety defect, not a
 * data-quality one. The invariant is enforced by the database
 * (`care_providers_phone_e164_valid_check`, added unconditionally by 0015 after
 * 0013's version was silently skipped on production), so the seed cannot
 * actually write a bad number even without this function. What this adds is the
 * difference between:
 *
 *   error: new row for relation "care_providers" violates check constraint
 *          "care_providers_phone_e164_valid_check"
 *
 * and being told which organisation, which field, and which value — BEFORE any
 * row is written, so a bad edit does not abort a partially-applied seed.
 *
 * A SHAPE CHECK, NOT A VALIDITY CHECK, and the distinction is worth knowing:
 * `apps/api/src/lib/phone.ts` (`normalizeIndianPhone`) validates against
 * India's real numbering plan via libphonenumber-js and would also normalise
 * '022 2413 7518' for you. It cannot be used here — `libphonenumber-js` is a
 * dependency of `apps/api`, not of `packages/db`, and in this pnpm workspace
 * that is a hard resolution failure, not a soft one:
 *
 *   $ cd packages/db && node -e "import('libphonenumber-js/min')"
 *   Cannot find package 'libphonenumber-js' imported from packages/db
 *
 * Adding it here would mean a second copy of the metadata in a package that has
 * no other need for it, so the seed asks only "is this already canonical?" and
 * expects a human to have typed a canonical number. Which is the right ask for
 * hand-curated data: this file is reviewed, and '+912224137518' with a citation
 * next to it is a better artefact than '022 2413 7518' plus a parser.
 */
function assertSeedPhonesAreE164(): void {
  const bad: string[] = [];
  for (const row of CARE_SEED) {
    for (const [field, value] of [
      ["phone", row.phone],
      ["altPhone", row.altPhone ?? null],
    ] as const) {
      if (value !== null && value !== undefined && !E164_RE.test(value)) {
        bad.push(`  ${row.name} — ${field}: ${JSON.stringify(value)}`);
      }
    }
  }
  if (bad.length > 0) {
    throw new Error(
      [
        `seed-care: ${bad.length} phone number(s) in CARE_SEED are not E.164, refusing to seed.`,
        "",
        ...bad,
        "",
        "Write them as +91 followed by the 10-digit national number, with no spaces:",
        "  mobile   9820127085   -> +919820127085",
        "  landline 022 2413 7518 -> +912224137518   (drop the trunk 0 from the STD code)",
        "",
        "This is the same rule care_providers_phone_e164_valid_check enforces",
        "(packages/db/migrations/0015_care_phone_e164_retry.sql).",
      ].join("\n"),
    );
  }
}

export async function seedCare(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  // Before the first INSERT, not per row: a bad number should stop the seed
  // rather than leave half the directory written.
  assertSeedPhonesAreE164();

  for (const row of CARE_SEED) {
    const res = await pool.query(
      `INSERT INTO care_providers
         (name, kind, cost_tier, phone_e164, alt_phone_e164, geo, ward_id,
          has_ambulance, is_24x7, hours_note, handles_wildlife,
          source, source_ref, phone_verified_at, listed,
          geo_precision, locality)
       VALUES
         ($1, $2, $3, $4, $5, $6::geography, $7,
          $8, $9, $10, $11,
          'curated', $12, NULL, TRUE,
          $13, $14)
       -- DO UPDATE (not DO NOTHING) for geo_precision/locality only: the
       -- table was seeded once before migration 0009_care_geo_precision.sql
       -- existed, so those 25 rows need this backfilled on the next run.
       -- Every other column -- notably phone_verified_at -- is left alone
       -- on conflict so a human's later verification is never clobbered.
       -- (xmax = 0) distinguishes a genuine INSERT from a conflict-triggered
       -- UPDATE for the inserted/skipped counters below.
       ON CONFLICT (name, (COALESCE(phone_e164, '')))
       DO UPDATE SET geo_precision = EXCLUDED.geo_precision, locality = EXCLUDED.locality
       RETURNING (xmax = 0) AS inserted`,
      [
        row.name,
        row.kind,
        row.costTier,
        row.phone,
        row.altPhone ?? null,
        geoWkt(row.lat, row.lng),
        row.ward ?? null,
        row.hasAmbulance ?? false,
        row.is24x7 ?? false,
        row.hoursNote ?? null,
        row.handlesWildlife ?? false,
        row.sourceUrl,
        row.geoPrecision ?? "locality",
        row.locality,
      ],
    );
    if (res.rows[0]?.inserted) inserted++;
    else skipped++;
  }

  return { inserted, skipped };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  seedCare()
    .then((r) => {
      console.log(`seed-care complete: ${r.inserted} inserted, ${r.skipped} already present`);
      return pool.end();
    })
    .catch((err) => {
      console.error("seed-care failed:", err);
      process.exit(1);
    });
}
