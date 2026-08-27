# Hetja bug inventory — 2026-08-27 — base 2504622

Generated unattended. Every line cites a file:line that was read. No speculative
bugs — `STILL_BROKEN` means code at that line contradicts the invariant/contract
today; `UNVERIFIABLE` means the claim needs a live DB/box and the file cites
what would prove it. Keep under 300 lines — fixer waves consume this.

## Backend integrity
- [ ] P2-7 LRU PoW `spent_challenges` table — `apps/api/src/routes/devices.ts:132` — UNFIXED — `spentChallenges = new LRUCache({ttl: SPENT_TTL_MS})` is per-process; restart within 120s TTL lets a held (challenge,solution) mint a second token; durable `spent_challenges(signature PK)` table does not exist (comment at `devices.ts:72` admits).
- [ ] P2-6 `0011_push_subscriptions` no GRANT — `packages/db/migrations/0011_push_subscriptions.sql:20` — UNFIXED — ends at `CREATE INDEX` with no `GRANT ALL ON push_subscriptions TO app_user` block unlike `0010:52` / `0013:32`; fresh cluster leaves `app_user` without rights until manual `GRANT` from `AGENTS.md §f`.
- [ ] P2-8 Collar re-issue overwrites same row — `apps/api/src/routes/enrolment.ts:194` — UNFIXED — `ON CONFLICT (qr_code) DO UPDATE SET hmac_sig,batch_no,status='active'` mutates the single `qr_code==slug` row; no history row, `reason` only in pino; distinct from correct `DO NOTHING RETURNING` loop in `lib/enrol.ts:120`.
- [ ] P2-10 `collars.bound_once` dead column — `packages/db/migrations/0001_init.sql:41` — UNFIXED — `BOOLEAN DEFAULT TRUE` never read/written; `grep -rn bound_once apps/` has zero hits beyond schema.
- [ ] P2-11 `feeders.display_name` hardcoded — `apps/api/src/routes/auth.ts:50` / `apps/api/src/routes/feeders.ts:123` — UNFIXED — every account inserted as `'Hetja Feeder'`; `PATCH /me` is `z.strictObject({sosOptIn})` only, no display_name/ward write.
- [ ] P2-13 `docs/queries/heatmap.sql` three-way wrong — `docs/queries/heatmap.sql:6` — UNFIXED — `ST_X AS cell_lat, ST_Y AS cell_lng` swapped, `ST_SnapToGrid(geo::geometry,200)` in degrees (one cell per planet), `fed_ratio` `count(*) FILTER / count(*)` counts rows not dogs.
- [ ] P2-2 Heatmap doc vs shipped divergence — `docs/queries/heatmap.sql:11` vs `apps/api/src/routes/heatmap.ts:41` — UNFIXED — doc grids in degrees without `ST_Transform(3857)`, shipped does `Transform(SnapToGrid(Transform(...,3857),200),4326)` + `DISTINCT dog_id`; `ops/check-queries.sh` EXPLAINs the doc, not the route.
- [ ] P2-14 `fedRatio` can exceed 1 — `apps/api/src/routes/heatmap.ts:36` — UNFIXED — `round(count(*)::numeric / NULLIF(count(DISTINCT dog_id),0),3)` is feeds-per-dog (10/3→3.33) violating `contracts` `z.number().min(0).max(1)`; no clamp.
- [ ] P2-15 Grid 200m below INVARIANT 2 500m floor — `apps/api/src/routes/heatmap.ts:16` — UNFIXED — `CELL_SIZE_M=200` while `contracts/src/geo.ts:coarsenToCell(...,500)` tested and unused; `round(...,2)` coarsens output but `K_ANON` applied per 200m cell and duplicates collapse.
- [ ] P2 moderation approve unconditional re-approve — `apps/api/src/routes/moderation.ts:131` — UNFIXED — `SELECT id` then `UPDATE dog_stories SET moderated_at=now() WHERE id=$1` without `WHERE moderated_at IS NULL` and not in `withTx`; reject path `moderation.ts:176` is `withTx`+`FOR UPDATE`.
- [ ] P3 `getFeederTrust` writes on GET — `apps/api/src/lib/trust.ts:458` — UNFIXED — `getFeederTrust` → `withTx(applyVerificationGate)` may `INSERT auto_paused`; documented as only INVARIANT 15 enforcement until a review path exists (`trust.ts:440`), but still a GET that writes.
- [ ] P3 `HOST` 0.0.0.0 no `requireInProd` — `apps/api/src/config.ts:14` — UNFIXED — `HOST default "0.0.0.0"` with no `requireInProd` guard (PGPASSWORD/HMAC etc. have it at `config.ts:159`); live box is `127.0.0.1` via systemd but guard missing as `AGENTS.md §h` flags for `TRUST_PROXY`.
- [ ] P2-9/P2-24 `STORAGE_BACKEND=s3` stores none — `apps/api/src/lib/storage.ts:97` / `apps/worker/src/index.ts:358` — UNFIXED — `throw "not implemented"`; `scans.ts:52` already returned `200 {ok:true}` before `catch{log.warn}`; worker retention `return` on non-local with comment "Implement before relying on TTL" (`HOW-IT-WORKS.md:462`).

