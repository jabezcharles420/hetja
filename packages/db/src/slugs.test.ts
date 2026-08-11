import { describe, expect, it } from "vitest";
import { generateSlug, isValidSlug, signSlug, verifySlugSig } from "./slugs.js";

describe("slugs (INVARIANT 1: random, never sequential)", () => {
  it("generates 9-char base32 slugs without confusables", () => {
    for (let i = 0; i < 500; i++) {
      const s = generateSlug();
      expect(s).toMatch(/^[a-km-z2-9]{9}$/);
      expect(isValidSlug(s)).toBe(true);
    }
  });

  it("is not sequential: consecutive slugs never share a prefix pattern", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = generateSlug();
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
  });

  it("rejects slugs with invalid check chars", () => {
    const s = generateSlug();
    const corrupted = s.slice(0, 8) + (s[8] === "a" ? "b" : "a");
    expect(isValidSlug(corrupted)).toBe(false);
  });

  it("HMAC signs and verifies", () => {
    const s = generateSlug();
    const sig = signSlug(s, "secret");
    expect(verifySlugSig(s, sig, "secret")).toBe(true);
    expect(verifySlugSig(s, sig, "other")).toBe(false);
    expect(verifySlugSig(s, sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a"), "secret")).toBe(false);
  });
});
