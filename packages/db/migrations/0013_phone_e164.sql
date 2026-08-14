-- Hetja · migration 0013_phone_e164
-- Normalizes care_providers phone columns to E.164 ("+91...") and pins that
-- shape with a CHECK constraint. 0008_care_providers.sql created the columns
-- as free-form TEXT, but the directory is written by hand (the seed research
-- in packages/db/src/seed-care.ts and, going forward, the admin API) and a
-- hand-typed "98201 27085" or "09820127085" is a real number that the
-- emergency surface (GET /api/v1/care, also embedded in the SOS report
-- response, sos.ts) would dial incorrectly.
--
-- libphonenumber-js is NOT available in SQL, so this migration applies a
-- conservative subset of the same parsing rules apps/api/src/lib/phone.ts
-- implements: only the unambiguous national formats are converted, and anything
-- ambiguous is left untouched rather than guessed at.
--
-- CORRECTION (added by 0015_care_phone_e164_retry.sql, which supersedes this
-- file's constraint). The sentence that stood here claimed: "The API closes the
-- gap going forward: a new number that cannot be parsed as a valid Indian
-- number is rejected with a 400 before it is ever written." THAT WAS NEVER
-- TRUE. `apps/api/src/lib/phone.ts` existed and was tested, but nothing called
-- it and there was no write route to return a 400 from; `care_providers` had
-- exactly one writer, packages/db/src/seed-care.ts, which inserted whatever it
-- was given. The claim mattered because it was the stated justification for
-- this migration leaving unparseable rows alone -- "the API will catch the rest"
-- was load-bearing and false, so the rest was caught by nothing.
--
-- What actually enforces it now:
--   * care_providers_phone_e164_valid_check (0015) -- a real E.164 CHECK,
--     enforced on every INSERT and UPDATE, on every database, unconditionally.
--     This is the binding one: it also covers hand-written psql, which no
--     amount of application validation ever will.
--   * seed-care.ts refuses to seed a non-E.164 number, before its first INSERT.
--   * apps/api/src/routes/care.ts normalises both numbers through
--     normalizeIndianPhone() on the way out, so a legacy row still reaches the
--     caller as a dialable E.164 where it can be parsed.
--   * IndianPhoneE164 (lib/phone.ts) is the zod field a future write route must
--     use. Only THEN does the 400 in the sentence above become real.
--
-- The SQL in this file is left exactly as it was applied. Only this comment
-- changed: correcting a false statement about what enforces an invariant is
-- worth the file no longer being byte-identical to what ran, whereas rewriting
-- the statements would make the migration disagree with the databases that
-- already applied it.
--
-- phone_verified_at is deliberately NEVER touched here. That column means
-- "a human actually called this number" (see 0008's comment: a number nobody
-- has called is never presented as confirmed). Renormalizing a string does
-- not make a line any more confirmed, so it stays exactly as it was -- this
-- migration only rewrites the phone columns themselves.
--
-- The CHECK constraint (phone_e164/alt_phone_e164 are NULL or start with '+')
-- is added ONLY where every existing row can satisfy it. The UPDATEs above
-- convert what is parseable; any value that still does not start with '+' is
-- one this SQL cannot parse (see above), and on a database carrying such a
-- row the ALTER would fail and take the whole migration down with it. The DO
-- block therefore adds the constraint only when no violating row remains --
-- on a database where one does, the constraint is SKIPPED rather than
-- guessed at.
--
-- THAT SKIP IS THE BUG, and it fired. The UPDATEs above only understand
-- 10-digit mobiles, so a Mumbai landline ('02224137518') matched nothing, stayed
-- unprefixed, and this DO block quietly declined to add the constraint on the
-- production cluster while adding it to the Supabase mirror. schema_migrations
-- recorded 0013 as applied on both, so it is never retried, and CI always builds
-- a fresh database and therefore always lands on the branch that HAS the
-- constraint -- the divergence was invisible to the test suite by construction.
-- Fixed by 0015_care_phone_e164_retry.sql, which handles landlines, adds a
-- stricter constraint as NOT VALID so it can never be skipped, and reports its
-- outcome instead of choosing a branch in silence.

-- Normalize primary numbers. National-format Indian mobile numbers
-- (10 digits starting 6-9) are the only shapes that can be re-parsed
-- unambiguously without a phone-number library; already-'+' values (E.164 or
-- a foreign prefix) pass through untouched.
UPDATE care_providers
   SET phone_e164 = CASE
       WHEN phone_e164 ~ '^\+'                   THEN phone_e164
       WHEN phone_e164 ~ '^91[6-9][0-9]{9}$'     THEN '+' || phone_e164
       WHEN phone_e164 ~ '^0[6-9][0-9]{9}$'      THEN '+91' || substr(phone_e164, 2)
       WHEN phone_e164 ~ '^[6-9][0-9]{9}$'       THEN '+91' || phone_e164
       ELSE phone_e164
     END
 WHERE phone_e164 IS NOT NULL;

-- Same normalization for the secondary number.
UPDATE care_providers
   SET alt_phone_e164 = CASE
       WHEN alt_phone_e164 ~ '^\+'                    THEN alt_phone_e164
       WHEN alt_phone_e164 ~ '^91[6-9][0-9]{9}$'      THEN '+' || alt_phone_e164
       WHEN alt_phone_e164 ~ '^0[6-9][0-9]{9}$'       THEN '+91' || substr(alt_phone_e164, 2)
       WHEN alt_phone_e164 ~ '^[6-9][0-9]{9}$'        THEN '+91' || alt_phone_e164
       ELSE alt_phone_e164
     END
 WHERE alt_phone_e164 IS NOT NULL;

-- Constraint, added only when safe for the existing rows. EXECUTE is used
-- because ALTER TABLE inside plpgsql needs dynamic execution, same as the
-- GRANT in 0010_identity_email.sql.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM care_providers
     WHERE (phone_e164 IS NOT NULL AND phone_e164 !~ '^\+')
        OR (alt_phone_e164 IS NOT NULL AND alt_phone_e164 !~ '^\+')
  ) THEN
    EXECUTE 'ALTER TABLE care_providers
             ADD CONSTRAINT care_providers_phone_e164_format_check
             CHECK (
               (phone_e164 IS NULL OR phone_e164 LIKE ''+%'')
               AND (alt_phone_e164 IS NULL OR alt_phone_e164 LIKE ''+%'')
             )';
  END IF;
END $do$;
