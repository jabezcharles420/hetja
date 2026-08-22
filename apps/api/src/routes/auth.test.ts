import { afterEach, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { identityHmac } from "../lib/hmac.js";
import {
  verifyAccessToken,
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  decodeJwtPayload,
} from "../lib/jwt.js";
import { issueDeviceToken } from "../lib/device.js";
import { clearOtp } from "../lib/otp.js";
import { canonicalEmailAddress, resolveIdentityHmac } from "../lib/email.js";
import { query } from "@hetja/db";

const config = loadConfig();

function randomEmail(): string {
  return `feeder-${Math.random().toString(36).slice(2)}@example.com`;
}

const usedEmails: string[] = [];

async function cleanupEmails(): Promise<void> {
  for (const email of usedEmails) {
    // Both keyings: accounts created before canonicalisation are keyed on the
    // raw typed string; Gmail signups land on the canonical hash. Deleting
    // the feeder cascades its refresh_tokens rows (migration 0017).
    const variants = new Set([email, canonicalEmailAddress(email)]);
    for (const variant of variants) {
      const idHmac = identityHmac(variant, config.HETJA_HMAC_PEPPER);
      await clearOtp(idHmac);
      await query(`DELETE FROM feeders WHERE identity_hmac = $1`, [idHmac]);
    }
  }
}

afterEach(async () => {
  await cleanupEmails();
  usedEmails.length = 0;
});

describe("POST /api/v1/auth/otp + verify", () => {
  it("issues a dev-mode OTP and verifies it into JWTs + feeder", async () => {
    const app = buildServer(config);
    const email = randomEmail();
    usedEmails.push(email);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email },
    });
    expect(otpRes.statusCode).toBe(200);
    const otpBody = otpRes.json();
    expect(otpBody.ok).toBe(true);
    expect(otpBody.data.devCode).toMatch(/^\d{6}$/);

    const deviceToken = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        email,
        code: otpBody.data.devCode,
        deviceToken,
        consentVersion: 2,
        isMinor: false,
      },
    });
    expect(verifyRes.statusCode).toBe(200);
    const body = verifyRes.json();
    expect(body.ok).toBe(true);
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();

    const access = verifyAccessToken(body.data.accessToken, config.JWT_SECRET);
    expect(access.type).toBe("access");
    expect(access.exp * 1000 - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 60_000);

    const refresh = verifyRefreshToken(body.data.refreshToken, config.JWT_SECRET);
    expect(refresh.type).toBe("refresh");

    expect(body.data.feeder.displayName).toBeTruthy();
    expect(body.data.feeder.trustScore).toBe(30);

    await app.close();
  });

  it("fails verify with a wrong code", async () => {
    const app = buildServer(config);
    const email = randomEmail();
    usedEmails.push(email);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email },
    });
    const devCode = otpRes.json().data.devCode;

    const wrongCode = devCode === "000000" ? "111111" : "000000";
    const deviceToken = issueDeviceToken(config.HETJA_DEVICE_SECRET);
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { email, code: wrongCode, deviceToken, consentVersion: 1, isMinor: false },
    });
    expect(verifyRes.statusCode).toBe(400);
    expect(verifyRes.json().ok).toBe(false);

    await app.close();
  });

  it("rejects verify with a bad device token", async () => {
    const app = buildServer(config);
    const email = randomEmail();
    usedEmails.push(email);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email },
    });
    const devCode = otpRes.json().data.devCode;

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { email, code: devCode, deviceToken: "not-an-attested-token", consentVersion: 1, isMinor: false },
    });
    expect(verifyRes.statusCode).toBe(401);

    await app.close();
  });

  it("requires consentVersion at signup (DPDP)", async () => {
    const app = buildServer(config);
    const email = randomEmail();
    usedEmails.push(email);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email },
    });
    const devCode = otpRes.json().data.devCode;

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { email, code: devCode, deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET), isMinor: false },
    });
    expect(verifyRes.statusCode).toBe(400);

    await app.close();
  });

  it("advances consent_version and is_minor on re-login, but never role or trust_score", async () => {
    // The ON CONFLICT clause used to be a total no-op, so a returning feeder's
    // consent_version froze at their signup value (a DPDP compliance gap) and
    // a user who turned 18 stayed flagged a minor forever. This test pins both
    // halves of the contract: the facts about the account DO advance, and the
    // privileges do NOT — re-login must not be able to grant or revoke either.
    const app = buildServer(config);
    const email = randomEmail();
    usedEmails.push(email);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email },
    });
    const devCode = otpRes.json().data.devCode;

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        email,
        code: devCode,
        deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET),
        consentVersion: 1,
        isMinor: true,
      },
    });
    expect(first.statusCode).toBe(200);

    const idHmac = identityHmac(email, config.HETJA_HMAC_PEPPER);
    const afterSignup = await query<{ consent_version: string; is_minor: boolean; role: string; trust_score: number }>(
      `SELECT consent_version::text AS consent_version, is_minor, role, trust_score
         FROM feeders WHERE identity_hmac = $1`,
      [idHmac],
    );
    expect(afterSignup.rows[0].consent_version).toBe("1");
    expect(afterSignup.rows[0].is_minor).toBe(true);
    expect(afterSignup.rows[0].role).toBe("feeder");
    expect(afterSignup.rows[0].trust_score).toBe(30);

    // Simulate state that only an operator should be able to cause, so the
    // second login can prove it survives re-authentication.
    await query(`UPDATE feeders SET role = 'admin', trust_score = 77 WHERE identity_hmac = $1`, [idHmac]);

    const secondOtp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email },
    });
    const secondCode = secondOtp.json().data.devCode;
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        email,
        code: secondCode,
        deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET),
        consentVersion: 3,
        isMinor: false,
      },
    });
    expect(second.statusCode).toBe(200);

    const afterRelogin = await query<{ consent_version: string; is_minor: boolean; role: string; trust_score: number }>(
      `SELECT consent_version::text AS consent_version, is_minor, role, trust_score
         FROM feeders WHERE identity_hmac = $1`,
      [idHmac],
    );
    expect(afterRelogin.rows[0].consent_version).toBe("3");
    expect(afterRelogin.rows[0].is_minor).toBe(false);
    expect(afterRelogin.rows[0].role).toBe("admin");
    expect(afterRelogin.rows[0].trust_score).toBe(77);

    await app.close();
  });

  it("survives a restart of the OTP store (Postgres-backed, not in-memory)", async () => {
    // The old in-memory Map lost every pending code the instant the process
    // that issued it exited. Simulate that boundary here: close the server
    // (and with it, any in-process state) after requesting a code, then
    // verify against a *new* server instance built from a fresh config.
    const email = randomEmail();
    usedEmails.push(email);

    const issuer = buildServer(config);
    const otpRes = await issuer.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email },
    });
    const devCode = otpRes.json().data.devCode;
    await issuer.close();

    const verifier = buildServer(loadConfig());
    const verifyRes = await verifier.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        email,
        code: devCode,
        deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET),
        consentVersion: 1,
        isMinor: false,
      },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().ok).toBe(true);

    await verifier.close();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh (migration 0017)
