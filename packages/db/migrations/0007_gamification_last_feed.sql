-- 0007_gamification_last_feed.sql
-- Gamification (feeder quests / streaks / badges): feeders.last_feed_date
-- records the calendar day (Asia/Kolkata) of the most recent feed scan so the
-- consecutive-day streak rule is deterministic given {lastFeedDate, today}.
-- streak_days (INT) and badges (TEXT[]) already exist from 0001_init.
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS last_feed_date DATE;
