/**
 * Map screen (19): the pure parts, kept free of Leaflet and React so they can
 * be tested in node. Marker HTML mirrors the mock's wardHtml / placeHtml
 * exactly; class names come in through `cls` so the CSS Module's hashed names
 * can be used (tests pass identity names).
 */

import { careLabel } from "@/lib/care-label";
import type { DogSex, MapCitySosV6, MapCitySummaryV6 } from "@/lib/api";

export type Severity = "minor" | "serious" | "critical";
export type MarkerMode = "dot" | "mini" | "full";
export type Filter = "sos" | "hungry" | "vet" | "ngo";
export type Filters = Record<Filter, boolean>;

export const ALL_ON: Filters = { sos: true, hungry: true, vet: true, ngo: true };

export interface MapWard {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  dogs: number;
  notFedToday: number;
  sosOpen: number;
  latestSos: { severity: Severity; raisedAt: string } | null;
}

export interface MapPlace {
  id: string;
  name: string;
  kind: "vet" | "ngo";
  careKind?: string;
  /** "free" | "subsidised" | "paid" (the nearby list carries it; pins may not). */
  costTier?: string | null;
  /** v7: a government provider ("Government vet · free"). */
  isGovernment?: boolean | null;
  /** v7: a government vet listed as a person rather than a hospital. */
  isPerson?: boolean | null;
  wardId: string | null;
  locality: string | null;
  lat: number;
  lng: number;
  hoursNote: string | null;
  is24x7: boolean;
  hasAmbulance: boolean;
  phoneE164: string | null;
  confirmed: boolean;
  partner: boolean;
  geoPrecision?: "exact" | "locality";
}

export interface MapSos {
  caseId: string | null;
  severity: Severity;
  raisedAt: string;
  state: "open" | "acked" | "escalated";
  feedersTold: boolean;
  mine: boolean;
  /** v6 (lib/api MapSosV6Fields): the dog's first name, when the case has a known dog. */
  dogName?: string | null;
  /** v6: someone has taken it. */
  taken?: boolean;
}

// ---------------------------------------------------------------------------
// Mumbai only

/**
 * @hetja/contracts MUMBAI_BOUNDS, repeated so the map bundle does not pull in
 * the contracts' zod schemas (logic.test.ts fails if the two drift). The map
 * pans, zooms and loads tiles only inside this box.
 */
export const MUMBAI_BOUNDS = { south: 18.88, west: 72.76, north: 19.3, east: 73.0 } as const;

/** Leaflet's [[south, west], [north, east]]. */
export const MUMBAI_LATLNG: [[number, number], [number, number]] = [
  [MUMBAI_BOUNDS.south, MUMBAI_BOUNDS.west],
  [MUMBAI_BOUNDS.north, MUMBAI_BOUNDS.east],
];

/**
 * The zoom floor. `boxZoom` is where the Mumbai box just fits the map
 * (Leaflet getBoundsZoom(MUMBAI, false)), snapped UP to the 0.25 step:
 * further out only shows what is not Mumbai. `cityZoom` is what the city view
 * needs to show every ward above the sheet (snapped DOWN); on a phone that is
 * a little further out, and the floor gives way to it so the whole city fits.
 * Tiles still never load outside the box. Never below 10.
 */
export function mumbaiMinZoom(boxZoom: number, cityZoom: number = Infinity): number {
  return Math.max(10, Math.min(Math.ceil(boxZoom * 4) / 4, Math.floor(cityZoom * 4) / 4));
}

// ---------------------------------------------------------------------------
// Zoom

/** The mock's three ward-marker modes: dot below 12, mini 12 to 13, full from 13. */
export function markerMode(zoom: number): MarkerMode {
  return zoom < 12 ? "dot" : zoom < 13 ? "mini" : "full";
}

/** Place pins go mini below 13 (the mock's placeHtml). */
export function placeMini(zoom: number): boolean {
  return zoom < 13;
}

// ---------------------------------------------------------------------------
// Words

/** "{n} dogs need help. {n} are waiting for dinner.", singular-aware. */
export function headline(sos: number, hungry: number): string {
  const help = sos === 1 ? "1 dog needs help." : `${sos} dogs need help.`;
  const dinner = hungry === 1 ? "1 is waiting for dinner." : `${hungry} are waiting for dinner.`;
  return `${help} ${dinner}`;
}

