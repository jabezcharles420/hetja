/**
 * D1's phone preview (design v6 CONTRACT, adapted list): a real public dog
 * when one exists, ward level only, else the labelled example. Everything
 * comes from public endpoints that need no sign-in:
 *
 *   GET /map/wards               the ward with the most collared dogs
 *   GET /wards/:ward/dogs        a named dog there (prefer one with a photo)
 *   GET /dogs/:slug              its ward, pills and last feed
 *
 * Nothing finer than the ward is ever read or shown (INVARIANT 2), and the
 * result is kept for the browser session so D1 costs three requests once.
 */
import { wardDisplay } from "@hetja/contracts";
import { api, API_BASE, type DogSex } from "@/lib/api";

export interface ShowcaseDog {
  name: string;
  wardLine: string;
  photoUrl: string | null;
  vaccinated: boolean;
  sterilised: boolean;
  /** "Priya fed her 2 hours ago." / "Fed 2 hours ago." / null when never fed. */
  fedLine: string | null;
}

export const SHOWCASE_KEY = "hetja:d1-dog";

/** "just now", "12 minutes ago", "2 hours ago", "3 days ago". */
export function agoText(iso: string, now: Date = new Date()): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

export function fedLine(
  lastFedAt: string | null | undefined,
  lastFedBy: string | null | undefined,
  name: string,
  sex: DogSex | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!lastFedAt) return null;
  const ago = agoText(lastFedAt, now);
  if (!ago) return null;
  if (!lastFedBy) return `Fed ${ago}.`;
  const them = sex === "female" ? "her" : sex === "male" ? "him" : name;
  return `${lastFedBy} fed ${them} ${ago}.`;
}

interface WardCount {
  id: string;
  dogs: number;
}

async function busiestWard(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/map/wards`, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as { ok?: boolean; data?: { wards?: WardCount[] } };
  const wards = j.ok && Array.isArray(j.data?.wards) ? j.data!.wards! : [];
  const best = [...wards].filter((w) => w.dogs > 0).sort((a, b) => b.dogs - a.dogs)[0];
  return best?.id ?? null;
}

export async function loadShowcaseDog(now: Date = new Date()): Promise<ShowcaseDog | null> {
  try {
    const cached = sessionStorage.getItem(SHOWCASE_KEY);
    if (cached) return cached === "none" ? null : (JSON.parse(cached) as ShowcaseDog);
  } catch {
    /* no session storage: just fetch */
  }
  let dog: ShowcaseDog | null = null;
  try {
    const ward = await busiestWard();
    if (ward) {
      const list = await api.getWardDogs(ward);
      const named = (list.dogs ?? []).filter((d) => d.name && d.name.trim());
      const pick = named.find((d) => d.photoUrl) ?? named[0];
      if (pick) {
        const p = await api.getDog(pick.slug);
        const name = (p.name ?? pick.name ?? "").trim();
        if (name) {
          const w = wardDisplay(p.wardId);
          const place = p.wardName ?? w.name;
          const extra = p as { lastFedBy?: string | null; sex?: DogSex | null; avatarUrl?: string | null };
          dog = {
            name,
            wardLine: place ? `${w.code} ward · ${place}` : `${w.code} ward`,
            photoUrl: p.photoUrl ?? pick.photoUrl ?? extra.avatarUrl ?? null,
            vaccinated: p.vaccinated === "yes",
            sterilised: p.sterilised === "yes",
            fedLine: fedLine(p.lastFedAt, extra.lastFedBy, name, extra.sex, now),
          };
        }
      }
    }
  } catch {
    dog = null;
  }
  try {
    sessionStorage.setItem(SHOWCASE_KEY, dog ? JSON.stringify(dog) : "none");
  } catch {
    /* ignore */
  }
  return dog;
}
