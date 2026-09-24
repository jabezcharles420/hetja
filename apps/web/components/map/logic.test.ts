import { describe, expect, it } from "vitest";
import { MUMBAI_BOUNDS as CONTRACT_BOUNDS } from "@hetja/contracts";
import {
  ALL_ON,
  MUMBAI_BOUNDS,
  mumbaiMinZoom,
  bboxParam,
  callLabel,
  formatPhone,
  headline,
  hoursPill,
  hungriest,
  markerMode,
  needsHelp,
  placeHtml,
  placeKinds,
  placeLead,
  placeMini,
  placeSub,
  relTime,
  severityLabel,
  showPlace,
  sosSubline,
  telHref,
  totals,
  wardAria,
  wardFromHash,
  wardHash,
  wardHtml,
  wardLead,
  type MapPlace,
  type MapWard,
} from "./logic";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function ward(over: Partial<MapWard>): MapWard {
  return { id: "A", code: "A", name: "Colaba, Fort", lat: 18.9, lng: 72.8, dogs: 10, notFedToday: 0, sosOpen: 0, latestSos: null, ...over };
}

function place(over: Partial<MapPlace> = {}): MapPlace {
  return {
    id: "p1", name: "Dr. Mehta Pet Clinic", kind: "vet", wardId: "K-West", locality: "Andheri", lat: 19.1, lng: 72.8,
    hoursNote: "Open till 9 pm", is24x7: false, hasAmbulance: false, phoneE164: "+912224137518", confirmed: true,
    partner: true, ...over,
  };
}

describe("marker mode by zoom (the mock's three modes)", () => {
  it("is dot below 12, mini from 12 to under 13, full from 13", () => {
    expect(markerMode(10)).toBe("dot");
    expect(markerMode(11.75)).toBe("dot");
    expect(markerMode(12)).toBe("mini");
    expect(markerMode(12.75)).toBe("mini");
    expect(markerMode(13)).toBe("full");
    expect(markerMode(15)).toBe("full");
    expect(placeMini(12.75)).toBe(true);
    expect(placeMini(13)).toBe(false);
  });
});

describe("headline", () => {
  it("matches the mock, singular and plural", () => {
    expect(headline(3, 26)).toBe("3 dogs need help. 26 are waiting for dinner.");
    expect(headline(1, 1)).toBe("1 dog needs help. 1 is waiting for dinner.");
    expect(headline(0, 0)).toBe("0 dogs need help. 0 are waiting for dinner.");
  });
  it("has no em dashes anywhere in generated copy", () => {
    const all = [
      headline(2, 3), wardLead(ward({ notFedToday: 2 })), wardLead(ward({})), wardLead(ward({ dogs: 0 })),
      placeLead(place(), "K/W"), placeLead(place({ confirmed: false, partner: false, kind: "ngo" }), null),
      severityLabel("critical"), severityLabel("serious"), severityLabel("minor"),
    ];
    for (const s of all) expect(s).not.toContain("—");
  });
});

describe("severity labels", () => {
  it("say what the SOS picker offered", () => {
    expect(severityLabel("critical")).toBe("Can't get up, or bleeding");
    expect(severityLabel("serious")).toBe("Hurt, or needs checking");
    expect(severityLabel("minor")).toBe("Minor");
  });
});

describe("sorting", () => {
  const wards = [
    ward({ id: "E", code: "E", sosOpen: 1, notFedToday: 3, latestSos: { severity: "serious", raisedAt: ago(25) } }),
    ward({ id: "M-East", code: "M/E", sosOpen: 1, notFedToday: 2, latestSos: { severity: "critical", raisedAt: ago(8) } }),
    ward({ id: "K-West", code: "K/W", sosOpen: 1, notFedToday: 3, latestSos: { severity: "serious", raisedAt: ago(60) } }),
    ward({ id: "F-North", code: "F/N", notFedToday: 4 }),
    ward({ id: "L", code: "L", notFedToday: 3 }),
    ward({ id: "G-South", code: "G/S", notFedToday: 2 }),
    ward({ id: "H-West", code: "H/W", notFedToday: 2 }),
    ward({ id: "P-North", code: "P/N", notFedToday: 2 }),
    ward({ id: "N", code: "N", notFedToday: 0 }),
  ];
  it("lists Needs help most recent case first", () => {
    expect(needsHelp(wards).map((w) => w.code)).toEqual(["M/E", "E", "K/W"]);
  });
  it("lists the four hungriest wards without an SOS, most not fed first, ties by code", () => {
    expect(hungriest(wards).map((w) => w.code)).toEqual(["F/N", "L", "G/S", "H/W"]);
  });
  it("totals every ward", () => {
    expect(totals(wards)).toEqual({ dogs: 90, hungry: 21, sos: 3 });
  });
});

