import { describe, expect, it } from "vitest";
import {
  alertsModeLabel,
  cleanName,
  formatClock,
  formatQuietHours,
  MAX_WARDS,
  suggestedWards,
  toggleWard,
  wardChipLabel,
  wardsSummary,
} from "@/lib/feeder-prefs";

describe("ward chips", () => {
  it("labels chips like the N1 mock", () => {
    expect(wardChipLabel("K-West")).toBe("K/W Andheri W");
    expect(wardChipLabel("H-West")).toBe("H/W Bandra W");
    expect(wardChipLabel("K-East")).toBe("K/E Andheri E");
    expect(wardChipLabel("A")).toBe("A Colaba");
  });

  it("summarises wards like the N6 row", () => {
    expect(wardsSummary(["K-West", "H-West"])).toBe("K/W, H/W");
    expect(wardsSummary([])).toBe("None yet");
  });

  it("suggests the home ward and its nearest neighbours after the chosen ones", () => {
    const s = suggestedWards(["H-West"], "K-West");
    expect(s[0]).toBe("H-West");
    expect(s[1]).toBe("K-West");
    expect(s.length).toBe(3);
    expect(suggestedWards([], "K-West")).toContain("K-East");
    expect(suggestedWards([], null)).toEqual([]);
  });

  it("toggles, and refuses a seventh ward", () => {
    expect(toggleWard(["A"], "B")).toEqual(["A", "B"]);
    expect(toggleWard(["A", "B"], "A")).toEqual(["B"]);
    const six = ["A", "B", "C", "D", "E", "L"];
    expect(six).toHaveLength(MAX_WARDS);
    expect(toggleWard(six, "T")).toEqual(six);
  });
});

describe("quiet hours", () => {
  it("reads like the mock: 11 pm – 6 am", () => {
    expect(formatQuietHours({ start: "23:00", end: "06:00" })).toBe("11 pm – 6 am");
    expect(formatQuietHours({ start: "22:30", end: "07:15" })).toBe("10:30 pm – 7:15 am");
    expect(formatQuietHours(null)).toBe("Off");
  });

  it("formats midnight and noon", () => {
    expect(formatClock("00:00")).toBe("12 am");
    expect(formatClock("12:00")).toBe("12 pm");
  });

  it("uses no em dash", () => {
    expect(formatQuietHours({ start: "23:00", end: "06:00" })).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("names and modes", () => {
  it("accepts 1 to 40 characters, trimmed", () => {
    expect(cleanName("  Priya   S. ")).toBe("Priya S.");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(41))).toBeNull();
  });

  it("labels the alerts mode like N6", () => {
    expect(alertsModeLabel("sos_only")).toBe("SOS only");
    expect(alertsModeLabel(undefined)).toBe("SOS only");
    expect(alertsModeLabel("all")).toBe("All");
  });
});
