/**
 * Me-screen display logic (design v4, screen 09), kept pure so it is
 * unit-testable without a DOM: greeting by hour, the four streak badges, the
 * trust bar, "fed today" pills and the unfed-first dog order.
 *
 * Calendar days are Asia/Kolkata throughout, the same boundary the API uses
 * for streaks (apps/api/src/lib/gamification.ts), so "Not fed today" and the
 * streak can never disagree about what "today" is.
 */
import type { AvatarPalette } from "@/components/ds";
import type { MyDog, StreakData, TrustLevel } from "./api";

export type { StreakData } from "./api";

const KOLKATA_TZ = "Asia/Kolkata";

/* ------------------------------------------------------------------ */
/* Greeting                                                           */
/* ------------------------------------------------------------------ */

export type Greeting = "Morning" | "Afternoon" | "Evening";

/** Local time of day: 05:00-11:59 Morning, 12:00-16:59 Afternoon, else Evening. */
export function greetingFor(now: Date): Greeting {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "Morning";
  if (h >= 12 && h < 17) return "Afternoon";
  return "Evening";
}

/** The server's placeholder name for an account nobody has named yet. */
const DEFAULT_DISPLAY_NAME = "Hetja Feeder";

/** "Priya Sharma" -> "Priya". Null for empty or the unnamed default. */
export function firstName(displayName: string | null | undefined): string | null {
  const name = (displayName ?? "").trim();
  if (!name || name === DEFAULT_DISPLAY_NAME) return null;
  return name.split(/\s+/)[0] ?? null;
}

/** "Morning, Priya." or "Morning." when there is no usable name. */
export function greetingLine(now: Date, displayName: string | null | undefined): string {
  const name = firstName(displayName);
  return name ? `${greetingFor(now)}, ${name}.` : `${greetingFor(now)}.`;
}

/* ------------------------------------------------------------------ */
/* Days                                                               */
/* ------------------------------------------------------------------ */

