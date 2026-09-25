/**
 * Pure helpers for the feeder's own settings (N1 /welcome, N6 /settings):
 * ward chips, quiet hours and the alerts mode.
 */
import {
  BMC_WARD_CODES,
  isBmcWardCode,
  wardCentroid,
  wardDisplay,
  type BmcWardCode,
} from "@hetja/contracts";
import type { AlertsMode, QuietHours } from "@/lib/api";

/** PATCH /feeders/me accepts 0 to 6 wards. */
export const MAX_WARDS = 6;
/** PATCH /feeders/me accepts a display name of 1 to 40 characters. */
export const MAX_NAME = 40;

export const ALL_WARDS: readonly BmcWardCode[] = BMC_WARD_CODES;

/** The N1 default: 11 pm to 6 am. */
export const DEFAULT_QUIET_HOURS: QuietHours = { start: "23:00", end: "06:00" };

/** "K-West" -> "K/W". Unknown ids come back unchanged. */
export function wardCode(id: string): string {
  return wardDisplay(id).code;
}

/** "Bandra West, Khar" -> "Bandra W": the first locality, West / East shortened. */
export function shortLocality(id: string): string | null {
  const name = wardDisplay(id).name;
  if (!name) return null;
  const first = name.split(",")[0]!.trim();
  return first.replace(/ West$/, " W").replace(/ East$/, " E");
}

/** The N1 chip text: "K/W Andheri W". */
export function wardChipLabel(id: string): string {
  const place = shortLocality(id);
  return place ? `${wardCode(id)} ${place}` : wardCode(id);
}

/** The N6 "My wards" value: "K/W, H/W", or "None yet". */
export function wardsSummary(ids: readonly string[]): string {
  return ids.length === 0 ? "None yet" : ids.map(wardCode).join(", ");
}

/**
 * The chips N1 shows before "+ More wards": the feeder's wards, their home
 * ward, then the wards nearest the home ward, three in all (the mock's row). Nearness is by the
 * hand-placed ward centres (ward level only, INVARIANT 2).
 */
export function suggestedWards(selected: readonly string[], homeWard: string | null | undefined, max = 3): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  selected.forEach(add);
  if (homeWard && isBmcWardCode(homeWard)) {
    add(homeWard);
    const here = wardCentroid(homeWard);
    if (here) {
      const near = ALL_WARDS.filter((w) => w !== homeWard)
        .map((w) => {
          const c = wardCentroid(w);
          return { w, d: c ? (c.lat - here.lat) ** 2 + (c.lng - here.lng) ** 2 : Infinity };
        })
        .sort((a, b) => a.d - b.d);
      for (const { w } of near) {
        if (out.length >= Math.max(max, selected.length + 1)) break;
        add(w);
      }
    }
  }
  return out;
}

/** Toggle a ward, refusing a seventh. */
export function toggleWard(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((w) => w !== id);
  if (selected.length >= MAX_WARDS) return [...selected];
  return [...selected, id];
}

/** "23:00" -> "11 pm", "06:30" -> "6:30 am", "00:00" -> "12 am". */
export function formatClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2]!;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === "00" ? `${h12} ${suffix}` : `${h12}:${min} ${suffix}`;
}

/** The N1 row value: "11 pm – 6 am" (an en dash, as in the mock), or "Off". */
export function formatQuietHours(q: QuietHours | null | undefined): string {
  if (!q) return "Off";
  return `${formatClock(q.start)} – ${formatClock(q.end)}`;
}

export function alertsModeLabel(mode: AlertsMode | null | undefined): string {
  return mode === "all" ? "All" : "SOS only";
}

/** A trimmed display name the API will accept, or null. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
}
