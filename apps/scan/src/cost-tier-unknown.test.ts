/**
 * Migration 0030: a care provider's cost tier may be unknown (null). The
 * collar page must then say nothing about price and never "free"; a
 * government row is free whatever its tier says.
 */
import { describe, expect, it } from "vitest";
import { normalizeList } from "./care.js";
import { careRow } from "./format.js";

describe("unknown cost tier on the collar page", () => {
  it("normalises a null tier to none and shows no price or 'free'", () => {
    const p = normalizeList({ ok: true, data: { providers: [{ name: "An NGO", kind: "ngo", costTier: null, phoneE164: "+919820000000" }] } })[0]!;
    expect(p.costTier).toBeUndefined();
    const row = careRow({ name: p.name, kind: "ngo", costTier: p.costTier, is24x7: false, hasAmbulance: false, phone: "+919820000000", phoneVerified: false });
    expect(row.meta).not.toMatch(/free|paid|subsidised/i);
    expect(row.note).toBe("Number not confirmed yet");
  });

  it("still labels a government row free", () => {
    const row = careRow({ name: "BMC Dog Control Office", kind: "govt", is24x7: false, hasAmbulance: false, phoneVerified: false });
    expect(row.meta).toMatch(/free/);
  });
});