## Frontend
- [ ] Impact stats hardcoded — `apps/web/app/page.tsx:97` — UNFIXED — three `<Stat value="—" label="dogs tracked/feeds logged/lives touched" />`; no `GET /api/v1/stats` route and no `lib/api.ts` call.
- [ ] `/me` SOS opt-in has no UI — `apps/web/app/me/page.tsx:1` — UNFIXED — page queries `getStreak()` + trust only; `PATCH /api/v1/feeders/me {sosOptIn}` exists at `apps/api/src/routes/feeders.ts:123` (tested `sos.test.ts:1081`) but web never surfaces it (`grep sos_opt_in apps/web` zero hits outside tests).
- [ ] Manual collar entry drops signature — `apps/web/components/ScanEntry.tsx:60` — UNFIXED — `router.push(`/dog/${result.slug}`)` without `?s=`; `app/dog/[slug]/page.tsx:41` reads `?s=` and calls `api.getDog(slug,sig)` → empty sig → 401 on typed entry while QR scan forwards sig.
- [x] Slug alphabet off-by-one (33 chars) — `packages/db/src/slugs.ts:19` — FIXED — `ALPHABET` now 32 chars (`abcdefghijkmnopqrstuvwxyz2345678`), `VALIDATOR_ALPHABET` retains 33 for hand-minted `9` compat; masks `&31`/`%32` now index fully.
- [x] `verifySlugSig` not constant-time — `packages/db/src/slugs.ts:72` — FIXED — unified on `timingSafeEqual` with length guard, matching `apps/api/src/lib/hmac.ts:24`.

## Ops / watchdogs
- [ ] Supabase mirror drift — `docs/HOW-IT-WORKS.md:292` — UNFIXED — `ops/supabase/01_schema.sql` behind through `0009` (migrations now at `0020`); mirror serves no reads today but repoint is unsafe without `pg_dump --no-privileges` regen per `ops/supabase/README.md`.
- [ ] `STORAGE_BACKEND=s3` retention silent success — `ops/caddy/Caddyfile:147` / `apps/worker/src/index.ts:358` — UNFIXED — Caddy `/photos/*` `file_server /srv/hetja/photos` only exists for `local`; worker logs `warn` and returns on `s3` so photos retained forever (`HOW-IT-WORKS.md:462` "local path is only one that actually deletes").
- [ ] UNVERIFIABLE — backup volume empty vs nine snapshots claimed — `ops/backup/restic-backup.sh:1` / `ops/systemd/hetja-restic.timer:11` — UNVERIFIABLE — timer `OnCalendar=*-*-* 02:15 Asia/Kolkata` enabled via `bootstrap.sh:126` and `BACKUPS.md:147` claims "Verified live 2026-08-22: nine snapshots"; proving needs `restic snapshots` on the box or `/srv/hetja-backups/restic` listing.
- [ ] UNVERIFIABLE — `validate_scan` has no producer — `apps/worker/src/index.ts:779` / `docs/HOW-IT-WORKS.md:452` — UNVERIFIABLE as live gap — `JOB_PRODUCERS.validate_scan="NONE"` honestly documents that `ai_validation` stays `NULL` and INVARIANT 15 gate never fires from AI; no code enqueues it.
- [ ] UNVERIFIABLE — ledger head unpublished — `docs/INVARIANTS.md:10` / `apps/worker/src/index.ts:612` — UNVERIFIABLE as external publication — anchor computed+Merkle+signed to `ledger_anchors.published_url=''` (worker `:580`), INVARIANT 10 requires "somewhere operator does not solely control"; proving needs a third-party URL.

