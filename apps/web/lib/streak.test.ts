import { describe, expect, it } from "vitest";
import {
  badgeSlots,
  fedAgoLabel,
  firstName,
  formatDayMonth,
  greetingFor,
  greetingLine,
  isFedToday,
  kolkataDay,
  nextFeedLabel,
  safeStreak,
  sortUnfedFirst,
  streakAfterFeed,
  streakCaption,
  streakSubline,
  trustLevelFor,
  trustView,
} from "./streak";

function at(h: number, m = 0): Date {
  const d = new Date(2026, 8, 24, h, m);
  return d;
}

describe("greeting", () => {
  it("says Morning / Afternoon / Evening by local hour", () => {
    expect(greetingFor(at(5))).toBe("Morning");
    expect(greetingFor(at(11, 59))).toBe("Morning");
    expect(greetingFor(at(12))).toBe("Afternoon");
    expect(greetingFor(at(16, 59))).toBe("Afternoon");
    expect(greetingFor(at(17))).toBe("Evening");
    expect(greetingFor(at(23))).toBe("Evening");
    expect(greetingFor(at(2))).toBe("Evening");
  });

  it("uses the first name, and none for the server's unnamed default", () => {
    expect(firstName("Priya Sharma")).toBe("Priya");
    expect(firstName("Hetja Feeder")).toBeNull();
    expect(firstName("  ")).toBeNull();
    expect(greetingLine(at(9), "Priya")).toBe("Morning, Priya.");
    expect(greetingLine(at(9), "Hetja Feeder")).toBe("Morning.");
  });
});

describe("badge mapping", () => {
  it("maps the API catalog to the four Me badges in the mock's order", () => {
    const slots = badgeSlots(["first_feed", "week_streak", "monsoon_hero"], 23);
    expect(slots.map((s) => [s.key, s.mark, s.label, s.locked])).toEqual([
      ["first_feed", "1st", "First feed", false],
      ["week_streak", "7", "A full week", false],
      ["monsoon_hero", "M", "Monsoon feeder", false],
      ["month_streak", "28", "28 days", true],
    ]);
    // The API's month threshold is 28: 23 days in, 5 to go.
    expect(slots[3]!.remaining).toBe("5 days to go");
  });

  it("locks what the API has not awarded, whatever the streak says", () => {
    const slots = badgeSlots([], 9);
    expect(slots.every((s) => s.locked)).toBe(true);
    expect(slots[1]!.remaining).toBe("1 day to go"); // never "0 days" or negative
    expect(slots[3]!.remaining).toBe("19 days to go");
  });
});

describe("fed today and the unfed-first order", () => {
  const now = new Date("2026-09-24T10:00:00+05:30");

  it("uses the Kolkata calendar day", () => {
    expect(kolkataDay(new Date("2026-09-23T19:00:00Z"))).toBe("2026-09-24"); // 00:30 IST
    expect(isFedToday("2026-09-24T01:00:00+05:30", now)).toBe(true);
    expect(isFedToday("2026-09-23T23:30:00+05:30", now)).toBe(false);
    expect(isFedToday(null, now)).toBe(false);
  });

  it("labels today's feeds as time ago", () => {
    expect(fedAgoLabel("2026-09-24T08:00:00+05:30", now)).toBe("Fed 2h ago");
    expect(fedAgoLabel("2026-09-24T09:48:00+05:30", now)).toBe("Fed 12m ago");
    expect(fedAgoLabel("2026-09-24T10:00:00+05:30", now)).toBe("Fed just now");
  });

  it("puts dogs not fed today first and keeps the API order within each group", () => {
    const dogs = [
      { slug: "bruno", lastFedAt: "2026-09-24T08:00:00+05:30" },
      { slug: "kaali", lastFedAt: "2026-09-23T08:00:00+05:30" },
      { slug: "motu", lastFedAt: "2026-09-24T05:00:00+05:30" },
      { slug: "rani", lastFedAt: null },
    ];
    expect(sortUnfedFirst(dogs, now).map((d) => d.slug)).toEqual(["kaali", "rani", "bruno", "motu"]);
  });

  it("names the next dog on the sticky button", () => {
    expect(nextFeedLabel({ name: "Kaali" })).toBe("Scan to log Kaali's feed");
    expect(nextFeedLabel({ name: "Chris" })).toBe("Scan to log Chris' feed");
    expect(nextFeedLabel({ name: null })).toBe("Scan to log this dog's feed");
    expect(nextFeedLabel(null)).toBe("Scan to log a feed");
  });
});

describe("streak after this feed (the Log a feed caption)", () => {
  it("mirrors the API's computeStreak", () => {
    expect(streakAfterFeed(23, "2026-09-23", "2026-09-24")).toBe(24);
    expect(streakAfterFeed(23, "2026-09-24", "2026-09-24")).toBe(23);
    expect(streakAfterFeed(23, "2026-09-20", "2026-09-24")).toBe(1);
    expect(streakAfterFeed(0, null, "2026-09-24")).toBe(1);
    expect(streakAfterFeed(4, "2026-08-31", "2026-09-01")).toBe(5); // month boundary
  });

  it("phrases it", () => {
    expect(streakCaption(24)).toBe("Keeps your streak at 24 days.");
    expect(streakCaption(1)).toBe("Starts your streak today.");
  });
});

describe("trust", () => {
  it("matches the API's levels and thresholds", () => {
    expect(trustLevelFor(30)).toEqual({ name: "New feeder", level: 1, nextThreshold: 40 });
    expect(trustLevelFor(46)).toEqual({ name: "Trusted feeder", level: 2, nextThreshold: 50 });
    expect(trustLevelFor(75)).toEqual({ name: "Trusted feeder", level: 4, nextThreshold: null });
  });

  it("builds the Progress lines", () => {
    const v = trustView(42, { name: "Trusted feeder", level: 2, nextThreshold: 50 });
    expect(v.label).toBe("Trusted feeder · Level 2");
    expect(v.target).toBe("Level 3 at 50");
    expect(v.value).toBeCloseTo(0.84);
    expect(trustView(80, null).target).toBe("Top level");
  });
});

describe("safeStreak and the sub line", () => {
  it("degrades a drifted payload instead of throwing", () => {
    const s = safeStreak({ streakDays: undefined as never, badges: undefined as never } as never);
    expect(s).toMatchObject({ streakDays: 0, badges: [], trustScore: 0, trustLevel: null });
  });

  it("formats the start day", () => {
    expect(formatDayMonth("2026-09-01")).toBe("1 September");
    expect(formatDayMonth("nope")).toBeNull();
  });

  it("tells the Tuesday joke with the feeder's own dog", () => {
    const s = safeStreak({ streakDays: 23, badges: [], trustScore: 46, streakStart: "2026-09-01" });
    expect(streakSubline(s, "Bruno")).toBe(
      "Fed someone every day since 1 September. Bruno still says you missed Tuesday.",
    );
    expect(streakSubline(s, null)).toBe(
      "Fed someone every day since 1 September. Your dogs still say you missed Tuesday.",
    );
    expect(streakSubline(safeStreak({ streakDays: 0, badges: [], trustScore: 30 }), "Bruno")).toBe(
      "No streak yet. Log a feed today to start one.",
    );
  });
});
