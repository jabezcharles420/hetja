/**
 * Map screen (19): the pure parts, kept free of Leaflet and React so they can
 * be tested in node. Marker HTML mirrors the mock's wardHtml / placeHtml
 * exactly; class names come in through `cls` so the CSS Module's hashed names
 * can be used (tests pass identity names).
 */

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
  return [kindWord(p.kind), placeWhere(p), hoursPill(p).text].filter(Boolean).join(" · ");
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
    ? `Hetja sends them SOS alerts for dogs in ${wardLabel ?? "their area"} and neighbouring wards.`
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