## Data
- [ ] `dogs.cv_embedding` / `geofences` / `alert_radius_m` dead — `packages/db/migrations/0001_init.sql:24` / `0001_init.sql:188` — UNFIXED — `cv_embedding VECTOR(768)`, `geofences.boundary/boundary`, `alert_radius_m`, `dogs_geofences` never read/written; fan-out uses hardcoded `ST_DWithin(...,2000)` at `sos.ts:167` not `alert_radius_m`.
- [ ] `SQL_ASCII / C` collation — `docs/HOW-IT-WORKS.md:474` — UNFIXED — all four DBs `SQL_ASCII`/`C` collation; Devanagari ordering broken, fixing needs dump-and-restore; recorded not fixed.
- [ ] `care_providers` locality estimates — `packages/db/src/seed-care.ts:26` / `apps/api/src/routes/care.ts:104` — UNFIXED — 81/93 providers `geo_precision='locality'` (ward centroid) + 26 `TODO: geocode`; `distanceM:null` by contract (`care.ts` omits distance unless `exact`); honest but data debt per `VET-DATA-INTAKE.md`.
- [ ] UNVERIFIABLE — 85 `medical_records` deletion with no audit — `docs/INVARIANTS.md:163` / `packages/db/migrations/0012_ledger_truncate_and_ownership.sql:3` — UNVERIFIABLE — `app_user` REVOKE+trigger blocks TRUNCATE/UPDATE but `postgres` retains `arwdDxt DELETE`; `DELETE` (not `TRUNCATE`) leaves no trigger; proving needs `SELECT count(*) FROM medical_records` and `pg_stat_user_tables` on live `hetja`.

