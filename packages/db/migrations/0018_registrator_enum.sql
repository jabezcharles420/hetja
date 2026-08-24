-- Hetja · migration 0018_registrator_enum
-- Adds the three enum values the self-serve registration flow (wave 6) needs:
--
--   dog_status  'pending_activation'  a registration nobody has physically
--                                     scanned yet — inert by construction
--   dog_status  'expired'             a pending registration whose print window
--                                     closed without ever being attached
--   feeder_role 'registrator'         the self-elected role (see the capability
--                                     map in apps/api/src/lib/require-role.ts,
--                                     which already names this value)
--
-- WHY THIS IS ITS OWN FILE, AND WHY THAT IS NOT NEGOTIABLE.
-- packages/db/src/migrate.ts runs each migration file inside ONE transaction
-- (withTx). PostgreSQL permits `ALTER TYPE ... ADD VALUE` inside a transaction
-- block (since 12), but it forbids USING the new value in that same
-- transaction:
--
--     ERROR: unsafe use of new value "pending_activation" of enum type dog_status
--     HINT:  New enum values must be committed before they can be used.
--
-- So any statement that names one of these values — an index predicate like
-- `WHERE status = 'pending_activation'`, a DEFAULT, an UPDATE, even the
-- backfill in 0019 — fails to apply if it shares a file with the ALTER TYPE.
-- The failure would happen at APPLY time, on the box, mid-deploy, AFTER the
-- API code that speaks the new values has already shipped (deploy order in
-- AGENTS.md §g builds api+worker on the box before migrations run), and an
-- applied migration stays applied through a rollback — so the deploy would sit
-- broken with no clean way back. Splitting is the fix: this file commits the
-- enum values; 0019_registration_lifecycle.sql, in its own transaction, is
-- then free to name them.
--
-- Both statements are IF NOT EXISTS, so re-applying after a partial failure is
-- a no-op rather than a duplicate-value error.

ALTER TYPE dog_status  ADD VALUE IF NOT EXISTS 'pending_activation';
ALTER TYPE dog_status  ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE feeder_role ADD VALUE IF NOT EXISTS 'registrator';
