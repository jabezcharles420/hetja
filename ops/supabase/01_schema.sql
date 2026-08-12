-- ---------------------------------------------------------------------------
-- Hetja / StrayNet -- schema for Supabase
-- Generated from the VPS Postgres 16 dump; see ops/supabase/README.md.
-- Apply BEFORE 02_data.sql, then 03_hardening.sql.
-- ---------------------------------------------------------------------------

-- Supabase convention: extensions live in `extensions`, never `public`.
CREATE EXTENSION IF NOT EXISTS postgis  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public, extensions', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: case_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.case_state AS ENUM (
    'open',
    'acked',
    'escalated',
    'resolved',
    'false_alarm'
);


--
-- Name: dog_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dog_status AS ENUM (
    'active',
    'lost',
    'deceased',
    'adopted',
    'relocated'
);


--
-- Name: feeder_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.feeder_role AS ENUM (
    'feeder',
    'vet',
    'bmc_officer',
    'admin'
);


--
-- Name: review_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.review_status AS ENUM (
    'pending',
    'auto_passed',
    'flagged',
    'human_passed',
    'rejected'
);


--
-- Name: scan_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scan_type AS ENUM (
    'view',
    'feed',
    'sos',
    'retag',
    'identify'
);


--
-- Name: severity_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.severity_t AS ENUM (
    'minor',
    'serious',
    'critical'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: collars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dog_id uuid NOT NULL,
    qr_code text NOT NULL,
    hmac_sig text NOT NULL,
    batch_no text NOT NULL,
    material text NOT NULL,
    bound_once boolean DEFAULT true NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL
);


--
-- Name: dog_stories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dog_stories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dog_id uuid NOT NULL,
    author_feeder_id uuid NOT NULL,
    paragraph text NOT NULL,
    version integer NOT NULL,
    moderated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dogs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dogs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text,
    sex text,
    approx_age integer,
    coat_pattern text,
    temperament text,
    vibe text,
    status public.dog_status DEFAULT 'active'::public.dog_status NOT NULL,
    cv_embedding extensions.vector(768),
    last_seen_geo extensions.geography(Point,4326),
    last_seen_at timestamp with time zone,
    ward_id text NOT NULL,
    abc_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_received_at timestamp with time zone
);


--
-- Name: dogs_geofences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dogs_geofences (
    dog_id uuid NOT NULL,
    geofence_id uuid NOT NULL,
    since timestamp with time zone DEFAULT now() NOT NULL,
    until timestamp with time zone
);


--
-- Name: feeder_territories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feeder_territories (
    feeder_id uuid NOT NULL,
    geofence_id uuid NOT NULL,
    role text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    since timestamp with time zone DEFAULT now() NOT NULL,
    until timestamp with time zone
);


--
-- Name: feeders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feeders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_hmac text NOT NULL,
    display_name text NOT NULL,
    role public.feeder_role DEFAULT 'feeder'::public.feeder_role NOT NULL,
    trust_score integer DEFAULT 30 NOT NULL,
    verification_tier text DEFAULT 'provisional'::text NOT NULL,
    home_ward text,
    last_known_geo extensions.geography(Point,4326),
    last_seen_at timestamp with time zone,
    sos_opt_in boolean DEFAULT false NOT NULL,
    consent_version text NOT NULL,
    is_minor boolean DEFAULT false NOT NULL,
    streak_days integer DEFAULT 0 NOT NULL,
    badges text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    trust_recomputed_at timestamp with time zone,
    last_feed_date date,
    CONSTRAINT feeders_trust_score_check CHECK (((trust_score >= 0) AND (trust_score <= 100)))
);


--
-- Name: geofences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geofences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    boundary extensions.geography(Polygon,4326) NOT NULL,
    ward_id text NOT NULL,
    alert_radius_m integer DEFAULT 2000 NOT NULL
);


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id bigint NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone
)
WITH (autovacuum_vacuum_scale_factor='0.01');


--
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jobs_id_seq OWNED BY public.jobs.id;


--
-- Name: ledger_anchors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_anchors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    head_hash text NOT NULL,
    record_count integer NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    published_url text
);


--
-- Name: medical_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medical_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dog_id uuid NOT NULL,
    vet_id uuid,
    record_type text NOT NULL,
    vaccine_name text,
    vaccine_date date,
    abc_date date,
    diagnosis text,
    treatment text,
    severity public.severity_t,
    is_verified boolean DEFAULT false NOT NULL,
    vet_signature text,
    corrects_record_id uuid,
    payload_len integer NOT NULL,
    hash_prev text NOT NULL,
    hash_curr text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    hash_vet_id text DEFAULT 'feeder'::text NOT NULL,
    hash_ts text DEFAULT ''::text NOT NULL
);