// ---------------------------------------------------------------------------
// What this suite pins:
//   - one-time use: the row behind a presented jti wins the exchange UPDATE
//     exactly once, and a replay is treated as theft — the WHOLE family of
//     live tokens for that feeder is revoked;
//   - verify records what it mints, or every first refresh would look like a
//     replay and lock every feeder out;
//   - each failure mode keeps its own code, so a client can branch on them.

const refreshFeederIds: string[] = [];

afterEach(async () => {
  for (const id of refreshFeederIds) {
    // ON DELETE CASCADE (migration 0017) takes the refresh_tokens rows with it.
    await query(`DELETE FROM feeders WHERE id = $1`, [id]);
  }
  refreshFeederIds.length = 0;
});

async function makeRefreshFeeder(role: "feeder" | "admin" = "feeder"): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, 'Refresh Tester', $2, 30, '1', false) RETURNING id`,
    [`refresh-test-${randomUUID()}`, role],
  );
  refreshFeederIds.push(res.rows[0].id);
  return res.rows[0].id;
}

/**
 * Mints a refresh token AND records its row exactly the way /auth/verify now
 * does, so the scenarios below exercise the exchange itself without burning
 * an OTP flow each. One integration test still drives the full flow, to prove
 * verify genuinely records the row.
 */
async function mintRecordedRefresh(feederId: string): Promise<string> {
  const token = signRefreshToken(feederId, config.JWT_SECRET, config.JWT_REFRESH_TTL);
  const payload = decodeJwtPayload(token);
  await query(
    `INSERT INTO refresh_tokens (jti, feeder_id, expires_at) VALUES ($1, $2, $3)`,
    [payload.jti, feederId, new Date(payload.exp * 1000).toISOString()],
  );
  return token;
}

interface RefreshRow {
  jti: string;
  used_at: Date | null;
  replaced_by: string | null;
  revoked_at: Date | null;
}

async function rowsFor(feederId: string): Promise<RefreshRow[]> {
  const res = await query<RefreshRow>(
    `SELECT jti, used_at, replaced_by, revoked_at
       FROM refresh_tokens WHERE feeder_id = $1 ORDER BY issued_at, jti`,
    [feederId],
  );
  return res.rows;
}

/** A correctly-signed refresh token whose expiry is already in the past. */
function craftExpiredRefresh(sub: string): string {
  const b64url = (v: string) => Buffer.from(v).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({ sub, type: "refresh", iat: now - 120, exp: now - 60, jti: randomUUID() }),
  );
  const sig = createHmac("sha256", config.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

describe("POST /api/v1/auth/refresh — the exchange", () => {
  it("verify records the refresh token it mints, and refresh consumes it", async () => {
    // The full OTP path once: if verify did not store the jti, the first
    // refresh would find no row, look exactly like a replay, and lock the
    // feeder out — the exact failure the store exists to prevent.
    const app = buildServer(config);
    const email = randomEmail();
    usedEmails.push(email);

    const otpRes = await app.inject({ method: "POST", url: "/api/v1/auth/otp", payload: { email } });
    expect(otpRes.statusCode).toBe(200);
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        email,
        code: otpRes.json().data.devCode,
        deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET),
        consentVersion: 1,
        isMinor: false,
      },
    });
    expect(verifyRes.statusCode).toBe(200);
    const data = verifyRes.json().data;
    const minted = decodeJwtPayload(data.refreshToken);
    refreshFeederIds.push(minted.sub);

    const row = await query<{ feeder_id: string; used_at: Date | null }>(
      `SELECT feeder_id, used_at FROM refresh_tokens WHERE jti = $1`,
      [minted.jti],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].used_at).toBeNull();

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: data.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().ok).toBe(true);
    expect(refreshed.json().data.accessToken).toBeTruthy();
    expect(refreshed.json().data.refreshToken).not.toBe(data.refreshToken);
    expect(refreshed.json().data.feeder.role).toBe("feeder");
    await app.close();
  });

  it("exchanges exactly once: marks the row used, chains replaced_by, mints a live successor", async () => {
    const app = buildServer(config);
    const feederId = await makeRefreshFeeder();
    const token = await mintRecordedRefresh(feederId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.feeder.displayName).toBe("Refresh Tester");
    expect(body.data.feeder.trustScore).toBe(30);

    // The access token is live, for this feeder, and of the right type.
    const access = verifyAccessToken(body.data.accessToken, config.JWT_SECRET);
    expect(access.type).toBe("access");
    expect(access.sub).toBe(feederId);

    const rows = await rowsFor(feederId);
    expect(rows.length).toBe(2);
    const oldJti = decodeJwtPayload(token).jti;
    const newJti = decodeJwtPayload(body.data.refreshToken).jti;
    const old = rows.find((r) => r.jti === oldJti);
    const next = rows.find((r) => r.jti === newJti);
    expect(old?.used_at).not.toBeNull();
    expect(old?.replaced_by).toBe(newJti);
    expect(old?.revoked_at).toBeNull();
    expect(next?.used_at).toBeNull();
    expect(next?.revoked_at).toBeNull();
    await app.close();
  });

  it("400s INVALID_REFRESH on a missing or malformed body", async () => {
    const app = buildServer(config);
    const noBody = await app.inject({ method: "POST", url: "/api/v1/auth/refresh" });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json().error.code).toBe("INVALID_REFRESH");

    const wrongShape = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: 42 },
    });
    expect(wrongShape.statusCode).toBe(400);
    expect(wrongShape.json().error.code).toBe("INVALID_REFRESH");
    await app.close();
  });

  it("401s BAD_REFRESH_TOKEN on garbage, on an access token, and on an expired token", async () => {
    const app = buildServer(config);
    const feederId = await makeRefreshFeeder();

    for (const bad of [
      "not-a-jwt",
      "a.b.c",
      signAccessToken(feederId, config.JWT_SECRET, config.JWT_ACCESS_TTL),
      craftExpiredRefresh(feederId),
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: bad },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("BAD_REFRESH_TOKEN");
    }
    // None of these ever touched the store.
    expect(await rowsFor(feederId)).toHaveLength(0);
    await app.close();
  });

  it("treats a replay as theft: refuses it and revokes every live session", async () => {
    const app = buildServer(config);
    const feederId = await makeRefreshFeeder();
    const token = await mintRecordedRefresh(feederId);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: token },
    });
    expect(first.statusCode).toBe(200);
    const replacement = first.json().data.refreshToken;

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: token },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("REFRESH_REUSED");

    // EVERY row for the feeder is now dead — used or revoked — including the
    // successor minted one hop earlier. That is the point: a replayed token
    // proves at least one copy is in the wrong hands, so the whole chain
    // dies rather than letting the attacker's copy keep working.
    const rows = await rowsFor(feederId);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.used_at ?? row.revoked_at, `row ${row.jti} must be dead`).not.toBeNull();
    }

    // The successor is dead too — presenting it is itself a replay now.
    const deadReplacement = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: replacement },
    });
    expect(deadReplacement.statusCode).toBe(401);
    expect(deadReplacement.json().error.code).toBe("REFRESH_REUSED");
    await app.close();
  });

  it("two concurrent presentations of one token: exactly one wins", async () => {
    const app = buildServer(config);
    const feederId = await makeRefreshFeeder();
    const token = await mintRecordedRefresh(feederId);

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: token } }),
      app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: token } }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 401]);
    const loser = a.statusCode === 401 ? a : b;
    expect(loser.json().error.code).toBe("REFRESH_REUSED");

    // The loser's reuse sweep killed even the winner's successor — the
    // fail-closed trade recorded in the refresh_tokens.replaced_by comment.
    const rows = await rowsFor(feederId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => (r.used_at ?? r.revoked_at) !== null)).toBe(true);
    await app.close();
  });

  it("401s REFRESH_REUSED for a valid signature with no recorded row", async () => {
    // Signed by us, never stored — the shape of a pre-migration token or a
    // row already swept by retention. Zero rows from the exchange UPDATE is
    // the reuse path: fail closed.
    const app = buildServer(config);
    const feederId = await makeRefreshFeeder();
    const orphan = signRefreshToken(feederId, config.JWT_SECRET, config.JWT_REFRESH_TTL);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: orphan },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("REFRESH_REUSED");
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 5.4 — signup eligibility + canonicalisation
// ---------------------------------------------------------------------------
// The domain restriction is enforced in PRODUCTION only (the route reads
// app.config.NODE_ENV — same idiom as the mailer and devCode gating), so
// dev/test login stays open, which everything above this line relies on.
//
// A production-config server is built by overriding NODE_ENV on an
// already-loaded config: loadConfig()'s production boot guards (which demand
// real SMTP/KMS env) never run, and the tests below only exercise paths that
// return BEFORE any email send — an accepted OTP under production config
// would hit sendOtpEmail against an empty SMTP host.

describe("signup eligibility — production only, unadvertised", () => {
  const prodConfig = { ...config, NODE_ENV: "production" as const };

  it("refuses a genuinely new address outside the eligible family", async () => {
    const app = buildServer(prodConfig);
    const email = `feeder-${Math.random().toString(36).slice(2)}@example.com`;
    usedEmails.push(email);

    const res = await app.inject({ method: "POST", url: "/api/v1/auth/otp", payload: { email } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("ADDRESS_NOT_ELIGIBLE");
    // The message may not name a provider, a domain or a policy.
    expect(res.json().error.message).toBe("We can't sign in that address right now.");
    await app.close();
  });

  it("resolver: a new address inside the eligible family passes the production gate", async () => {
    // Resolver level rather than route level: the route-level accept path
    // would send a real email under production config.
    const email = `feeder-${Math.random().toString(36).slice(2)}@gmail.com`;
    usedEmails.push(email);
    const resolved = await resolveIdentityHmac(email, config.HETJA_HMAC_PEPPER, {
      enforceNewSignupDomain: true,
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.existedBefore).toBe(false);
      expect(resolved.hmac).toBe(identityHmac(email, config.HETJA_HMAC_PEPPER));
    }
  });

  it("resolver: an existing account is grandfathered regardless of domain", async () => {
    const raw = `Legacy.Feeder-${Math.random().toString(36).slice(2)}@Yahoo.com`;
    usedEmails.push(raw);
    await query(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Legacy', 'feeder', 30, '1', false)`,
      [identityHmac(raw, config.HETJA_HMAC_PEPPER)],
    );

    const resolved = await resolveIdentityHmac(raw, config.HETJA_HMAC_PEPPER, {
      enforceNewSignupDomain: true,
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.existedBefore).toBe(true);
      // Keeps using the hash that already exists — the raw one.
      expect(resolved.hmac).toBe(identityHmac(raw, config.HETJA_HMAC_PEPPER));
    }
  });

  it("dev/test stays open to any domain (the gate is production-only)", async () => {
    // The suite above already depends on this; pinned explicitly because a
    // future "tighten the gate" change must break THIS test first.
    const app = buildServer(config);
    const email = randomEmail();
    usedEmails.push(email);
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/otp", payload: { email } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("canonicalisation — one mailbox, one account", () => {
  it("keys a new signup on the canonical hash, not the typed string", async () => {
    const app = buildServer(config);
    const typed = `Wave5.Key-${Math.random().toString(36).slice(2)}@Gmail.com`;
    usedEmails.push(typed);

    const res = await app.inject({ method: "POST", url: "/api/v1/auth/otp", payload: { email: typed } });
    expect(res.statusCode).toBe(200);

    const canonical = identityHmac(canonicalEmailAddress(typed), config.HETJA_HMAC_PEPPER);
    const raw = identityHmac(typed, config.HETJA_HMAC_PEPPER);
    expect(canonical).not.toBe(raw);
    const canonRow = await query(`SELECT 1 FROM otp_codes WHERE identity_hmac = $1`, [canonical]);
    const rawRow = await query(`SELECT 1 FROM otp_codes WHERE identity_hmac = $1`, [raw]);
    expect(canonRow.rowCount).toBe(1);
    expect(rawRow.rowCount).toBe(0);
    await app.close();
  });

  it("signing up under one rendering, logging in under another, finds the same account", async () => {
    const app = buildServer(config);
    const base = `wave5-${Math.random().toString(36).slice(2)}`;
    const signup = `${base}.test@gmail.com`;
    const variant = `${base}test+sort@gmail.com`; // same canonical local part
    usedEmails.push(signup, variant);

    const otp1 = await app.inject({ method: "POST", url: "/api/v1/auth/otp", payload: { email: signup } });
    expect(otp1.statusCode).toBe(200);
    const verify1 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        email: signup,
        code: otp1.json().data.devCode,
        deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET),
        consentVersion: 1,
        isMinor: false,
      },
    });
    expect(verify1.statusCode).toBe(200);

    const canonical = identityHmac(canonicalEmailAddress(signup), config.HETJA_HMAC_PEPPER);
    const before = await query<{ id: string }>(`SELECT id FROM feeders WHERE identity_hmac = $1`, [canonical]);
    expect(before.rowCount).toBe(1);

    // The second rendering must NOT create a second account.
    const otp2 = await app.inject({ method: "POST", url: "/api/v1/auth/otp", payload: { email: variant } });
    expect(otp2.statusCode).toBe(200);
    const verify2 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        email: variant,
        code: otp2.json().data.devCode,
        deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET),
        consentVersion: 1,
        isMinor: false,
      },
    });
    expect(verify2.statusCode).toBe(200);

    const after = await query<{ id: string }>(`SELECT id FROM feeders WHERE identity_hmac = $1`, [canonical]);
    expect(after.rowCount).toBe(1);
    expect(after.rows[0].id).toBe(before.rows[0].id);
    await app.close();
  });

  it("dot-rotated renderings share ONE per-identity rate bucket", async () => {
    // otpPerIdentity burst is 5. Six distinct renderings of one mailbox must
    // spend ONE bucket, so the sixth is refused — the exact bypass the
    // canonical keying exists to kill.
    const app = buildServer(config);
    const base = `bucket-${Math.random().toString(36).slice(2)}`;
    const renderings = [
      `${base}@gmail.com`,
      `${base.slice(0, 2)}.${base.slice(2)}@gmail.com`,
      `${base.slice(0, 1)}.${base.slice(1, 3)}.${base.slice(3)}@gmail.com`,
      `${base}+one@gmail.com`,
      `${base}+two@gmail.com`,
      `${base}+three@gmail.com`,
    ];
    for (const r of renderings) usedEmails.push(r);

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/otp",
        payload: { email: renderings[i] },
      });
      expect(res.statusCode, `rendering ${i}`).toBe(200);
    }
    const sixth = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { email: renderings[5] },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe("RATE_LIMITED");
    await app.close();
  });

  it("a legacy account keeps its raw hash and never gains a duplicate", async () => {
    const app = buildServer(config);
    const raw = `legacy-${Math.random().toString(36).slice(2)}@example.com`;
    usedEmails.push(raw);
    await query(
      `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
       VALUES ($1, 'Legacy Route', 'feeder', 30, '1', false)`,
      [identityHmac(raw, config.HETJA_HMAC_PEPPER)],
    );

    const otp = await app.inject({ method: "POST", url: "/api/v1/auth/otp", payload: { email: raw } });
    expect(otp.statusCode).toBe(200);
    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        email: raw,
        code: otp.json().data.devCode,
        deviceToken: issueDeviceToken(config.HETJA_DEVICE_SECRET),
        consentVersion: 1,
        isMinor: false,
      },
    });
    expect(verify.statusCode).toBe(200);

    const all = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM feeders WHERE identity_hmac IN ($1, $2)`,
      [
        identityHmac(raw, config.HETJA_HMAC_PEPPER),
        identityHmac(canonicalEmailAddress(raw), config.HETJA_HMAC_PEPPER),
      ],
    );
    expect(all.rows[0].n).toBe(1);
    await app.close();
  });
});
