/**
 * Migration 0030: costTier may be null (unknown). careLabel must then claim
 * nothing about price; government care stays "free" by the owner's decision.
 */
import { describe, expect, it } from "vitest";
import { careLabel } from "./care-label";

describe("careLabel with an unknown cost tier", () => {
  it("says no 'free' for an NGO or clinic whose tier is unknown", () => {
    expect(careLabel({ careKind: "ngo", costTier: null })).toBe("NGO");
    expect(careLabel({ careKind: "private_clinic", costTier: null })).not.toMatch(/free/);
  });

  it("keeps a government row free, and a known free row free", () => {
    expect(careLabel({ careKind: "govt", costTier: null })).toMatch(/free/);
    expect(careLabel({ careKind: "ngo", costTier: "free" })).toBe("NGO · free");
  });
});
