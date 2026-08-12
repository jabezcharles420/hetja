-- ---------------------------------------------------------------------------
-- Hetja / StrayNet -- Supabase hardening. Apply AFTER 01_schema.sql + 02_data.sql.
--
-- Why this file exists
-- -------------------
-- On the VPS, Postgres was only ever reachable from localhost and every read
-- went through the Fastify API, which enforced three things in code:
--
--   1. INVARIANT 1/QR gate -- a dog profile is only readable with a valid
--      HMAC signature (?s=), so random 9-char slugs cannot be enumerated.
--   2. Privacy -- coordinates are coarsened to 2 decimals (~1.1km) before
--      leaving the server (coarsenToWard in @straynet/contracts).
--   3. INVARIANT 9 -- medical_records is append-only, enforced by
--      `REVOKE UPDATE, DELETE ... FROM app_user`.
--
-- Reading Supabase directly from the browser removes that API from the path.
-- The publishable/anon key is public by definition and PostgREST exposes every
-- table in `public`, so without this file the anon key could read feeders
-- (phone_hmac), collars (hmac_sig), exact dog coordinates, and unmoderated
-- stories, and could enumerate every dog without a signature.
--
-- The model here: no table is readable by anon at all. Reads happen through
-- SECURITY DEFINER functions that re-implement the three guarantees above.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. Private schema for server-side secrets. Never exposed to PostgREST.
-- --------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.app_secrets (
  name  text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE private.app_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.app_secrets FROM anon, authenticated;

-- Seed the QR signing secret out of band -- it must match the API's
-- STRAYNET_QR_SECRET exactly, or every signature check fails:
--
--   INSERT INTO private.app_secrets (name, value)
--   VALUES ('qr_secret', '<STRAYNET_QR_SECRET>')
--   ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
--
-- Deliberately not committed here.

-- --------------------------------------------------------------------------
-- 2. Lock every table down. RLS with no policy = deny all, including SELECT.
--    spatial_ref_sys is postgis-owned reference data and is skipped.
-- --------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    -- Defence in depth: Supabase's default privileges grant anon/authenticated
    -- table access in `public`, so RLS is not the only thing standing here.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;

-- Future tables inherit the same posture instead of being open by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. INVARIANT 9: medical_records is append-only.
--    The VPS used REVOKE UPDATE, DELETE on app_user. That does not carry over
--    (pg_dump --no-privileges drops it, and Supabase uses different roles), so
--    enforce it with a trigger, which holds for every role including postgres.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'medical_records is append-only (INVARIANT 9): % denied. Corrections must '
    'insert a new row with corrects_record_id set.', TG_OP;
END $$;

DROP TRIGGER IF EXISTS medical_records_append_only ON public.medical_records;
CREATE TRIGGER medical_records_append_only
  BEFORE UPDATE OR DELETE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();

-- --------------------------------------------------------------------------
-- 4. QR signature verification -- the SQL twin of verifySlugSig() in
--    apps/api/src/lib/hmac.ts:
--        sig = base64url(HMAC-SHA256(key = qr_secret, msg = slug))
--    base64url = standard base64 with +/ -> -_ and '=' padding stripped.
--    HMAC-SHA256 is 32 bytes -> 44 base64 chars, comfortably under the 76-char
--    wrap threshold, so encode() never inserts a newline here.
--
--    Note: this is not a constant-time comparison the way timingSafeEqual is
--    on the API. Remote timing analysis against PostgREST to recover an HMAC is
--    not a practical attack, but it is a real difference from the API path.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.verify_slug_sig(p_slug text, p_sig text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, extensions, public
AS $$
DECLARE
  v_secret   text;
  v_expected text;
BEGIN
  IF p_slug IS NULL OR p_sig IS NULL OR p_sig = '' THEN
    RETURN false;
  END IF;

  -- Slugs are 9 chars of the generator alphabet abcdefghijkmnopqrstuvwxyz23456789
  -- (packages/db/src/slugs.ts): a-z minus the confusables l and o, digits 2-9.
  IF p_slug !~ '^[a-km-z2-9]{9}$' THEN
    RETURN false;
  END IF;

  SELECT value INTO v_secret FROM private.app_secrets WHERE name = 'qr_secret';
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'private.app_secrets has no qr_secret row -- seed it first';
  END IF;

  v_expected := replace(
    translate(encode(extensions.hmac(p_slug, v_secret, 'sha256'), 'base64'), '+/', '-_'),
    '=', ''
  );

  RETURN v_expected = p_sig;
END $$;

REVOKE ALL ON FUNCTION private.verify_slug_sig(text, text) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- 5. Public read surface. These three functions are the ONLY things anon may
--    call, and each one requires a valid signature. Shapes mirror the API
--    responses consumed by apps/web/lib/api.ts.
-- --------------------------------------------------------------------------

-- GET /api/v1/dogs/:slug?s=
CREATE OR REPLACE FUNCTION public.get_dog_profile(p_slug text, p_sig text)
RETURNS TABLE (
  slug           text,
  name           text,
  status         text,
  ward_id        text,
  photo_key      text,
  abc_status     text,
  vaccine_status text,
  micro_story    text,
  last_seen_at   timestamptz,
  lat            numeric,
  lng            numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, private
AS $$
BEGIN
  IF NOT private.verify_slug_sig(p_slug, p_sig) THEN
    -- Same response as a missing dog: never confirm that a slug exists.
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.slug,
    d.name,
    d.status::text,
    d.ward_id,
    (SELECT s.photo_s3_key FROM scans s
      WHERE s.dog_id = d.id AND s.photo_s3_key IS NOT NULL
      ORDER BY s.received_at DESC LIMIT 1),
    d.abc_status,
    (SELECT NULLIF(concat_ws(' · ', m.vaccine_name, m.vaccine_date::text), '')
       FROM medical_records m
      WHERE m.dog_id = d.id
        AND m.record_type IN ('vaccination', 'vaccine')
        AND m.is_verified
      ORDER BY m.created_at DESC LIMIT 1),
    -- Only moderated stories. The API's profile query omitted this filter,
    -- which let an unmoderated paragraph surface on the public profile.
    (SELECT st.paragraph FROM dog_stories st
      WHERE st.dog_id = d.id AND st.moderated_at IS NOT NULL
      ORDER BY st.created_at DESC, st.version DESC LIMIT 1),
    d.last_seen_at,
    -- Privacy: coarsenToWard() -- 2 decimals, ~1.1km. Never the exact point.
    round(extensions.ST_Y(d.last_seen_geo::extensions.geometry)::numeric, 2),
    round(extensions.ST_X(d.last_seen_geo::extensions.geometry)::numeric, 2)
  FROM dogs d
  WHERE d.slug = p_slug;
END $$;

-- GET /api/v1/dogs/:slug/medical -- verified records only, with the hash chain
-- so the client can still check integrity.
CREATE OR REPLACE FUNCTION public.get_dog_medical(p_slug text, p_sig text)
RETURNS TABLE (
  record_type  text,
  vaccine_name text,
  vaccine_date date,
  abc_date     date,
  diagnosis    text,
  treatment    text,
  severity     text,
  created_at   timestamptz,
  hash_curr    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, private
AS $$
BEGIN
  IF NOT private.verify_slug_sig(p_slug, p_sig) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.record_type, m.vaccine_name, m.vaccine_date, m.abc_date,
         m.diagnosis, m.treatment, m.severity::text, m.created_at, m.hash_curr
  FROM medical_records m
  JOIN dogs d ON d.id = m.dog_id
  WHERE d.slug = p_slug AND m.is_verified
  ORDER BY m.created_at DESC;
END $$;

-- GET /api/v1/dogs/:slug/stories -- moderated only.
CREATE OR REPLACE FUNCTION public.get_dog_stories(p_slug text, p_sig text)
RETURNS TABLE (
  id           uuid,
  version      int,
  paragraph    text,
  moderated_at timestamptz,
  created_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, private
AS $$
BEGIN
  IF NOT private.verify_slug_sig(p_slug, p_sig) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT st.id, st.version, st.paragraph, st.moderated_at, st.created_at
  FROM dog_stories st
  JOIN dogs d ON d.id = st.dog_id
  WHERE d.slug = p_slug AND st.moderated_at IS NOT NULL
  ORDER BY st.created_at DESC, st.version DESC;
END $$;

-- --------------------------------------------------------------------------
-- 6. Grants. anon gets exactly these three functions and nothing else.
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_dog_profile(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dog_medical(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dog_stories(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_dog_profile(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dog_medical(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dog_stories(text, text) TO anon, authenticated;

-- --------------------------------------------------------------------------
-- 7. Care directory RPC (plan docs/PLAN-v2.md §2.3) -- public business
--    listings, not dog/feeder data, so (unlike the three functions above)
--    this needs NO signature check. Mirrors docs/queries/care_nearby.sql /
--    apps/api/src/routes/care.ts's getNearbyCare().
-- --------------------------------------------------------------------------
ALTER TABLE public.care_providers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_providers FROM anon, authenticated;
-- Redundant with the dynamic DO-loop in section 2 once 01_schema.sql is
-- regenerated to include this table (added by migration
-- 0008_care_providers.sql, after the schema this file's header assumes) --
-- kept explicit so a hardening run against an older dump still locks it.

CREATE OR REPLACE FUNCTION public.get_nearby_care(
  p_lat    double precision,
  p_lng    double precision,
  p_max_km double precision DEFAULT 5
)
RETURNS TABLE (
  id                uuid,
  name              text,
  kind              text,
  cost_tier         text,
  phone_e164        text,
  alt_phone_e164    text,
  has_ambulance     boolean,
  is_24x7           boolean,
  hours_note        text,
  handles_wildlife  boolean,
  phone_verified_at timestamptz,
  lat               double precision,
  lng               double precision,
  distance_m        double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, private
AS $$
DECLARE
  v_origin   extensions.geography;
  v_radius_m double precision;
BEGIN
  v_origin := extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;
  -- Same cap as the API (apps/api/src/routes/care.ts MAX_KM_CAP = 25).
  v_radius_m := LEAST(GREATEST(COALESCE(p_max_km, 5), 0.001), 25) * 1000;

  RETURN QUERY
  SELECT
    cp.id, cp.name, cp.kind::text, cp.cost_tier::text,
    cp.phone_e164, cp.alt_phone_e164, cp.has_ambulance, cp.is_24x7,
    cp.hours_note, cp.handles_wildlife, cp.phone_verified_at,
    extensions.ST_Y(cp.geo::extensions.geometry),
    extensions.ST_X(cp.geo::extensions.geometry),
    extensions.ST_Distance(cp.geo, v_origin)
  FROM care_providers cp
  WHERE cp.listed
    AND extensions.ST_DWithin(cp.geo, v_origin, v_radius_m)
  ORDER BY extensions.ST_Distance(cp.geo, v_origin)
  LIMIT 8;
END $$;

REVOKE ALL ON FUNCTION public.get_nearby_care(double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_care(double precision, double precision, double precision) TO anon, authenticated;

-- --------------------------------------------------------------------------
-- 8. Verification -- every one of these should hold after applying this file.
-- --------------------------------------------------------------------------
-- Expect zero rows: any public table still missing RLS.
--   SELECT tablename FROM pg_tables t
--    WHERE schemaname='public' AND tablename<>'spatial_ref_sys'
--      AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--                       WHERE n.nspname='public' AND c.relname=t.tablename AND c.relrowsecurity);
--
-- Expect zero rows: any anon privilege left on a public table.
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee='anon' AND table_schema='public';
--
-- Expect an exception (INVARIANT 9):
--   UPDATE medical_records SET diagnosis='x' WHERE true;
