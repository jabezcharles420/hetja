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
 * expectation does not error — it silently stops producing telemetry, for the
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
