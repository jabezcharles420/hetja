// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { slugStrippedPath, vitalsPayload, sendVitalsBeacon } from "./web-vitals";

function metric(name: "LCP" | "CLS" | "INP" | "TTFB", value: number, rating: "good" | "needs-improvement" | "poor") {
  return {
    name,
    value,
    rating,
    delta: value,
    id: "v1",
    entries: [],
    navigationType: "navigate",
    navigationId: 1,
  } as import("web-vitals").MetricType;
}

describe("web-vitals client (§M.16)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("slugStrippedPath", () => {
    it("strips a trailing collar slug from the web dog page", () => {
      expect(slugStrippedPath("/dog/c3di5esh8")).toBe("/dog/:slug");
    });

    it("strips a trailing collar slug from the scan landing", () => {
      expect(slugStrippedPath("/d/c3di5esh8")).toBe("/d/:slug");
    });

    it("handles a trailing slash", () => {
      expect(slugStrippedPath("/d/c3di5esh8/")).toBe("/d/:slug");
    });

    it("never emits a 9-char code in the result", () => {
      const stripped = slugStrippedPath("/dog/c3di5esh8");
      expect(stripped).not.toMatch(/[a-km-z2-9]{9}/);
    });

    it("leaves non-dog paths untouched", () => {
      expect(slugStrippedPath("/privacy")).toBe("/privacy");
    });

    // Regression: the pattern used to be any trailing 9-char run in the reduced
    // alphabet, with no route prefix -- a length test masquerading as a slug
    // test. Every name below is 9+ in-alphabet characters, so each was rewritten
    // to "/:slug" and its telemetry merged into the dog-page bucket. Mislabelled
    // metrics are worse than missing ones: they make the collar page's measured
    // LCP -- the number the whole 40 KB budget exists to defend -- untrue.
    it.each([
      "/dashboard",
      "/leaderboard",
      "/gamification",
      "/territories",
      "/moderation",
      "/how-it-works",
      "/about",
    ])("leaves the ordinary route %s alone", (route) => {
      expect(slugStrippedPath(route)).toBe(route);
    });

    it("strips a slug that has more path after it", () => {
      expect(slugStrippedPath("/dog/c3di5esh8/photos")).toBe("/dog/:slug/photos");
    });

    it("does not strip a 9-char run that is not in a dog route position", () => {
      // Same characters, wrong place: this is not a dog page, so it must not be
      // *labelled* as one.
      //
      // Note the deliberate coupling with the server. routes/metrics.ts rejects a
      // slug-shaped segment anywhere in the path if it passes the INVARIANT 1
      // check character, so if a route like this ever carried a REAL slug the
      // beacon would 400 and that telemetry would be dropped rather than
      // recorded against a dog. Failing closed is the right direction for a
      // privacy guard -- but it does mean that adding a new route which embeds a
      // collar slug requires extending DOG_SLUG_PATH above at the same time, or
      // the page silently reports nothing. There is no such route today.
      expect(slugStrippedPath("/stories/c3di5esh8")).toBe("/stories/c3di5esh8");
    });
  });

  describe("vitalsPayload", () => {
    it("builds the anonymous, slug-stripped payload the API contract expects", () => {
      const m = metric("LCP", 1234.5, "good");
      expect(vitalsPayload("/dog/c3di5esh8", m)).toEqual({
        path: "/dog/:slug",
        name: "LCP",
        value: 1234.5,
        rating: "good",
      });
    });
  });

  describe("sendVitalsBeacon", () => {
    it("beacons a JSON blob to the web-vitals endpoint", async () => {
      const sendBeacon = vi.fn((_url: string, _data?: BodyInit) => true);
      vi.stubGlobal("navigator", { sendBeacon });
      const ok = sendVitalsBeacon("/dog/c3di5esh8", metric("INP", 120, "good"));
      expect(ok).toBe(true);
      expect(sendBeacon).toHaveBeenCalledTimes(1);
      const [url, blob] = sendBeacon.mock.calls[0] as [string, Blob];
      expect(url).toContain("/api/v1/metrics/web-vitals");
      expect(blob.type).toBe("application/json");
      // jsdom's Blob has no .text(); read via FileReader.
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      expect(JSON.parse(text)).toEqual({
        path: "/dog/:slug",
        name: "INP",
        value: 120,
        rating: "good",
      });
    });

    it("returns false instead of throwing when the beacon fails", () => {
      vi.stubGlobal("navigator", {
        sendBeacon: () => {
          throw new Error("blocked");
        },
      });
      expect(sendVitalsBeacon("/privacy", metric("TTFB", 90, "good"))).toBe(false);
    });
  });
});
