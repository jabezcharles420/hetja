import { describe, expect, it } from "vitest";
import { CREDIT_GROUPS, shownGroups } from "./credits";

describe("credits", () => {
  it("keeps the design's three headings, in order", () => {
    expect(CREDIT_GROUPS.map((g) => g.heading)).toEqual(["On the street", "Checked the details", "Lent a hand"]);
  });

  it("never shows a heading with nobody under it (no placeholder rows)", () => {
    expect(shownGroups([{ heading: "On the street", people: [] }])).toEqual([]);
    const g = { heading: "Lent a hand", people: [{ name: "Asha", did: "Printed and laminated tags at cost" }] };
    expect(shownGroups([{ heading: "On the street", people: [] }, g])).toEqual([g]);
  });

  it("carries no placeholder or em dash", () => {
    const text = JSON.stringify(CREDIT_GROUPS);
    expect(text).not.toContain("[Name");
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
