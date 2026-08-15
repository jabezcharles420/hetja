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

  const at = (ms: number) =>
    ScanInput.safeParse({ ...base, capturedAt: new Date(Date.now() + ms).toISOString() });

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("accepts capturedAt slightly in the future (ordinary phone clock drift)", () => {
    expect(at(5 * MIN).success).toBe(true);
  });

  it("rejects capturedAt more than 15 minutes in the future", () => {
    // The direction that matters: applyLww keeps the greatest captured_at, so a
    // future timestamp wins last-writer-wins indefinitely and pins
    // last_seen_geo — the field the SOS geofence depends on.
    expect(at(20 * MIN).success).toBe(false);
  });

  // The past direction had NO coverage, which is how a symmetric clamp survived
  // in a schema whose invariant is explicitly about phones that are "offline for
  // hours". Each of these was a permanent 400 before the clamp was made
  // one-sided: the feed synced, was refused, and the client — correctly reading
  // a 400 as final — dropped it along with the photo.
  it.each([
    ["16 minutes", 16 * MIN],
    ["45 minutes", 45 * MIN],
    ["3 hours", 3 * HOUR],
    ["an afternoon out of signal", 8 * HOUR],
    ["6 days", 6 * DAY],
  ])("accepts a feed captured %s ago", (_label, ago) => {
    expect(at(-ago).success).toBe(true);
  });

  it("still rejects a capturedAt from an implausibly distant past", () => {
    // Not unbounded: a timestamp this old is a broken client, not a patient
    // feeder, and applyLww should reason over a finite window.
    expect(at(-60 * DAY).success).toBe(false);
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
