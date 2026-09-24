import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signSlug } from "../lib/hmac.js";
import { query, generateSlug, isValidSlug } from "@hetja/db";
import { GENESIS_PREV_HASH, computeHash } from "@hetja/ledger";
import { signAccessToken } from "../lib/jwt.js";
import { dogCache, sterilisedFrom } from "./dogs.js";

const config = loadConfig();

// Slugs come from the real generator in @hetja/db, not a local alphabet.
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
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, 'Story Author', 'feeder', 50, 'v1', FALSE)
     ON CONFLICT (identity_hmac) DO UPDATE SET identity_hmac = EXCLUDED.identity_hmac
     RETURNING id`,
    ["test-story-author-feeder"],
  );
  await query(
    // The profile endpoint serves MODERATED stories only, so the fixture story
    // must arrive pre-approved to be visible at all. It used to be inserted
    // unmoderated AND expected in the payload, which only held while the
    // profile query ignored moderated_at. Seeding it approved keeps this suite
    // about the profile contract rather than about moderation, which stories'
    // own tests cover.
    `INSERT INTO dog_stories (dog_id, author_feeder_id, paragraph, version, moderated_at)
     VALUES ($1, $2, 'Friendly soul with a happy tail.', 1, now())`,
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
  // The 5s dog-page cache (enhancement stack §M.1) is module-level state;
  // tests create/update dogs per-case, so clear it or one test sees stale rows.
  dogCache.clear();
  await setupDog();
});

afterEach(async () => {
  if (testDog) {
    await query(`DELETE FROM dog_stories WHERE dog_id = $1`, [testDog.id]);
    await query(`DELETE FROM scans WHERE dog_id = $1`, [testDog.id]);
    try {
      await query(`DELETE FROM dogs WHERE id = $1`, [testDog.id]);
    } catch {
      /* FK kept by the append-only medical row; fine */
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

  it("never serves an unmoderated story through the profile payload", async () => {
    // The moderation bypass: dog_stories rows start unmoderated, and this
    // endpoint used to take the newest row with no moderated_at filter while
    // GET /dogs/:slug/stories filtered correctly, so posting a story and
    // reading the profile published it to strangers with no moderator in the
    // loop.
    const app = buildServer(config);
    const feederRes = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Bypass Author', 'feeder', 50, 'v1', FALSE)
       ON CONFLICT (identity_hmac) DO UPDATE SET identity_hmac = EXCLUDED.identity_hmac
       RETURNING id`,
      ["test-story-bypass-feeder"],
    );
    // Newer than the fixture's approved story on every ordering key.
    await query(
      `INSERT INTO dog_stories (dog_id, author_feeder_id, paragraph, version, created_at)
       VALUES ($1, $2, 'UNMODERATED graffiti text', 2, now() + interval '1 hour')`,
      [testDog!.id, feederRes.rows[0].id],
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dogs/${testDog!.slug}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.microStory).toContain("Friendly soul");
    expect(res.json().data.microStory).not.toContain("UNMODERATED");

    await app.close();
  });

  it("serves no microStory when the only stories are unmoderated", async () => {
    const app = buildServer(config);
    await query(`DELETE FROM dog_stories WHERE dog_id = $1`, [testDog!.id]);
    const feederRes = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Pending Author', 'feeder', 50, 'v1', FALSE)
       ON CONFLICT (identity_hmac) DO UPDATE SET identity_hmac = EXCLUDED.identity_hmac
       RETURNING id`,
      ["test-story-pending-feeder"],
    );
    await query(
      `INSERT INTO dog_stories (dog_id, author_feeder_id, paragraph, version)
       VALUES ($1, $2, 'awaiting a moderator', 1)`,
      [testDog!.id, feederRes.rows[0].id],
    );

    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${testDog!.slug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.microStory).toBeNull();

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

  it("resolves without ?s= when the slug's check character validates (typed code)", async () => {
    // The typed-collar-code path: no signature at all. The slug from the real
    // generator always carries a valid check character.
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${testDog!.slug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().data.slug).toBe(testDog!.slug);
    expect(res.json().data.vaccineStatus).toContain("Anti-Rabies");

    await app.close();
  });

  it("resolves an empty ?s= the same as an absent one (web typed-entry sends '?s=')", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${testDog!.slug}?s=` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.slug).toBe(testDog!.slug);

    await app.close();
  });

  it("404s without ?s= when the check character is wrong (typo'd code)", async () => {
    const app = buildServer(config);
    // Break ONLY the check character, keeping the body intact: this is exactly
    // what a mistyped collar entry looks like. It must die before any database
    // work and never resolve to a profile.
    const body = testDog!.slug.slice(0, 8);
    const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
    let badSlug = "";
    for (const c of alphabet) {
      if (c !== testDog!.slug[8] && !isValidSlug(body + c)) {
        badSlug = body + c;
        break;
      }
    }
    expect(badSlug).toBeTruthy();

    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${badSlug}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().ok).toBe(false);

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

describe("GET /api/v1/dogs/:slug: design-v4 fields", () => {
  const extraFeeders: string[] = [];

  afterEach(async () => {
    if (testDog) await query(`DELETE FROM scans WHERE dog_id = $1`, [testDog.id]);
    for (const id of extraFeeders.splice(0)) {
      await query(`DELETE FROM scans WHERE feeder_id = $1`, [id]);
      await query(`UPDATE dogs SET registered_by = NULL WHERE registered_by = $1`, [id]);
      await query(`DELETE FROM feeders WHERE id = $1`, [id]);
    }
  });

  async function feeder(): Promise<string> {
    const res = await query<{ id: string }>(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'V4 Feeder', 'feeder', 30, 'v1', FALSE) RETURNING id`,
      [`dogs-v4-${Math.random()}`],
    );
    extraFeeders.push(res.rows[0].id);
    return res.rows[0].id;
  }

  async function feed(feederId: string | null, capturedAt: string, reviewStatus = "pending"): Promise<void> {
    await query(
      `INSERT INTO scans (dog_id, client_uuid, scan_type, feeder_id, captured_at, received_at, review_status)
       VALUES ($1, gen_random_uuid(), 'feed', $2, $3, now(), $4)`,
      [testDog!.id, feederId, capturedAt, reviewStatus],
    );
  }

  it("adds ward name, vaccination, sterilisation, counts and photoUrl with safe defaults", async () => {
    const app = buildServer(config);
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${testDog!.slug}` });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.wardName).toBe("Andheri West");
    expect(d.vaccinated).toBe("yes");
    // abc_status NULL and no ABC record: unknown, never a guessed "no".
    expect(d.sterilised).toBe("unknown");
    expect(d.lastFedAt).toBeNull();
    expect(d.feederCount).toBe(0);
    expect(d.storyAuthorCount).toBe(1);
    expect(d.photoUrl).toBeNull();
    await app.close();
  });

  it("counts distinct feeders, never names them, and ignores rejected feeds", async () => {
    const app = buildServer(config);
    const a = await feeder();
    const b = await feeder();
    const c = await feeder();
    await feed(a, "2026-09-01T06:00:00.000Z");
    await feed(a, "2026-09-02T06:00:00.000Z");
    await feed(b, "2026-09-03T06:00:00.000Z");
    await feed(null, "2026-09-03T07:00:00.000Z"); // anonymous device feed: a feed, not a feeder
    await feed(c, "2026-09-04T06:00:00.000Z", "rejected");

    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${testDog!.slug}` });
    const d = res.json().data;
    expect(d.feederCount).toBe(2);
    expect(d.lastFedAt).toBe("2026-09-03T07:00:00.000Z");
    // INVARIANT 3: counts only. No feeder id appears anywhere in the payload.
    for (const id of [a, b, c]) expect(res.body).not.toContain(id);
    await app.close();
  });

  it("vaccinated is 'unknown' without a verified record; sterilised follows evidence only", async () => {
    const app = buildServer(config);
    const other = await query<{ id: string; slug: string }>(
      `INSERT INTO dogs (slug, name, ward_id, abc_status) VALUES ($1, 'NoRecords', 'not-a-ward', 'not_sterilized')
       RETURNING id, slug`,
      [randomSlug()],
    );
    try {
      const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${other.rows[0].slug}` });
      const d = res.json().data;
      expect(d.vaccinated).toBe("unknown");
      expect(d.sterilised).toBe("no");
      expect(d.wardName).toBeNull();
    } finally {
      await query(`DELETE FROM dogs WHERE id = $1`, [other.rows[0].id]);
      await app.close();
    }
  });

  it("sterilisedFrom: a verified ABC record wins; unknown text is unknown, not no", () => {
    expect(sterilisedFrom(null, true)).toBe("yes");
    expect(sterilisedFrom("not_sterilized", true)).toBe("yes");
    expect(sterilisedFrom("Sterilized", false)).toBe("yes");
    expect(sterilisedFrom("abc done", false)).toBe("yes");
    expect(sterilisedFrom("not sterilised", false)).toBe("no");
    expect(sterilisedFrom("scheduled for next camp", false)).toBe("unknown");
    expect(sterilisedFrom(null, false)).toBe("unknown");
  });

  it("marks sterilised 'yes' from a verified ABC medical record", async () => {
    const app = buildServer(config);
    const ts = new Date().toISOString() + Math.random();
    await query(
      `INSERT INTO medical_records (dog_id, record_type, abc_date, is_verified, payload_len, hash_prev, hash_curr, hash_vet_id, hash_ts)
       VALUES ($1, 'abc', '2026-02-01', TRUE, 0, $2, $3, 'feeder', $4)`,
      [testDog!.id, GENESIS_PREV_HASH, computeHash(GENESIS_PREV_HASH, { recordType: "abc" }, "feeder", ts), ts],
    );
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${testDog!.slug}` });
    expect(res.json().data.sterilised).toBe("yes");
    await app.close();
  });

  it("builds an absolute photoUrl, and never uses an SOS report photo as the portrait", async () => {
    const app = buildServer({ ...config, PUBLIC_API_ORIGIN: "https://api.example.test/" });
    await query(
      `INSERT INTO scans (dog_id, client_uuid, scan_type, captured_at, received_at, review_status, photo_s3_key)
       VALUES ($1, gen_random_uuid(), 'feed', now(), now() - interval '1 minute', 'pending', 'photos/portrait.webp'),
              ($1, gen_random_uuid(), 'sos', now(), now(), 'pending', 'photos/injury.jpg')`,
      [testDog!.id],
    );
    const res = await app.inject({ method: "GET", url: `/api/v1/dogs/${testDog!.slug}` });
    const d = res.json().data;
    expect(d.photoKey).toBe("photos/portrait.webp");
    expect(d.photoUrl).toBe("https://api.example.test/photos/portrait.webp");
    await app.close();

    // Without a configured origin, the request's own origin is used, even on
    // a cache hit (the URL is never cached).
    const app2 = buildServer({ ...config, PUBLIC_API_ORIGIN: "" });
    const res2 = await app2.inject({
      method: "GET",
      url: `/api/v1/dogs/${testDog!.slug}`,
      headers: { host: "api.local:8080" },
    });
    expect(res2.json().data.photoUrl).toBe("http://api.local:8080/photos/portrait.webp");
    await app2.close();
  });

  for (const status of ["pending_activation", "expired"]) {
    it(`404s a ${status} dog to the public, but not to the registrator who filed it`, async () => {
      const app = buildServer(config);
      const registrator = await feeder();
      const stranger = await feeder();
      await query(`UPDATE dogs SET status = $2, registered_by = $3 WHERE id = $1`, [
        testDog!.id,
        status,
        registrator,
      ]);
      const url = `/api/v1/dogs/${testDog!.slug}?s=${signSlug(testDog!.slug, config.HETJA_QR_SECRET)}`;
      const bearer = (id: string) => ({
        authorization: `Bearer ${signAccessToken(id, config.JWT_SECRET, config.JWT_ACCESS_TTL)}`,
      });

      const anon = await app.inject({ method: "GET", url });
      expect(anon.statusCode).toBe(404);
      expect(anon.json().error.code).toBe("NOT_FOUND");

      const other = await app.inject({ method: "GET", url, headers: bearer(stranger) });
      expect(other.statusCode).toBe(404);

      const own = await app.inject({ method: "GET", url, headers: bearer(registrator) });
      expect(own.statusCode).toBe(200);
      expect(own.json().data.status).toBe(status);

      // The registrator's 200 must not have been cached for everyone else.
      const anonAgain = await app.inject({ method: "GET", url });
      expect(anonAgain.statusCode).toBe(404);

      // Once active (what a geotagged activation scan does), it is public.
      await query(`UPDATE dogs SET status = 'active' WHERE id = $1`, [testDog!.id]);
      const after = await app.inject({ method: "GET", url });
      expect(after.statusCode).toBe(200);
      await app.close();
    });
  }
});
