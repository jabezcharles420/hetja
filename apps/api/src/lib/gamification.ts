/**
 * Hetja GAMIFICATION (feeder quests / streaks / badges).
 *
 * Ships AFTER the trust engine / anti-abuse. Streaks and badges are DERIVED
 * from scans — there is no direct way for a client to grant itself a streak
 * or a badge except through an actual feed scan (deduped by client_uuid).
 *
 * STREAK rule: a 'feed' scan on day D extends the streak iff there was a feed
 * scan on day D-1 (consecutive days). A missed day (>1 day gap) resets the
 * streak to 0 — there is NO retroactive recovery. Multiple feed scans on the
 * same day are a no-op for the streak. The transition is a pure function of
 * {lastFeedDate, today} so the scans hook and the endpoints agree exactly.
 *
 * BADGES catalog (name, condition, description):
 *   first_feed     — 1 verified feed
 *   week_streak    — 7 consecutive feed days
 *   month_streak   — 28 consecutive feed days
 *   guardian_100   — 100 verified feeds
 *   night_owl      — a feed between 22:00 and 05:00 (Asia/Kolkata)
 *   monsoon_hero   — a feed during the Jun–Sep monsoon (Asia/Kolkata)
 * Badge grants are idempotent: a badge is only INSERTed into feeders.badges
 * when it is NOT already present (checked in JS and guarded in SQL).
 *
 * All day/month/hour boundaries use Asia/Kolkata (the platform is Mumbai).
 */
import { query } from "@hetja/db";

const KOLKATA_TZ = "Asia/Kolkata";

