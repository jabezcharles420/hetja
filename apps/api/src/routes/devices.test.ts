/**
 * Anon-attested device-token *issuance* tests -- the wire contract that
 * silently did not exist before this route (lib/device.ts's
 * issueDeviceToken was only ever called from test files that import it
 * directly, which no real HTTP client can do).
 *
 * 1. happy path: challenge -> solve the ALTCHA v2 SHA-256 PoW with the same
 *    solver the server ships (lib/device.ts's solvePoW) -> token -> and, the
 *    whole point of this task, that token minted through the HTTP endpoints
 *    is accepted by POST /api/v1/reports.
 * 2. single-use (enhancement stack D.4): a solved challenge mints exactly ONE
 *    token -- resubmitting it is rejected with CHALLENGE_REUSED -- while a
 *    freshly issued challenge still mints.
 * 3. the widget payload form ({ payload: base64(JSON({challenge, solution})) })
 *    is accepted, so a future altcha-widget integration needs no server change.
 * 4. a tampered/forged challenge is rejected (BAD_CHALLENGE).
 * 5. an expired challenge is rejected (CHALLENGE_EXPIRED).
 * 6. a solution that does not satisfy the PoW is rejected (BAD_POW).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Challenge } from "altcha-lib";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { effectivePowDifficulty, solvePoW } from "../lib/device.js";
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

async function fetchChallenge(app: ReturnType<typeof buildServer>): Promise<{
  challenge: Challenge;
  difficulty: number;
}> {
  const res = await app.inject({ method: "POST", url: "/api/v1/devices/challenge" });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.ok).toBe(true);
  return body.data as unknown as { challenge: Challenge; difficulty: number };
}

describe("POST /api/v1/devices/challenge + POST /api/v1/devices/token", () => {
  it(
    "issues a challenge, mints a token from a solved PoW, and that token is accepted by POST /api/v1/reports",
    async () => {
      // DEVICE_POW_DIFFICULTY defaults to 18 (enhancement stack Phase 0 #6),
      // rounded up by ALTCHA's hex-prefix encoding to 20 effective bits
      // (~2^19 average attempts); the tail is heavy, so the test gets a real
      // timeout.
      const app = buildServer(config);

      const { challenge, difficulty } = await fetchChallenge(app);
      expect(difficulty).toBe(effectivePowDifficulty(config.DEVICE_POW_DIFFICULTY));
      expect(difficulty).toBeGreaterThanOrEqual(config.DEVICE_POW_DIFFICULTY);
      expect(challenge.parameters.algorithm).toBe("SHA-256");
      expect(challenge.parameters.keyPrefix.length * 4).toBe(difficulty);

      const solution = await solvePoW(challenge);
      expect(solution).not.toBeNull();

      const tokenRes = await app.inject({
        method: "POST",
        url: "/api/v1/devices/token",
        payload: { challenge, solution },
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
    },
    60_000,
  );

  it("mints exactly one token per solved challenge — replay is rejected (CHALLENGE_REUSED)", async () => {
    const app = buildServer(config);

    const { challenge } = await fetchChallenge(app);
    const solution = await solvePoW(challenge);
    expect(solution).not.toBeNull();

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge, solution },
    });
    expect(first.statusCode).toBe(200);

    // Replaying the identical (challenge, solution) must not mint a second
    // token — this is the reuse gap the enhancement stack documented (D.4).
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge, solution },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("CHALLENGE_REUSED");

    // A freshly issued challenge still mints — the registry only blocks spent
    // challenges, not new work.
    const fresh = await fetchChallenge(app);
    const freshSolution = await solvePoW(fresh.challenge);
    expect(freshSolution).not.toBeNull();
    const freshRes = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge: fresh.challenge, solution: freshSolution },
    });
    expect(freshRes.statusCode).toBe(200);
  }, 60_000);

  it("accepts the altcha-widget payload form (base64 of JSON({challenge, solution}))", async () => {
    const app = buildServer(config);

    const { challenge } = await fetchChallenge(app);
    const solution = await solvePoW(challenge);
    expect(solution).not.toBeNull();

    // btoa(JSON.stringify({challenge, solution})) is exactly what the ALTCHA
    // widget writes into its hidden `altcha` form field.
    const payload = Buffer.from(JSON.stringify({ challenge, solution })).toString("base64");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { payload },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(typeof res.json().data.deviceToken).toBe("string");
  }, 60_000);

  it("rejects a tampered challenge (HMAC no longer matches its own parameters)", async () => {
    const app = buildServer(config);
    const { challenge } = await fetchChallenge(app);

    // Flip a signed parameter (nonce) but leave signature and expiry intact:
    // the HMAC can no longer verify, and the challenge is not expired, so this
    // must surface as BAD_CHALLENGE rather than CHALLENGE_EXPIRED or BAD_POW.
    const tampered = {
      ...challenge,
      parameters: { ...challenge.parameters, nonce: "ab".repeat(16) },
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge: tampered, solution: { counter: 0, derivedKey: "0".repeat(64) } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("BAD_CHALLENGE");
  });

  it("rejects an expired challenge even with a correctly-signed body", async () => {
    const app = buildServer(config);
    const realNow = Date.now;
    let challenge: Challenge | undefined;
    try {
      Date.now = () => realNow() - 10 * 60 * 1000; // mint as if 10 minutes ago
      challenge = (await fetchChallenge(app)).challenge;
    } finally {
      Date.now = realNow;
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge, solution: { counter: 0, derivedKey: "0".repeat(64) } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("CHALLENGE_EXPIRED");
  });

  it("rejects a solution that does not satisfy the configured PoW difficulty", async () => {
    const app = buildServer(config);
    const { challenge } = await fetchChallenge(app);

    // A nonce/counter of 0 can never produce a 32-byte zero derivedKey, so the
    // server's key re-derivation cannot match this solution — deterministically
    // BAD_POW rather than a value we *hope* fails the prefix check.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/token",
      payload: { challenge, solution: { counter: 0, derivedKey: "0".repeat(64) } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("BAD_POW");
  });
});
