import { describe, expect, it } from "vitest";
import {
  agoShort,
  dayWords,
  fedWords,
  monthWords,
  myDogRow,
  myDogsSummary,
  pronouns,
  sexOf,
  tagEventWords,
} from "./care-copy";
import type { MyDogV5 } from "./api";

// 10:00 IST on 25 Sep 2026.
const NOW = Date.parse("2026-09-25T04:30:00Z");

function d(over: Partial<MyDogV5>): MyDogV5 {
  return {
    slug: "abcdefgh2",
    name: "Kalu",
    wardId: "K-West",
    wardName: null,
    lastFedAt: null,
    myLastFedAt: null,
    ...over,
  };
}

describe("care-copy", () => {
  it("pronouns follow sex when known, else they/them", () => {
    expect(pronouns("female").possessive).toBe("her");
    expect(pronouns("male").object).toBe("him");
    expect(pronouns(undefined)).toEqual({ subject: "they", object: "them", possessive: "their" });
    expect(sexOf({ sex: "female" })).toBe("female");
    expect(sexOf({ sex: "x" })).toBeUndefined();
    expect(sexOf(null)).toBeUndefined();
  });

  it("feed lines read like the mock", () => {
    expect(fedWords("2026-09-25T02:30:00Z", "Anil", NOW)).toBe("Fed 2 h ago by Anil");
    // 06:00 IST, four and a half hours ago.
    expect(fedWords("2026-09-25T00:00:00Z", null, NOW)).toBe("Fed this morning");
    expect(fedWords("2026-09-24T12:00:00Z", null, NOW)).toBe("Fed yesterday");
    expect(fedWords("2026-09-20T12:00:00Z", null, NOW)).toBe("Fed 4 days ago");
  });

  it("months, days and short times", () => {
    expect(monthWords("2026-10", NOW)).toBe("Oct");
    expect(monthWords("2027-09", NOW)).toBe("Sep 2027");
    expect(monthWords("nope", NOW)).toBeNull();
    expect(dayWords("2026-09-25T01:00:00Z", NOW)).toBe("Today");
    expect(dayWords("2026-08-12T06:00:00Z", NOW)).toBe("12 Aug");
    expect(dayWords("2025-08-12T06:00:00Z", NOW)).toBe("12 Aug 2025");
    expect(agoShort("2026-09-25T04:18:00Z", NOW)).toBe("12 min");
  });

  it("tag history rows", () => {
    expect(tagEventWords({ kind: "reported", at: "", detail: "found_on_ground", byName: null })).toBe(
      "Reported off by a passer-by",
    );
    expect(tagEventWords({ kind: "printed", at: "", detail: "1", byName: "Priya S." })).toBe(
      "Printed · 1 tag · Priya S.",
    );
    expect(tagEventWords({ kind: "resolved", at: "", detail: "spare", byName: "Anil" })).toBe(
      "Spare tag fitted · Anil",
    );
  });

  it("derives each My dogs row from attention", () => {
    expect(myDogRow(d({ attention: { kind: "sos", since: "2026-09-25T04:26:00Z", detail: null } }), NOW)).toMatchObject(
      { tag: "SOS", variant: "danger", needsYou: true, sub: "SOS raised · 4 min" },
    );
    expect(
      myDogRow(d({ attention: { kind: "tag", since: "2026-09-25T04:18:00Z", detail: "found_on_ground" } }), NOW),
    ).toMatchObject({ tag: "Tag", variant: "warn", needsYou: true, href: "/me/dogs/abcdefgh2/tag" });
    expect(
      myDogRow(
        d({ lastFedAt: "2026-09-16T04:00:00Z", attention: { kind: "missing", since: "x", detail: null } }),
        NOW,
      ),
    ).toMatchObject({ tag: "Missing?", sub: "Not logged in 9 days", href: "/me/dogs/abcdefgh2/status" });
    expect(myDogRow(d({ attention: { kind: "vet", since: "x", detail: "2026-10" } }), NOW)).toMatchObject({
      tag: "Vet",
      variant: "neutral",
      sub: "Vaccine due Oct",
      needsYou: false,
    });
    expect(myDogRow(d({ verified: false }), NOW)).toMatchObject({ tag: "New", sub: "Unverified" });
    expect(myDogRow(d({ lastFedAt: "2026-09-25T02:30:00Z", myLastFedAt: "2026-09-25T02:30:00Z", lastFedByName: "Me" }), NOW))
      .toMatchObject({ tag: "Fed", sub: "Fed 2 h ago", href: "/d/abcdefgh2" });
    expect(myDogRow(d({}), NOW)).toMatchObject({ tag: null, sub: "No feeds yet" });
  });

  it("summary line", () => {
    expect(myDogsSummary(7, 2)).toBe("7 dogs · 2 need you today");
    expect(myDogsSummary(1, 1)).toBe("1 dog · 1 needs you today");
    expect(myDogsSummary(3, 0)).toBe("3 dogs · nothing needs you today");
  });
});
