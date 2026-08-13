import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signSlug } from "../lib/hmac.js";
import { query, generateSlug } from "@straynet/db";
import { GENESIS_PREV_HASH, computeHash } from "@straynet/ledger";

const config = loadConfig();

// Slugs come from the real generator in @straynet/db, not a local alphabet.
// Eight test files each kept their own copy reading
// "abcdefghijklmnopqrstuvwxyz234567" -- which includes the confusable `l` that
// the generator never emits, and excludes 8/9 which it does. Those fixtures
// produced slugs that cannot exist, so once slug validation was corrected about
// one run in four failed on a random `l`. Using the generator keeps the tests
// honest and removes the ninth copy of this alphabet.
function randomSlug(): string {
  return generateSlug();
}

interface TestDog {
  slug: string;
  id: string;
}

let testDog: TestDog | undefined;

async function setupDog(): Promise<TestDog> {
  const ts = new Date().toISOString() + Math.random();
  const slug = randomSlug();
  const dogRes = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, last_seen_geo, last_seen_at, last_seen_received_at)
     VALUES ($1, 'GeoTest', 'K-West', ST_SetSRID(ST_MakePoint(72.8214, 18.9767), 4326)::geography, now(), now())
     RETURNING id`,
    [slug],
  );
  const id = dogRes.rows[0].id;

  const feederRes = await query<{ id: string }>(
    `INSERT INTO feeders (phone_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, 'Story Author', 'feeder', 50, 'v1', FALSE)
     ON CONFLICT (phone_hmac) DO UPDATE SET phone_hmac = EXCLUDED.phone_hmac
     RETURNING id`,
    ["test-story-author-feeder"],
  );
  await query(
    `INSERT INTO dog_stories (dog_id, author_feeder_id, paragraph, version)
     VALUES ($1, $2, 'Friendly soul with a happy tail.', 1)`,
    [id, feederRes.rows[0].id],
  );
  await query(
    `INSERT INTO medical_records (dog_id, record_type, vaccine_name, vaccine_date, is_verified, payload_len, hash_prev, hash_curr, hash_vet_id, hash_ts)
     VALUES ($1, 'vaccination', 'Anti-Rabies', '2026-01-15', TRUE, 0, $2, $3, 'feeder', $4)`,
    [id, GENESIS_PREV_HASH, computeHash(GENESIS_PREV_HASH, { recordType: "vaccination" }, "feeder", ts), ts],
  );

  testDog = { slug, id };
  return testDog;
}

beforeEach(async () => {
  await setupDog();
});

afterEach(async () => {
  if (testDog) {
    await query(`DELETE FROM dog_stories WHERE dog_id = $1`, [testDog.id]);
    await query(`DELETE FROM scans WHERE dog_id = $1`, [testDog.id]);
    try {
      await query(`DELETE FROM dogs WHERE id = $1`, [testDog.id]);
    } catch {
      /* FK kept by the append-only medical row — fine */
    }
    testDog = undefined;
  }
});

describe("GET /api/v1/dogs/:slug (anon)", () => {
  it("returns ward-level geo only (<=2 decimals)", async () => {
    const app = buildServer(config);
    const sig = signSlug(testDog!.slug, config.HETJA_QR_SECRET);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dogs/${testDog!.slug}?s=${sig}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.slug).toBe(testDog!.slug);
    expect(body.data.name).toBe("GeoTest");
    expect(body.data.wardId).toBe("K-West");
    expect(body.data.abcStatus).toBeNull();
    expect(body.data.vaccineStatus).toContain("Anti-Rabies");
    expect(body.data.microStory).toContain("Friendly soul");

    const { lat, lng } = body.data.geo;
    const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;
    expect(decimals(lat)).toBeLessThanOrEqual(2);
    expect(decimals(lng)).toBeLessThanOrEqual(2);
    expect(lat).toBe(18.97);
    expect(lng).toBe(72.82);

    await app.close();
  });

  it("404s on a tampered ?s= signature", async () => {
    const app = buildServer(config);
    const goodSig = signSlug(testDog!.slug, config.HETJA_QR_SECRET);
    const tampered = (goodSig[0] === "A" ? "B" : "A") + goodSig.slice(1);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dogs/${testDog!.slug}?s=${tampered}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().ok).toBe(false);

    await app.close();
  });

  it("404s when ?s= is missing", async () => {
    const app = buildServer(config);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dogs/${testDog!.slug}`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("404s for an unknown slug even with a valid signature", async () => {
    const app = buildServer(config);
    const slug = randomSlug();
    const sig = signSlug(slug, config.HETJA_QR_SECRET);
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${slug}?s=${sig}` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