/**
 * Severity as the map says it. The collar page's SOS picker maps both "Hurt,
 * but moving" and "Something else" to `serious`, so the two cannot be told
 * apart here; "Hurt, or needs checking" covers both honestly.
 */
export function severityLabel(s: Severity): string {
  if (s === "critical") return "Can't get up, or bleeding";
  if (s === "serious") return "Hurt, or needs checking";
  return "Minor";
}

/** "8 min ago", "1 h ago", "3 d ago"; "just now" under a minute. */
export function relTime(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function dogsLabel(n: number): string {
  return n === 1 ? "1 dog" : `${n} dogs`;
}

export function needsHelpLabel(n: number): string {
  return n === 1 ? "1 needs help" : `${n} need help`;
}

/** The ward lead: the mock's two funny lines, plus an honest one for an empty ward. */
export function wardLead(w: Pick<MapWard, "code" | "dogs" | "notFedToday">): string {
  if (w.dogs === 0) return `No dogs with collars in ${w.code} yet. Nobody here to feed, or nobody has registered them.`;
  if (w.notFedToday > 0) {
    const who = w.notFedToday === 1 ? "One dog here has" : `${w.notFedToday} dogs here have`;
    return `${who} not been logged today. They might have eaten. They will not tell you either way.`;
  }
  return `Every dog in ${w.code} has a feed logged today. Somebody here is very organised.`;
}

/** Sub-line under an SOS case: what is actually known about who was told. */
export function sosSubline(s: MapSos, now: number = Date.now()): string {
  const raised = `Raised ${relTime(s.raisedAt, now)}`;
  if (s.state === "acked") return `${raised} · someone is on the way`;
  if (s.feedersTold) return `${raised} · feeders told · waiting for someone nearby`;
  return `${raised} · waiting for someone nearby`;
}

// ---------------------------------------------------------------------------
// Sorting

/** Wards with an open case, most recent case first. */
export function needsHelp(wards: MapWard[]): MapWard[] {
  return wards
    .filter((w) => w.sosOpen > 0)
    .sort((a, b) => time(b.latestSos?.raisedAt) - time(a.latestSos?.raisedAt) || a.code.localeCompare(b.code));
}

/** The mock's "Hungriest wards": most not-fed first, SOS wards excluded (listed above), top 4. */
export function hungriest(wards: MapWard[], limit = 4): MapWard[] {
  return wards
    .filter((w) => w.notFedToday > 0 && w.sosOpen === 0)
    .sort((a, b) => b.notFedToday - a.notFedToday || a.code.localeCompare(b.code))
    .slice(0, limit);
}

function time(iso: string | undefined): number {
  return iso ? new Date(iso).getTime() : 0;
}

export function totals(wards: MapWard[]): { dogs: number; hungry: number; sos: number } {
  return wards.reduce(
    (t, w) => ({ dogs: t.dogs + w.dogs, hungry: t.hungry + w.notFedToday, sos: t.sos + w.sosOpen }),
    { dogs: 0, hungry: 0, sos: 0 },
  );
}

// ---------------------------------------------------------------------------
// Places

/** The hours pill: [tone, words]. ok = a fact worth a check mark. */
export function hoursPill(p: Pick<MapPlace, "is24x7" | "hoursNote" | "hasAmbulance">): {
  tone: "ok" | "neu";
  text: string;
} {
  if (p.is24x7) return { tone: "ok", text: "Open 24 hours" };
  if (p.hoursNote) return { tone: /closed/i.test(p.hoursNote) ? "neu" : "ok", text: p.hoursNote };
  if (p.hasAmbulance) return { tone: "ok", text: "Ambulance on call" };
  return { tone: "neu", text: "Hours not listed" };
}

export function kindWord(k: "vet" | "ngo"): string {
  return k === "vet" ? "Vet" : "NGO";
}

/** A place's kind as every list says it (lib/care-label): "Government hospital · free", "NGO · free", "Vet". */
export function placeKindLabel(p: Pick<MapPlace, "kind" | "careKind" | "costTier" | "isGovernment" | "isPerson"> & { name?: string | null }): string {
  return careLabel(p);
}

/** "K-West" -> "K/W", "A" -> "A" (the contracts' wardDisplay, repeated to keep this module dependency-free). */
export function wardCode(id: string): string {
  const [letter, half] = id.split("-");
  return half ? `${letter}/${half.charAt(0)}` : letter;
}

/** Where a place is, for "Vet · K/W ward": its ward when known, else its locality. */
export function placeWhere(p: Pick<MapPlace, "wardId" | "locality">): string | null {
  if (p.wardId) return `${wardCode(p.wardId)} ward`;
  if (p.locality && p.locality !== "Mumbai") return p.locality;
  return null;
}

/** "Vet · K/W ward · Open till 9 pm" (the nearby row sub-line). */
export function placeSub(p: MapPlace): string {
  return [placeKindLabel(p), placeWhere(p), hoursPill(p).text].filter(Boolean).join(" · ");
}

/**
 * The place sheet's lead, told straight. "Listed by the clinic" only when a
 * human confirmed the details with the provider; the SOS-alert sentence only
 * for a contracted partner (escalation pages the nearest partner vets).
 */
export function placeLead(p: MapPlace, wardLabel: string | null): string {
  const who = p.kind === "vet" ? "the clinic" : "the NGO";
  const first = p.confirmed
    ? `Listed by ${who}.`
    : "Listed by Hetja from public records. The number is not confirmed yet.";
  const second = p.partner
    ? `Hetja sends them SOS alerts for ${wardLabel ?? "their area"}.`
    : "They do not get Hetja's SOS alerts, so call them yourself.";
  return `${first} ${second}`;
}

/** Footer caption: "Call the clinic", or "Call {first word}" for an NGO as the mock does. */
export function callLabel(p: Pick<MapPlace, "kind" | "name">): string {
  if (p.kind === "vet") return "Call the clinic";
  const first = p.name.trim().split(/\s+/)[0] ?? "";
  if (!first || /^(the|a|an|shri|sri|shree|dr\.?|st\.?|mr\.?|mrs\.?|ms\.?)$/i.test(first) || first.length < 3) {
    return "Call the NGO";
  }
  return `Call ${first}`;
}

/** +912224137518 -> "+91 22 2413 7518"; +919820012345 -> "+91 98200 12345". */
export function formatPhone(e164: string): string {
  const m = e164.match(/^\+91(\d{10})$/);
  if (!m) return e164;
  const d = m[1];
  if (d.startsWith("22")) return `+91 22 ${d.slice(2, 6)} ${d.slice(6)}`;
  if (/^[6-9]/.test(d)) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return `+91 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

// ---------------------------------------------------------------------------
// Bbox

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * The places query box: padded by `pad` of its size on each side, rounded
 * OUTWARD to 2 decimals (so small pans reuse the same cached box), clamped to
 * the API's 2.5 degree limit around the centre.
 */
export function bboxParam(b: Bounds, pad = 0.2): string {
  const w = b.east - b.west;
  const h = b.north - b.south;
  let west = b.west - w * pad;
  let east = b.east + w * pad;
  let south = b.south - h * pad;
  let north = b.north + h * pad;
  const MAX = 2.4;
  if (east - west > MAX) {
    const c = (east + west) / 2;
    west = c - MAX / 2;
    east = c + MAX / 2;
  }
  if (north - south > MAX) {
    const c = (north + south) / 2;
    south = c - MAX / 2;
    north = c + MAX / 2;
  }
  const down = (v: number) => (Math.floor(v * 100) / 100).toFixed(2);
  const up = (v: number) => (Math.ceil(v * 100) / 100).toFixed(2);
  return `${down(west)},${down(south)},${up(east)},${up(north)}`;
}

/** Which kind the places query should ask for, or null for both / none. */
export function placeKinds(f: Filters): { fetch: boolean; kind: "vet" | "ngo" | null } {
  if (!f.vet && !f.ngo) return { fetch: false, kind: null };
  if (f.vet && f.ngo) return { fetch: true, kind: null };
  return { fetch: true, kind: f.vet ? "vet" : "ngo" };
}

// ---------------------------------------------------------------------------
// Deep link

/** "#ward=K%2FW" -> "K/W". */
export function wardFromHash(hash: string): string | null {
  const m = hash.match(/ward=([^&]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export function wardHash(code: string): string {
  return `#ward=${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// Marker HTML (the mock's wardHtml / placeHtml)

export type MarkerClass =
  | "ward" | "sel" | "n" | "wc" | "badge" | "bSos" | "bHun" | "bOk" | "dot" | "dotm" | "mini"
  | "place" | "pin" | "stem" | "pVet" | "pNgo" | "plus";

export type ClassMap = Record<MarkerClass, string>;

export const IDENTITY_CLASSES: ClassMap = {
  ward: "ward", sel: "sel", n: "n", wc: "wc", badge: "badge", bSos: "b-sos", bHun: "b-hun", bOk: "b-ok",
  dot: "dot", dotm: "dotm", mini: "mini", place: "place", pin: "pin", stem: "stem", pVet: "p-vet",
  pNgo: "p-ngo", plus: "plus",
};

export const CLOCK_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
export const CHECK_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** What a ward marker says, for its aria-label (and the dot's title). */
export function wardStatus(w: MapWard, f: Filters): string {
  if (f.sos && w.sosOpen) return `${w.sosOpen} needs help`;
  if (f.hungry && w.notFedToday) return `${w.notFedToday} not fed today`;
  return "All fed";
}

export function wardAria(w: MapWard, mode: MarkerMode, f: Filters): string {
  return mode === "dot" ? `${w.code} ward, ${w.name}: ${wardStatus(w, f)}` : `${w.code} ward, ${w.name}`;
}

export function wardHtml(w: MapWard, mode: MarkerMode, f: Filters, selected: boolean, c: ClassMap = IDENTITY_CLASSES): string {
  const code = escapeHtml(w.code);
  const sel = selected ? ` ${c.sel}` : "";
  if (mode === "dot") {
    let cls = c.bOk;
    let inner = CHECK_SVG;
    if (f.sos && w.sosOpen) {
      cls = c.bSos;
      inner = "";
    } else if (f.hungry && w.notFedToday) {
      cls = c.bHun;
      inner = String(w.notFedToday);
    }
    const t = escapeHtml(wardStatus(w, f));
    return `<div class="${c.ward} ${c.dotm}${sel}" title="${code} · ${t}"><span class="${c.badge} ${cls}">${inner}</span></div>`;
  }
  let b = "";
  if (f.sos && w.sosOpen) {
    b += `<span class="${c.badge} ${c.bSos}" title="${w.sosOpen} needs help"><span class="${c.dot}">!</span>${w.sosOpen}</span>`;
  }
  if (f.hungry && w.notFedToday) {
    b += `<span class="${c.badge} ${c.bHun}" title="${w.notFedToday} not fed today">${CLOCK_SVG}${w.notFedToday}</span>`;
  }
  if (!b) b = `<span class="${c.badge} ${c.bOk}" title="All fed">${CHECK_SVG}</span>`;
  return `<div class="${c.ward}${sel}${mode === "mini" ? ` ${c.mini}` : ""}"><span class="${c.wc}">${code}</span><span class="${c.n}">${w.dogs}</span>${b}</div>`;
}

export function placeHtml(p: Pick<MapPlace, "kind">, mini: boolean, selected: boolean, c: ClassMap = IDENTITY_CLASSES): string {
  const k = p.kind === "vet" ? c.pVet : c.pNgo;
  const inner = mini ? (p.kind === "vet" ? "+" : "N") : p.kind === "vet" ? `<span class="${c.plus}">+</span>Vet` : "NGO";
  return `<div class="${c.place} ${k}${selected ? ` ${c.sel}` : ""}${mini ? ` ${c.mini}` : ""}"><div class="${c.pin}">${inner}</div><div class="${c.stem}"></div></div>`;
}

/** The mock draws place pins only when zoomed in, when both dog layers are off, or for the selection / nearby. */
export function showPlace(
  p: Pick<MapPlace, "id" | "kind">,
  zoom: number,
  f: Filters,
  selectedId: string | null,
  nearbyIds: ReadonlySet<string>,
): boolean {
  if (!f[p.kind]) return false;
  const onlyPlaces = !f.sos && !f.hungry;
  return zoom >= 13 || onlyPlaces || selectedId === p.id || nearbyIds.has(p.id);
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlaps(a: ScreenRect, b: ScreenRect, gap: number): boolean {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

/**
 * How far (px, positive = down) to move a ward label so it covers no vet or
 * NGO pin. The pin sits on a real place; the ward label sits on a hand-placed
 * ward centre that means nothing finer than "this ward", so the label is the
 * one that moves: just above or just below the pins it would cover, whichever
 * is the shorter move. 0 when nothing overlaps.
 */
export function wardNudge(ward: ScreenRect, places: readonly ScreenRect[], gap = 4): number {
  const hit = places.filter((p) => overlaps(ward, p, gap));
  if (hit.length === 0) return 0;
  const down = Math.max(...hit.map((p) => p.bottom)) - ward.top + gap;
  const up = Math.min(...hit.map((p) => p.top)) - ward.bottom - gap;
  return Math.abs(up) <= Math.abs(down) ? up : down;
}

/* ------------------------------------------------------------------------- */
/* Design v6 (M1, M2, M4, M5, M6, M7, V20)                                   */
/* ------------------------------------------------------------------------- */

/** GET /map/wards v6 (lib/api MapWardsV6): the city summary and its SOS rows. */
export type CitySummary = Partial<MapCitySummaryV6>;
/** A city SOS row. Public and cached, so no case id: it opens the ward. */
export type CitySos = MapCitySosV6;

/** A ward-detail dog nobody has logged today (first name only, no slug). */
export interface NotLoggedDog {
  name: string | null;
  lastLoggedAt: string | null;
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** 2 -> "Two" at the start of a sentence ("two" with `lower`); 10 and up stay digits. */
export function countWord(n: number, lower = false): string {
  if (n < 0 || n >= WORDS.length) return String(n);
  const w = WORDS[n]!;
  return lower ? w.toLowerCase() : w;
}

/** Morning / afternoon / evening / night, in Mumbai. */
export function partOfDay(now: number = Date.now()): string {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now),
  );
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

/** "Bandra West, Khar" -> "Bandra West". */
export function firstLocality(name: string): string {
  return name.split(",")[0]!.trim();
}

/**
 * The city sheet's headline and lead (M1, V20). "Not logged", never "waiting
 * for dinner": the data knows a feed was not recorded, not that a dog is
 * hungry. The zero-SOS case is its own sentence, not a template with a 0.
 */
export function cityWords(
  wards: readonly MapWard[],
  summary: CitySummary | null | undefined,
  now: number = Date.now(),
  sosRows?: readonly CitySos[] | null,
): { h1: string; lead: string | null } {
  const t = totals([...wards]);
  const dogs = summary?.withCollars ?? t.dogs;
  const sos = sosRows?.length ?? t.sos;
  const notLogged = summary?.notLoggedToday ?? t.hungry;
  if (dogs === 0 && sos === 0) return { h1: "Hetja is new here. The first collars go on in K/W.", lead: null };
  if (sos > 0) {
    const help = sos === 1 ? "One dog needs help." : `${countWord(sos)} dogs need help.`;
    if (notLogged === 0) return { h1: help, lead: null };
    const logged = notLogged === 1 ? "1 hasn't been logged today." : `${notLogged} haven't been logged today.`;
    return { h1: `${help} ${logged}`, lead: null };
  }
  const h1 = `A quiet ${partOfDay(now)}. No dog needs help.`;
  if (notLogged === 0) {
    return { h1, lead: "Every dog with a collar has a feed logged today. Somebody here is very organised." };
  }
  const top = [...wards].sort((a, b) => b.notFedToday - a.notFedToday)[0];
  let where = "";
  if (top && top.notFedToday > 0) {
    if (top.notFedToday === notLogged) where = `, all in ${firstLocality(top.name)}`;
    else if (top.notFedToday * 2 >= notLogged) where = `, mostly in ${firstLocality(top.name)}`;
  }
  const count = notLogged === 1 ? "1 hasn't" : `${notLogged} haven't`;
  return { h1, lead: `${count} been logged today${where}. They've probably eaten. Nobody has said so.` };
}

/** The M1 stats line, one line of text: "59 with collars · 23 feeders · 41 fed today". */
export function cityStats(
  wards: readonly MapWard[],
  summary: CitySummary | null | undefined,
): Array<{ n: number; label: string }> {
  const t = totals([...wards]);
  const out = [{ n: summary?.withCollars ?? t.dogs, label: "with collars" }];
  if (typeof summary?.feeders === "number") {
    out.push({ n: summary.feeders, label: summary.feeders === 1 ? "feeder" : "feeders" });
  }
  out.push({ n: summary?.fedToday ?? Math.max(0, t.dogs - t.hungry), label: "fed today" });
  return out;
}

export interface CitySosRow {
  key: string;
  wardId: string;
  title: string;
  severity: Severity | null;
  raisedAt: string | null;
  taken: boolean;
  initial: string;
}

/** The city "Needs help" rows: v6's dog-named rows, or one row per ward from an older API. Both open the ward. */
export function citySosRows(wards: readonly MapWard[], sos: readonly CitySos[] | null | undefined): CitySosRow[] {
  const byId = new Map(wards.map((w) => [w.id, w]));
  if (sos) {
    return [...sos]
      .sort((a, b) => time(b.raisedAt) - time(a.raisedAt))
      .map((s, i) => {
        const ward = byId.get(s.wardId);
        const place = ward ? firstLocality(ward.name) : `${s.wardCode} ward`;
        const name = s.dogName?.trim() || null;
        return {
          key: `${s.wardId}-${s.raisedAt}-${i}`,
          wardId: s.wardId,
          title: `${name ?? "A dog"} · ${place}`,
          severity: s.severity,
          raisedAt: s.raisedAt,
          taken: s.taken,
          initial: (name ?? place).charAt(0).toUpperCase(),
        };
      });
  }
  return needsHelp([...wards]).map((w) => ({
    key: w.id,
    wardId: w.id,
    title: `${w.code} ward · ${firstLocality(w.name)}`,
    severity: w.latestSos?.severity ?? null,
    raisedAt: w.latestSos?.raisedAt ?? null,
    taken: false,
    initial: w.code.charAt(0),
  }));
}

/** "13 min", "2 h", "3 d"; "now" under a minute. */
export function shortAgo(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** M2: "Rani, Kalu, Bruno and 11 others live here. 5 not logged today." */
export function wardDogsLine(names: readonly string[] | undefined, total: number, notLogged: number): string | null {
  const shown = (names ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 3);
  if (shown.length === 0) return null;
  const others = Math.max(0, total - shown.length);
  let who: string;
  if (others > 0) who = `${shown.join(", ")} and ${others === 1 ? "1 other" : `${others} others`}`;
  else if (shown.length === 1) who = shown[0]!;
  else who = `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  const verb = others === 0 && shown.length === 1 ? "lives" : "live";
  const tail = notLogged > 0 ? ` ${notLogged} not logged today.` : "";
  return `${who} ${verb} here.${tail}`;
}

/** M2 SOS card title: "Rani can't get up". */
export function sosCardTitle(s: Pick<MapSos, "severity" | "dogName">): string {
  const name = s.dogName?.trim() || "A dog";
  if (s.severity === "critical") return `${name} can't get up`;
  if (s.severity === "serious") return `${name} is hurt`;
  return `${name} needs checking`;
}

/**
 * M2 SOS card sub-line: "13 min · feeders told · nobody yet". Claims only
 * what is known: the ward detail sends no feeder count and no sex, so the
 * mock's "her 2 feeders told" becomes "feeders told".
 */
export function sosCardSub(s: MapSos, now: number = Date.now()): string {
  const bits = [shortAgo(s.raisedAt, now)];
  if (s.feedersTold) bits.push("feeders told");
  const taken = s.taken ?? s.state === "acked";
  bits.push(taken ? (s.mine ? "you're going" : "someone is going") : "nobody yet");
  return bits.join(" · ");
}

/** Days since the epoch in Mumbai. */
function istDayNumber(ms: number): number {
  return Math.floor((ms + 5.5 * 3600_000) / 86_400_000);
}

/** M6: "yesterday", "3 days", "not yet". `warn` from two days. */
export function lastLoggedLabel(iso: string | null, now: number = Date.now()): { text: string; warn: boolean } {
  if (!iso) return { text: "not yet", warn: true };
  const d = istDayNumber(now) - istDayNumber(new Date(iso).getTime());
  if (d <= 0) return { text: "today", warn: false };
  if (d === 1) return { text: "yesterday", warn: false };
  return { text: `${d} days`, warn: true };
}

/** M6 lead: "Nobody's logged these four today. They've probably eaten. Nobody has said so." */
export function notLoggedLead(dogs: readonly NotLoggedDog[]): string {
  if (dogs.length === 1) {
    const n = dogs[0]!.name?.trim();
    return n
      ? `Nobody's logged ${n} today. ${n} has probably eaten. Nobody has said so.`
      : "Nobody's logged this one today. They've probably eaten. Nobody has said so.";
  }
  return `Nobody's logged these ${countWord(dogs.length, true)} today. They've probably eaten. Nobody has said so.`;
}

/** "I feed in Malad". */
export function feedHereLabel(w: Pick<MapWard, "name">): string {
  return `I feed in ${firstLocality(w.name)}`;
}

/** M4: "Rani's case is yours." */
export function ackTitle(dogName: string | null | undefined): string {
  const n = dogName?.trim();
  return n ? `${n}'s case is yours.` : "The case is yours.";
}

/** M4 body: "her" only when the dog's sex is known. */
export function ackBody(dogName: string | null | undefined, sex: DogSex | null | undefined): string {
  const obj = sex === "female" ? "her" : sex === "male" ? "him" : dogName?.trim() || "the dog";
  const pos = sex === "female" ? "Her" : sex === "male" ? "His" : "The";
  return `The person who found ${obj} can see you're coming. ${pos} exact spot is on the map now, for you only.`;
}

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "900 m", "1.4 km". */
export function distanceLabel(m: number): string {
  if (m < 950) return `${Math.max(100, Math.round(m / 100) * 100)} m`;
  const km = Math.round(m / 100) / 10;
  return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km`;
}

/** "1.4 km · about 6 min by auto" (an auto-rickshaw at about 15 km/h in traffic). */
export function autoTrip(m: number): string {
  const min = Math.max(1, Math.ceil((m / 1000 / 15) * 60));
  return `${distanceLabel(m)} · about ${min} min by auto`;
}

/** The phone's maps app, with the coordinates as the destination. */
export function directionsHref(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

function parseClock(t: string): number | null {
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === "pm") h += 12;
  return h * 60 + Number(m[2] ?? 0);
}

function clockWords(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/**
 * M5 "open now", computed only where the hours are structured: 24 x 7, or a
 * daily range such as "9 am to 9 pm" / "9:30am - 8pm". Anything else is the
 * clinic's own note (`open: null`), never a guess.
 */
export function openNow(
  p: Pick<MapPlace, "is24x7" | "hoursNote">,
  now: number = Date.now(),
): { open: boolean | null; text: string; short: string } | null {
  if (p.is24x7) return { open: true, text: "Open now · 24 hours", short: "open now, 24 hours" };
  const note = p.hoursNote?.trim();
  if (!note) return null;
  const m = note.match(
    /^(?:open\s+)?(\d{1,2}(?::\d{2})?\s*[ap]m)\s*(?:to|-|–|until|till)\s*(\d{1,2}(?::\d{2})?\s*[ap]m)$/i,
  );
  const from = m ? parseClock(m[1]!) : null;
  const to = m ? parseClock(m[2]!) : null;
  if (from === null || to === null) {
    return { open: null, text: note, short: note.charAt(0).toLowerCase() + note.slice(1) };
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).formatToParts(now);
  const cur =
    Number(parts.find((x) => x.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((x) => x.type === "minute")?.value ?? 0);
  const open = from < to ? cur >= from && cur < to : cur >= from || cur < to;
  return open
    ? { open: true, text: `Open now · till ${clockWords(to)}`, short: `open now, till ${clockWords(to)}` }
    : { open: false, text: `Closed now · opens ${clockWords(from)}`, short: `closed now, opens ${clockWords(from)}` };
}

/** "3:40 pm" in Mumbai (M7). */
export function clockIST(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).formatToParts(ms);
  const h = Number(parts.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(parts.find((x) => x.type === "minute")?.value ?? 0);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** M7 lead when cached counts are on the map. */
export function staleLead(savedAt: number): string {
  return `Showing counts from ${clockIST(savedAt)}, greyed out. Open SOS cases may be missing.`;
}

export const WARDS_CACHE_KEY = "hetja.map.wards.v1";

export interface WardsCache {
  at: number;
  wards: MapWard[];
  summary: CitySummary | null;
  sos: CitySos[] | null;
}

/** Last good /map/wards, or null. Storage can be missing or throw (private mode). */
export function readWardsCache(storage: Pick<Storage, "getItem"> | null | undefined): WardsCache | null {
  try {
    const raw = storage?.getItem(WARDS_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<WardsCache>;
    if (typeof c?.at !== "number" || !Array.isArray(c.wards)) return null;
    return { at: c.at, wards: c.wards, summary: c.summary ?? null, sos: c.sos ?? null };
  } catch {
    return null;
  }
}

export function writeWardsCache(
  storage: Pick<Storage, "setItem"> | null | undefined,
  wards: MapWard[],
  summary: CitySummary | null,
  sos: CitySos[] | null,
  at: number = Date.now(),
): void {
  try {
    storage?.setItem(WARDS_CACHE_KEY, JSON.stringify({ at, wards, summary, sos }));
  } catch {
    // Full or blocked storage: the cache is only a convenience.
  }
}

/**
 * v6 M2: where to draw a vet or NGO pin so it covers no ward label and no pin
 * already placed. Ward labels stay on their ward centres (the map's anchor);
 * the pin moves the shortest way clear (up, then sideways, then down),
 * trying again if the new spot hits something else. Returns the offset in px.
 */
export function pinOffset(
  pin: ScreenRect,
  obstacles: readonly ScreenRect[],
  gap = 4,
): { dx: number; dy: number } {
  const at = (dx: number, dy: number): ScreenRect => ({
    left: pin.left + dx,
    right: pin.right + dx,
    top: pin.top + dy,
    bottom: pin.bottom + dy,
  });
  const clear = (r: ScreenRect) => !obstacles.some((o) => overlaps(r, o, gap));
  if (clear(pin)) return { dx: 0, dy: 0 };
  let best: { dx: number; dy: number } | null = null;
  const consider = (dx: number, dy: number) => {
    if (!clear(at(dx, dy))) return;
    if (!best || Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy)) best = { dx, dy };
  };
  // Candidate moves: flush against each side of each obstacle the pin touches.
  let frontier: Array<{ dx: number; dy: number }> = [{ dx: 0, dy: 0 }];
  for (let round = 0; round < 3 && !best; round++) {
    const next: Array<{ dx: number; dy: number }> = [];
    for (const f of frontier) {
      const r = at(f.dx, f.dy);
      for (const o of obstacles.filter((x) => overlaps(r, x, gap))) {
        const moves = [
          { dx: f.dx, dy: f.dy + (o.top - r.bottom - gap) },
          { dx: f.dx + (o.right - r.left + gap), dy: f.dy },
          { dx: f.dx + (o.left - r.right - gap), dy: f.dy },
          { dx: f.dx, dy: f.dy + (o.bottom - r.top + gap) },
        ];
        for (const m of moves) {
          consider(m.dx, m.dy);
          next.push(m);
        }
      }
    }
    frontier = next.slice(0, 32);
  }
  if (best) return best;
  // Crowded spot: no clear place within three hops. Never leave the pin on a
  // label: step it straight up past whatever it touches until it is clear.
  let dy = 0;
  for (let i = 0; i < 12; i++) {
    const hits = obstacles.filter((o) => overlaps(at(0, dy), o, gap));
    if (hits.length === 0) return { dx: 0, dy };
    dy = Math.min(...hits.map((o) => o.top)) - pin.bottom - gap;
  }
  return { dx: 0, dy };
}