## Verified fixed (do not re-fix)
- [x] `sos_notifications` no-op `ON CONFLICT` — `packages/db/migrations/0020_sos_network_indexes.sql:63` — FIXED — three partial unique indexes (`case_feeder_uix`, `case_vet_uix`, `case_channel_uix`) make `sos.ts:185` + `worker/index.ts:278` `ON CONFLICT DO NOTHING` arbitrate.
- [x] `vets.geo` GIST index — `packages/db/migrations/0020_sos_network_indexes.sql:21` — FIXED — `vets_geo_gix USING GIST (geo)` indexes `worker/index.ts:272` `ORDER BY v.geo <-> d.last_seen_geo`.
- [x] `GET /sos/cases/:id` any-feeder read — `apps/api/src/routes/sos.ts:493` — FIXED — `requireFeeder` + `parseUuidParam` + `acked_by OR EXISTS(sos_notifications WHERE feeder_id) OR moderate` else `403`.
- [x] SOS resolve/close route — `apps/api/src/routes/sos.ts:572` — FIXED — `POST /cases/:id/resolve` conditional `WHERE resolved_at IS NULL AND state IN ('open','acked','escalated')` idempotent.
- [x] SOS caps rolling windows — `apps/api/src/routes/sos.ts:302` — FIXED — `WHERE received_at >= now() - interval '1 day'/'7 days'` rolling; `INVARIANTS.md:152` records calendar `date_trunc` bug.
- [x] Device PoW IP-bypass via base64 — `apps/api/src/routes/devices.ts:38` — FIXED — canonical deviceSubject used for mint bucket; `lib/rate-limit.ts` global mint bucket added.
- [x] `STORAGE_BACKEND=s3` silent accept — `apps/api/src/config.ts:139` — FIXED — boot `throw` for `s3` in every env; `scans.ts:236` `decodePhotoUpload` validates before `withTx` → `400 INVALID_PHOTO`.
- [x] Hardcoded 64-hex DB password — `apps/api/src/config.ts:29` / `packages/db/src/pool.ts:101` / `ops/check-queries.sh:26` — FIXED — no literal; `PGPASSWORD=${PGPASSWORD:-}` defaults to `_test`.
- [x] `check-queries.sh` swallowing stderr / wrong DB — `ops/check-queries.sh:25` / `ops/check-queries.sh:52` — FIXED — defaults `hetja_test` min `*_test` guard, captures stderr and prints on FAIL.
- [x] `security-gate.sh` blind to high-entropy hex — `ops/security-gate.sh:166` — FIXED — `hex_secret_hits` greps `([0-9a-f]{48,})` outside test/fixtures.
- [x] `scans`/`trust_events` unbounded seq scans — `packages/db/migrations/0020_sos_network_indexes.sql:32` / `apps/api/src/lib/trust.ts:315` — FIXED — `scans_feeder_recent_ix` + `trust_events_feeder_ix` plus `LIMIT 3` on serial-reject count.
- [x] Invalid UUID 22P02 → 500 — `apps/api/src/lib/params.ts:1` / `apps/api/src/routes/sos.ts:498` — FIXED — `parseUuidParam` → `400 INVALID_*_ID`; tests `sos.test.ts:728`, `moderation.test.ts:76`.
- [x] Feeder-authed SOS no attribution / shared dedupe — `apps/api/src/routes/sos.ts:239` — FIXED — `deterministicUuid("sos-report",[feederId??deviceSubject,slug,severity,note])` per-account; `INSERT feeder_id, device_token` at `:350`.
- [x] Offline sync walks streak backwards — `apps/api/src/lib/gamification.ts:106` / `apps/api/src/routes/scans.ts:286` — FIXED — monotonicity guard `if (today < lastFeedDate) return` and same-day/`daysBetween===1` guards.
- [x] Moderation double-decrement trust — `apps/api/src/routes/moderation.ts:193` — FIXED — `withTx` + `logTrustEvent` + `recomputeScore` replaces direct `UPDATE trust_score -5`.
- [x] `withTx` poisoned client + masked error — `packages/db/src/pool.ts:137` — FIXED — `try{ROLLBACK}catch(rollbackErr)` + `client.release(rollbackErr)` + `throw original err`.
- [x] Consent/minor freeze at first login — `apps/api/src/routes/auth.ts:49` — FIXED — `DO UPDATE SET consent_version=EXCLUDED.consent_version, is_minor=EXCLUDED.is_minor`.
- [x] Push subscription hijack — `apps/api/src/routes/push.ts:86` — FIXED — `DO UPDATE ... WHERE push_subscriptions.feeder_id=EXCLUDED.feeder_id` scoped + `409 PUSH_ENDPOINT_OWNED`.
- [x] `mintUnusedSlug` SELECT-then-INSERT TOCTOU — `apps/api/src/lib/enrol.ts:120` — FIXED — `INSERT ... ON CONFLICT (slug) DO NOTHING RETURNING` retry loop.
- [x] `otp too_many_attempts` unreachable — `apps/api/src/lib/otp.ts:67` — FIXED — atomic `UPDATE attempts_used+1 RETURNING` before `if (used>MAX)`.
- [x] `TRUST_EVENTS.reversal` not in catalog — `apps/api/src/lib/trust.ts:73` — FIXED — `reversal:0, auto_paused:0` in catalog; `lib/trust.ts:284` writes `reversal`.
- [x] Scan photo/vaccine mapping — `apps/scan/src/api.ts:92` — FIXED — `normalizeProfile` reads `vaccineStatus` + `photoKey` via `photoUrlFromKey`; prior `d.vaccine`/`d.photoUrl` always undefined.
- [x] Anonymous feed device token omitted — `apps/scan/src/flush.ts:39` / `apps/web/components/FeedButton.tsx:93` — FIXED — `x-device-token` from `deviceToken` at capture; tokenless dropped via `onDrop`/`recordDroppedFeed`.
- [x] Feed geo precedence — `apps/web/components/FeedButton.tsx:60` — FIXED — `consentedGeo ?? photoGeo` with `captureGeo()` winning over ward-coarsened EXIF.
- [x] Caddy `CF-Connecting-IP` / cache headers — `ops/caddy/Caddyfile:60` / `ops/caddy/Caddyfile:77` — FIXED — `trusted_proxies cloudflare` + `real_ip` rewrite, `/api/v1/*` `no-store`, `/photos/*` `immutable`, `/care*` `public max-age=60`.
- [x] Systemd stale units / OOM containment — `ops/systemd/hetja-api.service:9` / `ops/check-systemd.sh:1` — FIXED — `After postgresql.service`, `MemoryHigh/Max` (api 350/500, web 400/650), `__NODE_BIN__` templating.
- [x] Worker anchor/retention idempotent schedulers — `apps/worker/src/index.ts:668` / `apps/worker/src/index.ts:718` — FIXED — `pg_try_advisory_xact_lock` + `NOT EXISTS (jobs failed_at IS NULL)` + `NOT EXISTS (ledger_anchors > now()-24h)`; empty ledger returns `null` no row (`worker/index.ts:579`).
- [x] `e2e/routes.ts` missing `/register` — `apps/web/e2e/routes.ts:16` — FIXED — `STATIC_ROUTES` includes `/register`.
- [x] `scan` size gate walks `dist/` — `apps/scan/scripts/size-gate.mjs:46` — FIXED — walks `dist/`, excludes `.map`, split `main.js`/`service-worker.js`/`telemetry.js`.
- [x] `HOW-IT-WORKS §3.2` wrong SOS route — `docs/HOW-IT-WORKS.md:130` — FIXED — `POST /api/v1/reports`.
- [x] Table-count drift 18 vs 15 — `docs/HOW-IT-WORKS.md:192` — FIXED — "Nineteen domain tables plus schema_migrations".
- [x] `verifySlugSig` timing-safe — `packages/db/src/slugs.ts:72` / `apps/api/src/lib/hmac.ts:24` — FIXED — both use `timingSafeEqual` with length guard (unified constant-time).
- [x] Slug alphabet 33→32 — `packages/db/src/slugs.ts:19` — FIXED — `ALPHABET` 32 chars, `VALIDATOR_ALPHABET` 33 for `9` compat; masks `&31`/`%32` now index fully without reindexing.
