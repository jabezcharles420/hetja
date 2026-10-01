import { describe, expect, it } from "vitest";
import { deskHeadline, dogStatuses, feedProgress, istClock, layerOf, LAYER_FILTERS } from "./desk";

describe("desktop inspector words", () => {
  it("says the headline in two lines, honest at zero", () => {
    expect(deskHeadline(2, 17)).toEqual({ help: "2 dogs need help.", dinner: "17 waiting for dinner." });
    expect(deskHeadline(1, 1).help).toBe("1 dog needs help.");
    expect(deskHeadline(0, 0)).toEqual({ help: "No dog needs help.", dinner: "Every dog is logged today." });
  });

  it("tells Mumbai time", () => {
    expect(istClock(new Date("2026-10-01T13:12:00Z"))).toBe("18:42 IST");
  });

  it("counts the feeding round", () => {
    expect(feedProgress(14, 5)).toEqual({ fed: 9, pct: 64 });
    expect(feedProgress(0, 0)).toEqual({ fed: 0, pct: 0 });
    expect(feedProgress(3, 5)).toEqual({ fed: 0, pct: 0 });
  });

  it("marks each named dog fed or waiting", () => {
    expect(dogStatuses(["Moti", "Lali"], [{ name: "Lali" }, { name: null }])).toEqual([
      { name: "Moti", fed: true },
      { name: "Lali", fed: false },
    ]);
    expect(dogStatuses(undefined, undefined)).toEqual([]);
  });

  it("maps the layer tabs to filters and back", () => {
    expect(layerOf(LAYER_FILTERS.care)).toBe("care");
    expect(layerOf({ sos: true, hungry: false, vet: true, ngo: true })).toBeNull();
  });
});