/** Calendar day (YYYY-MM-DD) of `d` in Asia/Kolkata. */
export function kolkataDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KOLKATA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09-01" -> "1 September". Null for anything unparseable. */
export function formatDayMonth(isoDate: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month}`;
}

/**
 * What the streak will read after one more feed today, mirroring the API's
 * computeStreak: already fed today keeps it, fed yesterday extends it, and
 * anything older (or nothing) starts a new 1-day run.
 */
export function streakAfterFeed(
  streakDays: number,
  lastFeedDate: string | null | undefined,
  today: string,
): number {
  if (!lastFeedDate) return 1;
  if (lastFeedDate === today) return Math.max(1, streakDays);
  if (addDays(lastFeedDate, 1) === today) return streakDays + 1;
  return 1;
}

/** The Log a feed caption. */
export function streakCaption(days: number): string {
  if (days <= 1) return "Starts your streak today.";
  return `Keeps your streak at ${days} days.`;
}

/* ------------------------------------------------------------------ */
/* Fed today                                                          */
/* ------------------------------------------------------------------ */

export function isFedToday(lastFedAt: string | null | undefined, now: Date): boolean {
  if (!lastFedAt) return false;
  const t = new Date(lastFedAt);
  if (Number.isNaN(t.getTime())) return false;
  return kolkataDay(t) === kolkataDay(now);
}

/** "Fed just now" / "Fed 12m ago" / "Fed 2h ago". Only meaningful for today. */
export function fedAgoLabel(lastFedAt: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(lastFedAt).getTime()) / 60_000));
  if (mins < 1) return "Fed just now";
  if (mins < 60) return `Fed ${mins}m ago`;
  return `Fed ${Math.floor(mins / 60)}h ago`;
}

/**
 * Dogs not fed today first (the ones that need someone), then the rest. The
 * sort is stable, so within each group the API's order (the feeder's own most
 * recent feed first) is kept.
 */
export function sortUnfedFirst<T extends Pick<MyDog, "lastFedAt">>(dogs: T[], now: Date): T[] {
  return dogs
    .map((dog, i) => ({ dog, i, fed: isFedToday(dog.lastFedAt, now) }))
    .sort((a, b) => Number(a.fed) - Number(b.fed) || a.i - b.i)
    .map((x) => x.dog);
}

/** A dog's display name; the API allows a nameless registration. */
export function dogName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n || "This dog";
}

/** The Me sticky button: "Scan to log Kaali's feed", or a generic one. */
export function nextFeedLabel(dog: Pick<MyDog, "name"> | null | undefined): string {
  const n = (dog?.name ?? "").trim();
  if (!dog) return "Scan to log a feed";
  if (!n) return "Scan to log this dog's feed";
  return `Scan to log ${n}${n.endsWith("s") ? "'" : "'s"} feed`;
}

/* ------------------------------------------------------------------ */
/* Badges                                                             */
/* ------------------------------------------------------------------ */

export interface BadgeSlot {
  /** API catalog name (apps/api/src/lib/gamification.ts BADGES). */
  key: "first_feed" | "week_streak" | "monsoon_hero" | "month_streak";
  mark: string;
  label: string;
  palette: AvatarPalette;
  locked: boolean;
  /** Visible line while locked, e.g. "5 days to go". */
  remaining?: string;
}

function daysToGo(target: number, streakDays: number): string {
  const n = Math.max(1, target - streakDays);
  return n === 1 ? "1 day to go" : `${n} days to go`;
}

/**
 * The four Me badges, in the mock's order. Earned is the API's word only
 * (feeders.badges); the streak count just phrases the locked line.
 * month_streak's threshold is 28 in the API catalog (the mock's "30" was
 * written before that), so its mark and label say 28.
 */
export function badgeSlots(earned: readonly string[], streakDays: number): BadgeSlot[] {
  const has = (k: string) => earned.includes(k);
  return [
    {
      key: "first_feed",
      mark: "1st",
      label: "First feed",
      palette: "apricot",
      locked: !has("first_feed"),
      remaining: "1 feed to go",
    },
    {
      key: "week_streak",
      mark: "7",
      label: "A full week",
      palette: "mint",
      locked: !has("week_streak"),
      remaining: daysToGo(7, streakDays),
    },
    {
      key: "monsoon_hero",
      mark: "M",
      label: "Monsoon feeder",
      palette: "sky",
      locked: !has("monsoon_hero"),
      remaining: "Jun to Sep",
    },
    {
      key: "month_streak",
      mark: "28",
      label: "28 days",
      palette: "rose",
      locked: !has("month_streak"),
      remaining: daysToGo(28, streakDays),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Trust                                                              */
/* ------------------------------------------------------------------ */

/** Client copy of the API's TRUST_LEVEL_THRESHOLDS, for payloads without trustLevel. */
const TRUST_LEVEL_THRESHOLDS = [40, 50, 60] as const;

export function trustLevelFor(score: number): TrustLevel {
  let level = 1;
  for (const t of TRUST_LEVEL_THRESHOLDS) if (score >= t) level += 1;
  return {
    name: level === 1 ? "New feeder" : "Trusted feeder",
    level,
    nextThreshold: TRUST_LEVEL_THRESHOLDS[level - 1] ?? null,
  };
}

export interface TrustView {
  label: string;
  target: string;
  value: number;
  valueText: string;
}

export function trustView(score: number, level?: TrustLevel | null): TrustView {
  const lv = level ?? trustLevelFor(score);
  const next = lv.nextThreshold;
  return {
    label: `${lv.name} · Level ${lv.level}`,
    target: next === null ? "Top level" : `Level ${lv.level + 1} at ${next}`,
    value: next === null ? 1 : Math.min(1, Math.max(0, score / next)),
    valueText: next === null ? `Trust score ${score}` : `Trust score ${score} of ${next}`,
  };
}

/* ------------------------------------------------------------------ */
/* Payload coercion                                                   */
/* ------------------------------------------------------------------ */

export interface SafeStreak {
  streakDays: number;
  badges: string[];
  trustScore: number;
  lastFeedDate: string | null;
  streakStart: string | null;
  trustLevel: TrustLevel | null;
}

/**
 * Tolerates a payload missing fields its type declares. For a while the API
 * sent neither `badges` nor `trustScore`, `data.badges.map` threw on every
 * render of /me (the page a feeder lands on right after signing in), and the
 * whole tree unmounted. A drifted payload should cost a number, not the page.
 */
export function safeStreak(data: Partial<StreakData> | null | undefined): SafeStreak {
  const streakDays = Math.max(0, Math.floor(Number(data?.streakDays) || 0));
  const trustScore = Number.isFinite(data?.trustScore) ? Number(data?.trustScore) : 0;
  const tl = data?.trustLevel;
  return {
    streakDays,
    badges: Array.isArray(data?.badges) ? data.badges.filter((b) => typeof b === "string") : [],
    trustScore,
    lastFeedDate: typeof data?.lastFeedDate === "string" ? data.lastFeedDate : null,
    streakStart: typeof data?.streakStart === "string" ? data.streakStart : null,
    trustLevel:
      tl && typeof tl.level === "number" && typeof tl.name === "string"
        ? { name: tl.name, level: tl.level, nextThreshold: tl.nextThreshold ?? null }
        : null,
  };
}

/**
 * The streak card's sub line. The second sentence is the mock's joke, told by
 * one of the feeder's own dogs when there is one.
 */
export function streakSubline(streak: SafeStreak, firstDogName: string | null | undefined): string {
  const who = (firstDogName ?? "").trim();
  const joke = who ? `${who} still says you missed Tuesday.` : "Your dogs still say you missed Tuesday.";
  if (streak.streakDays <= 0) return "No streak yet. Log a feed today to start one.";
  const since = formatDayMonth(streak.streakStart);
  if (!since) return joke;
  return `Fed someone every day since ${since}. ${joke}`;
}
