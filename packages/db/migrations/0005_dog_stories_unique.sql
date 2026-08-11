-- StrayNet · migration 0005_dog_stories_unique
-- Concurrency-safe micro-story versioning: a dog may have exactly one story
-- per version (count+1 is computed under a per-dog row lock, and this unique
-- index is the backstop against racing writers). The partial index keeps the
-- admin moderation queue (moderated_at IS NULL, oldest first) fast.
CREATE UNIQUE INDEX dog_stories_dog_version_uix ON dog_stories (dog_id, version);
CREATE INDEX dog_stories_moderation_ix ON dog_stories (created_at, version)
  WHERE moderated_at IS NULL;
