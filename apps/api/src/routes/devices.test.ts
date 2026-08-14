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
 * 7. a device token must be CANONICALLY encoded -- the regression test for the
 *    bug where one PoW solve bought unlimited INVARIANT 7 budget.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Challenge } from "altcha-lib";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import {
  deviceTokenSubject,
  effectivePowDifficulty,
  issueDeviceToken,
  solvePoW,
  verifyDeviceToken,
} from "../lib/device.js";
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
      // DEVICE_POW_DIFFICULTY defaults to 16, which ALTCHA's hex-prefix
      // encoding leaves at 16 effective bits (~2^16 expected attempts). It was
      // 18 -- i.e. 20 effective bits -- until the browser solver in apps/scan
      // was measured as unable to finish 2^20 inside its own 20s budget. The
      // tail is heavy either way, so the test keeps a real timeout.
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

/**
 * Canonical device-token encoding (INVARIANT 6/7).
 *
 * `Buffer.from(s, "base64url")` silently discards every character outside the
 * base64 alphabet, padding included. So a minted token and its `=`, `==`,
 * newline, space, tab and `!` suffixed variants all decode to identical bytes,
 * recompute an identical HMAC, and used to all verify -- while remaining
 * distinct strings. Since routes/sos.ts keyed its INVARIANT 7 cap query and
 * its idempotency key on the *string*, one proof-of-work solve yielded an
 * unbounded family of device identities, each granted a fresh 2/day + 5/week
 * SOS budget, and each report pages real responders' phones.
 *
 * `deviceTokenSubject` closes it by requiring the decoded bytes to re-encode
 * to exactly the submitted string.
 */
// Every one of these decodes, under Node's base64url decoder, to byte-for-byte
// the same bytes as the unmodified prefix -- asserted below rather than
// asserted-by-comment, so this stays true if Node's decoder ever changes.
const NON_CANONICAL_SUFFIXES = ["=", "==", "\n", "\r\n", " ", "\t", "!", "!!", "-=", "*"];

describe("device token canonical encoding (INVARIANT 6/7)", () => {
  it("rejects every non-canonical re-encoding of a token it just minted", () => {
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    expect(verifyDeviceToken(token, config.HETJA_DEVICE_SECRET)).toBe(true);

    const dot = token.indexOf(".");
    const base = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    for (const suffix of NON_CANONICAL_SUFFIXES) {
      const label = JSON.stringify(suffix);

      // Establish the premise first: this variant really is the same bytes, so
      // the HMAC really does still match. A rejection therefore proves the
      // canonical round-trip check fired -- not that we happened to corrupt
      // the signature.
      expect(
        Buffer.from(base + suffix, "base64url").equals(Buffer.from(base, "base64url")),
        `premise: ${label} must decode to the same bytes`,
      ).toBe(true);

      const mutated = `${base}${suffix}.${sig}`;
      expect(verifyDeviceToken(mutated, config.HETJA_DEVICE_SECRET), `variant ${label} must be rejected`).toBe(false);
      expect(deviceTokenSubject(mutated, config.HETJA_DEVICE_SECRET), `variant ${label} must yield no subject`).toBe(
        null,
      );
    }
  });

  it("yields one canonical subject per device, and that subject is the deviceId rather than the token", () => {
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const subject = deviceTokenSubject(token, config.HETJA_DEVICE_SECRET);

    // A UUID -- the deviceId issueDeviceToken drew -- and specifically NOT the
    // bearer token: the HMAC half is never stored, so a leak of
    // scans.device_token cannot be replayed as an attested token.
    expect(subject).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(subject).not.toBe(token);
    expect(token).toContain(Buffer.from(subject!, "utf8").toString("base64url"));

    // Stable across calls, and distinct per mint -- the two properties a
    // rate-limit subject has to have.
    expect(deviceTokenSubject(token, config.HETJA_DEVICE_SECRET)).toBe(subject);
    expect(deviceTokenSubject(issueDeviceToken(config.HETJA_DEVICE_SECRET), config.HETJA_DEVICE_SECRET)).not.toBe(
      subject,
    );
  });

  it("still rejects the ordinary failures: wrong secret, no dot, empty id, tampered signature", () => {
    const token = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const dot = token.indexOf(".");

    expect(verifyDeviceToken(token, "a-different-device-secret")).toBe(false);
    expect(verifyDeviceToken(token.replace(".", ""), config.HETJA_DEVICE_SECRET)).toBe(false);
    expect(verifyDeviceToken(`.${token.slice(dot + 1)}`, config.HETJA_DEVICE_SECRET)).toBe(false);
    expect(verifyDeviceToken(`${token.slice(0, dot)}.`, config.HETJA_DEVICE_SECRET)).toBe(false);
    expect(verifyDeviceToken("", config.HETJA_DEVICE_SECRET)).toBe(false);
    // Non-canonical in the signature half too: the signature is compared
    // against a canonically-encoded expected value, so padding it mismatches.
    expect(verifyDeviceToken(`${token}=`, config.HETJA_DEVICE_SECRET)).toBe(false);
  });
});
