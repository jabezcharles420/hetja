import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { phoneHmac } from "../lib/hmac.js";
import { verifyAccessToken, verifyRefreshToken } from "../lib/jwt.js";
import { issueDeviceToken } from "../lib/device.js";
import { clearOtp } from "../lib/otp.js";
import { query } from "@straynet/db";

const config = loadConfig();

function randomPhone(): string {
  return `+91${Math.floor(Math.random() * 4) + 6}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

const usedPhones: string[] = [];

async function cleanupPhones(): Promise<void> {
  for (const phone of usedPhones) {
    clearOtp(phone);
    await query(`DELETE FROM feeders WHERE phone_hmac = $1`, [phoneHmac(phone, config.STRAYNET_HMAC_PEPPER)]);
  }
}

afterEach(async () => {
  await cleanupPhones();
  usedPhones.length = 0;
});

describe("POST /api/v1/auth/otp + verify", () => {
  it("issues a dev-mode OTP and verifies it into JWTs + feeder", async () => {
    const app = buildServer(config);
    const phone = randomPhone();
    usedPhones.push(phone);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { phone },
    });
    expect(otpRes.statusCode).toBe(200);
    const otpBody = otpRes.json();
    expect(otpBody.ok).toBe(true);
    expect(otpBody.data.devCode).toMatch(/^\d{6}$/);

    const deviceToken = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        phone,
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
    const phone = randomPhone();
    usedPhones.push(phone);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { phone },
    });
    const devCode = otpRes.json().data.devCode;

    const wrongCode = devCode === "000000" ? "111111" : "000000";
    const deviceToken = issueDeviceToken(config.STRAYNET_DEVICE_SECRET);
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { phone, code: wrongCode, deviceToken, consentVersion: 1, isMinor: false },
    });
    expect(verifyRes.statusCode).toBe(400);
    expect(verifyRes.json().ok).toBe(false);

    await app.close();
  });

  it("rejects verify with a bad device token", async () => {
    const app = buildServer(config);
    const phone = randomPhone();
    usedPhones.push(phone);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { phone },
    });
    const devCode = otpRes.json().data.devCode;

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { phone, code: devCode, deviceToken: "not-an-attested-token", consentVersion: 1, isMinor: false },
    });
    expect(verifyRes.statusCode).toBe(401);

    await app.close();
  });

  it("requires consentVersion at signup (DPDP)", async () => {
    const app = buildServer(config);
    const phone = randomPhone();
    usedPhones.push(phone);

    const otpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp",
      payload: { phone },
    });
    const devCode = otpRes.json().data.devCode;

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { phone, code: devCode, deviceToken: issueDeviceToken(config.STRAYNET_DEVICE_SECRET), isMinor: false },
    });
    expect(verifyRes.statusCode).toBe(400);

    await app.close();
  });
});
