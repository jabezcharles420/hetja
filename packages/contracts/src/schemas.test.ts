import { describe, expect, it } from "vitest";
import { SLUG_REGEX, ScanInput, apiEnvelope, Dog } from "./schemas.js";

const validSlug = "abcd2345x";

describe("slug", () => {
  it("matches /^[a-km-z2-9]{9}$/ for valid slugs (8 data + 1 check char)", () => {
    expect("abcd2345x").toMatch(SLUG_REGEX);
    expect("zzzz2222z").toMatch(SLUG_REGEX);
    expect("abcdefgh2").toMatch(SLUG_REGEX);
  });

  it("accepts the digits 8 and 9, which the old regex wrongly refused", () => {
    // Regression: the real Phase-0 collar c3di5esh8 was rejected outright, so a
    // stranger scanning that dog's tag could not file an emergency report.
    expect("c3di5esh8").toMatch(SLUG_REGEX);
    expect("abcdefgh9").toMatch(SLUG_REGEX);
  });

  it("accepts every real Phase-0 collar", () => {
    for (const slug of ["c3di5esh8", "md5wicnma", "jo23vpmg5", "5hreaphdq", "jtkkaece2"]) {
      expect(slug).toMatch(SLUG_REGEX);
    }
  });

  it("rejects wrong lengths, uppercase, and the omitted confusables", () => {
    expect("abc2345").not.toMatch(SLUG_REGEX);
    expect("abcde123").not.toMatch(SLUG_REGEX);
    expect("ABC23456").not.toMatch(SLUG_REGEX);
    expect("abcdefghl").not.toMatch(SLUG_REGEX); // `l` is not in the alphabet
    expect("abcd23450").not.toMatch(SLUG_REGEX); // nor is `0`
    expect("abcd23451").not.toMatch(SLUG_REGEX); // nor is `1`
  });

  it("rejects a Dog with a bad slug", () => {
    const result = Dog.safeParse({
      slug: "abcde123",
      status: "active",
      wardId: "A",
    });
    expect(result.success).toBe(false);
  });
});

describe("ScanInput skew clamp", () => {
  const base = {
    clientUuid: "3b241101-e2bb-4255-8caf-4136c566a962",
    dogSlug: validSlug,
    type: "feed" as const,
  };

  it("accepts capturedAt within the ±15min window", () => {
    const result = ScanInput.safeParse({
      ...base,
      capturedAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects capturedAt more than 15 minutes in the future", () => {
    const result = ScanInput.safeParse({
      ...base,
      capturedAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe("ScanInput clientUuid", () => {
  it("rejects a ScanInput missing clientUuid", () => {
    const result = ScanInput.safeParse({
      dogSlug: validSlug,
      type: "view" as const,
      capturedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues.some((i) => i.path[0] === "clientUuid"))).toBe(
        "true",
      );
    }
  });
});

describe("apiEnvelope", () => {
  const envelope = apiEnvelope(Dog);

  it("builds ok envelopes with data", () => {
    const result = envelope.safeParse({
      ok: true,
      data: { slug: validSlug, status: "active", wardId: "G/North" },
    });
    expect(result.success).toBe(true);
  });

  it("builds error envelopes without data", () => {
    const result = envelope.safeParse({ ok: false, error: { message: "boom" } });
    expect(result.success).toBe(true);
  });
});