--
-- Name: scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dog_id uuid NOT NULL,
    feeder_id uuid,
    collar_id uuid,
    client_uuid uuid NOT NULL,
    scan_type public.scan_type NOT NULL,
    geo extensions.geography(Point,4326),
    photo_s3_key text,
    ai_validation jsonb,
    review_status public.review_status DEFAULT 'pending'::public.review_status NOT NULL,
    device_token text,
    captured_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sos_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scan_id uuid NOT NULL,
    dog_id uuid NOT NULL,
    severity public.severity_t NOT NULL,
    state public.case_state DEFAULT 'open'::public.case_state NOT NULL,
    tier integer DEFAULT 1 NOT NULL,
    acked_by uuid,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    acked_at timestamp with time zone,
    escalated_at timestamp with time zone,
    resolved_at timestamp with time zone,
    resolution text
);


--
-- Name: sos_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    feeder_id uuid,
    vet_id uuid,
    channel text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    acked_at timestamp with time zone,
    stood_down boolean DEFAULT false NOT NULL
);


--
-- Name: trust_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trust_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feeder_id uuid NOT NULL,
    event_type text NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    ref_scan_id uuid,
    reverses_event_id uuid,
    dispute_state text DEFAULT 'none'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_name text NOT NULL,
    geo extensions.geography(Point,4326) NOT NULL,
    signing_key_pub text NOT NULL,
    sla_minutes integer DEFAULT 30 NOT NULL,
    retainer_paise integer DEFAULT 0 NOT NULL,
    mou_signed_at date,
    verified_at timestamp with time zone,
    feeder_id uuid
);


--
-- Name: jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs ALTER COLUMN id SET DEFAULT nextval('public.jobs_id_seq'::regclass);


--
-- Name: collars collars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collars
    ADD CONSTRAINT collars_pkey PRIMARY KEY (id);


--
-- Name: collars collars_qr_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collars
    ADD CONSTRAINT collars_qr_code_key UNIQUE (qr_code);


--
-- Name: dog_stories dog_stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dog_stories
    ADD CONSTRAINT dog_stories_pkey PRIMARY KEY (id);


--
-- Name: dogs_geofences dogs_geofences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dogs_geofences
    ADD CONSTRAINT dogs_geofences_pkey PRIMARY KEY (dog_id, geofence_id);


--
-- Name: dogs dogs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dogs
    ADD CONSTRAINT dogs_pkey PRIMARY KEY (id);


--
-- Name: dogs dogs_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dogs
    ADD CONSTRAINT dogs_slug_key UNIQUE (slug);


--
-- Name: feeder_territories feeder_territories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feeder_territories
    ADD CONSTRAINT feeder_territories_pkey PRIMARY KEY (feeder_id, geofence_id);


--
-- Name: feeders feeders_phone_hmac_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feeders
    ADD CONSTRAINT feeders_phone_hmac_key UNIQUE (phone_hmac);


--
-- Name: feeders feeders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feeders
    ADD CONSTRAINT feeders_pkey PRIMARY KEY (id);


--
-- Name: geofences geofences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofences
    ADD CONSTRAINT geofences_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: ledger_anchors ledger_anchors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_anchors
    ADD CONSTRAINT ledger_anchors_pkey PRIMARY KEY (id);


--
-- Name: medical_records medical_records_hash_curr_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_hash_curr_key UNIQUE (hash_curr);


--
-- Name: medical_records medical_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_pkey PRIMARY KEY (id);


--
-- Name: scans scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: sos_cases sos_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_cases
    ADD CONSTRAINT sos_cases_pkey PRIMARY KEY (id);


--
-- Name: sos_notifications sos_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_notifications
    ADD CONSTRAINT sos_notifications_pkey PRIMARY KEY (id);


--
-- Name: trust_events trust_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_events
    ADD CONSTRAINT trust_events_pkey PRIMARY KEY (id);


--
-- Name: vets vets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vets
    ADD CONSTRAINT vets_pkey PRIMARY KEY (id);


--
-- Name: dog_stories_dog_version_uix; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dog_stories_dog_version_uix ON public.dog_stories USING btree (dog_id, version);


--
-- Name: dog_stories_moderation_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dog_stories_moderation_ix ON public.dog_stories USING btree (created_at, version) WHERE (moderated_at IS NULL);


--
-- Name: dogs_geo_gix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dogs_geo_gix ON public.dogs USING gist (last_seen_geo);


--
-- Name: dogs_ward_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dogs_ward_ix ON public.dogs USING btree (ward_id) WHERE (status = 'active'::public.dog_status);


--
-- Name: feeder_territories_primary_uix; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX feeder_territories_primary_uix ON public.feeder_territories USING btree (geofence_id) WHERE is_primary;


--
-- Name: feeders_sos_gix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feeders_sos_gix ON public.feeders USING gist (last_known_geo) WHERE (sos_opt_in AND (trust_score >= 40));


--
-- Name: jobs_ready_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_ready_ix ON public.jobs USING btree (run_after) WHERE (locked_until IS NULL);