describe("times and leads", () => {
  it("relTime", () => {
    expect(relTime(ago(0.5), NOW)).toBe("just now");
    expect(relTime(ago(8), NOW)).toBe("8 min ago");
    expect(relTime(ago(60), NOW)).toBe("1 h ago");
    expect(relTime(ago(60 * 50), NOW)).toBe("2 d ago");
  });
  it("wardLead keeps the mock's two lines", () => {
    expect(wardLead(ward({ notFedToday: 1 }))).toBe(
      "One dog here has not been logged today. They might have eaten. They will not tell you either way.",
    );
    expect(wardLead(ward({ notFedToday: 3 }))).toBe(
      "3 dogs here have not been logged today. They might have eaten. They will not tell you either way.",
    );
    expect(wardLead(ward({ code: "N" }))).toBe("Every dog in N has a feed logged today. Somebody here is very organised.");
  });
  it("sosSubline only claims feeders were told when they were", () => {
    const base = { caseId: null, severity: "serious" as const, raisedAt: ago(60), mine: false };
    expect(sosSubline({ ...base, state: "open", feedersTold: true }, NOW)).toBe(
      "Raised 1 h ago · feeders told · waiting for someone nearby",
    );
    expect(sosSubline({ ...base, state: "open", feedersTold: false }, NOW)).toBe("Raised 1 h ago · waiting for someone nearby");
    expect(sosSubline({ ...base, state: "acked", feedersTold: true }, NOW)).toBe("Raised 1 h ago · someone is on the way");
  });
});

describe("places", () => {
  it("hours pill", () => {
    expect(hoursPill(place({ is24x7: true }))).toEqual({ tone: "ok", text: "Open 24 hours" });
    expect(hoursPill(place())).toEqual({ tone: "ok", text: "Open till 9 pm" });
    expect(hoursPill(place({ hoursNote: "Closed, opens 9 am" }))).toEqual({ tone: "neu", text: "Closed, opens 9 am" });
    expect(hoursPill(place({ hoursNote: null, hasAmbulance: true }))).toEqual({ tone: "ok", text: "Ambulance on call" });
    expect(hoursPill(place({ hoursNote: null }))).toEqual({ tone: "neu", text: "Hours not listed" });
  });
  it("sub line and where", () => {
    expect(placeSub(place())).toBe("Vet · K/W ward · Open till 9 pm");
    expect(placeSub(place({ wardId: null, kind: "ngo", hoursNote: null, hasAmbulance: true }))).toBe("NGO · Andheri · Ambulance on call");
    expect(placeSub(place({ wardId: null, locality: "Mumbai" }))).toBe("Vet · Open till 9 pm");
  });
  it("lead is truthful about who listed it and who gets alerts", () => {
    expect(placeLead(place(), "K/W")).toBe("Listed by the clinic. Hetja sends them SOS alerts for dogs in K/W and neighbouring wards.");
    expect(placeLead(place({ kind: "ngo", partner: false }), null)).toBe(
      "Listed by the NGO. They do not get Hetja's SOS alerts, so call them yourself.",
    );
    expect(placeLead(place({ confirmed: false }), "K/W")).toMatch(/^Listed by Hetja from public records/);
  });
  it("call caption", () => {
    expect(callLabel(place())).toBe("Call the clinic");
    expect(callLabel(place({ kind: "ngo", name: "Andheri Animal Rescue" }))).toBe("Call Andheri");
    expect(callLabel(place({ kind: "ngo", name: "The Welfare of Stray Dogs" }))).toBe("Call the NGO");
  });
  it("phones", () => {
    expect(formatPhone("+912224137518")).toBe("+91 22 2413 7518");
    expect(formatPhone("+919820012345")).toBe("+91 98200 12345");
    expect(telHref("+91 22 0000 0001")).toBe("tel:+912200000001");
  });
  it("draws pins zoomed in, or when both dog layers are off, or for the selection and nearby", () => {
    const p = place();
    expect(showPlace(p, 13, ALL_ON, null, new Set())).toBe(true);
    expect(showPlace(p, 12, ALL_ON, null, new Set())).toBe(false);
    expect(showPlace(p, 12, { ...ALL_ON, sos: false, hungry: false }, null, new Set())).toBe(true);
    expect(showPlace(p, 12, ALL_ON, "p1", new Set())).toBe(true);
    expect(showPlace(p, 12, ALL_ON, null, new Set(["p1"]))).toBe(true);
    expect(showPlace(p, 14, { ...ALL_ON, vet: false }, null, new Set())).toBe(false);
  });
});

