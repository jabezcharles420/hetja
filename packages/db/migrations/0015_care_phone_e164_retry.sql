-- Hetja · migration 0015_care_phone_e164_retry
--
-- Re-attempts what 0013_phone_e164.sql was supposed to do, because on the
-- database that matters 0013 did nothing and can never be retried.
--
-- WHAT WENT WRONG IN 0013
--
-- 0013 added care_providers_phone_e164_format_check inside a DO block guarded on
-- "IF NOT EXISTS (a violating row)". Its UPDATEs only understood 10-digit
-- mobiles -- '^[6-9][0-9]{9}$', '^0[6-9][0-9]{9}$', '^91[6-9][0-9]{9}$' -- so a
-- real Mumbai landline, written the way a human writes it ('02224137518',
-- '022 2413 7518'), matched none of them and stayed unprefixed. On any database
-- holding one, the guard saw a violating row and SKIPPED the constraint.
--
-- Per AGENTS.md §g migrations reach two databases. Supabase is a schema mirror
-- with (probably) no such row, so it got the constraint. The local production
-- cluster holds the real curated directory, which does contain landlines, so it
-- did not. schema_migrations recorded 0013 as applied on both, so the runner
-- (packages/db/src/migrate.ts) will never reconsider it. And CI always builds a
-- fresh database, which lands on the branch that HAS the constraint -- so the
-- test suite is structurally incapable of seeing the divergence. The invariant
-- was permanently absent from production and permanently present in CI.
--
-- The root cause is not the missing landline pattern. It is that 0013's outcome
-- was CONDITIONAL and SILENT: a migration that decides at runtime whether to
-- apply an invariant, tells nobody which branch it took, and is then marked
-- applied. This file is written so that cannot happen again -- see "always, or
-- loudly not at all" below.
--
-- WHAT THIS FILE DOES
--
-- 1. A normalising function that actually understands the Indian numbering
--    plan, including landlines and hand-typed separators.
-- 2. Normalises both phone columns with it, skipping (never forcing) any
--    rewrite that would collide with care_providers_name_phone_uq.
-- 3. Adds a STRICTER constraint -- real E.164, not merely "starts with +" --
--    as NOT VALID, which succeeds unconditionally.
-- 4. Validates it when every existing row passes, and when they do not, names
--    the offending rows and leaves the constraint recorded as unvalidated.
--
-- ALWAYS, OR LOUDLY NOT AT ALL: WHY `NOT VALID`
--
-- The brief offered two options -- a constraint that tolerates the bad rows
-- explicitly, or no constraint at all. `NOT VALID` is a third that is strictly
-- better than either, because it separates the two questions 0013 conflated:
--
--   * "Are FUTURE writes constrained?"  -- Yes. Unconditionally, on both
--     databases, from this migration onward. PostgreSQL enforces a NOT VALID
--     CHECK on every INSERT and UPDATE; NOT VALID only means "existing rows
--     were not scanned". The invariant can no longer be silently absent from
--     one database, which was the actual defect.
--   * "Do all EXISTING rows satisfy it?" -- Recorded honestly, per database,
--     in pg_constraint.convalidated, and re-checkable at any time:
--       SELECT conname, convalidated FROM pg_constraint
--        WHERE conname = 'care_providers_phone_e164_valid_check';
--     false means "legacy rows here have not been proven to conform" -- a fact
--     an operator can query, not a branch nobody logged.
--
-- Tolerating the bad shapes in the constraint text was rejected because it
-- means inventing a taxonomy of acceptable non-E.164 numbers (short codes?
-- 1800 numbers? extensions?) from no evidence -- guessing, which is what
-- produced this bug. Dropping the constraint idea was rejected because
-- care_providers.phone_e164 is the number a stranger taps while standing over
-- an injured dog; unconstrained is how it got here.
--
-- No row is deleted or nulled to make the constraint fit. A weirdly-formatted
-- Indian number is very likely still dialable; NULL definitely is not. On an
-- emergency surface, removing a possibly-working number to satisfy a format
-- rule would be a worse bug than the format.
--
-- ONE CONSEQUENCE TO KNOW ABOUT: while the constraint is NOT VALID, any UPDATE
-- to a still-violating row fails the check -- including an UPDATE of an
-- unrelated column such as phone_verified_at. So the first human who rings one
-- of those lines and tries to mark it verified gets an error instead of a
-- write. That is deliberate and, on this table, correct: it surfaces the bad
-- number to the one person who is holding a phone and can read the correct one
-- off the answering end. The fix is one statement, and it is exactly what this
-- migration would have done had the value been parseable:
--   UPDATE care_providers
--      SET phone_e164 = hetja_phone_e164_in(phone_e164)
--    WHERE id = '<id>';   -- then re-check, or type the number by hand
--
-- phone_verified_at is not touched here, for the same reason 0013 gave:
-- renormalising a string does not make a line any more confirmed.
--
-- Additive only -- CREATE OR REPLACE FUNCTION, two UPDATEs, ADD CONSTRAINT,
-- VALIDATE CONSTRAINT. Nothing is removed; 0013's weaker constraint is left in
-- place where it exists (this one implies it, so both can hold), because
-- removing it would need an ALTER ... DROP CONSTRAINT and therefore a
-- human-signed `-- MIGRATION-APPROVED:` marker for no gain.

