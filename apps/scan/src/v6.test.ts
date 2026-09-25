/**
 * Design v6 on the collar page (docs/design/v6-handoff): the profile's voice
 * (V15 to V17), the unknown collar (P8), the SOS copy (V18, P12, P13, V19,
 * N10, N11, L7) and the desktop page (D2). Pinned through the pure builders
 * and parsers, since the page has no DOM test harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DogProfile } from "./api.js";
import { firstAid } from "./firstaid.js";
import { careRow, clock, dayWord, doneCopy, feederLine, helpCap, nameList, pronouns, sentCopy, sosSeeCap, sosText } from "./format.js";
import { byConfirmed, careBlock, readReport, readStatus } from "./sos.js";
import { buildProfile, deskMarkup, unknownMarkup } from "./ui.js";

const NOW = Date.parse("2026-09-25T14:00:00Z");
const rani: DogProfile = {
  slug: "r4n7kw2ab",
  name: "Rani",
  status: "active",
  wardId: "K-West",
  wardName: "Andheri West",
  sex: "female",
  vaccinated: "yes",
  sterilised: "yes",
  feederCount: 2,
  feederNames: ["Priya", "Arjun"],
  lastFedBy: "Priya",
  lastFedAt: new Date(NOW - 2 * 3600e3).toISOString(),
  microStory: "Rani sleeps under the sugarcane-juice cart on SV Road.",
};

beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());

describe("V15 to V17: every dog by name", () => {
  it("names feeders by first name and counts the rest", () => {
    expect(feederLine("Rani", rani, NOW)).toBe("Priya fed her 2 hours ago. Rani has 2 feeders.");
    expect(helpCap(rani)).toBe("Tells Priya, Arjun and a vet nearby.");
    expect(sosSeeCap(rani, "K-West")).toBe("Priya, Arjun and a vet will see K/W ward. Never your exact spot.");
    // One opted out: counted, not named.
    const one = { ...rani, feederCount: 3, feederNames: ["Priya"] };
    expect(helpCap(one)).toBe("Tells Priya, 2 other feeders and a vet nearby.");
    const none = { ...rani, feederNames: [], lastFedBy: null };
    expect(helpCap(none)).toBe("Tells her 2 feeders and a vet nearby.");
    expect(feederLine("Rani", none, NOW)).toBe("Last fed 2 hours ago. Rani has 2 feeders.");
    expect(sosSeeCap({ ...none, sex: undefined }, "K-West")).toBe("Their 2 feeders and a vet will see K/W ward. Never your exact spot.");
    expect(helpCap({ feederCount: 0 })).toBe("Tells a vet nearby.");
    expect(nameList(["Priya", "Arjun", "Meera"])).toBe("Priya, Arjun and Meera");
  });

  it("V15 profile: You found, the feeder card, the one-line code", () => {
    const html = buildProfile(rani, false, NOW);
    expect(html).toContain('<p class="label">You found</p>');
    expect(html).toContain(">Rani.</h1>");
    expect(html).toContain("Priya fed her 2 hours ago. Rani has 2 feeders.");
    expect(html).toContain("<span>P</span><span>A</span>");
    expect(html).toContain("Collar R4N 7KW 2AB · ");
    expect(html).not.toContain("Last fed 2 hours ago</span>");
    expect(html).not.toContain("No story yet");
  });

  it("V16: nobody feeds Moti yet, as an invitation", () => {
    const html = buildProfile({ ...rani, name: "Moti", feederCount: 0, feederNames: [], microStory: undefined }, false, NOW);
    expect(html).toContain("Nobody feeds Moti on Hetja yet.");
    expect(html).toContain("If you give Moti a biscuit on your way to work, that counts. Become her first feeder and her page will say so.");
    expect(html).toContain("I feed Moti ›");
    expect(html).toContain('href="/feed?dog=r4n7kw2ab"');
  });

  it("V17: saved copy chip and 'as of' pills offline", () => {
    const savedAt = new Date(NOW - 20 * 3600e3).toISOString();
    const html = buildProfile({ ...rani, savedAt }, true, NOW);
    expect(html).toContain(`Saved ${dayWord(savedAt, NOW)}, ${clock(savedAt)}`);
    expect(html).toContain(`Vaccinated, as of ${dayWord(savedAt, NOW)}`);
    expect(html).toContain("You're offline, so this is the last copy your phone saw. The SOS button still works. It sends when there's signal, or by text.");
  });
});

describe("P8: unknown collar", () => {
  it("says so in a sentence and shows the code that was scanned", () => {
    const html = unknownMarkup("k2au9pd3x");
    expect(html).toContain("Hetja doesn't know this collar.");
    expect(html).toContain("It may be new and not switched on yet, or a letter was misread. The dog is still someone's.");
    expect(html).toContain("<span>K2A</span><span>U9P</span><span>D3X</span>");
    expect(html).toContain("Type the code again");
    expect(html).toContain("Find the dog by photo");
    expect(html).toContain("Dogs in the ward you're in");
    expect(unknownMarkup("")).not.toContain("You scanned");
  });
});

describe("SOS copy", () => {
  it("P12 / P13 text a person can pass on", () => {
    const d = { name: "Rani", slug: "r4n7kw2ab", wardId: "K-West", wardName: "Andheri West" };
    expect(sosText(false, d, "Can't get up, or bleeding", "Near the SV Road signal.")).toBe(
      "SOS for Rani (collar R4N 7KW 2AB), K/W ward. Can't get up, or bleeding. Near the SV Road signal.",
    );
    expect(sosText(true, d, "Can't get up, or bleeding", "Hit by an auto near the SV Road signal, lying by the juice cart.")).toBe(
      "Hetja SOS: Rani (collar R4N 7KW 2AB), K/W ward, Andheri West. Can't get up, or bleeding. Hit by an auto near the SV Road signal, lying by the juice cart.",
    );
    expect(sosText(false, {}, "Something else")).toBe("SOS for a dog. Something else.");
  });

  it("V19 names who knows, and claims no more than the status says", () => {
    const d = { name: "Rani", feederCount: 2 };
    expect(sentCopy(d, ["Priya", "Arjun"], 1)).toEqual({
      title: "Priya and Arjun know.",
      lead: "They feed Rani and got your message just now, along with a vet nearby. This page updates when someone's on the way.",
    });
    expect(sentCopy(d, ["Priya"], 0).lead).toBe("Priya feeds Rani and got your message just now. This page updates when someone's on the way.");
    expect(sentCopy(d).title).toBe("Rani's feeders know.");
    expect(sentCopy(d, [], 1, 2).title).toBe("2 feeders know.");
    expect(sentCopy({ name: "Moti", feederCount: 0 }, [], 1).title).toBe("A vet nearby knows.");
    expect(sentCopy({ name: "Moti", feederCount: 0 }, [], 0).title).toBe("Nobody nearby was reached.");
    expect(sentCopy({ dogless: true }).title).toBe("Your SOS is out.");
  });

  it("V19 care rows: closed places lose Call, open now only when known", () => {
    const base = { phone: "+912226300000", phoneVerified: true, hasAmbulance: false };
    expect(careRow({ ...base, kind: "private_clinic", is24x7: true, distanceKm: 0.9 })).toEqual({ meta: "Vet · open now, 24 hours · 900 m", closed: false });
    expect(careRow({ ...base, kind: "ngo", is24x7: false, hoursNote: "open till 7 pm", distanceKm: 2.1 }).meta).toBe("NGO · open till 7 pm · 2.1 km");
    expect(careRow({ ...base, kind: "govt", is24x7: false, openNow: false, opensNote: "opens 10 am" })).toEqual({
      meta: "Government vet · free · Closed now · opens 10 am",
      closed: true,
    });
    // 24 x 7 is never "closed now", whatever else the row says.
    expect(careRow({ ...base, kind: "private_clinic", is24x7: true, openNow: false }).closed).toBe(false);
  });

  it("government and free places say they are free", () => {
    const base = { phone: "+912226300000", phoneVerified: true, hasAmbulance: false, is24x7: false };
    expect(careRow({ ...base, kind: "govt", name: "BMC Vet Dispensary" }).meta).toBe("Government vet · free");
    expect(careRow({ ...base, kind: "govt", name: "Bai Sakarbai Dinshaw Petit Hospital" }).meta).toBe("Government hospital · free");
    expect(careRow({ ...base, kind: "ngo", costTier: "free", hoursNote: "open till 7 pm" }).meta).toBe("NGO · free · open till 7 pm");
    expect(careRow({ ...base, kind: "private_clinic", costTier: "paid" }).meta).toBe("Vet");
  });

  it("never hides a number: unconfirmed ones keep Call, after the confirmed ones", () => {
    const list = [
      { name: "Unconfirmed Clinic", kind: "private_clinic", phone: "+912226300003", phoneVerified: false, hasAmbulance: false, is24x7: false },
      { name: "No Phone Trust", kind: "ngo", phoneVerified: false, hasAmbulance: false, is24x7: false },
      { name: "Lokhandwala Pet Hospital", kind: "private_clinic", phone: "+912226300000", phoneVerified: true, hasAmbulance: false, is24x7: true },
    ];
    expect(byConfirmed(list).map((p) => p.name)).toEqual(["Lokhandwala Pet Hospital", "Unconfirmed Clinic"]);
    const html = careBlock(list);
    expect(html.indexOf("Lokhandwala")).toBeLessThan(html.indexOf("Unconfirmed Clinic"));
    expect(html).toContain('<p class="row-n">Number not confirmed yet</p>');
    expect(html).toContain('href="tel:+912226300003"');
    expect(html).not.toContain("No Phone Trust");
    // Every provider unconfirmed (today's data): still something to call.
    expect(careBlock([list[0]!])).toContain("Call Unconfirmed Clinic");
  });

  it("N10 first aid, the mock's three lines", () => {
    expect(firstAid(pronouns("female"))).toEqual([
      "Keep traffic and people back. Stand between her and the road if it's safe.",
      "Don't lift a dog that can't stand. Don't give food or water.",
      "Talk low and keep your hands away from her face. Hurt dogs can snap.",
    ]);
  });

  it("N11 outcomes", () => {
    const d = { name: "Rani", sex: "female" };
    expect(doneCopy("taken_to_vet", d, "Priya", "Lokhandwala Pet Hospital", "4:31 pm")).toMatchObject({
      title: "Rani is with a vet.",
      lead: "Priya took her to Lokhandwala Pet Hospital at 4:31 pm. You stopped when most people walk past. Thank you.",
      pill: "Taken to a vet",
      ok: true,
    });
    expect(doneCopy("died", d, "Priya", undefined, "").title).toBe("Rani didn't make it.");
    expect(doneCopy("not_found", d, undefined, undefined, "").pill).toBe("Not found");
    expect(doneCopy("resolved", d, undefined, undefined, "").title).toBe("This SOS is closed.");
  });

  it("L7: a 429 with openCase carries the open case", () => {
    const oc = { caseId: "c9", raisedAt: "2026-09-25T10:20:00Z", responderFirstName: "Priya", takenAt: "2026-09-25T10:24:00Z" };
    expect(readReport(429, { ok: false, error: { code: "RATE_LIMITED", data: { openCase: oc } } }).openCase).toEqual(oc);
    expect(readReport(429, { ok: false, data: { openCase: { ...oc, responderFirstName: null, takenAt: null } } }).openCase).toEqual({
      caseId: "c9",
      raisedAt: oc.raisedAt,
      responderFirstName: undefined,
      takenAt: undefined,
    });
    expect(readReport(429, { ok: false }).openCase).toBeUndefined();
  });

  it("reads the v6 reporter status", () => {
    const s = readStatus({
      ok: true,
      data: {
        state: "acked",
        responderFirstName: "Priya",
        takenAt: "2026-09-25T10:24:00Z",
        closeByAt: null,
        arrivedAt: null,
        outcome: null,
        feedersNotifiedNames: ["Priya", "Arjun"],
        feedersNotified: 3,
        vetsNotified: 1,
        updates: [],
        leftAt: null,
      },
    });
    expect(s).toMatchObject({ state: "acked", responderFirstName: "Priya", feedersNotifiedNames: ["Priya", "Arjun"], feedersNotified: 3, vetsNotified: 1 });
    expect(s.outcome).toBeUndefined();
    expect(s.leftAt).toBeUndefined();
  });
});

describe("D2: a dog's link on a desktop", () => {
  it("the dog, a QR of this URL, and the SOS", () => {
    const html = deskMarkup(rani, "https://hetja.in/d/r4n7kw2ab?s=abc");
    expect(html).toContain("Rani is on Hetja.");
    expect(html).toContain("K/W ward · Andheri West · fed by 2 people");
    expect(html).toContain("Standing next to her?<br>Use your phone.");
    expect(html).toContain('<svg class="qr"');
    expect(html).toContain("Scan to open Rani&#39;s page on your phone. It can share your location with whoever comes to help.");
    expect(html).toContain("Is she hurt right now? You can still raise an SOS from here.");
    expect(html).toContain("Rani needs help");
    expect(deskMarkup({ ...rani, sex: undefined }, "x")).toContain("Are they hurt right now?");
  });
});
