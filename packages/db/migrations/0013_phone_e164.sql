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
-- conservative subset of the same parsing rules the API now enforces
-- (apps/api/src/lib/phone.ts): only the unambiguous national formats are
-- converted, and anything ambiguous is left untouched rather than guessed at.
-- The API closes the gap going forward: a new number that cannot be parsed
-- as a valid Indian number is rejected with a 400 before it is ever written.
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
-- guessed at. The API layer enforces the same rule on every future write.

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
