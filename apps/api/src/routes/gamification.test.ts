/**
 * Gamification route tests (feeder quests / streaks / badges).
 *
 * 1. consecutive feed days extend the streak (+1 per day, same-day no-op)
 * 2. a missed day resets the streak (dead run reports 0; next feed = 1)
 * 3. badge grants are idempotent — never double-awarded
 * 4. week_streak is awarded at exactly 7 days (and not on a dead run)
 * 5. night_owl only inside the 22:00-05:00 (Asia/Kolkata) window
 * 6. anonymous (device-token) scans never touch the streak
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { query, generateSlug } from "@straynet/db";
import { signAccessToken } from "../lib/jwt.js";
import { issueDeviceToken } from "../lib/device.js";
import { addDays, dateInKolkata } from "../lib/gamification.js";

const config = loadConfig();
// Slugs come from the real generator in @straynet/db, not a local alphabet.
// Eight test files each kept their own copy reading
// "abcdefghijklmnopqrstuvwxyz234567" -- which includes the confusable `l` that
// the generator never emits, and excludes 8/9 which it does. Those fixtures
// produced slugs that cannot exist, so once slug validation was corrected about
// one run in four failed on a random `l`. Using the generator keeps the tests
// honest and removes the ninth copy of this alphabet.
function randomSlug(): string {
  return generateSlug();
}

interface Fixture {
  app: FastifyInstance;
  feederId: string;
  dogId: string;
  dogSlug: string;
}

async function insertFeeder(
  streakDays = 0,
  lastFeedDate: string | null = null,
  badges: string[] = [],
): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO feeders (phone_hmac, display_name, role, trust_score, consent_version, streak_days, last_feed_date, badges)
     VALUES ($1, 'GamTest', 'feeder', 30, 'v1.0', $2, $3, $4)
     RETURNING id`,
    [`gam-test-${randomUUID()}`, streakDays, lastFeedDate, badges],
  );
  return res.rows[0].id;
}

async function insertDog(): Promise<{ id: string; slug: string }> {
  const slug = randomSlug();
  const res = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id) VALUES ($1, 'GamTestDog', 'G/North') RETURNING id`,
    [slug],
  );
  return { id: res.rows[0].id, slug };
}

async function insertFeedScan(
  feederId: string,
  dogId: string,
  capturedAtIso: string,
  reviewStatus = "pending",
): Promise<void> {
  await query(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, feeder_id, captured_at, received_at, review_status)
     VALUES ($1, $2, 'feed', $3, $4, now(), $5)`,
    [dogId, randomUUID(), feederId, capturedAtIso, reviewStatus],
  );
}

async function setStreakState(feederId: string, streakDays: number, lastFeedDate: string): Promise<void> {
  await query(`UPDATE feeders SET streak_days = $2, last_feed_date = $3 WHERE id = $1`, [
    feederId,
    streakDays,
    lastFeedDate,
  ]);
}

async function readStreakState(feederId: string): Promise<{ streak_days: number; last_feed_date: string | null; badges: string[] }> {
  const res = await query<{ streak_days: number; last_feed_date: string | null; badges: string[] }>(
    `SELECT streak_days, last_feed_date::text AS last_feed_date, badges FROM feeders WHERE id = $1`,
    [feederId],
  );
  return res.rows[0];
}

async function cleanup(fixture: Fixture): Promise<void> {
  await query(`DELETE FROM trust_events WHERE feeder_id = $1`, [fixture.feederId]);
  await query(`DELETE FROM scans WHERE dog_id = $1`, [fixture.dogId]);
  await query(`DELETE FROM dogs WHERE id = $1`, [fixture.dogId]);
  await query(`DELETE FROM feeders WHERE id = $1`, [fixture.feederId]);
}

function bearerToken(feederId: string): string {
  return `Bearer ${signAccessToken(feederId, config.JWT_SECRET, config.JWT_ACCESS_TTL)}`;
}

function postFeed(fixture: Fixture) {
  return fixture.app.inject({
    method: "POST",
    url: "/api/v1/scans",
    headers: { authorization: bearerToken(fixture.feederId) },
    payload: { clientUuid: randomUUID(), dogSlug: fixture.dogSlug, type: "feed", capturedAt: new Date().toISOString() },
  });
}

function getStreak(fixture: Fixture) {
  return fixture.app.inject({
    method: "GET",
    url: "/api/v1/feeders/me/streak",
    headers: { authorization: bearerToken(fixture.feederId) },
  });
}

function checkBadges(fixture: Fixture) {
  return fixture.app.inject({
    method: "POST",
    url: "/api/v1/feeders/me/badges/check",
    headers: { authorization: bearerToken(fixture.feederId) },
    payload: {},
  });
}

let fixture: Fixture;

beforeEach(async () => {
  const dog = await insertDog();
  fixture = {
    app: buildServer(config),
    feederId: await insertFeeder(),
    dogId: dog.id,
    dogSlug: dog.slug,
  };
  await fixture.app.ready();
});

afterEach(async () => {
  await cleanup(fixture);
  await fixture.app.close();
});

describe("streak — consecutive feed days", () => {
  it("extends the streak by 1 on consecutive days and is a same-day no-op", async () => {
    const today = dateInKolkata(new Date());
    const yesterday = addDays(today, -1);

    await setStreakState(fixture.feederId, 1, yesterday);

    const first = await postFeed(fixture);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.created).toBe(true);

    let state = await readStreakState(fixture.feederId);
    expect(state.streak_days).toBe(2);
    expect(state.last_feed_date).toBe(today);

    const sameDay = await postFeed(fixture);
    expect(sameDay.statusCode).toBe(200);
    expect(sameDay.json().data.created).toBe(true);

    state = await readStreakState(fixture.feederId);
    expect(state.streak_days).toBe(2);
    expect(state.last_feed_date).toBe(today);
  });

  it("starts a streak at 1 on the first feed", async () => {
    const res = await postFeed(fixture);
    expect(res.statusCode).toBe(200);

    const state = await readStreakState(fixture.feederId);
    expect(state.streak_days).toBe(1);
    expect(state.last_feed_date).toBe(dateInKolkata(new Date()));
  });
});

describe("streak — a missed day resets it", () => {
  it("reports a dead run as 0 and resets to 1 on the next feed", async () => {
    const today = dateInKolkata(new Date());
    await setStreakState(fixture.feederId, 5, addDays(today, -3));

    const dead = await getStreak(fixture);
    expect(dead.statusCode).toBe(200);
    expect(dead.json().data.streakDays).toBe(0);
    expect(dead.json().data.lastFeedDate).toBe(addDays(today, -3));

    const res = await postFeed(fixture);
    expect(res.statusCode).toBe(200);

    const state = await readStreakState(fixture.feederId);
    expect(state.streak_days).toBe(1);
    expect(state.last_feed_date).toBe(today);
  });
});

describe("streak — anti-abuse", () => {
  it("does not touch the streak for anonymous (device-token) feed scans", async () => {
    const res = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { "x-device-token": issueDeviceToken(config.STRAYNET_DEVICE_SECRET) },
      payload: {
        clientUuid: randomUUID(),
        dogSlug: fixture.dogSlug,
        type: "feed",
        capturedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.created).toBe(true);

    const state = await readStreakState(fixture.feederId);
    expect(state.streak_days).toBe(0);
    expect(state.last_feed_date).toBeNull();
  });

  it("requires feeder auth on both endpoints", async () => {
    const streak = await fixture.app.inject({ method: "GET", url: "/api/v1/feeders/me/streak" });
    expect(streak.statusCode).toBe(401);

    const badges = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/feeders/me/badges/check",
      payload: {},
    });
    expect(badges.statusCode).toBe(401);
  });
});

describe("badges — idempotent grants", () => {
  it("awards first_feed exactly once across repeated checks", async () => {
    // deterministic: daytime in October (outside night/monsoon windows)
    await insertFeedScan(fixture.feederId, fixture.dogId, "2026-10-15T06:30:00.000Z", "auto_passed");

    const first = await checkBadges(fixture);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.awarded).toContain("first_feed");

    const second = await checkBadges(fixture);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.awarded).not.toContain("first_feed");

    const state = await readStreakState(fixture.feederId);
    expect(state.badges.filter((b) => b === "first_feed")).toHaveLength(1);
  });
});

describe("badges — week_streak", () => {
  it("awards week_streak at exactly 7 days", async () => {
    await setStreakState(fixture.feederId, 7, dateInKolkata(new Date()));
    const res = await checkBadges(fixture);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.awarded).toContain("week_streak");

    const state = await readStreakState(fixture.feederId);
    expect(state.badges).toContain("week_streak");
  });

  it("does not award week_streak on a dead run", async () => {
    await setStreakState(fixture.feederId, 7, addDays(dateInKolkata(new Date()), -2));
    const res = await checkBadges(fixture);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.awarded).not.toContain("week_streak");
  });
});

describe("badges — night_owl window", () => {
  it("awards night_owl for a feed at 23:00 Asia/Kolkata", async () => {
    // 23:00 IST = 17:30Z
    await insertFeedScan(fixture.feederId, fixture.dogId, "2026-07-15T17:30:00.000Z");
    const res = await checkBadges(fixture);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.awarded).toContain("night_owl");
  });

  it("does not award night_owl outside the window", async () => {
    // 12:00 IST = 06:30Z, October (no monsoon either)
    await insertFeedScan(fixture.feederId, fixture.dogId, "2026-10-15T06:30:00.000Z");
    const res = await checkBadges(fixture);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.awarded).not.toContain("night_owl");
    expect(res.json().data.awarded).not.toContain("monsoon_hero");
  });
});

describe("GET /feeders/me/streak payload", () => {
  it("reports a fresh feeder with 0 streak and a badge hint", async () => {
    const res = await getStreak(fixture);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.streakDays).toBe(0);
    expect(res.json().data.lastFeedDate).toBeNull();
    expect(res.json().data.nextBadgeHint).not.toBeNull();
    expect(res.json().data.nextBadgeHint.name).toBe("first_feed");
  });
});