describe("bbox", () => {
  it("pads, rounds outward to 2 decimals and stays inside the API's limit", () => {
    expect(bboxParam({ west: 72.8, south: 19.0, east: 72.9, north: 19.1 })).toBe("72.78,18.98,72.92,19.12");
    const [w, s, e, n] = bboxParam({ west: 70, south: 17, east: 75, north: 22 }).split(",").map(Number);
    expect(e - w).toBeLessThanOrEqual(2.5);
    expect(n - s).toBeLessThanOrEqual(2.5);
    expect((e + w) / 2).toBeCloseTo(72.5, 1);
  });
  it("asks for one kind only when one chip is off, and nothing when both are", () => {
    expect(placeKinds(ALL_ON)).toEqual({ fetch: true, kind: null });
    expect(placeKinds({ ...ALL_ON, ngo: false })).toEqual({ fetch: true, kind: "vet" });
    expect(placeKinds({ ...ALL_ON, vet: false })).toEqual({ fetch: true, kind: "ngo" });
    expect(placeKinds({ ...ALL_ON, vet: false, ngo: false })).toEqual({ fetch: false, kind: null });
  });
});

describe("deep link", () => {
  it("round-trips #ward=K%2FW", () => {
    expect(wardHash("K/W")).toBe("#ward=K%2FW");
    expect(wardFromHash("#ward=K%2FW")).toBe("K/W");
    expect(wardFromHash("#x=1")).toBeNull();
    expect(wardFromHash("#ward=%E0%A4%A")).toBeNull();
  });
});

describe("marker HTML (the mock's wardHtml / placeHtml)", () => {
  const kw = ward({ id: "K-West", code: "K/W", name: "Andheri West", dogs: 38, notFedToday: 3, sosOpen: 1 });
  it("dot mode shows the most urgent badge only, with the mock's aria-label", () => {
    expect(wardHtml(kw, "dot", ALL_ON, false)).toContain('class="badge b-sos"');
    expect(wardAria(kw, "dot", ALL_ON)).toBe("K/W ward, Andheri West: 1 needs help");
    expect(wardAria(kw, "dot", { ...ALL_ON, sos: false })).toBe("K/W ward, Andheri West: 3 not fed today");
    expect(wardAria(kw, "full", ALL_ON)).toBe("K/W ward, Andheri West");
    expect(wardHtml(ward({}), "dot", ALL_ON, false)).toContain("b-ok");
  });
  it("mini and full carry code, count and both badges; mini adds its class; selection rings it", () => {
    const full = wardHtml(kw, "full", ALL_ON, true);
    expect(full).toMatch(/^<div class="ward sel">/);
    expect(full).toContain('<span class="wc">K/W</span><span class="n">38</span>');
    expect(full).toContain("b-sos");
    expect(full).toContain("b-hun");
    expect(wardHtml(kw, "mini", ALL_ON, false)).toMatch(/^<div class="ward mini">/);
    expect(wardHtml(kw, "full", { ...ALL_ON, sos: false, hungry: false }, false)).toContain('title="All fed"');
  });
  it("escapes the ward code", () => {
    expect(wardHtml(ward({ code: "<x>" }), "full", ALL_ON, false)).toContain("&lt;x&gt;");
  });
  it("place pins: + / N when mini, + Vet / NGO when full", () => {
    expect(placeHtml({ kind: "vet" }, true, false)).toBe('<div class="place p-vet mini"><div class="pin">+</div><div class="stem"></div></div>');
    expect(placeHtml({ kind: "ngo" }, false, true)).toBe('<div class="place p-ngo sel"><div class="pin">NGO</div><div class="stem"></div></div>');
    expect(placeHtml({ kind: "vet" }, false, false)).toContain('<span class="plus">+</span>Vet');
  });
});

describe("Mumbai only", () => {
  it("uses the same box as @hetja/contracts", () => {
    expect(MUMBAI_BOUNDS).toEqual(CONTRACT_BOUNDS);
  });
  it("never lets the view zoom out past the whole of Mumbai", () => {
    expect(mumbaiMinZoom(10.9)).toBe(11);
    expect(mumbaiMinZoom(11.1)).toBe(11.25);
    expect(mumbaiMinZoom(8)).toBe(10);
    // The city view on a phone needs 10.9: the floor gives way to it.
    expect(mumbaiMinZoom(11.16, 10.93)).toBe(10.75);
    expect(mumbaiMinZoom(11.16, 12)).toBe(11.25);
  });
});
