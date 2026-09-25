-- Hetja · migration 0028_sos_notify_only
--
-- sos_notifications.notify_only (pre-deploy review of design v6). The dog's
-- OWN feeders (its registrator and anyone with a feed in the last 60 days) are
-- told about every SOS on their dog, whatever their trust, so "Priya and Arjun
-- know" is true. Being told is not being a responder: a row with notify_only
-- is a push and an Alerts entry, counted as told, and it is NOT a ground to
-- take the case (routes/sos.ts ack, lib/sos-eligibility.ts mayAck `notified`),
-- is not re-paged after a release, and cannot delay or stop escalation. Taking
-- the case still needs the trust floor.
--
-- ADDITIVE ONLY: a constant default (catalog-only since PostgreSQL 11). Every
-- existing row is a responder page, which FALSE says.

ALTER TABLE sos_notifications ADD COLUMN IF NOT EXISTS notify_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sos_notifications.notify_only IS
  'Told, not paged as a responder: the dog''s own feeder below the trust floor. '
  'Never a ground to take the case; never re-paged; never delays escalation.';
