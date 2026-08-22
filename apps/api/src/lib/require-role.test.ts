/**
 * The shared capability gate (lib/require-role.ts).
 *
 * Two things are pinned here:
 *   1. the role→capability map, including `registrator` before any row can
 *      hold it — so wave 6's registrator surface cannot quietly widen what
 *      feeder/vet/bmc_officer may do;
 *   2. that authorisation derives from a LIVE role read, never from anything
 *      carried in the token (the property grant-admin.ts --revoke depends on).
 */
import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "./require-role.js";

describe("capabilitiesFor", () => {
  it("admin holds all four capabilities", () => {
    expect([...capabilitiesFor("admin")].sort()).toEqual(
      ["enrol", "feed", "moderate", "register"],
    );
  });

  it("registrator holds feed+register — and nothing more", () => {
    // Declared in contracts ahead of any migration that lets a row hold the
    // role; the map must already know exactly what such an account gets.
    const caps = capabilitiesFor("registrator");
    expect(caps.has("feed")).toBe(true);
    expect(caps.has("register")).toBe(true);
    expect(caps.has("moderate")).toBe(false);
    expect(caps.has("enrol")).toBe(false);
  });

  it("vet and bmc_officer hold feed+register, like registrator", () => {
    for (const role of ["vet", "bmc_officer"] as const) {
      const caps = capabilitiesFor(role);
      expect([...caps].sort()).toEqual(["feed", "register"]);
    }
  });

  it("plain feeder feeds and does nothing else", () => {
    expect([...capabilitiesFor("feeder")]).toEqual(["feed"]);
  });

  it("an unknown role yields an EMPTY set — fail-closed", () => {
    // A role added to the DB enum without a mapping here must be able to do
    // nothing rather than everything.
    expect(capabilitiesFor("superuser").size).toBe(0);
    expect(capabilitiesFor("").size).toBe(0);
  });

  it("never grants enrol to anyone but admin (the register is a targeting list)", () => {
    for (const role of ["feeder", "registrator", "vet", "bmc_officer"]) {
      expect(capabilitiesFor(role).has("enrol"), role).toBe(false);
    }
  });
});
