import { describe, expect, it } from "vitest";
import { coarsenToWard, coarsenToCell } from "./geo.js";

function atMostTwoDecimals(x: number): boolean {
  return Number(x.toFixed(2)) === x;
}

const samples = [
  [19.076, 72.8777],
  [19.0596, 72.8295],
  [19.1136, 72.8697],
  [19.2122, 72.8449],
  [19.045, 72.877],
  [-33.8688, 151.2093],
  [0, 0],
  [90, 180],
  [-90, -180],
] as const;

describe("geo coarsening invariant", () => {
  it("coarsenToWard never returns more than 2 decimals", () => {
    for (const [lat, lng] of samples) {
      const { lat: wLat, lng: wLng } = coarsenToWard(lat, lng);
      expect(atMostTwoDecimals(wLat)).toBe(true);
      expect(atMostTwoDecimals(wLng)).toBe(true);
    }
  });

  it("coarsenToCell never returns more than 2 decimals", () => {
    for (const [lat, lng] of samples) {
      for (const sizeM of [500, 250, 1000]) {
        const { lat: cLat, lng: cLng } = coarsenToCell(lat, lng, sizeM);
        expect(atMostTwoDecimals(cLat)).toBe(true);
        expect(atMostTwoDecimals(cLng)).toBe(true);
      }
    }
  });

  it("coarsenToCell defaults to 500m cells and lands near the input", () => {
    const { lat, lng } = coarsenToCell(19.076, 72.8777);
    expect(Math.abs(lat - 19.076)).toBeLessThan(0.01);
    expect(Math.abs(lng - 72.8777)).toBeLessThan(0.01);
  });
});