-- ---------------------------------------------------------------------------
-- 1. The normaliser.
--
-- Indian national significant numbers are 10 digits for BOTH mobile and fixed
-- line: a landline is trunk '0' + STD code (2-4 digits) + subscriber number,
-- and STD code + subscriber always totals 10 ('022' + '24137518' -> national
-- 2224137518 -> E.164 +912224137518). That single fact is what 0013 missed: it
-- special-cased mobiles by their 6-9 leading digit instead of handling the
-- 10-digit national number, of which mobiles are just the 6-9 subset.
--
-- Separators are stripped FIRST, because the directory is typed by hand and
-- 0013's own header cites '98201 27085' as a real case it could not parse.
-- Stripping is safe only because the result must then match one of the exact,
-- length-anchored shapes below; a field holding two numbers, or a number with
-- an extension, collapses into digits that match nothing and is returned
-- UNCHANGED rather than mangled into a single wrong number. Returning the input
-- untouched is always the fallback -- this function never guesses.
--
-- IMMUTABLE + STRICT: pure, and NULL in -> NULL out (a provider may publish
-- only an address; see 0008).
--
-- Deliberately NOT referenced by the CHECK constraint below. A constraint whose
-- meaning depends on a function is a constraint that a later CREATE OR REPLACE
-- can silently loosen without revalidating a single row. The constraint carries
-- its own literal regex; this function is only ever used to WRITE values.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hetja_phone_e164_in(raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $fn$
DECLARE
  s TEXT;
BEGIN
  -- Keep digits and '+' only: spaces, hyphens, dots, brackets all go.
  s := regexp_replace(raw, '[^0-9+]', '', 'g');

  -- Already E.164 (possibly only after separators were stripped: '+91 98201
  -- 27085'). Also the pass-through for a legitimate foreign number.
  IF s ~ '^\+[1-9][0-9]{7,14}$'  THEN RETURN s;                     END IF;
  -- '00' international prefix + 91 + 10-digit national number.
  IF s ~ '^0091[1-9][0-9]{9}$'   THEN RETURN '+91' || substr(s, 5); END IF;
  -- Country code without the '+': exactly 12 digits, so this can never eat a
  -- 10-digit mobile that merely happens to start '91' (e.g. 9122241375).
  IF s ~ '^91[1-9][0-9]{9}$'     THEN RETURN '+'   || s;            END IF;
  -- Trunk '0' + 10-digit national number. Covers landlines ('02224137518')
  -- and mobiles written with the trunk prefix ('09820127085') in one rule.
  IF s ~ '^0[1-9][0-9]{9}$'      THEN RETURN '+91' || substr(s, 2); END IF;
  -- Bare 10-digit mobile.
  IF s ~ '^[6-9][0-9]{9}$'       THEN RETURN '+91' || s;            END IF;

  -- Unparseable: hand it back exactly as it came in.
  RETURN raw;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 2a. Normalise the primary number, without ever breaking the unique index.
--
-- care_providers_name_phone_uq is UNIQUE (name, COALESCE(phone_e164, '')), so
-- rewriting '9820127085' -> '+919820127085' can collide with an existing row
-- that has the same name and already holds the E.164 form. Low probability,
-- loud failure -- it would abort this migration and, because migrate.ts runs
-- each file in one transaction, take the whole deploy's schema change with it.
--
-- Two collision shapes, both handled by skipping the rewrite rather than
-- resolving it (deduplicating two curated directory rows is a judgement call
-- about which one a human should keep -- not something a migration decides at
-- 3am):
--   * against a row that already exists  -> the NOT EXISTS below.
--   * against another row in this same UPDATE, e.g. '9820127085' and
--     '09820127085' under one name both normalising to the same E.164 -> the
--     row_number() below keeps the oldest and leaves the rest alone. A
--     statement-level UPDATE checks uniqueness once at the end, so without
--     this the two rewrites would collide with each other.
--
-- Skipped rows stay unparsed, so they show up in the report in step 4 rather
-- than disappearing quietly.
-- ---------------------------------------------------------------------------
WITH candidate AS (
  SELECT id, name, created_at, hetja_phone_e164_in(phone_e164) AS norm
    FROM care_providers
   WHERE phone_e164 IS NOT NULL
     AND hetja_phone_e164_in(phone_e164) IS DISTINCT FROM phone_e164
), ranked AS (
  SELECT c.*,
         row_number() OVER (PARTITION BY c.name, c.norm ORDER BY c.created_at, c.id) AS rn
    FROM candidate c
), safe AS (
  SELECT r.id, r.norm
    FROM ranked r
   WHERE r.rn = 1
     AND NOT EXISTS (
       SELECT 1
         FROM care_providers x
        WHERE x.name = r.name
          AND COALESCE(x.phone_e164, '') = r.norm
          AND x.id <> r.id
     )
)
UPDATE care_providers p
   SET phone_e164 = s.norm
  FROM safe s
 WHERE p.id = s.id;

-- ---------------------------------------------------------------------------
-- 2b. Same for the secondary number. No unique index covers alt_phone_e164
-- (0008 only indexes name + primary phone), so there is nothing to collide
-- with and no guard is needed.
-- ---------------------------------------------------------------------------
UPDATE care_providers
   SET alt_phone_e164 = hetja_phone_e164_in(alt_phone_e164)
 WHERE alt_phone_e164 IS NOT NULL
   AND hetja_phone_e164_in(alt_phone_e164) IS DISTINCT FROM alt_phone_e164;

-- ---------------------------------------------------------------------------
-- 3. The constraint, added unconditionally as NOT VALID.
--
-- '^\+[1-9][0-9]{7,14}$' is real E.164: a '+', a non-zero country code digit,
-- and a total of 8-15 digits. Strictly stronger than 0013's LIKE '+%', which
-- accepted '+91 98201 27085' (spaces), '+' alone, and '+0'. The country code is
-- not pinned to 91 -- a directory row for a genuinely foreign line is not this
-- constraint's business, and apps/api/src/routes/care.test.ts uses a +1 fixture.
--
-- Guarded on the constraint's own existence, not on the data: re-runnable and
-- safe against a database where a previous partial attempt left it in place.
-- The guard can only skip work that is already done -- it can never skip the
-- invariant, which is the difference from 0013.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'care_providers_phone_e164_valid_check'
       AND conrelid = 'care_providers'::regclass
  ) THEN
    EXECUTE $q$
      ALTER TABLE care_providers
        ADD CONSTRAINT care_providers_phone_e164_valid_check
        CHECK (
          (phone_e164     IS NULL OR phone_e164     ~ '^\+[1-9][0-9]{7,14}$')
          AND
          (alt_phone_e164 IS NULL OR alt_phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
        )
        NOT VALID
    $q$;
  END IF;
END $do$;

-- ---------------------------------------------------------------------------
-- 4. Report, then validate if and only if the data earns it.
--
-- Every path through this block says out loud what it did. RAISE NOTICE and
-- RAISE WARNING reach the deploy log because migrate.ts forwards server
-- messages to stdout (it did not, until this migration needed it to -- a RAISE
-- in a migration was previously swallowed by node-postgres, which is the other
-- half of why 0013's skipped branch was invisible).
--
-- Row VALUES are deliberately not logged, only id and name. The deploy log is
-- readable by every repo collaborator and ops/security-gate.sh already tracks
-- care_providers.phone_e164 as plaintext contact data pending encryption
-- (Top-25 #14). The id is enough to fix the row; the number adds nothing but
-- exposure. `name` is a published organisation name, so it is safe and it is
-- what makes the log actionable without a second query.
--
-- The two violation classes are reported separately because they need
-- different human actions: "unparseable" needs someone to find the real
-- number, "collides" needs someone to decide which of two duplicate directory
-- rows survives.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  r RECORD;
  bad INT := 0;
BEGIN
  FOR r IN
    -- concat_ws drops NULL branches, so a row with two bad numbers reports
    -- both reasons instead of only the first one a CASE would have matched.
    SELECT id, name, concat_ws('; ',
             CASE WHEN phone_e164 IS NOT NULL
                   AND phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
                   AND hetja_phone_e164_in(phone_e164) IS DISTINCT FROM phone_e164
                  THEN 'primary number is normalisable but step 2a skipped it: the rewrite would duplicate another row with the same name'
             END,
             CASE WHEN phone_e164 IS NOT NULL
                   AND phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
                   AND hetja_phone_e164_in(phone_e164) = phone_e164
                  THEN 'primary number cannot be parsed as an Indian or E.164 number'
             END,
             CASE WHEN alt_phone_e164 IS NOT NULL
                   AND alt_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
                  THEN 'secondary number cannot be parsed as an Indian or E.164 number'
             END
           ) AS reason
      FROM care_providers
     WHERE (phone_e164     IS NOT NULL AND phone_e164     !~ '^\+[1-9][0-9]{7,14}$')
        OR (alt_phone_e164 IS NOT NULL AND alt_phone_e164 !~ '^\+[1-9][0-9]{7,14}$')
     ORDER BY name
  LOOP
    bad := bad + 1;
    RAISE WARNING '0015: care_providers row % (%) still violates E.164: %', r.id, r.name, r.reason;
  END LOOP;

  IF bad = 0 THEN
    EXECUTE 'ALTER TABLE care_providers VALIDATE CONSTRAINT care_providers_phone_e164_valid_check';
    RAISE NOTICE '0015: care_providers_phone_e164_valid_check is VALIDATED -- every existing care_providers row is E.164.';
  ELSE
    RAISE WARNING '0015: % care_providers row(s) listed above are not E.164, so care_providers_phone_e164_valid_check stays NOT VALID on this database. It IS still enforced on every future INSERT and UPDATE. Fix the rows above, then run: ALTER TABLE care_providers VALIDATE CONSTRAINT care_providers_phone_e164_valid_check;', bad;
  END IF;
END $do$;
