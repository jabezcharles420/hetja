/**
 * The words a stranger reads on the collar page come from these helpers, so
 * each rule is pinned here: collar grouping and the "Say it" line, the ward
 * short code, the relative "Last fed" time, and the SOS severity mapping
 * (only "Can't get up, or bleeding" may page responders at report time).
 */
import { describe, expect, it } from "vitest";
import {
  apiSeverity,
  careMeta,
  casePill,
  CHOICES,
  collarGroups,
  lastFedText,
  pastelIndex,
  possessive,
  sayCollarCode,
  wardLine,
  wardShort,
  writtenByLine,
} from "./format.js";

describe("collar code", () => {
  it("groups a stored lowercase code into three uppercase triples", () => {
    expect(collarGroups("ddr017xk2")).toEqual(["DDR", "017", "XK2"]);
    expect(collarGroups("DDR 017 XK2")).toEqual(["DDR", "017", "XK2"]);
    expect(collarGroups("ddr01")).toEqual(["DDR", "01"]);
  });

  it("spells letters and says digits as words, one group per triple", () => {
    expect(sayCollarCode("ddr017xk2")).toBe("D D R · zero one seven · X K two");
    expect(sayCollarCode("c3di5esh8")).toBe("C three D · I five E · S H eight");
  });
});

describe("ward", () => {
  it("shortens canonical BMC codes the way ward signage does", () => {
    expect(wardShort("K-West")).toBe("K/W");
    expect(wardShort("F-North")).toBe("F/N");
    expect(wardShort("R-Central")).toBe("R/C");
    expect(wardShort("A")).toBe("A");
  });

  it("leaves a non-canonical id unchanged rather than guessing", () => {
    expect(wardShort("kwest")).toBe("kwest");
    expect(wardShort("K West")).toBe("K West");
  });

  it("builds the ward line with and without a name", () => {
    expect(wardLine("K-West", "Andheri West")).toBe("K/W ward · Andheri West");
    expect(wardLine("K-West")).toBe("K/W ward");
    expect(wardLine("", "Andheri West")).toBe("Andheri West");
    expect(wardLine("")).toBe("");
  });
});

describe("last fed", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const ago = (ms: number): string => new Date(now - ms).toISOString();

  it("reads coarse relative times", () => {
    expect(lastFedText(ago(20_000), now)).toBe("Last fed just now");
    expect(lastFedText(ago(60_000), now)).toBe("Last fed 1 minute ago");
    expect(lastFedText(ago(45 * 60_000), now)).toBe("Last fed 45 minutes ago");
    expect(lastFedText(ago(3600_000), now)).toBe("Last fed 1 hour ago");
    expect(lastFedText(ago(2.5 * 3600_000), now)).toBe("Last fed 2 hours ago");
    expect(lastFedText(ago(30 * 3600_000), now)).toBe("Last fed yesterday");
    expect(lastFedText(ago(5 * 86400_000), now)).toBe("Last fed 5 days ago");
  });

  it("never prints a negative or NaN time", () => {
    expect(lastFedText(new Date(now + 60_000).toISOString(), now)).toBe("Last fed just now");
    expect(lastFedText("not a date", now)).toBeUndefined();
  });
});

describe("words about the dog", () => {
  it("uses a pronoun only when the record has a sex", () => {
    expect(possessive("Bruno", "male")).toBe("his");
    expect(possessive("Rosie", "female")).toBe("her");
    expect(possessive("Bruno")).toBe("Bruno's");
  });

  it("attributes the story with the author count only when known", () => {
    expect(writtenByLine("Bruno", "male", 3)).toBe("Written by his 3 feeders");
    expect(writtenByLine("Bruno", undefined, 1)).toBe("Written by Bruno's feeder");
    expect(writtenByLine("Bruno", undefined, undefined)).toBe("Written by Bruno's feeders");
  });

  it("picks a stable pastel for a slug", () => {
    expect(pastelIndex("ddr827xk2")).toBe(pastelIndex("ddr827xk2"));
    expect(pastelIndex("ddr827xk2")).toBeGreaterThanOrEqual(0);
    expect(pastelIndex("ddr827xk2")).toBeLessThan(5);
  });
});

describe("SOS severity", () => {
  it("maps the design's choices onto the API enum", () => {
    expect(apiSeverity("moving")).toBe("serious");
    expect(apiSeverity("urgent")).toBe("critical");
    expect(apiSeverity("other")).toBe("serious");
  });

  it("carries the mock's copy verbatim", () => {
    expect(CHOICES.map((c) => [c.title, c.sub])).toEqual([
      ["Hurt, but moving", "Limping, a wound, not eating"],
      ["Can't get up, or bleeding", "Needs a vet now"],
      ["Something else", "Missing, scared, or being harmed"],
    ]);
  });

  it("turns the case state into the reply pill", () => {
    expect(casePill("open")).toMatchObject({ text: "Waiting for reply", tone: "warn", final: false });
    expect(casePill("escalated")).toMatchObject({ text: "Waiting for reply", final: false });
    expect(casePill(undefined)).toMatchObject({ text: "Waiting for reply", final: false });
    expect(casePill("acked")).toMatchObject({ text: "On the way", tone: "ok", final: true });
    expect(casePill("resolved").final).toBe(true);
  });
});

describe("care rows", () => {
  const base = { is24x7: false, hasAmbulance: false, phone: "+912226300000", phoneVerified: true };

  it("reads type · place · note", () => {
    expect(careMeta({ ...base, kind: "private_clinic", locality: "Andheri West", hoursNote: "open till 9 pm" })).toBe(
      "Vet · Andheri West · open till 9 pm",
    );
    expect(careMeta({ ...base, kind: "ngo", locality: "Andheri West", hasAmbulance: true })).toBe(
      "NGO · Andheri West · ambulance",
    );
  });

  it("says when a number is missing or unconfirmed", () => {
    expect(careMeta({ ...base, kind: "ngo", phoneVerified: false })).toBe("NGO · number not confirmed");
    expect(careMeta({ ...base, kind: "govt", phone: undefined })).toBe("Govt vet · no phone listed");
  });
});
