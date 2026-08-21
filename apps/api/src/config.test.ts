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
