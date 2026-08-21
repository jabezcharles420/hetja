import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { identityHmac } from "../lib/hmac.js";
import { verifyAccessToken, verifyRefreshToken } from "../lib/jwt.js";
import { issueDeviceToken } from "../lib/device.js";
import { clearOtp } from "../lib/otp.js";
import { query } from "@hetja/db";

const config = loadConfig();

function randomEmail(): string {
  return `feeder-${Math.random().toString(36).slice(2)}@example.com`;
}

const usedEmails: string[] = [];

async function cleanupEmails(): Promise<void> {
  for (const email of usedEmails) {
    const idHmac = identityHmac(email, config.HETJA_HMAC_PEPPER);
    await clearOtp(idHmac);
    await query(`DELETE FROM feeders WHERE identity_hmac = $1`, [idHmac]);
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
