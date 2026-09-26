/**
 * Partial collar codes for F2 ("Type what you can read") and N8 ("No dog has
 * this code."), plus the small helpers the find-a-dog screens share.
 *
 * A collar code is 9 characters from `abcdefghijkmnopqrstuvwxyz23456789`
 * (lib/collar.ts). On a muddy tag people read what they can, so the F2 boxes
 * take:
 *
 *   - any case;
 *   - the confusables the alphabet leaves out, folded the way the API folds
 *     them (GET /dogs/lookup): `0` is `o`, `1` and `l` are `i`. The screen
 *     says so: "0 and O, 1 and I are treated as the same.";
 *   - an explicit "can't read this one" (`?`, `.`, `*`, `_`, `-`, space, or
 *     the middle dot the boxes draw), stored as `?`.
 *
 * Unknown characters travel to the API as `?`, and the lookup needs at least
 * 4 known characters.
 */

import { BMC_WARD_CENTROIDS, isInMumbai, type BmcWardCode } from "@hetja/contracts";
import { collarGroups } from "@/components/ds/collar";
import { careLabel } from "@/lib/care-label";

export const CODE_LENGTH = 9;
export const BOX_LENGTH = 3;
export const UNKNOWN = "?";
/** The lookup refuses fewer known characters than this. */
export const MIN_KNOWN = 4;

const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
const FOLD: Record<string, string> = { "0": "o", "1": "i", l: "i" };
const SKIP = new Set(["?", ".", "*", "_", "-", " ", "·"]);

/** One typed character in the collar alphabet, `?` for a skip, or null to drop it. */
export function normaliseCodeChar(ch: string): string | null {
  const c = ch.toLowerCase();
  if (SKIP.has(c)) return UNKNOWN;
  const folded = FOLD[c] ?? c;
  return ALPHABET.includes(folded) ? folded : null;
}

/** Normalises free text ("rni 4?2-pq7", "RN1482PQ7") to at most `max` code characters. */
export function normaliseCode(raw: string, max = CODE_LENGTH): string {
  let out = "";
  for (const ch of raw) {
    const n = normaliseCodeChar(ch);
    if (n !== null) out += n;
    if (out.length >= max) break;
  }
  return out;
}

/** Three boxes of up to 3 characters each; `?` marks a skipped character. */
export type CodeBoxes = [string, string, string];

export const EMPTY_BOXES: CodeBoxes = ["", "", ""];

/** Splits a (normalised or raw) code into the three boxes. */
export function boxesFromCode(raw: string): CodeBoxes {
  const code = normaliseCode(raw);
  return [code.slice(0, 3), code.slice(3, 6), code.slice(6, 9)];
}

/** The 9-character query, unknowns and untyped slots as `?`. */
export function queryFromBoxes(boxes: CodeBoxes): string {
  return boxes.map((b) => b.padEnd(BOX_LENGTH, UNKNOWN)).join("");
}

export function knownCount(query: string): number {
  let n = 0;
  for (const ch of query) if (ch !== UNKNOWN) n += 1;
  return n;
}

/** Every character read: a full code that either is a dog or is an N8 miss. */
export function isFullCode(query: string): boolean {
  return query.length === CODE_LENGTH && knownCount(query) === CODE_LENGTH;
}

/** "rni482pq7" -> "RNI 482 PQ7". */
export function prettyCode(slug: string): string {
  return collarGroups(slug).join(" ");
}

/** "RNI 482 PQ7 · K/W", the match row's mono sub line. */
export function codeLine(slug: string, wardCode: string | null | undefined): string {
  return wardCode ? `${prettyCode(slug)} · ${wardCode}` : prettyCode(slug);
}

/** "2 dogs match", "1 dog matches". */
export function matchCountLabel(n: number): string {
  return n === 1 ? "1 dog matches" : `${n} dogs match`;
}

