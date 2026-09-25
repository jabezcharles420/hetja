/**
 * The report answer (hardening T11): a 429 still shows the nearby Call rows.
 */
import { describe, expect, it } from "vitest";
import { readReport } from "./sos.js";

const VET = {
  id: "p1",
  name: "Dr. Mehta, Pet Clinic",
  kind: "vet",
  costTier: "paid",
  phoneE164: "+912226300000",
  altPhoneE164: null,
  hasAmbulance: false,
  is24x7: false,
  hoursNote: "open till 9 pm",
  handlesWildlife: false,
  phoneVerifiedAt: "2026-09-01T00:00:00Z",
  geoPrecision: "exact",
  locality: "Andheri West",
  lat: 19.13,
  lng: 72.83,
  distanceM: 420,
};

describe("readReport", () => {
  it("success: case id and the care rows", () => {
    const r = readReport(200, { ok: true, data: { caseId: "c1", nearbyCare: [VET] } });
    expect(r.ok).toBe(true);
    expect(r.caseId).toBe("c1");
    expect(r.care.map((p) => p.name)).toEqual(["Dr. Mehta, Pet Clinic"]);
  });

  it("429: capped, but the nearbyCare from the 429 body is still shown", () => {
    const r = readReport(429, {
      ok: false,
      error: { message: "too many reports", code: "RATE_LIMITED" },
      data: { nearbyCare: [VET] },
    });
    expect(r.ok).toBe(false);
    expect(r.rateLimited).toBe(true);
    expect(r.care).toHaveLength(1);
    expect(r.care[0]!.name).toBe("Dr. Mehta, Pet Clinic");
  });

  it("429 with nearbyCare under error.data works too", () => {
    const r = readReport(429, { ok: false, error: { code: "RATE_LIMITED", data: { nearbyCare: [VET] } } });
    expect(r.care).toHaveLength(1);
  });

  it("429 without nearbyCare: capped, no rows (the page falls back to a location lookup)", () => {
    const r = readReport(429, { ok: false, error: { code: "RATE_LIMITED" } });
    expect(r).toEqual({ ok: false, rateLimited: true, care: [], code: "RATE_LIMITED" });
  });

  it("other failures carry no rows and are not rate-limited", () => {
    expect(readReport(500, null)).toEqual({ ok: false, rateLimited: false, care: [] });
  });
});
