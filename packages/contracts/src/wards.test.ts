import { describe, expect, it } from "vitest";
import { BMC_WARD_CODES, FeedOutcome, ScanInput, SosReport } from "./schemas.js";
import {
  BMC_WARD_CENTROIDS,
  BMC_WARD_NAMES,
  MUMBAI_BOUNDS,
  isBmcWardCode,
  wardCentroid,
  wardDisplay,
  wardName,
} from "./wards.js";

describe("BMC_WARD_NAMES", () => {
  it("names every one of the 24 codes, and nothing else", () => {
    expect(BMC_WARD_CODES).toHaveLength(24);
    expect(Object.keys(BMC_WARD_NAMES).sort()).toEqual([...BMC_WARD_CODES].sort());
    for (const code of BMC_WARD_CODES) {
      expect(BMC_WARD_NAMES[code].length).toBeGreaterThan(0);
    }
  });

  it("carries no em dashes", () => {
    for (const name of Object.values(BMC_WARD_NAMES)) expect(name).not.toContain("\u2014");
  });
});

describe("wardDisplay", () => {
  it("renders the short slash code BMC signage uses", () => {
    expect(wardDisplay("K-West")).toEqual({ code: "K/W", name: "Andheri West" });
    expect(wardDisplay("F-North")).toEqual({ code: "F/N", name: "Matunga, Sion" });
    expect(wardDisplay("R-Central")).toEqual({ code: "R/C", name: "Borivali" });
    expect(wardDisplay("H-East")).toEqual({ code: "H/E", name: "Bandra East, Santacruz East" });
    expect(wardDisplay("A")).toEqual({ code: "A", name: "Colaba, Fort" });
    expect(wardDisplay("T")).toEqual({ code: "T", name: "Mulund" });
  });

  it("gives every canonical code a distinct short code", () => {
    const shorts = BMC_WARD_CODES.map((c) => wardDisplay(c).code);
    expect(new Set(shorts).size).toBe(BMC_WARD_CODES.length);
  });

  it("passes a non-canonical ward id through without guessing a name", () => {
    expect(wardDisplay("kwest")).toEqual({ code: "kwest", name: null });
    expect(wardDisplay("")).toEqual({ code: "", name: null });
    expect(isBmcWardCode("K West")).toBe(false);
    expect(wardName("Kandivali")).toBeNull();
    expect(wardName(null)).toBeNull();
    expect(wardName("R-South")).toBe("Kandivali");
  });
});

describe("SosReport (matches routes/sos.ts)", () => {
  it("requires dogSlug and accepts a report with no note", () => {
    expect(SosReport.safeParse({ dogSlug: "c3di5esh8", severity: "critical" }).success).toBe(true);
    expect(SosReport.safeParse({ severity: "critical", note: "x" }).success).toBe(false);
  });
});

describe("ScanInput.outcome", () => {
  it("accepts the four outcomes and nothing else", () => {
    for (const o of ["ate_all", "ate_some", "didnt_eat", "unwell"]) {
      expect(FeedOutcome.safeParse(o).success).toBe(true);
    }
    const base = {
      clientUuid: "3f1c2e4a-8b7d-4c6e-9a1b-2d3e4f5a6b7c",
      dogSlug: "c3di5esh8",
      type: "feed",
      capturedAt: new Date().toISOString(),
    };
    expect(ScanInput.safeParse({ ...base, outcome: "ate_all" }).success).toBe(true);
    expect(ScanInput.safeParse(base).success).toBe(true);
    expect(ScanInput.safeParse({ ...base, outcome: "sos" }).success).toBe(false);
  });
});

describe("BMC_WARD_CENTROIDS", () => {
  it("places every one of the 24 codes, and nothing else", () => {
    expect(Object.keys(BMC_WARD_CENTROIDS).sort()).toEqual([...BMC_WARD_CODES].sort());
  });

  it("keeps every centre inside Greater Mumbai, and no two on top of each other", () => {
    const pts = Object.values(BMC_WARD_CENTROIDS);
    for (const p of pts) {
      expect(p.lat).toBeGreaterThan(18.89);
      expect(p.lat).toBeLessThan(19.28);
      expect(p.lng).toBeGreaterThan(72.79);
      expect(p.lng).toBeLessThan(72.99);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const km = Math.hypot((pts[i].lat - pts[j].lat) * 111, (pts[i].lng - pts[j].lng) * 105);
        expect(km).toBeGreaterThan(1);
      }
    }
  });

  it("runs south to north the way the city does", () => {
    expect(BMC_WARD_CENTROIDS.A.lat).toBeLessThan(BMC_WARD_CENTROIDS.E.lat);
    expect(BMC_WARD_CENTROIDS.E.lat).toBeLessThan(BMC_WARD_CENTROIDS["K-West"].lat);
    expect(BMC_WARD_CENTROIDS["K-West"].lat).toBeLessThan(BMC_WARD_CENTROIDS["R-North"].lat);
  });

  it("wardCentroid answers null for a non-canonical id", () => {
    expect(wardCentroid("K-West")).toEqual({ lat: 19.132, lng: 72.828 });
    expect(wardCentroid("K/W")).toBeNull();
    expect(wardCentroid(null)).toBeNull();
  });
});

describe("MUMBAI_BOUNDS", () => {
  it("holds every ward centre with a margin of at least 3 km", () => {
    for (const c of Object.values(BMC_WARD_CENTROIDS)) {
      expect(c.lat - MUMBAI_BOUNDS.south).toBeGreaterThan(0.027);
      expect(MUMBAI_BOUNDS.north - c.lat).toBeGreaterThan(0.027);
      expect(c.lng - MUMBAI_BOUNDS.west).toBeGreaterThan(0.028);
      expect(MUMBAI_BOUNDS.east - c.lng).toBeGreaterThan(0.028);
    }
  });
  it("is Mumbai and not the region: under 50 km tall and 30 km wide", () => {
    expect((MUMBAI_BOUNDS.north - MUMBAI_BOUNDS.south) * 111).toBeLessThan(50);
    expect((MUMBAI_BOUNDS.east - MUMBAI_BOUNDS.west) * 105).toBeLessThan(30);
  });
});