/**
 * The ward a phone is standing in, approximated as the nearest ward centre.
 * There are no ward boundary polygons on the client; the centres are placed
 * on each ward's populated core, which is good enough to open the right ward
 * first (and the ward card always has Change). Null outside Mumbai.
 */
export function nearestWard(lat: number, lng: number): BmcWardCode | null {
  if (!isInMumbai(lat, lng)) return null;
  let best: BmcWardCode | null = null;
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const [id, c] of Object.entries(BMC_WARD_CENTROIDS) as Array<[BmcWardCode, { lat: number; lng: number }]>) {
    const dLat = c.lat - lat;
    const dLng = (c.lng - lng) * k;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** One-shot position with a hard timeout; undefined on denial, timeout or no API. */
export function getPosition(timeoutMs = 6000): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
      );
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

/** tel: link for an E.164 or printed number. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/**
 * "Vet · Andheri West · open 24 hours", the care row's sub line. The kind
 * comes from lib/care-label (v7: "Government vet · free", "NGO · free"), so
 * the SOS-anyway list names care the way the map and portals do.
 */
export function careLine(p: {
  kind?: string | null;
  costTier?: string | null;
  isGovernment?: boolean | null;
  isPerson?: boolean | null;
  locality?: string | null;
  hoursNote?: string | null;
  is24x7?: boolean;
  hasAmbulance?: boolean;
  phoneE164?: string | null;
  phoneVerifiedAt?: string | null;
  /** The provider's name; "hospital" or "dispensary" in it picks the government label. */
  name?: string | null;
}): string {
  const note = p.hoursNote ?? (p.is24x7 ? "open 24 hours" : p.hasAmbulance ? "ambulance" : undefined);
  const known = p.kind || p.isGovernment || p.costTier;
  const label = known
    ? careLabel({ careKind: p.kind, costTier: p.costTier, isGovernment: p.isGovernment, isPerson: p.isPerson, name: p.name })
    : undefined;
  const bits = [label, p.locality ?? undefined, note];
  if (!p.phoneE164) bits.push("no phone listed");
  else if (!p.phoneVerifiedAt) bits.push("number not confirmed");
  return bits.filter(Boolean).join(" · ");
}

export interface ScannedCollar {
  slug: string;
  sig: string | null;
}

/**
 * Where a resolved collar goes. /d/ is the profile app, so it is a full URL
 * (window.location.assign or a plain <a>). With `?intent=feed` (from Me or
 * Log a feed's Change) it is Log a feed for that dog instead.
 */
export function destinationFor(collar: ScannedCollar, intent: string | null): string {
  if (intent === "feed") return `/feed?dog=${encodeURIComponent(collar.slug)}`;
  // Design v7: "Scan a collar" in the Vet tab opens the vet's view of the dog (V2b).
  if (intent === "vet") return `/vet/dogs/${encodeURIComponent(collar.slug)}`;
  const qs = collar.sig ? `?s=${encodeURIComponent(collar.sig)}` : "";
  return `/d/${collar.slug}${qs}`;
}

/** A scan-fallback route that keeps `?intent=feed` when there is one. */
export function withIntent(path: string, intent: string | null): string {
  if (intent !== "feed" && intent !== "vet") return path;
  return `${path}${path.includes("?") ? "&" : "?"}intent=${intent}`;
}

/** `?intent=` of the current page, read at call time (no Suspense needed). */
export function currentIntent(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("intent");
}

const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** V2's counter, left side: "One more to go" with 8 typed; empty before the first. */
export function remainingLabel(typed: number): string {
  const left = CODE_LENGTH - typed;
  if (left <= 0) return "That's all nine";
  if (left >= CODE_LENGTH) return "";
  return `${COUNT_WORDS[left]} more to go`;
}

/** Positions where a suggestion differs from what was typed (V3 marks them). */
export function diffPositions(typed: string, slug: string): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < Math.max(typed.length, slug.length); i++) if (typed[i] !== slug[i]) out.add(i);
  return out;
}
