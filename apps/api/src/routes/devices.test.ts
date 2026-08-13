/**
 * Anon-attested device-token *issuance* tests -- the wire contract that
 * silently did not exist before this route (lib/device.ts's
 * issueDeviceToken was only ever called from test files that import it
 * directly, which no real HTTP client can do).
 *
 * 1. happy path: challenge -> solve the PoW with the same solver the
 *    server ships (lib/device.ts's solvePoW) -> token -> and, the whole
 *    point of this task, that token minted through the HTTP endpoints is
 *    accepted by POST /api/v1/reports (previously every anon report path
 *    401'd because nothing could ever obtain a token this way).
 * 2. a tampered/forged challenge is rejected (BAD_CHALLENGE).
 * 3. an expired challenge is rejected (CHALLENGE_EXPIRED).
 * 4. a nonce that does not satisfy the PoW difficulty is rejected (BAD_POW).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { solvePoW, verifyPoW } from "../lib/device.js";
import { query, generateSlug } from "@hetja/db";

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

let dogId: string;
let dogSlug: string;

async function insertDog(): Promise<void> {
  dogSlug = randomSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, last_seen_geo)
     VALUES ($1, 'DeviceTestDog', 'K-West',
             ST_SetSRID(ST_MakePoint(72.8214, 18.9767), 4326)::geography)
     RETURNING id`,
    [dogSlug],
  );
  dogId = res.rows[0].id;
}

beforeEach(async () => {
  await insertDog();
});

afterEach(async () => {
  await query(`DELETE FROM sos_notifications WHERE case_id IN (SELECT id FROM sos_cases WHERE dog_id = $1)`, [dogId]);
  await query(`DELETE FROM sos_cases WHERE dog_id = $1`, [dogId]);
  await query(`DELETE FROM scans WHERE dog_id = $1`, [dogId]);
  await query(`DELETE FROM jobs WHERE payload->>'dogId' = $1`, [dogId]);
  await query(`DELETE FROM dogs WHERE id = $1`, [dogId]);
});

describe("POST /api/v1/devices/challenge + POST /api/v1/devices/token", () => {
  it(
    "issues a challenge, mints a token from a solved PoW, and that token is accepted by POST /api/v1/reports",
    async () => {
        // DEVICE_POW_DIFFICULTY defaults to 18 (enhancement stack Phase 0 #6):
        // ~2^17 average attempts, but the tail is heavy — an unlucky draw can
        // take 10-30s with the naive solver, so this test gets a real timeout.
        const app = buildServer(config);

      const challengeRes = await app.inject({ method: "POST", url: "/api/v1/devices/challenge" });
      expect(challengeRes.statusCode).toBe(200);
      const challengeBody = challengeRes.json();
      expect(challengeBody.ok).toBe(true);
      const { challenge, difficulty } = challengeBody.data as { challenge: string; difficulty: number };
      expect(typeof challenge).toBe("string");
      expect(difficulty).toBe(config.DEVICE_POW_DIFFICULTY);

      const solution = solvePoW(challenge, difficulty);
      expect(solution).not.toBeNull();

      const tokenRes = await app.inject({
        method: "POST",
        url: "/api/v1/devices/token",
        payload: { challenge, nonce: solution!.nonce },
      });
      expect(tokenRes.statusCode).toBe(200);
      const tokenBody = tokenRes.json();
      expect(tokenBody.ok).toBe(true);
      const deviceToken: string = tokenBody.data.deviceToken;
      expect(typeof deviceToken).toBe("string");
      expect(deviceToken.length).toBeGreaterThan(0);

      // The actual contract this task exists to fix: a token minted purely
      // through the HTTP endpoints above -- never issueDeviceToken() called
      // directly -- must be accepted by an anonymous write.
      const reportRes = await app.inject({
        method: "POST",
        url: "/api/v1/reports",
        payload: { dogSlug, severity: "minor", deviceToken },
      });
      expect(reportRes.statusCode).toBe(200);
      const reportBody = reportRes.json();
      expect(reportBody.ok).toBe(true);
      expect(reportBody.data.created).toBe(true);
  }, 60_000);

  it("rejects a tampered challenge (HMAC no longer matches its own fields)", async () => {
    const app = buildServer(config);
    const challengeRes = await app.inject({ method: "POST", url: "/api/v1/devices/challenge" });
    const { challenge } = challengeRes.json().data as { challenge: string };
    const [powSeed, expiresAtStr, sig] = challenge.split(".");

    // Same signature, different expiry -- the HMAC can no longer verify.
    const tampered = `${powSeed}.${Number(expiresAtStr) + 60_000}.${sig}`;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge: tampered, nonce: "0" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("BAD_CHALLENGE");
  });

  it("rejects an expired challenge even with a correctly-signed body", async () => {
    const app = buildServer(config);
    const realNow = Date.now;
    let challenge = "";
    try {
      Date.now = () => realNow() - 10 * 60 * 1000; // mint as if 10 minutes ago
      const challengeRes = await app.inject({ method: "POST", url: "/api/v1/devices/challenge" });
      challenge = (challengeRes.json().data as { challenge: string }).challenge;
    } finally {
      Date.now = realNow;
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge, nonce: "0" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("CHALLENGE_EXPIRED");
  });

  it("rejects a nonce that does not satisfy the configured PoW difficulty", async () => {
    const app = buildServer(config);
    const challengeRes = await app.inject({ method: "POST", url: "/api/v1/devices/challenge" });
    const { challenge, difficulty } = challengeRes.json().data as { challenge: string; difficulty: number };

    // Find a nonce that provably does NOT satisfy the difficulty -- checked
    // locally with the exact verifyPoW the server uses -- instead of
    // guessing a fixed value and relying on it being astronomically
    // unlikely to accidentally solve the puzzle (which would make this
    // test occasionally, flakily wrong).
    let badNonce: string | undefined;
    for (let i = 0; i < 1000; i++) {
      if (!verifyPoW(challenge, String(i), difficulty)) {
        badNonce = String(i);
        break;
      }
    }
    expect(badNonce).toBeDefined();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge, nonce: badNonce },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("BAD_POW");
  });
});