/** Calendar day (YYYY-MM-DD) of `d` in Asia/Kolkata. */
export function dateInKolkata(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KOLKATA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Pure day arithmetic on an ISO date (YYYY-MM-DD). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (to - from). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Structural view of the pg client so helpers avoid importing `pg`. */
export interface TxClient {
  query<T = any>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

async function gamQuery<T = any>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const res = await query(text, params);
  return res as unknown as { rows: T[]; rowCount: number | null };
}

const gamDb: TxClient = { query: gamQuery };

export class GamificationError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "GamificationError";
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Streak                                                             */
/* ------------------------------------------------------------------ */

export interface StreakState {
  streakDays: number;
  lastFeedDate: string | null;
}

/**
 * Deterministic streak transition given {lastFeedDate, today} (YYYY-MM-DD).
 * - same day already fed → no-op (idempotent, never double-increments)
 * - feed on the day after lastFeedDate → streak + 1
 * - first feed ever, or a gap > 1 day → reset; today starts a 1-day streak
 */
export function computeStreak(state: StreakState, today: string): StreakState {
  if (state.lastFeedDate === today) return state;
  if (state.lastFeedDate !== null && daysBetween(state.lastFeedDate, today) === 1) {
    return { streakDays: state.streakDays + 1, lastFeedDate: today };
  }
  return { streakDays: 1, lastFeedDate: today };
}

/**
 * The CURRENT streak as of `today`. A run whose last feed was more than one
 * day ago is dead: it resets to 0 (a missed day breaks the streak even before
 * the next feed arrives).
 */
export function currentStreak(state: StreakState, today: string): number {
  if (state.lastFeedDate === null) return 0;
  return daysBetween(state.lastFeedDate, today) <= 1 ? state.streakDays : 0;
}

/* ------------------------------------------------------------------ */
/* Badges                                                             */
/* ------------------------------------------------------------------ */

export interface BadgeContext {
  streakDays: number;
  verifiedFeeds: number;
  hasNightOwlFeed: boolean;
  hasMonsoonFeed: boolean;
}

export interface BadgeDef {
  name: string;
  description: string;
  condition: (ctx: BadgeContext) => boolean;
  current: (ctx: BadgeContext) => number;
  target: number;
}

export const BADGES: readonly BadgeDef[] = [
  {
    name: "first_feed",
    description: "Logged your first verified feed",
    condition: (ctx) => ctx.verifiedFeeds >= 1,
    current: (ctx) => ctx.verifiedFeeds,
    target: 1,
  },
  {
    name: "week_streak",
    description: "Fed 7 days in a row",
    condition: (ctx) => ctx.streakDays >= 7,
    current: (ctx) => ctx.streakDays,
    target: 7,
  },
  {
    name: "month_streak",
    description: "Fed 28 days in a row",
    condition: (ctx) => ctx.streakDays >= 28,
    current: (ctx) => ctx.streakDays,
    target: 28,
  },
  {
    name: "guardian_100",
    description: "100 verified feeds logged",
    condition: (ctx) => ctx.verifiedFeeds >= 100,
    current: (ctx) => ctx.verifiedFeeds,
    target: 100,
  },
  {
    name: "night_owl",
    description: "Fed between 22:00 and 05:00",
    condition: (ctx) => ctx.hasNightOwlFeed,
    current: (ctx) => (ctx.hasNightOwlFeed ? 1 : 0),
    target: 1,
  },
  {
    name: "monsoon_hero",
    description: "Fed during the Jun–Sep monsoon",
    condition: (ctx) => ctx.hasMonsoonFeed,
    current: (ctx) => (ctx.hasMonsoonFeed ? 1 : 0),
    target: 1,
  },
];

export interface FeederGamificationRow {
  streak_days: number;
  last_feed_date: string | null;
  badges: string[];
}

const GAM_COLUMNS = `streak_days, last_feed_date::text AS last_feed_date, badges`;

export async function getFeederGamification(
  feederId: string,
  client?: TxClient,
): Promise<FeederGamificationRow> {
  const c = client ?? gamDb;
  const res = await c.query<FeederGamificationRow>(
    `SELECT ${GAM_COLUMNS} FROM feeders WHERE id = $1`,
    [feederId],
  );
  if (res.rowCount === 0) throw new GamificationError("feeder not found", "FEEDER_NOT_FOUND", 404);
  return res.rows[0];
}

/**
 * STREAKS UPDATE HOOK — called from the scans flow (same transaction as the
 * scan insert) after a successful feed scan by an authenticated feeder. Reads
 * the feeder row under a row lock and persists the deterministic next state.
 */
export async function updateFeedStreak(
  feederId: string,
  today: string,
  client?: TxClient,
): Promise<StreakState> {
  const c = client ?? gamDb;
  const res = await c.query<FeederGamificationRow>(
    `SELECT ${GAM_COLUMNS} FROM feeders WHERE id = $1 FOR UPDATE`,
    [feederId],
  );
  if (res.rowCount === 0) throw new GamificationError("feeder not found", "FEEDER_NOT_FOUND", 404);
  const row = res.rows[0];
  const next = computeStreak({ streakDays: row.streak_days, lastFeedDate: row.last_feed_date }, today);
  await c.query(`UPDATE feeders SET streak_days = $2, last_feed_date = $3 WHERE id = $1`, [
    feederId,
    next.streakDays,
    next.lastFeedDate,
  ]);
  return next;
}

const VERIFIED_REVIEW_STATUSES = ["auto_passed", "human_passed"];

/** Build the badge context from server-recorded state (scans table). */
export async function buildBadgeContext(
  feederId: string,
  streakDays: number,
  client: TxClient,
): Promise<BadgeContext> {
  const stats = await client.query<{
    verified: string | number;
    night: boolean | null;
    monsoon: boolean | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE review_status = ANY($2::review_status[])) AS verified,
       bool_or(EXTRACT(HOUR FROM captured_at AT TIME ZONE 'Asia/Kolkata') >= 22
            OR EXTRACT(HOUR FROM captured_at AT TIME ZONE 'Asia/Kolkata') < 5) AS night,
       bool_or(EXTRACT(MONTH FROM captured_at AT TIME ZONE 'Asia/Kolkata') BETWEEN 6 AND 9) AS monsoon
     FROM scans
     WHERE feeder_id = $1 AND scan_type = 'feed'`,
    [feederId, VERIFIED_REVIEW_STATUSES],
  );
  return {
    streakDays,
    verifiedFeeds: Number(stats.rows[0].verified ?? 0),
    hasNightOwlFeed: stats.rows[0].night === true,
    hasMonsoonFeed: stats.rows[0].monsoon === true,
  };
}

export interface BadgeEvalResult {
  awarded: string[];
  earned: string[];
}

/**
 * Evaluate the catalog against the feeder's current state and grant any newly
 * earned badges (INSERT into feeders.badges). Idempotent: a badge already in
 * badges[] is never granted again (JS check + SQL `NOT ($2 = ANY(badges))`
 * guard). Returns the newly awarded badge names.
 */
export async function evaluateBadges(feederId: string, client?: TxClient): Promise<BadgeEvalResult> {
  const c = client ?? gamDb;
  const row = await getFeederGamification(feederId, c);
  const today = dateInKolkata(new Date());
  const streak = currentStreak({ streakDays: row.streak_days, lastFeedDate: row.last_feed_date }, today);
  const ctx = await buildBadgeContext(feederId, streak, c);

  const earned = BADGES.filter((b) => b.condition(ctx)).map((b) => b.name);
  const awarded: string[] = [];
  for (const name of earned) {
    if (row.badges.includes(name)) continue;
    await c.query(
      `UPDATE feeders SET badges = array_append(badges, $2) WHERE id = $1 AND NOT ($2 = ANY(badges))`,
      [feederId, name],
    );
    awarded.push(name);
  }
  return { awarded, earned };
}

export interface BadgeHint {
  name: string;
  description: string;
  current: number;
  target: number;
}

/** The unearned badge the feeder is closest to (highest progress). */
export function nextBadgeHint(owned: string[], ctx: BadgeContext): BadgeHint | null {
  let best: BadgeDef | null = null;
  let bestProgress = -1;
  for (const badge of BADGES) {
    if (owned.includes(badge.name)) continue;
    if (badge.condition(ctx)) continue;
    const current = Math.min(badge.current(ctx), badge.target);
    const progress = badge.target === 0 ? 0 : current / badge.target;
    if (progress > bestProgress) {
      bestProgress = progress;
      best = badge;
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    description: best.description,
    current: best.current(ctx),
    target: best.target,
  };
}

export interface StreakView {
  streakDays: number;
  lastFeedDate: string | null;
  nextBadgeHint: BadgeHint | null;
}

/** GET /feeders/me/streak payload: current streak + last feed + hint. */
export async function getStreakView(feederId: string): Promise<StreakView> {
  const row = await getFeederGamification(feederId);
  const today = dateInKolkata(new Date());
  const ctx = await buildBadgeContext(feederId, currentStreak({ streakDays: row.streak_days, lastFeedDate: row.last_feed_date }, today), gamDb);
  return {
    streakDays: currentStreak({ streakDays: row.streak_days, lastFeedDate: row.last_feed_date }, today),
    lastFeedDate: row.last_feed_date,
    nextBadgeHint: nextBadgeHint(row.badges, ctx),
  };
}
