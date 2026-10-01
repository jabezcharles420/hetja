/**
 * The desktop inspector's words (design v8, components/map/DeskPanel.tsx,
 * from the owner's Stitch map page in the design system). Pure, so tested in
 * desk.test.ts.
 */
import type { Filters } from "./logic";

/** "2 dogs need help." / "17 waiting for dinner." (Stitch's two-line headline), honest at zero. */
export function deskHeadline(sos: number, hungry: number): { help: string; dinner: string } {
  const help = sos === 0 ? "No dog needs help." : sos === 1 ? "1 dog needs help." : `${sos} dogs need help.`;
  const dinner = hungry === 0 ? "Every dog is logged today." : `${hungry} waiting for dinner.`;
  return { help, dinner };
}

/** Mumbai time for the "Mumbai right now" clock: "18:42 IST". */
export function istClock(at: Date = new Date()): string {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return `${t} IST`;
}

/** The ward's feeding round: dogs logged today out of the dogs with collars. */
export function feedProgress(dogs: number, notFedToday: number): { fed: number; pct: number } {
  const fed = Math.max(0, dogs - Math.max(0, notFedToday));
  return { fed, pct: dogs > 0 ? Math.round((fed / dogs) * 100) : 0 };
}

/** Each named dog in the ward and whether it has been logged today. */
export function dogStatuses(
  dogNames: readonly string[] | undefined,
  notLogged: readonly { name: string | null }[] | undefined,
): { name: string; fed: boolean }[] {
  const waiting = new Set((notLogged ?? []).map((d) => d.name).filter((n): n is string => !!n));
  return (dogNames ?? []).map((name) => ({ name, fed: !waiting.has(name) }));
}

/** The map's three layer tabs (Stitch "Live feed / ..."), as filter sets. */
export type MapLayer = "live" | "wards" | "care";

export const LAYER_FILTERS: Record<MapLayer, Filters> = {
  live: { sos: true, hungry: true, vet: true, ngo: true },
  wards: { sos: true, hungry: true, vet: false, ngo: false },
  care: { sos: false, hungry: false, vet: true, ngo: true },
};

/** Which tab the current filters are, if any. */
export function layerOf(f: Filters): MapLayer | null {
  for (const k of Object.keys(LAYER_FILTERS) as MapLayer[]) {
    const l = LAYER_FILTERS[k];
    if (l.sos === f.sos && l.hungry === f.hungry && l.vet === f.vet && l.ngo === f.ngo) return k;
  }
  return null;
}
