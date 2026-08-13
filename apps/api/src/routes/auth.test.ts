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
