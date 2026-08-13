-- Hetja · migration 0011 — Web Push subscription storage (plan §3.2).
--
-- sos_notifications stays a delivery *record* (case_id, channel, sent_at,
-- delivered_at, acked_at, stood_down) -- it has no room for a subscriber's
-- push credentials and must not be repurposed to hold them. This table is
-- the credential store: one row per browser subscription, owned by exactly
-- one feeder, unique on endpoint (re-subscribing the same endpoint -- e.g.
-- after a token refresh on the same device -- updates the row in place
-- rather than duplicating it; see apps/api/src/routes/push.ts's upsert).

CREATE TABLE push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id  UUID NOT NULL REFERENCES feeders(id),
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);
CREATE INDEX push_subscriptions_feeder_ix ON push_subscriptions (feeder_id);
