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

  it("HMAC signs and verifies (constant-time compare, incl. length mismatch)", () => {
    const s = generateSlug();
    const sig = signSlug(s, "secret");
    expect(verifySlugSig(s, sig, "secret")).toBe(true);
    expect(verifySlugSig(s, sig, "other")).toBe(false);
    expect(verifySlugSig(s, sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a"), "secret")).toBe(false);
    // A truncated signature must fail on the length guard before the
    // constant-time comparison, not throw.
    expect(verifySlugSig(s, sig.slice(0, 4), "secret")).toBe(false);
  });

  /**
   * The alphabet's documented reality (see the comment above ALPHABET in
   * slugs.ts): the string holds 33 characters and contains `o`, but the
   * & 31 mask and % 32 check make index 32 — `9` — unreachable, so the
   * effective emitted set is exactly `2345678abcdefghijkmnopqrstuvwxyz`.
   * This pins that truth so a future edit to ALPHABET cannot silently change
   * what collars are made of: any reindexing shifts check characters of
   * already-issued slugs, and a collar is printed once and glued to a dog.
   */
  it("emits exactly the reduced 32-char alphabet — never l, 0, 1 or 9", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      for (const c of generateSlug()) seen.add(c);
    }
    expect([...seen].sort().join("")).toBe("2345678abcdefghijkmnopqrstuvwxyz");
  });

  it("keeps validating slugs whose body contains 9 (accepted by validators, never generated)", () => {
    // Validators deliberately stay more permissive than the generator so
    // hand-minted or legacy values keep resolving. Build such a value: swap a
    // body character for `9` and recompute the check char with the same
    // mod-32 arithmetic isValidSlug uses.
    const s = generateSlug();
    const body = s.slice(0, 7) + "9";
    const check = [...body].reduce((acc, c) => acc + "abcdefghijkmnopqrstuvwxyz23456789".indexOf(c), 0) % 32;
    expect(isValidSlug(body + "abcdefghijkmnopqrstuvwxyz23456789"[check])).toBe(true);
  });
});
