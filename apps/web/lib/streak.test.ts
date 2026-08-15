import { describe, expect, it } from "vitest";
import {
  badgeLabel,
  mapStreak,
  nextMilestoneFor,
  streakLabelFor,
  streakLevelFor,
  trustLabelFor,
  type StreakData,
} from "./streak";

describe("lib/streak display mapping", () => {
  it("maps streak days to levels and labels", () => {
    expect(streakLevelFor(0)).toBe("none");
    expect(streakLevelFor(3)).toBe("warm");
    expect(streakLevelFor(7)).toBe("week");
    expect(streakLevelFor(13)).toBe("week");
    expect(streakLevelFor(14)).toBe("fortnight");
    expect(streakLevelFor(30)).toBe("champion");
  });

  it("produces human labels for streak days", () => {
    expect(streakLabelFor(0)).toBe("Start a streak — log a feed today");
    expect(streakLabelFor(1)).toBe("1 day streak — keep it alive");
    expect(streakLabelFor(7)).toBe("7-day streak — a full week!");
    expect(streakLabelFor(30)).toBe("30-day streak — champion feeder");
  });

  it("computes the next milestone", () => {
    expect(nextMilestoneFor(0)).toBe("7 days to a week streak");
    expect(nextMilestoneFor(10)).toBe("4 days to a fortnight");
    expect(nextMilestoneFor(30)).toBeNull();
  });

  it("maps trust scores to labels", () => {
    expect(trustLabelFor(90)).toBe("Trusted regular");
    expect(trustLabelFor(65)).toBe("Reliable feeder");
    expect(trustLabelFor(45)).toBe("Active feeder");
    expect(trustLabelFor(25)).toBe("New feeder");
    expect(trustLabelFor(5)).toBe("Getting started");
  });

  it("maps known badges to friendly labels and title-cases unknown ones", () => {
    expect(badgeLabel("first_feed")).toBe("First Feed");
    expect(badgeLabel("sos_hero")).toBe("SOS Hero");
    expect(badgeLabel("brave_heart")).toBe("Brave Heart");
  });

  it("mapStreak assembles the full display view", () => {
    const view = mapStreak({ trustScore: 72, streakDays: 9, badges: ["week_streak", "vip_contributor"] });

    expect(view.streakDays).toBe(9);
    expect(view.streakLevel).toBe("week");
    expect(view.streakLabel).toContain("9-day streak");
    expect(view.trustScore).toBe(72);
    expect(view.trustLabel).toBe("Reliable feeder");
    expect(view.nextMilestone).toBe("5 days to a fortnight");
    expect(view.badges).toEqual([
      { key: "week_streak", label: "Week Streak" },
      { key: "vip_contributor", label: "Vip Contributor" },
    ]);
  });

  it("clamps negative streak days to zero", () => {
    const view = mapStreak({ trustScore: 30, streakDays: -4, badges: [] });
    expect(view.streakDays).toBe(0);
    expect(view.streakLevel).toBe("none");
  });
});

/**
 * Regression: /me must survive a streak payload missing fields.
 *
 * `StreakData` declares `badges` and `trustScore` as required, and the API did
 * not send either. `mapStreak` called `data.badges.map(...)`, which threw on
 * every render of /me — the page a feeder is redirected to the instant they
 * sign in. With no error boundary in the app at the time, React unmounted the
 * whole tree and the user got Next.js's bare "Application error: a client-side
 * exception has occurred". A login that had just succeeded, ending on a blank
 * error page, for every feeder, in every environment.
 *
 * The API now sends both fields and the app has error boundaries. This test
 * pins the third defence: a payload gap must cost a number on a page, never
 * the page.
 */
describe("mapStreak resilience to payload drift", () => {
  it("does not throw when badges is missing", () => {
    const partial = { streakDays: 3 } as unknown as StreakData;
    expect(() => mapStreak(partial)).not.toThrow();
    expect(mapStreak(partial).badges).toEqual([]);
  });

  it("does not throw when trustScore is missing", () => {
    const partial = { streakDays: 3, badges: [] } as unknown as StreakData;
    expect(() => mapStreak(partial)).not.toThrow();
    expect(mapStreak(partial).trustScore).toBe(0);
  });

  it("survives an entirely empty payload", () => {
    const empty = {} as unknown as StreakData;
    expect(() => mapStreak(empty)).not.toThrow();
    const out = mapStreak(empty);
    expect(out.streakDays).toBe(0);
    expect(out.badges).toEqual([]);
  });

  it("still maps a complete payload correctly", () => {
    const full: StreakData = { streakDays: 7, trustScore: 55, badges: ["first_feed"] };
    const out = mapStreak(full);
    expect(out.streakDays).toBe(7);
    expect(out.trustScore).toBe(55);
    expect(out.badges).toEqual([{ key: "first_feed", label: "First Feed" }]);
  });
});
