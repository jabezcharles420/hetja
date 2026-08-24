-- Hetja · migration 0019_registration_lifecycle
-- Columns, backfill and indexes for self-serve dog registration (wave 6).
-- Depends on 0018_registrator_enum.sql having committed the new enum values in
-- its own transaction — see that file's header for why they cannot share one:
-- this file NAMES 'pending_activation' (in index predicates and in the guard
-- below), which PostgreSQL refuses inside the transaction that added it.
--
-- ADDITIVE ONLY, AND SHAPED FOR A LIVE BOX. Every ADD COLUMN is nullable or
-- NOT NULL with a constant DEFAULT, so PostgreSQL records each in the catalog
-- without rewriting `dogs` — the difference between a fast deploy and holding
-- an ACCESS EXCLUSIVE lock through a table rewrite while the API serves scans
-- off it. Nothing here matches ops/check-destructive-migrations.sh's patterns
-- (plain UPDATE is not DELETE FROM), so no MIGRATION-APPROVED marker is needed
-- or appropriate.

ALTER TABLE dogs
  ADD COLUMN registered_by            UUID REFERENCES feeders(id) ON DELETE SET NULL,
  ADD COLUMN registered_at            TIMESTAMPTZ,
  ADD COLUMN activated_at             TIMESTAMPTZ,
  ADD COLUMN sos_eligible_at          TIMESTAMPTZ,
  ADD COLUMN activation_scan_id       UUID,
  ADD COLUMN registered_device_id     TEXT,
  ADD COLUMN activation_reminders_sent SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE feeders
  ADD COLUMN can_register BOOLEAN NOT NULL DEFAULT TRUE;

-- WHY ON DELETE SET NULL ON registered_by, DELIBERATELY. INVARIANT 11 requires
-- a DPDP erasure to be able to delete the `feeders` row. NO ACTION would block
-- the erasure whenever the person had ever registered a dog; CASCADE would
-- delete a dog that is still out there wearing a collar. SET NULL is the honest
-- outcome: the register survives, the budget effect disappears, and "who
-- registered this" becomes unanswerable — which is what erasure means.

COMMENT ON COLUMN dogs.registered_by IS
  'The feeder account that filed this registration, if any. NULLable by '
  'design: set only for self-serve registrations, and deliberately '
  'ON DELETE SET NULL so a DPDP erasure can delete the feeders row without '
  'deleting a dog that is still out there wearing its collar.';
COMMENT ON COLUMN dogs.registered_at IS
  'When the registration was filed. The clock the print window is measured '
  'from: a row still status=''pending_activation'' past its expiry horizon is '
  'a candidate for the expiry sweep.';
COMMENT ON COLUMN dogs.activated_at IS
  'When the first geotagged scan flipped the dog out of pending_activation '
  '(routes/scans.ts). Present means somebody stood next to the animal with a '
  'live tag; that physical-world event is the abuse control, not a review '
  'queue.';
COMMENT ON COLUMN dogs.sos_eligible_at IS
  'Set once, never cleared, when corroboration is reached (2 geotagged scans '
  'from distinct subjects, or 1 by a verified feeder). Wave 7 gates the SOS '
  'responder fan-out on this column being NOT NULL; it is materialised rather '
  'than derived per read because a derived query can flip back to false and a '
  'fan-out that silently turns itself off is the failure class INVARIANTS.md '
  'keeps recording.';
COMMENT ON COLUMN dogs.activation_scan_id IS
  'Soft pointer to the scans.id of the geotagged scan that activated this dog. '
  'Deliberately NOT a foreign key: a hard FK from dogs to scans inverts the '
  'existing deletion order (scans.dog_id already references dogs), and this '
  'repo lost a day to exactly that kind of referential-integrity trigger '
  'behind removing a dog row — see 0012''s header and AGENTS.md §h. A '
  'diagnostic pointer does not justify a second one. It may therefore dangle '
  'after a retention sweep removes old scans; read it as provenance, never '
  'join across it for correctness.';
COMMENT ON COLUMN dogs.registered_device_id IS
  'The canonical deviceTokenSubject() value of the device that filed the '
  'registration — the attested deviceId, NEVER the bearer token itself. Same '
  'rule and same reasoning as scans.device_token: the token string is not a '
  'canonical name for a device, and storing it would put replayable '
  'credentials in the database. This column is the second half of the '
  'two-sided registration budget (per account AND per device).';
COMMENT ON COLUMN dogs.activation_reminders_sent IS
  'How many "your tag is still unattached" pushes the worker has sent for this '
  'pending registration, so reminders stop instead of nagging forever.';
COMMENT ON COLUMN feeders.can_register IS
  'The operator-side kill switch for self-serve registration on ONE account. '
  'Exists separately from feeders.role because registrator is self-elected: '
  'revoking the role would be a demotion of a surface the account can simply '
  're-elect, so the real control lives here — disabling it leaves the '
  ''account''s feeder surface, streak and trust untouched.';

-- ---------------------------------------------------------------------------
-- THE BACKFILL — the most important statement in this file.
--
-- Every dog already in the register predates sos_eligible_at. Without a
-- backfill, wave 7's fan-out gate (`sos_eligible_at IS NOT NULL`) switches the
-- SOS responder fan-out OFF FOR THE ENTIRE REGISTER the moment it deploys —
-- silently, with a green health check, on the one path whose failure mode is
-- an animal dying untreated.
--
-- created_at, not now(): these dogs have been eligible since enrolment.
-- Stamping the deploy timestamp would make the column lie about every dog it
-- touches, and eligibility feeds responder paging — a column that lies here
-- delays real fan-out by the gap between enrolment and this migration.
-- ---------------------------------------------------------------------------

UPDATE dogs SET sos_eligible_at = created_at WHERE sos_eligible_at IS NULL;
UPDATE dogs SET activated_at = created_at
  WHERE activated_at IS NULL AND status = 'active';

-- Guard so the backfill cannot silently regress: if any future edit adds a
-- path that inserts a dog without eligibility above, applying this file fails
-- loudly instead of leaving the register SOS-dead with a green health check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dogs WHERE sos_eligible_at IS NULL) THEN
    RAISE EXCEPTION 'backfill failed: dogs rows still have sos_eligible_at IS NULL';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Partial indexes over the pending population only.
--
-- All three name 'pending_activation', which is exactly why they live here and
-- not in 0018: an index predicate referencing an enum value fails to apply in
-- the transaction that added the value (see 0018's header). They are partial
-- because the pending set is tiny (bounded, per account and per device, at 2)
-- while `dogs` grows without bound; indexing anything larger would tax every
-- other write to keep this one fast.
-- ---------------------------------------------------------------------------

-- Budget check #1: count pending registrations per registering account.
CREATE INDEX dogs_pending_registration_ix ON dogs (registered_by)
  WHERE status = 'pending_activation';

-- Budget check #2: count pending registrations per attested device.
CREATE INDEX dogs_pending_device_ix ON dogs (registered_device_id)
  WHERE status = 'pending_activation';

-- Expiry sweep (worker): find pending registrations whose print window closed.
CREATE INDEX dogs_pending_expiry_ix ON dogs (registered_at)
  WHERE status = 'pending_activation';
