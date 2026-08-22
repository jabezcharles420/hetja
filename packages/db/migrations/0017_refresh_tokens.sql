-- Give the refresh token a store, so rotation can be one-time-use and reuse
-- detectable.
--
-- THE GAP THIS CLOSES. `signRefreshToken` has been minted at every login since
-- the JWT lib landed, and `verifyRefreshToken` could check any token handed
-- back — but no route consumed a refresh token and nothing recorded issuance.
-- The header of lib/jwt.ts claims "rotation is achieved by minting a fresh
-- `jti`"; that described a mechanism with no consumer. There was no jti store,
-- so nothing could detect a replayed token and nothing could revoke a session
-- short of rotating JWT_SECRET (which logs out every feeder in the city at
-- once). A 30-day bearer token sitting in localStorage that cannot be revoked
-- is materially worse than no refresh token at all — and the registrator flow
-- this wave precedes ("fill a form, print a sheet, walk outside, scan a tag")
-- is exactly the multi-step flow that silently 401s when the 15-minute access
-- token dies mid-form with no way to renew it.
--
-- WHY A ROW PER ISSUANCE, NOT A TOKEN ALLOWLIST IN ANOTHER FORMAT. The row
-- stores only the jti (a random UUID), never the token itself: possession of
-- the database must not equal possession of live credentials, the same
-- reasoning that keeps OTPs hashed (lib/otp.ts) and contact info HMAC'd
-- (INVARIANT 3). `feeder_id` carries ON DELETE CASCADE because INVARIANT 11
-- requires a DPDP erasure to be able to delete the `feeders` row — a session
-- record is metadata about an account and must not outlive the account it
-- authenticates.
--
-- One-time use is enforced by routes/auth.ts as a conditional UPDATE on
-- used_at/revoked_at inside a transaction; two concurrent presentations of the
-- same token cannot both win, and the loser takes the reuse path (family-wide
-- revocation, 401 REFRESH_REUSED). The columns exist to make that UPDATE
-- expressible and auditable after the fact.
--
-- Additive: one new table, two indexes, column comments. Nothing existing is
-- dropped or rewritten.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti         UUID PRIMARY KEY,
  feeder_id   UUID NOT NULL REFERENCES feeders(id) ON DELETE CASCADE,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  replaced_by UUID,
  revoked_at  TIMESTAMPTZ
);

COMMENT ON COLUMN refresh_tokens.jti IS
  'The JWT ID of the refresh token this row tracks. Minted fresh on every '
  'issuance; the token itself is never stored here. One-time use means this '
  'jti can win the UPDATE in routes/auth.ts exactly once.';
COMMENT ON COLUMN refresh_tokens.used_at IS
  'Set when the token was PRESENTED to /auth/refresh and accepted. A '
  'presentation against a row where used_at IS NOT NULL is a replay of an '
  'already-rotated token and triggers family-wide revocation.';
COMMENT ON COLUMN refresh_tokens.replaced_by IS
  'Reuse-detection rule: the jti of the refresh token issued in exchange for '
  'this one, forming a chain a row per hop. On ANY presentation whose jti has '
  'used_at already set (or revoked_at set, or no row at all), the route treats '
  'the presented token as stolen and sets revoked_at = now() on EVERY live '
  '(unused, unrevoked) row for that feeder, returning 401 REFRESH_REUSED. This '
  'is fail-closed on purpose: it may log out a legitimate concurrent session, '
  'but the alternative is leaving the attacker''s copy of the token working for '
  'the rest of its 30-day life.';
COMMENT ON COLUMN refresh_tokens.revoked_at IS
  'Set by the reuse-detection path above, or by any future explicit '
  'logout/revoke. A revoked row can never win the exchange UPDATE again.';

-- The exchange UPDATE filters on feeder_id + unused + unrevoked, and the
-- revocation sweep updates every live row for one feeder: both shapes are
-- served by a partial index whose predicate agrees.
CREATE INDEX IF NOT EXISTS refresh_tokens_feeder_live_ix ON refresh_tokens (feeder_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

-- The worker's retention job sweeps rows whose token expired more than seven
-- days ago (grace period so a late replay still finds its row and gets the
-- honest REFRESH_REUSED rather than a row-less answer). Without this index the
-- daily sweep degrades to a scan as the table grows.
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_ix ON refresh_tokens (expires_at);
