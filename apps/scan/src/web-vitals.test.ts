/**
 * Slug-stripping tests for the scan app's web-vitals client.
 *
 * These exist because the identical bug shipped in two files and was fixed in
 * only one of them first: `apps/web/lib/web-vitals.ts` had its unanchored
 * "any trailing 9-char run" pattern corrected, and this copy kept it. The
 * assertions below are deliberately the same set as
 * `apps/web/lib/web-vitals.test.ts`, so the two clients cannot diverge without
 * one of the suites going red.
 *
 * Why divergence matters more than it looks: `apps/api/src/routes/metrics.ts`
 * rejects a slug-shaped path segment that passes the INVARIANT 1 check
 * character, and a beacon sent with `navigator.sendBeacon` cannot observe or
 * report the resulting 400. A client that strips differently from the server's
 * expectation does not error; it silently stops producing telemetry, for the
 * one page whose performance the whole 40 KB budget is about.
 */
import { describe, it, expect } from "vitest";
import { slugStrippedPath } from "./web-vitals.js";

describe("apps/scan slugStrippedPath", () => {
  it("strips a collar slug on the scan landing", () => {
    expect(slugStrippedPath("/d/c3di5esh8")).toBe("/d/:slug");
  });

  it("strips a collar slug on the web dog page shape too", () => {
    expect(slugStrippedPath("/dog/c3di5esh8")).toBe("/dog/:slug");
  });

  it("normalises a trailing slash rather than emitting a second variant", () => {
    // "/d/:slug" and "/d/:slug/" would otherwise be two rows for one page.
    expect(slugStrippedPath("/d/c3di5esh8/")).toBe("/d/:slug");
  });

  it("keeps any remaining path after the slug", () => {
    expect(slugStrippedPath("/d/c3di5esh8/photos")).toBe("/d/:slug/photos");
  });

  it("never emits a 9-char code in the result", () => {
    expect(slugStrippedPath("/d/c3di5esh8")).not.toMatch(/[a-km-z2-9]{9}/);
  });

  // Regression: every name here is 9+ characters in the reduced alphabet, so the
  // old pattern rewrote each one to "/:slug" and attributed its timings to the
  // collar page.
  it.each(["/dashboard", "/leaderboard", "/gamification", "/territories", "/moderation", "/about"])(
    "leaves the ordinary route %s alone",
    (route) => {
      expect(slugStrippedPath(route)).toBe(route);
    },
  );

  it("does not strip a 9-char run outside a dog route position", () => {
    expect(slugStrippedPath("/stories/c3di5esh8")).toBe("/stories/c3di5esh8");
  });

  it("leaves the root and short paths alone", () => {
    expect(slugStrippedPath("/")).toBe("/");
    expect(slugStrippedPath("/d")).toBe("/d");
    expect(slugStrippedPath("/d/")).toBe("/d/");
  });
});

import { clsOf, inpOf, rating } from "./web-vitals.js";

describe("native web vitals (design v6: the package no longer fits the 40 KB budget)", () => {
  it("rates with the web-vitals package's thresholds", () => {
    expect(rating("LCP", 2500)).toBe("good");
    expect(rating("LCP", 2501)).toBe("needs-improvement");
    expect(rating("LCP", 4001)).toBe("poor");
    expect(rating("CLS", 0.1)).toBe("good");
    expect(rating("INP", 300)).toBe("needs-improvement");
    expect(rating("TTFB", 1900)).toBe("poor");
  });

  it("CLS is the largest session window (1 s gap, 5 s cap)", () => {
    expect(clsOf([])).toBe(0);
    // One window: 0.1 + 0.05, then a gap over 1 s starts a new one of 0.12.
    expect(clsOf([{ startTime: 0, value: 0.1 }, { startTime: 500, value: 0.05 }, { startTime: 3000, value: 0.12 }])).toBeCloseTo(0.15);
    // A window longer than 5 s is split even without a gap.
    const steady = [0, 900, 1800, 2700, 3600, 4500, 5400].map((t) => ({ startTime: t, value: 0.1 }));
    expect(clsOf(steady)).toBeCloseTo(0.6);
  });

  it("INP is the worst interaction, skipping one per 50", () => {
    expect(inpOf([])).toBeUndefined();
    expect(inpOf([40, 120, 80])).toBe(120);
    const many = Array.from({ length: 60 }, (_, i) => i + 1);
    expect(inpOf(many)).toBe(59);
  });
});
