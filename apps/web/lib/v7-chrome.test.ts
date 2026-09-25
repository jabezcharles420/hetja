import { afterEach, describe, expect, it } from "vitest";
import { careKindWord, careLabel } from "@/lib/care-label";
import { portalStatus, readTabRole, rememberTabRole, saveTabRole, tabRoleFor } from "@/lib/tab-role";
import type { FeederMe } from "@/lib/api";

const me = (o: Record<string, unknown>) => o as unknown as FeederMe;

describe("care labels (v7: government care is free, and Hetja says so)", () => {
  it("names government vets and hospitals as free", () => {
    expect(careLabel({ careKind: "govt" })).toBe("Government hospital · free");
    expect(careLabel({ careKind: "govt", isPerson: true })).toBe("Government vet · free");
    expect(careLabel({ isGovernment: true, kind: "vet", costTier: "paid" })).toBe("Government hospital · free");
    expect(careLabel({ isGovernment: true, isPerson: true, kind: "vet" })).toBe("Government vet · free");
    expect(careLabel({ isGovernment: false, isPerson: true, kind: "vet", costTier: "free" })).toBe("Vet · free");
  });

  it("adds · free for the free cost tier, and nothing otherwise", () => {
    expect(careLabel({ careKind: "ngo", kind: "ngo", costTier: "free" })).toBe("NGO · free");
    expect(careLabel({ careKind: "private_clinic", kind: "vet", costTier: "paid" })).toBe("Vet");
    expect(careLabel({ kind: "vet", costTier: "subsidised" })).toBe("Vet");
    expect(careKindWord({ kind: "ngo" })).toBe("NGO");
  });
});

describe("role tab bars (v7)", () => {
  afterEach(() => localStorage.clear());

  it("vets get the Vet tab, NGO members the NGO tab, both get NGO", () => {
    expect(tabRoleFor(me({ role: "feeder", capabilities: [] }))).toBeNull();
    expect(tabRoleFor(me({ vet: { status: "verified" } }))).toBe("vet");
    expect(tabRoleFor(me({ vet: { status: "waiting" } }))).toBeNull();
    expect(tabRoleFor(me({ ngo: { status: "active" } }))).toBe("ngo");
    expect(tabRoleFor(me({ vet: { status: "verified" }, ngo: { status: "active" } }))).toBe("ngo");
    expect(tabRoleFor(me({ vet: { status: "suspended", regLabel: null } }))).toBeNull();
    // A paused NGO keeps its tab: pausing only stops SOS routing (A7).
    expect(tabRoleFor(me({ ngo: { status: "paused" } }))).toBe("ngo");
    expect(tabRoleFor(me({ ngo: { status: "waiting" } }))).toBeNull();
    expect(tabRoleFor(me({ ngo: { status: "removed" } }))).toBeNull();
  });

  it("keeps the role on the phone and forgets it", () => {
    rememberTabRole(me({ vet: { status: "verified" } }));
    expect(readTabRole()).toBe("vet");
    saveTabRole(null);
    expect(readTabRole()).toBeNull();
  });
});

describe("Me portal rows (v7)", () => {
  it("no application, a status in words, or gone once verified", () => {
    expect(portalStatus(me({}), "vet")).toBeNull();
    expect(portalStatus(me({ vet: { status: "waiting" } }), "vet")).toBe("Waiting");
    expect(portalStatus(me({ vet: { status: "more_info" } }), "vet")).toBe("Asked for more");
    expect(portalStatus(me({ vet: { status: "verified" } }), "vet")).toBe("done");
    expect(portalStatus(me({ ngo: { status: "active" } }), "ngo")).toBe("done");
    expect(portalStatus(me({ ngo: { status: "paused" } }), "ngo")).toBe("done");
    expect(portalStatus(me({ ngo: { status: "waiting" } }), "ngo")).toBe("Waiting");
  });
});
