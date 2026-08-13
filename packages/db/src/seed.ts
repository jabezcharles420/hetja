/**
 * Hetja Phase 0 seed — a small, realistic data set: dogs with random
 * non-sequential slugs (INVARIANT 1), HMAC-signed collars, a few feeders, one
 * ward geofence. Idempotent: skips existing dogs by slug.
 */
import { pool } from "./pool.js";
import { generateSlug, signSlug } from "./slugs.js";

/**
 * In production this must be the exact secret already burned into printed
 * collars, never a freshly generated one. Seeding (or re-seeding) with the
 * wrong HETJA_QR_SECRET mints collars whose HMAC signatures will never
 * verify -- a failure that is silent here and shows up only later, as a
 * physical scan of a printed tag failing verification in the field. So this
 * throws rather than falling back to the dev default once NODE_ENV=production.
 */
function requireQrSecret(): string {
  const value = process.env.HETJA_QR_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "HETJA_QR_SECRET is not set. Refusing to seed in production with the " +
        "development default: seeding collars with the wrong QR secret mints " +
        "HMAC signatures that will never verify, which is discovered only when " +
        "someone scans a printed collar in the field. Set HETJA_QR_SECRET to " +
        "the exact value already in use for this deployment -- it must be " +
        "carried over from the previous deployment, never freshly generated " +
        "(see AGENTS.md section (c)).",
    );
  }
  return "dev-qr-secret-change-me";
}

const QR_SECRET = requireQrSecret();

const SEED_DOGS = [
  { name: "Rosie", sex: "female", coat: "fawn", ward: "K-West" },
  { name: "Bruno", sex: "male", coat: "black", ward: "K-West" },
  { name: "Simba", sex: "male", coat: "brown", ward: "L-East" },
  { name: "Ginger", sex: "female", coat: "white", ward: "M-East" },
  { name: "Tommy", sex: "male", coat: "grey", ward: "K-West" },
];

export async function seed(): Promise<{ dogs: number; collars: number; feeders: number }> {
  let dogs = 0, collars = 0;

  for (const d of SEED_DOGS) {
    const slug = generateSlug();
    const ins = await pool.query(
      `INSERT INTO dogs (slug, name, sex, coat_pattern, ward_id)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [slug, d.name, d.sex, d.coat, d.ward],
    );
    if (ins.rowCount === 0) continue;
    dogs++;
    const dogId = ins.rows[0].id;
    const qr = slug; // QR content = slug; HMAC verifies authenticity
    const hmac = signSlug(slug, QR_SECRET);
    await pool.query(
      `INSERT INTO collars (dog_id, qr_code, hmac_sig, batch_no, material)
       VALUES ($1,$2,$3,$4,$5)`,
      [dogId, qr, hmac, `P0-${String(dogs).padStart(4, "0")}`, "TPU-Shore-95A"],
    );
    collars++;
  }

  const feeder = await pool.query(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version)
     VALUES ($1,'Phase0 Lead Feeder','feeder',60,'v1.0')
     ON CONFLICT (identity_hmac) DO NOTHING RETURNING id`,
    ["hmac-seed-feeder-0001"],
  );

  return { dogs, collars, feeders: feeder.rowCount ?? 0 };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  seed()
    .then((r) => {
      console.log(`seed complete: ${r.dogs} dogs, ${r.collars} collars, ${r.feeders} feeders`);
      return pool.end();
    })
    .catch((err) => {
      console.error("seed failed:", err);
      process.exit(1);
    });
}
