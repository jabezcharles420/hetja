import { describe, expect, it } from "vitest";
import { normalizeIndianPhone, IndianPhoneE164 } from "./phone.js";

describe("normalizeIndianPhone (enhancement stack §G.3)", () => {
  it("normalizes national-format mobiles to E.164", () => {
    expect(normalizeIndianPhone("9820127085")).toBe("+919820127085");
    expect(normalizeIndianPhone("09820127085")).toBe("+919820127085");
    expect(normalizeIndianPhone("+91 98201 27085")).toBe("+919820127085");
    expect(normalizeIndianPhone("+919820127085")).toBe("+919820127085");
  });

  it("normalizes fixed-line numbers (landlines are care providers too)", () => {
    // Bombay SPCA's Parel landline shape — /mobile metadata would reject this.
    expect(normalizeIndianPhone("022 2493 9005")).toBe("+912224939005");
    // The exact shape that broke migration 0013: a landline typed with the
    // trunk 0 and no separators. 0013's UPDATEs only matched 10-digit mobiles
    // (^[6-9]…), so this stayed unprefixed, its CHECK constraint was silently
    // skipped on the production cluster, and 0013 can never be retried. Fixed
    // in SQL by 0015_care_phone_e164_retry.sql; asserted here because this is
    // the value the two implementations have to agree about.
    expect(normalizeIndianPhone("02224137518")).toBe("+912224137518");
    expect(normalizeIndianPhone("2224137518")).toBe("+912224137518");
  });

  it("returns null for unparseable or foreign numbers", () => {
    expect(normalizeIndianPhone("not-a-number")).toBeNull();
    expect(normalizeIndianPhone("")).toBeNull();
    expect(normalizeIndianPhone("+12125551234")).toBeNull(); // valid US number, wrong country
    expect(normalizeIndianPhone("123")).toBeNull();
  });
});

describe("IndianPhoneE164 zod field", () => {
  it("passes null and undefined through (provider may publish no phone)", () => {
    expect(IndianPhoneE164.parse(null)).toBeNull();
    expect(IndianPhoneE164.parse(undefined)).toBeUndefined();
  });

  it("preprocesses a valid number to canonical E.164", () => {
    expect(IndianPhoneE164.parse("9820127085")).toBe("+919820127085");
  });

  it("rejects an unparseable number with the E.164 message", () => {
    const result = IndianPhoneE164.safeParse("12345");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("valid Indian phone number");
    }
  });
});
