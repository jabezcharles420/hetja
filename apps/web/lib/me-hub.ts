/**
 * Me (design v6 V7, V8, V9): the last good /me response kept on the phone,
 * the day-one checklist, and the Alerts row's unread count.
 */
import type { Alert, FeederMe, MyDog, StreakData } from "@/lib/api";
import { kolkataDay } from "@/lib/streak";

export const ME_CACHE_KEY = "hetja:me-cache";
export const ALERTS_SEEN_KEY = "hetja:alerts-seen-at";

export interface MeSnapshot {
  savedAt: string;
  streak: Partial<StreakData>;
  me: FeederMe;
  dogs: MyDog[];
}

/** V9: feeders log feeds with a weak signal, so the last copy beats an error page. */
export function saveMeSnapshot(s: Omit<MeSnapshot, "savedAt">, now: Date = new Date()): void {
  try {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ ...s, savedAt: now.toISOString() }));
  } catch {
    /* storage full or blocked: the page still works, just without a fallback */
  }
}

export function readMeSnapshot(): MeSnapshot | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<MeSnapshot>;
    if (!v || typeof v.savedAt !== "string" || !v.me || typeof v.me !== "object") return null;
    return { savedAt: v.savedAt, streak: v.streak ?? {}, me: v.me, dogs: Array.isArray(v.dogs) ? v.dogs : [] };
  } catch {
    return null;
  }
}

export function clearMeSnapshot(): void {
  try {
    localStorage.removeItem(ME_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** "this morning's", "this afternoon's", "this evening's", "yesterday's", "an older". */
export function staleCopyLabel(savedAtIso: string, now: Date = new Date()): string {
  const saved = new Date(savedAtIso);
  if (Number.isNaN(saved.getTime())) return "an older";
  const day = kolkataDay(saved);
  if (day === kolkataDay(now)) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(saved),
    );
    return hour < 12 ? "this morning's" : hour < 17 ? "this afternoon's" : "this evening's";
  }
  if (day === kolkataDay(new Date(now.getTime() - 86_400_000))) return "yesterday's";
  return "an older";
}

/** V9 "Fed 7:10 am" / "Fed yesterday" / "Fed 3 days ago" / "Not fed yet". */
export function fedWhenLabel(lastFedAt: string | null | undefined, now: Date = new Date()): string {
  if (!lastFedAt) return "Not fed yet";
  const t = new Date(lastFedAt);
  if (Number.isNaN(t.getTime())) return "Not fed yet";
  if (kolkataDay(t) === kolkataDay(now)) {
    const clock = new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    })
      .format(t)
      .replace(/\s?([ap])\.?m\.?/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
    return `Fed ${clock}`;
  }
  if (kolkataDay(t) === kolkataDay(new Date(now.getTime() - 86_400_000))) return "Fed yesterday";
  const days = Math.max(2, Math.round((now.getTime() - t.getTime()) / 86_400_000));
  return `Fed ${days} days ago`;
}

export interface DayOneStep {
  key: "signin" | "scan" | "feed" | "wards";
  title: string;
  sub: string | null;
  href: string | null;
  done: boolean;
}

/**
 * V8: a new feeder needs a first step, not an empty dashboard. The checklist
 * disappears once all four are done, and the streak card takes its place.
 */
export function dayOneSteps(input: { me: FeederMe; dogs: MyDog[]; streakDays: number }): DayOneStep[] {
  const fed = input.streakDays > 0 || input.dogs.some((d) => !!d.myLastFedAt);
  return [
    { key: "signin", title: "Sign in", sub: null, href: null, done: true },
    {
      key: "scan",
      title: "Scan a dog you feed",
      sub: "You'll be listed as one of their feeders",
      href: "/scan",
      done: input.dogs.length > 0,
    },
    { key: "feed", title: "Log their first feed", sub: "Starts your streak", href: "/scan?intent=feed", done: fed },
    {
      key: "wards",
      title: "Pick your wards",
      sub: "For SOS alerts nearby",
      href: "/settings",
      done: Array.isArray(input.me.wards) && input.me.wards.length > 0,
    },
  ];
}

export function readAlertsSeenAt(): number {
  try {
    const v = Number(localStorage.getItem(ALERTS_SEEN_KEY) ?? "0");
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function markAlertsSeen(now: Date = new Date()): void {
  try {
    localStorage.setItem(ALERTS_SEEN_KEY, String(now.getTime()));
  } catch {
    /* ignore */
  }
}

/** Alerts newer than the last visit to /alerts. */
export function unreadCount(items: readonly Alert[], seenAt: number): number {
  return items.filter((a) => {
    const t = Date.parse(a.at);
    return Number.isFinite(t) && t > seenAt;
  }).length;
}