--
-- Name: scans_client_uuid_uix; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX scans_client_uuid_uix ON public.scans USING btree (client_uuid);


--
-- Name: scans_dog_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scans_dog_ix ON public.scans USING btree (dog_id, received_at DESC);


--
-- Name: scans_received_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scans_received_ix ON public.scans USING btree (received_at);


--
-- Name: sos_open_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sos_open_ix ON public.sos_cases USING btree (state, opened_at) WHERE (state = ANY (ARRAY['open'::public.case_state, 'acked'::public.case_state]));


--
-- Name: vets_feeder_uix; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vets_feeder_uix ON public.vets USING btree (feeder_id) WHERE (feeder_id IS NOT NULL);


--
-- Name: collars collars_dog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collars
    ADD CONSTRAINT collars_dog_id_fkey FOREIGN KEY (dog_id) REFERENCES public.dogs(id);


--
-- Name: dog_stories dog_stories_author_feeder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dog_stories
    ADD CONSTRAINT dog_stories_author_feeder_id_fkey FOREIGN KEY (author_feeder_id) REFERENCES public.feeders(id);


--
-- Name: dog_stories dog_stories_dog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dog_stories
    ADD CONSTRAINT dog_stories_dog_id_fkey FOREIGN KEY (dog_id) REFERENCES public.dogs(id);


--
-- Name: dogs_geofences dogs_geofences_dog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dogs_geofences
    ADD CONSTRAINT dogs_geofences_dog_id_fkey FOREIGN KEY (dog_id) REFERENCES public.dogs(id);


--
-- Name: dogs_geofences dogs_geofences_geofence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dogs_geofences
    ADD CONSTRAINT dogs_geofences_geofence_id_fkey FOREIGN KEY (geofence_id) REFERENCES public.geofences(id);


--
-- Name: feeder_territories feeder_territories_feeder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feeder_territories
    ADD CONSTRAINT feeder_territories_feeder_id_fkey FOREIGN KEY (feeder_id) REFERENCES public.feeders(id);


--
-- Name: feeder_territories feeder_territories_geofence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feeder_territories
    ADD CONSTRAINT feeder_territories_geofence_id_fkey FOREIGN KEY (geofence_id) REFERENCES public.geofences(id);


--
-- Name: medical_records medical_records_corrects_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_corrects_record_id_fkey FOREIGN KEY (corrects_record_id) REFERENCES public.medical_records(id);


--
-- Name: medical_records medical_records_dog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_dog_id_fkey FOREIGN KEY (dog_id) REFERENCES public.dogs(id);


--
-- Name: medical_records medical_records_vet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_records
    ADD CONSTRAINT medical_records_vet_id_fkey FOREIGN KEY (vet_id) REFERENCES public.vets(id);


--
-- Name: scans scans_collar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_collar_id_fkey FOREIGN KEY (collar_id) REFERENCES public.collars(id);


--
-- Name: scans scans_dog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_dog_id_fkey FOREIGN KEY (dog_id) REFERENCES public.dogs(id);


--
-- Name: scans scans_feeder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_feeder_id_fkey FOREIGN KEY (feeder_id) REFERENCES public.feeders(id);


--
-- Name: sos_cases sos_cases_acked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_cases
    ADD CONSTRAINT sos_cases_acked_by_fkey FOREIGN KEY (acked_by) REFERENCES public.feeders(id);


--
-- Name: sos_cases sos_cases_dog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_cases
    ADD CONSTRAINT sos_cases_dog_id_fkey FOREIGN KEY (dog_id) REFERENCES public.dogs(id);


--
-- Name: sos_cases sos_cases_scan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_cases
    ADD CONSTRAINT sos_cases_scan_id_fkey FOREIGN KEY (scan_id) REFERENCES public.scans(id);


--
-- Name: sos_notifications sos_notifications_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_notifications
    ADD CONSTRAINT sos_notifications_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.sos_cases(id);


--
-- Name: sos_notifications sos_notifications_feeder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_notifications
    ADD CONSTRAINT sos_notifications_feeder_id_fkey FOREIGN KEY (feeder_id) REFERENCES public.feeders(id);


--
-- Name: sos_notifications sos_notifications_vet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_notifications
    ADD CONSTRAINT sos_notifications_vet_id_fkey FOREIGN KEY (vet_id) REFERENCES public.vets(id);


--
-- Name: trust_events trust_events_feeder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_events
    ADD CONSTRAINT trust_events_feeder_id_fkey FOREIGN KEY (feeder_id) REFERENCES public.feeders(id);


--
-- Name: trust_events trust_events_reverses_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_events
    ADD CONSTRAINT trust_events_reverses_event_id_fkey FOREIGN KEY (reverses_event_id) REFERENCES public.trust_events(id);


--
-- Name: vets vets_feeder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vets
    ADD CONSTRAINT vets_feeder_id_fkey FOREIGN KEY (feeder_id) REFERENCES public.feeders(id);


--
-- PostgreSQL database dump complete
--


