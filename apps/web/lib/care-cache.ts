/**
 * What a feeder needs on this phone when there is no signal (design v5, N7).
 *
 * N7 says "numbers for your wards are saved on this phone". This module is
 * what makes that sentence true: while online it reads the vets and NGOs the
 * map lists for each of the feeder's wards (GET /map/wards/:id, the same
 * public, published numbers the map shows: INVARIANT 3's tracked exception
 * for care_providers.phone_e164) and keeps them in IndexedDB. Offline, the
 * feed screen reads them back as tel: links.
 *
 * It also keeps the names of the feeder's own dogs, so a feed logged with no
 * signal can still say "Kalu's feed is saved."
 *
 * Every function here is best effort and never throws: a phone with storage
 * blocked simply has nothing saved, and the screen then says less.
 */

import { getCached, putCached } from "./idb";
import { api, getAccessToken } from "./api";
import { mapApi } from "@/app/map/api";

export interface CareNumber {
  id: string;
  name: string;
  kind: "vet" | "ngo";
  wardId: string | null;
  phoneE164: string;
  is24x7: boolean;
}

export interface SavedCare {
  wards: string[];
  numbers: CareNumber[];
  savedAt: string;
}

const CARE_KEY = "care-numbers";
const NAMES_KEY = "dog-names";
/** Refresh at most this often unless the wards change. */
const REFRESH_MS = 12 * 60 * 60 * 1000;
/** Three per ward on the map; six wards at most (CONTRACT: 0 to 6). */
const MAX_WARDS = 6;

function online(): boolean {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

/** The saved numbers, or null when nothing is saved. Never throws. */
export async function loadCareNumbers(): Promise<SavedCare | null> {
  try {
    const v = await getCached<SavedCare>(CARE_KEY);
    return v && Array.isArray(v.numbers) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Fetch and save the care numbers for the caller's wards (their chosen wards,
 * else their home ward). Returns what is saved afterwards. Skips the network
 * when offline, signed out, or when a fresh copy for the same wards exists.
 */
export async function refreshCareNumbers(opts: { force?: boolean; now?: number } = {}): Promise<SavedCare | null> {
  const now = opts.now ?? Date.now();
  const saved = await loadCareNumbers();
  if (!online() || !getAccessToken()) return saved;
  try {
    const me = await api.getFeederMe();
    const wards = (me.wards && me.wards.length ? me.wards : me.homeWard ? [me.homeWard] : []).slice(0, MAX_WARDS);
    if (wards.length === 0) return saved;
    const sameWards = saved && saved.wards.join(",") === wards.join(",");
    if (!opts.force && sameWards && now - Date.parse(saved.savedAt) < REFRESH_MS) return saved;

    const seen = new Set<string>();
    const numbers: CareNumber[] = [];
    let anyWard = false;
    for (const wardId of wards) {
      try {
        const w = await mapApi.ward(wardId);
        anyWard = true;
        for (const p of w.nearby ?? []) {
          if (!p.phoneE164 || seen.has(p.id)) continue;
          seen.add(p.id);
          numbers.push({
            id: p.id,
            name: p.name,
            kind: p.kind,
            wardId: p.wardId ?? wardId,
            phoneE164: p.phoneE164,
            is24x7: !!p.is24x7,
          });
        }
      } catch {
        /* one ward failing keeps the others */
      }
    }
    if (!anyWard) return saved;
    const next: SavedCare = { wards, numbers, savedAt: new Date(now).toISOString() };
    await putCached(CARE_KEY, next);
    return next;
  } catch {
    return saved;
  }
}

/** Remember dog names by slug (merged into what is kept). Never throws. */
export async function rememberDogNames(dogs: { slug: string; name: string | null }[]): Promise<void> {
  try {
    const cur = (await getCached<Record<string, string>>(NAMES_KEY)) ?? {};
    let changed = false;
    for (const d of dogs) {
      if (d.name && cur[d.slug] !== d.name) {
        cur[d.slug] = d.name;
        changed = true;
      }
    }
    if (changed) await putCached(NAMES_KEY, cur);
  } catch {
    /* nothing saved */
  }
}

/** A remembered name for a slug, or null. Never throws. */
export async function cachedDogName(slug: string): Promise<string | null> {
  try {
    const cur = await getCached<Record<string, string>>(NAMES_KEY);
    return cur?.[slug] ?? null;
  } catch {
    return null;
  }
}

/** "+912226..." as a tel: href. */
export function telHref(phoneE164: string): string {
  return `tel:${phoneE164.replace(/[^\d+]/g, "")}`;
}
