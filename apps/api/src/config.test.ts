/**
 * Boot-time config refusals.
 *
 * The API's posture is to refuse to start rather than start and silently
 * misbehave (the SMTP refusal is the precedent: minting OTP codes that go
 * nowhere). STORAGE_BACKEND=s3 joined that list because the unimplemented S3
 * backend made every scan answer {ok:true} while persistScanAssets' catch
 * discarded the photo with only a log.warn — silent data loss that no
 * dashboard would ever surface.
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig — STORAGE_BACKEND", () => {
  it("boots with the local backend (the default)", () => {
    const config = loadConfig({ ...process.env, STORAGE_BACKEND: "local" });
    expect(config.STORAGE_BACKEND).toBe("local");
  });

  it("refuses STORAGE_BACKEND=s3 in every environment", () => {
    // Unconditional by design: unlike mail, there is no environment where s3
    // currently functions, so photos would be silently dropped in dev too.
    expect(() => loadConfig({ ...process.env, STORAGE_BACKEND: "s3" })).toThrow(
      /STORAGE_BACKEND=s3 is not implemented/,
    );
  });
});

/**
 * HOST in production must be loopback. The check used to be presence-only —
 * docs/BUGS.md recorded it as "refuses anything but 127.0.0.1" while
 * HOST=0.0.0.0 set explicitly booted fine and exposed the API past Caddy.
 */
describe("loadConfig — HOST in production", () => {
  const prodEnv = {
    ...process.env,
    NODE_ENV: "production",
    PGPASSWORD: "x".repeat(20),
    HETJA_HMAC_PEPPER: "p".repeat(32),
    HETJA_QR_SECRET: "q".repeat(32),
    HETJA_DEVICE_SECRET: "d".repeat(32),
    JWT_SECRET: "j".repeat(32),
    BREVO_SMTP_HOST: "smtp.example.test",
    BREVO_SMTP_USER: "user",
    BREVO_SMTP_PASS: "pass",
    TRUST_PROXY: "1",
  };

  it("boots on 127.0.0.1", () => {
    expect(loadConfig({ ...prodEnv, HOST: "127.0.0.1" }).HOST).toBe("127.0.0.1");
  });

  it("refuses a non-loopback bind address", () => {
    expect(() => loadConfig({ ...prodEnv, HOST: "0.0.0.0" })).toThrow(/not a loopback address/);
    expect(() => loadConfig({ ...prodEnv, HOST: "10.0.0.5" })).toThrow(/not a loopback address/);
  });

  it("still refuses an unset HOST rather than falling back to 0.0.0.0", () => {
    const { HOST: _drop, ...noHost } = prodEnv as Record<string, string>;
    expect(() => loadConfig(noHost)).toThrow(/HOST is not set/);
  });
});
