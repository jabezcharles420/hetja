/**
 * Streak + badge display mapping — kept pure so it is unit-testable without a
 * DOM and shared between the `/me` page and the StreakBadge component.
 */

export type StreakLevel = "none" | "warm" | "week" | "fortnight" | "champion";

export interface StreakData {
  trustScore: number;
  streakDays: number;
  badges: string[];
}

export interface StreakBadgeView {
  key: string;
  label: string;
}

export interface StreakDisplay {
  streakDays: number;
  streakLevel: StreakLevel;
  streakLabel: string;
  trustScore: number;
  trustLabel: string;
  badges: StreakBadgeView[];
  nextMilestone: string | null;
}

export const BADGE_LABELS: Record<string, string> = {
  first_feed: "First Feed",
  streak_3: "3-Day Streak",
  streak_7: "Week Streak",
  streak_30: "Monthly Streak",
  sos_hero: "SOS Hero",
  vet_verified: "Vet Verified",
  night_feeder: "Night Feeder",
};

export function badgeLabel(key: string): string {
  const known = BADGE_LABELS[key];
  if (known) return known;
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function streakLevelFor(days: number): StreakLevel {
  if (days <= 0) return "none";
  if (days < 7) return "warm";
  if (days < 14) return "week";
  if (days < 30) return "fortnight";
  return "champion";
}

export function streakLabelFor(days: number): string {
  if (days <= 0) return "Start a streak — log a feed today";
  if (days === 1) return "1 day streak — keep it alive";
  if (days < 7) return `${days}-day streak — almost a week`;
  if (days < 14) return `${days}-day streak — a full week!`;
  if (days < 30) return `${days}-day streak — fortnight strong`;
  return `${days}-day streak — champion feeder`;
}

export function trustLabelFor(score: number): string {
  if (score >= 80) return "Trusted regular";
  if (score >= 60) return "Reliable feeder";
  if (score >= 40) return "Active feeder";
  if (score >= 20) return "New feeder";
  return "Getting started";
}

export function nextMilestoneFor(days: number): string | null {
  if (days < 7) return `${7 - days} days to a week streak`;
  if (days < 14) return `${14 - days} days to a fortnight`;
  if (days < 30) return `${30 - days} days to champion`;
  return null;
}

/**
 * Tolerates a server payload that is missing fields this type declares.
 *
 * `StreakData` says `badges` and `trustScore` are required, and for a while the
 * API did not send either. `data.badges.map(...)` then threw on every render of
 * /me — the page a feeder is redirected to the instant they sign in — and with
 * no error boundary in the app the whole tree unmounted to Next.js's bare
 * "Application error: a client-side exception has occurred". A successful login
 * followed by a blank error page, for every user.
 *
 * The API now sends both. This coercion exists so that the NEXT time a payload
 * drifts, a feeder loses a number on a page instead of losing the page — a
 * missing badge list is a display gap, not a reason to destroy the session's
 * only screen. It is deliberately not a schema validation: the goal is to
 * degrade, not to be strict.
 */
export function mapStreak(data: StreakData): StreakDisplay {
  const days = Math.max(0, Math.floor(Number(data?.streakDays) || 0));
  const badges = Array.isArray(data?.badges) ? data.badges : [];
  const trustScore = Number.isFinite(data?.trustScore) ? data.trustScore : 0;
  return {
    streakDays: days,
    streakLevel: streakLevelFor(days),
    streakLabel: streakLabelFor(days),
    trustScore,
    trustLabel: trustLabelFor(trustScore),
    badges: badges.map((key) => ({ key, label: badgeLabel(key) })),
    nextMilestone: nextMilestoneFor(days),
  };
}
