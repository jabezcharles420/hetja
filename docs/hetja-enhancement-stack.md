# Hetja — GitHub Repo Enhancement Stack (v2, expanded)

> Prepared by an 11-agent research swarm (10 stream researchers + 1 cross-stream auditor) · **2026-08-13 IST**
> Method: each stream was researched independently by a dedicated agent that web-verified every repo live on GitHub (stars, archived status, canonical URL, license). The audit agent then read all 10 streams + the existing v1 doc, deduplicated entries, debated disagreements, and produced the priority roadmap. Star counts drift daily — treat them as captured-at-research-time. Nothing in this document is from memory alone.

## What's new in v2 (read this first)

v1 of this doc covered three buckets — AI/Vision, SOS infrastructure, and the field portal surface. v2 adds **ten new streams** that v1 didn't touch, plus a cross-stream audit that re-graded every pick:

- **Trust, anti-abuse & cryptographic ledger** (Stream A) — Merkle proofs over `medical_records`, W3C verifiable credentials for vet-signed vaccinations, Altcha PoW, EigenTrust over the feeder graph.
- **Real-time comm & multi-channel notifications** (Stream B) — Telegram bots, WhatsApp Cloud API wrappers, native Web Speech for the illiterate stranger, WebSocket responder coordination, the IVR-vs-paid-service trade-off.
- **Geospatial — routing, mapping UI, indexing, self-hosted tiles** (Stream C) — OSRM/Valhalla for drive-time, MapLibre GL JS for UI, H3 for geofence fan-out, PMTiles + Martin for static tile serving.
- **Auth, passkeys, encryption, DPDP, audit logging** (Stream D) — SimpleWebAuthn for optional passkeys, libphonenumber-js for E.164 normalization, tweetnacl for field-level encryption, pgaudit for the DB audit floor.
- **Offline-first & field data collection** (Stream E) — RxDB for the tagger portal, Yjs for collaborative retag, TanStack Query for resilient photo uploads, Uppy + tusd for resumable uploads to R2.
- **Search, analytics & dashboards** (Stream F) — ParadeDB for in-Postgres BM25, TimescaleDB for hypertables, Umami/Plausible for cookieless analytics, Metabase cloud for NGO self-serve BI.
- **Vet/animal domain tools** (Stream G) — shelter-mgmt schemas (ASM3), DIVOC verifiable-credential spec for vet-signed vaccinations, triplet-loss animal re-ID, ISO 11784/11785 microchip reader firmware.
- **QR scanning & image processing** (Stream H) — BarcodeDetector polyfill for iOS Safari, compressorjs for auto-orient, exifr for orientation + GPS, sharp-phash for duplicate detection, inspector-bokeh for blur warnings.
- **DevOps, DR, secrets & feature flags** (Stream I) — wal-g for PG PITR to R2, restic for file backups, caddy-cloudflare-ip for real-IP rate limiting, Renovate for monorepo dep PRs, Upptime for static status pages.
- **Performance, caching & accessibility deeper** (Stream J) — lru-cache for `care_providers`, @fastify/compress + etag, imgproxy for on-demand dog-photo derivatives, web-vitals field measurement, chroma.js for WCAG contrast CI, @axe-core/playwright for a11y gates.

**The single most important finding the audit surfaced:** Hetja itself is AGPL-3.0-licensed (`github.com/jabezcharles420/hetja`, verified directly via the GitHub API). This **inverts** the AGPL license anxiety that runs through several streams. Self-hosting Metabase, Plausible, Grafana, Loki, Unleash, ParadeDB, Renovate, Soketi, Garage on Hetja's box is license-fine; the operational constraint (OOM risk, one-box shape, redundant with existing tools) becomes the only real filter. AGPL does **not** resolve the browser-bundle GPL ambiguity for snarkjs/pow-bot-deterrent/whatsapp-cloud-api (still reject), nor does it make BUSL/Sustainable-Use/FCL/BSL-derived licenses magically compatible (still reject Dragonfly, n8n, Realm).

**The single most important operational finding:** the *needs-second-box cluster* — OSRM, Novu, Chatwoot, PostHog self-host, Metabase self-host, Pelias self-host, Asterisk/FreeSWITCH — recurs across five streams independently. The honest answer: cloud-free-tier where one exists, defer to Phase 5+ otherwise, reject Apache Superset/Matomo/pm2/Garage outright.

---

## What Hetja is (30 seconds, for new readers)

Street dogs wear QR collars. A stranger scans with any phone camera — no app, no account — and gets the dog's page: name, vaccination/sterilisation status, last-seen, story, and one big **"this dog is hurt"** button. That button shows nearby vets/NGOs/ambulances with tappable numbers *and* wakes geofenced responders via push (first ack wins atomically via `WHERE acked_by IS NULL`, unacknowledged cases escalate after 8 min).

**Stack:** Next.js 14 web · vanilla-TS scan app (40 KB budget) · Fastify 5 API · Node worker · PostgreSQL 16 + PostGIS + pgvector · Cloudflare tunnel → Caddy → systemd · GitHub Actions CI with custom gates (destructive-migration gate, security-gate.sh, 40 KB size gate) · one OVH VPS, no inbound ports.

**The rule underneath everything:** *the system may know less than it wants; it may not claim more than it knows.* Every recommendation below respects that — AI output is flagged unverified, `distanceM` stays `null` until geocoding lands, the append-only hash-chained medical ledger never accepts machine-written records.

---

## §A. Vision & AI layer (`apps/ai`) *(existing — summary; see v1 for detail)*

Five repo families cover Hetja's AI needs: annotation tools (Label Studio ★27.7k, CVAT ★15.9k, supervision ★41.1k); detection models (Ultralytics YOLO ★58.6k ⚠️ AGPL — fine alongside Hetja AGPL; Grounding DINO ★10.2k; SAM ★54.5k); image embeddings for "find this dog by photo" (CLIP ★33.9k, sentence-transformers ★18.8k, SigLIP via HF transformers); on-device browser inference (Transformers.js ★16.1k, ONNX Runtime ★21.4k, MediaPipe ★36.3k); model serving (Roboflow Inference ★2.4k — or skip serving entirely and run ONNX Runtime inside the Node worker). **v2 update:** InsightFace is the wrong domain (human faces, non-commercial weights) — skip for dog re-ID. Use DogFaceNet ★161 as a research reference, not a runtime dependency. Stream G §G.5 adds `owahltinez/triplet-loss-animal-reid` ★14 MIT as the active training scaffold for the re-ID pipeline.

## §B. SOS machine & infrastructure *(existing — summary; see v1 for detail)*

The SOS machine is the real risk, not the AI. v1 picks stand: **BullMQ ★9.3k** (PostgreSQL backend, no Redis on the box) for the 8-min escalator and tier-2 fan-out; **graphile/worker ★2.3k** as the pure-PG alternative; **web-push ★3.5k** for the Web Push protocol; **capacitor ★16.3k** for the native iOS/Android shell that closes the iOS-push gap; **rate-limiter-flexible ★3.6k** (Memory/PostgreSQL backends) for hard per-IP + per-collar caps on the unauthenticated SOS route; **photon ★2.9k** for free OSM geocoding of the ~25 ward-centroid providers; **pino ★17.9k** for structured logs; **Sentry cloud free tier** (self-hosted is Kafka/ClickHouse, too heavy for one box); **uptime-kuma ★89.2k** for self-hosted uptime; **healthchecks ★10.1k** for worker heartbeats; **playwright ★91.3k** for E2E on the two life-safety flows; **nodemailer ★17.6k** for SMTP. **v2 update:** raise `DEVICE_POW_DIFFICULTY` from 14 to 18–20 and pair with Stream A's `altcha-org/altcha` ★2.7k MIT to replace the hand-rolled PoW (closes the documented "challenge token can be reused" gap).

## §C. Field portal, language & shipping *(existing — summary; see v1 for detail)*

For the unbuilt `apps/field` tagger portal: **refine ★34.9k** or **react-admin ★26.9k** for the admin/CRUD framework. For i18n (EN/HI/MR on the cheap phone): **next-intl ★4.3k** as the default (App Router-native, ICU plurals, lean bundle); **next-i18next ★6.2k** is NOT archived (v16 supports App Router — the "archived" claim is outdated). For QR generation: **node-qrcode ★8.2k** (error-correction H for scratched street collars) + **qrcode.react ★4.3k** + **pdfkit ★10.7k** for collar-sheet PDFs. For DB migrations on PG+PostGIS: **node-pg-migrate ★1.5k** + **drizzle-orm ★35.4k** or **kysely ★14.1k**. For image upload: **uploadthing ★5.3k** + **sharp ★32.6k** + **@aws-sdk/client-s3** (R2-compatible). For security: **@fastify/helmet**, **@fastify/csrf-protection**, **@fastify/rate-limit**. For local CI: **act ★71k** + **turborepo ★30.8k** + **changesets ★12.3k**. For accessibility: **axe-core ★7.3k**.

---

## §D. Trust, anti-abuse & cryptographic ledger *(new — Stream A)*

Hetja's trust score is currently a tally of `trust_events` rows. INVARIANT 9 enforces the hash-chained `medical_records` ledger, but the chain only defends ordering — it doesn't prove inclusion to a third party. Stream A researched the tooling that closes both gaps.

### D.1 Tamper-evident logs / Merkle trees (upgrades INVARIANT 9)
- **merkletreejs/merkletreejs ★1.2k** — [canonical](https://github.com/merkletreejs/merkletreejs) — MIT, active. Builds a Merkle tree over each dog's `medical_records` rows on each insert, persisted alongside the chain head. The `verifyProof` function is what an external auditor (court, municipal vet office) would call against a printed root from a cruelty-case exhibit. **Why it fits Hetja:** direct INVARIANT 9 upgrade. The existing `prev_hash` chain defends ordering; the Merkle root defends inclusion. A third party can verify a specific record's inclusion in O(log n) without seeing the whole table. Server-side (`packages/ledger`), not in `apps/scan`. Browser build needs `Buffer` polyfill.
- **panva/jose ★7.7k** — [canonical](https://github.com/panva/jose) — MIT, active. JOSE layer (JWS/JWE/JWKS) for vet-key rotation and signed scan-page proofs. Replaces ad-hoc crypto in `packages/ledger`. Both Stream A and Stream D independently converge on this as the #1 crypto pick. Pairs with the Merkle root: the root is signed with `jose` so an auditor can verify it was issued by Hetja.

### D.2 W3C Verifiable Credentials (vet-signed vaccination records)
- **decentralized-identity/did-jwt-vc ★211** — [canonical](https://github.com/decentralized-identity/did-jwt-vc) — Apache-2.0, active. JWT-VC issuance library. **The pairing:** a vet signs a vaccination record with their `vets.signing_key_pub`, the credential is a JWT-VC whose payload follows the DIVOC schema (Stream G §G.7), anyone scanning the collar can verify it. The vet's DID is `did:web:hetja.in:vets/<vet_id>`, the public key resolves via a JWKS endpoint built with `panva/jose`. **Phase 3, conditional on second vet signing up.**

### D.3 Zero-knowledge proofs (rejected for now)
- **iden3/snarkjs ★1.5k** — GPL-3.0 + browser bundle. **REJECT** — Hetja's scale doesn't justify ZK, and the browser-bundle GPL ambiguity isn't resolved by Hetja's own AGPL. If privacy-preserving "is this dog vaccinated?" proofs ever become a real need, reconsider then.
- **paulmillr/noble-hashes ★897** — MIT, active. Audited pure-JS hashes for `packages/ledger` browser code (where `Buffer`/`node:crypto` aren't available). **Phase 2.**

### D.4 Anti-abuse / proof-of-work (replaces hand-rolled PoW)
- **altcha-org/altcha ★2.7k** — [canonical](https://github.com/altcha-org/altcha) — MIT, active. Maintained PoW widget, replaces Hetja's hand-rolled PoW on `/api/v1/reports`. **Closes the documented "challenge token can be reused" gap.** PoW has documented bypass techniques — treat as a throttle, not a gate. Server-side rate caps remain the real defence. **Phase 1.**
- **fingerprintjs/BotD ★1.4k** — MIT. Browser-side bot-detection boolean. Transmit only the boolean `bot: true/false`, never the raw fingerprint (INVARIANT 3 tension). Server-side or authenticated-side only; never on `apps/scan`.
- **thumbmarkjs/thumbmarkjs ★1.1k** — MIT. Authenticated-side device fingerprint for multi-device feeder detection. Hash under pepper before persistence.

### D.5 Reputation / trust algorithms
- **graphology/graphology ★1.7k** — [canonical](https://github.com/graphology/graphology) — MIT, active. Nightly EigenTrust or PageRank over the feeder trust graph (built from `trust_events`). **Conditional, post-1000-feeders.** At current pilot scale, the trust_events tally is sufficient; graph-based trust adds value when feeder relationships need weighting.
- **EigenTrust reference: Karma3Labs/rs-eigentrust-snaps** — no license file. Read for the algorithm, don't depend on it.

### D.6 Sybil resistance (escalated, not solved)
No off-the-shelf sybil-resistance tool fits Hetja's shape. `proof-of-humanity/proof-of-humanity` is dormant (2023); `worldcoin/world-id-contracts` requires proprietary Orb hardware; `decentralized-identity/ion` was sunset by Microsoft in 2023. **The honest answer:** Hetja's sybil resistance is operational — email magic-code + device-token PoW + IP rate caps + behavioural review. Layer `fingerprintjs/BotD` as a one-bit signal, not a ground truth.

### D.7 DIDs (decentralized identifiers) — for vet identity
- **did:web** (no library needed) — the vet's DID is `did:web:hetja.in:vets/<vet_id>`, resolving via a `.well-known/did.json` endpoint. Simplest possible DID method; no blockchain, no ION, no Indy. Pairs with `did-jwt-vc` for vet-signed credentials.

### D.8 Rejected (for audit trail)
- `proof-of-humanity/proof-of-humanity` — dormant 2023, Ethereum + Kleros court — wrong shape for Indian street feeders.
- `worldcoin/world-id-contracts` — proprietary Orb hardware.
- `decentralized-identity/ion` — Microsoft sunset 2023.
- `spruceid/didkit` — archived 2025-07.
- `ChainSafe/persistent-merkle-tree`, `summa-dev/merkle-sum-tree-ts`, `worldcoin/world-id-js` — all archived.
- `indutny/proof-of-work` — no license file, stale 2020.
- `iden3/snarkjs`, `iden3/circom`, `iden3/circomlibjs` — GPL-3.0, browser-bundle ambiguity.
- `sequentialread/pow-bot-deterrent` — GPL-3.0; use `altcha-org/altcha` (MIT) instead.

---

## §E. Real-time communication & multi-channel notifications *(new — Stream B)*

Hetja's notifications today are Brevo email (300/day free) for login codes and Web Push for SOS fan-out (broken on iOS without the unbuilt native shell). Most Indian users live on WhatsApp; some can't read; a phone-call SOS line would close the illiterate-user gap entirely. Stream B researched the OSS landscape, with the "runs on nothing" rule as the filter.

### E.1 WhatsApp Business API (most Indian users)
- **great-detail/WhatsApp-JS-SDK ★39** — [canonical](https://github.com/great-detail/WhatsApp-JS-SDK) — MIT, active. Thin wrapper for WhatsApp Cloud API. Stranger-facing SOS ack + 2-way photo upload. Stays in WhatsApp Cloud API's 1,000 free service-conversations/month tier. **Caveat:** paid Cloud API account required (Meta Verified Business); pricing is per-conversation, not per-message.
- **Alternative: froggy1014/meta-cloud-api** — sister alternative if great-detail's API shape doesn't fit.
- **REJECT: tawn33y/whatsapp-cloud-api** — GPL-3.0; browser-bundle ambiguity.
- **REJECT: WhatsApp/WhatsApp-Nodejs-SDK** — Meta's official SDK, **archived 2023-06-07**. Use `great-detail` or raw `fetch`.
- **REJECT: Baileys / whatsapp-web.js / wppconnect / open-wa / evolution-api** — unofficial WhatsApp Web wrappers. They work today but violate WhatsApp ToS; ban risk is real. Fine for personal experiments, wrong for life-safety infra.

### E.2 Telegram bots (responder coordination, public SOS channel)
- **telegraf/telegraf ★9.2k** — [canonical](https://github.com/telegraf/telegraf) — MIT, active. Telegram bot for responder coordination; inline "Claim" button calls `/sos/cases/:id/ack`. **Closes the iOS-push gap for Telegram-using responders** — no paid accounts, no app install. Bot API 7.1 lags upstream Telegram API slightly. Web Push still needed for non-Telegram responders. **Phase 1.**
- **grammyjs/grammy ★9.0k** — MIT. Alternative if Telegraf's API feels dated; cleaner TypeScript.
- **python-telegram-bot/python-telegram-bot ★27k** — GPL-3.0 (compatible with Hetja AGPL). Pick only if a Python sidecar exists.

### E.3 Multi-channel notification orchestration
- **novuhq/novu ★39.5k** — AGPL-3.0 (fine alongside Hetja AGPL). Architecturally right (fan one SOS to push + WhatsApp + SMS + email from one trigger). **REJECT for one-box** — needs Mongo + Redis + ~700 MB RSS, same OOM-kill pattern that previously killed the web app. Defer to Phase 5 (second box). For pilot: hand-rolled fan-out in the worker.
- **Apprise ★13.6k** — MIT, BSD-3, MPL-2.0 (multi-licensed). Push notification library that fans out to ~100+ services. Lighter than Novu; useful for ops-side notifications (status alerts to Telegram + email + Slack), not life-safety SOS fan-out.

### E.4 Indian SMS providers (the "no SMS" rule holds)
- **MSG91 / Gupshup / TextLocal** — all paid + mandatory DLT registration under TRAI rules. HOW-IT-WORKS's "no SMS" stance remains correct: DLT paperwork + per-message cost violates "runs on nothing." Reconsider only if WhatsApp Cloud API proves insufficient for OTP delivery (it shouldn't).
- **REJECT: Twilio** — international pricing ~₹0.50+/SMS, double DLT paperwork.

### E.5 IVR / voice for illiterate users (escalated to user decision)
- **Exotel** (~₹1,000/month + ₹0.50/min) — hosted IVR; webhook-driven architecture fits no-inbound-ports deployment. Audio media stays on Exotel; only REST hooks traverse the Cloudflare tunnel. Closes the gap for a stranger who cannot read the scan page at all.
- **REJECT: Asterisk + FreeSWITCH self-hosted** — want UDP ports; the no-inbound-ports rule kills them. The Cloudflare tunnel is TCP-only.
- **REJECT: sptmru/voiceivr** — ★6 stale POC, no license file.
- **Audit verdict: ESCALATE TO USER.** Exotel is the only recommendation in this entire doc that introduces a recurring paid service. The decision depends on Hetja's funding trajectory and the actual measured illiterate-user gap. If Web Speech API (below) closes 90% of the gap, Exotel may not be needed.

### E.6 In-app messaging (feeder ↔ stranger, privacy-preserving)
- **Chatwoot ★35.8k** — AGPL-3.0 (fine alongside Hetja AGPL). Shared inbox. **REJECT for one-box** — Rails + Postgres + Redis + ~1.5 GB; same OOM-kill risk as Novu. Defer to Phase 5.
- **Matrix / Synapse** — AGPL-3.0. Federation model doesn't fit Hetja's "one central service" shape. Skip.

### E.7 Web Speech API / TTS / STT (zero-KB voice for the scan page)
- **Native Web Speech API (no repo)** — W3C spec, zero KB, fits the 40 KB scan budget. `speechSynthesis.speak(new SpeechSynthesisUtterance("This dog is named Sheru. Press the SOS button to alert nearby responders."))` is a one-liner that works on 95%+ of Indian Android phones. **Phase 0** — closes the illiterate-user gap at zero cost.
- **leaonline/easy-speech ★124** — MIT, ~3 KB polyfill for voice-loading bugs in older browsers. Use only if QA surfaces bugs.
- **meSpeak.js ★650** — MIT, ~150 KB, offline, robotic. Use only if offline TTS becomes a hard requirement.
- **REJECT: responsiveVoice.js** — commercial, 150 KB (3.75× the scan budget), sends device fingerprint to third party (INVARIANT 3 violation).
- **REJECT: ar-tts** — Arabic-specific; irrelevant to Hetja's EN/HI/MR locales.

### E.8 Real-time responder chat (beyond push)
- **websockets/ws ★22.8k** — [canonical](https://github.com/websockets/ws) — MIT, active. Bare WebSocket for in-process responder real-time. No new service on the one-box. **Phase 3.**
- **centrifugal/centrifugo ★8.6k** — Apache-2.0. ~30 MB RSS — lighter than Novu/Chatwoot. **Phase 4** — only when realtime fan-out volume grows beyond an in-process `Map`.
- **Socket.IO ★62k** — MIT. Heavier than `ws`; the namespaces/rooms abstraction isn't worth the cost for Hetja's two channels (case updates, responder chat).
- **REJECT: soketi/soketi** — AGPL-3.0 (audit overturns the license rejection — Hetja AGPL makes it fine) but **operationally** `ws` is leaner.

### E.9 WebRTC / TURN (direct audio between responder and stranger)
- **simple-peer ★6.7k** + **PeerJS ★11.3k** + **coturn ★11.8k** — WebRTC stack for direct audio. **REJECT operationally** — TURN needs UDP, Cloudflare tunnel is TCP-only. WhatsApp relay covers the same use case free.

---

## §F. Geospatial — routing, mapping UI, indexing, self-hosted tiles *(new — Stream C)*

Hetja uses PostGIS for geofences and care_providers but has no real routing ("drive time to the injured dog"), no map UI for displaying nearby providers, and no geospatial indexing for fast geofence lookups at scale. Stream C researched the full geospatial stack — and surfaced the most important license correction in the entire doc.

### F.1 Routing engines (drive-time to injured dog, multi-responder dispatch)
- **Project-OSRM/osrm-backend ★7.97k** — [canonical](https://github.com/Project-OSRM/osrm-backend) — BSD-2-Clause, active. The standard routing engine. 4–8 GB RAM at runtime + 6–8 GB disk for India CH. **Phase 5 (second box)** — too heavy for the OVH VPS. Use public OSRM demo for dev.
- **valhalla/valhalla ★6.1k** — MIT, active. Mapbox's routing engine. Same one-box constraint as OSRM. Tighter license terms; same Phase 5 deferral.
- **graphhopper/graphhopper ★6.6k** — Apache-2.0. ~300 MB JVM baseline + India extract. **Phase 5 (second box)** — adds JVM to the box.
- **GIScience/openrouteservice ★2.0k** — GPL-3.0 (fine alongside Hetja AGPL). Java, similar to GraphHopper. **Phase 5 (second box, separate service).**

### F.2 Mapping UI libraries
- **maplibre/maplibre-gl-js ★11.3k** — [canonical](https://github.com/maplibre/maplibre-gl-js) — BSD-3-Clause, active. **The MapLibre GL JS fork is the canonical pick** after Mapbox's license change. The 40 KB scan-app budget is incompatible with any mapping UI library — MapLibre belongs in `apps/web` and the future `apps/field`, never on `/d/<slug>`. **Phase 3.**
- **Leaflet/Leaflet ★45.5k** — BSD-2-Clause. Lighter, simpler; good for static marker maps. Use when MapLibre GL JS is overkill.
- **OpenLayers ★11.5k** — BSD-2-Clause. Most feature-complete, heaviest. Use only if MapLibre can't handle a specific projection need.

**⚠️ CRITICAL CORRECTION:** **mapbox/mapbox-gl-js ★12.4k** changed license from BSD-2-Clause → proprietary in v2.0 (2021). **REJECT.** Use the MapLibre GL JS fork (BSD-3-Clause). This is the single most important license correction in the entire doc — never wire `mapbox-gl-js` into a new Hetja app.

### F.3 Geospatial indexing (fast geofence lookups at scale)
- **uber/h3 ★6.5k** + **uber/h3-js ★1.1k** — [canonical](https://github.com/uber/h3) — Apache-2.0. Hexagonal hierarchical grid for fast geofence fan-out. `latLngToCell(dog_lat, dog_lng, RES_11)` computes the dog's H3 cell, `gridDisk(cell, 2)` gets the 19 surrounding cells, `SELECT ... FROM responders WHERE h3_index = ANY($1)` finds eligible responders. **Phase 4 — premature at current scale.** PostGIS GiST handles hundreds of providers/responders fine.
- **google/s2geometry ★2.7k** — Apache-2.0. Google's alternative to H3. More precise but less commonly used in JS. H3 wins on ecosystem.

### F.4 JS geospatial analysis (point-in-polygon, distance, buffers)
- **Turfjs/turf ★10.4k** — [canonical](https://github.com/Turfjs/turf) — MIT, active. The standard JS geospatial analysis library. Use for point-in-polygon checks (is this scan inside a geofence?), distance calculations, buffer zones. Tree-shake aggressively — the full `turf` package is huge; import per-function.
- **manuelbieh/geolib ★4.3k** — MIT. Lighter alternative for distance/bearing-only needs.
- **mourner/rbush ★2.8k** + **mourner/flatbush ★1.6k** — ISC. R-tree spatial index for fast bounding-box queries in JS. Useful for client-side geofence checks.
- **bjornharrtell/jsts ★1.6k** — BSD-3-Clause OR EPL-2.0. JS port of JTS (Java Topology Suite). Use for complex polygon operations Turf doesn't support.
- **placemark/check-geojson ★84** — MIT. GeoJSON validator. Use in the tagger portal's geofence-drawing save path to reject malformed polygons.

### F.5 Self-hosted tile servers
- **maplibre/martin ★3.8k** — [canonical](https://github.com/maplibre/martin) — Apache-2.0, active. PostGIS-to-MVT (Mapbox Vector Tiles) server. Lightweight Rust binary; serves live data layers (e.g., dog sightings heatmap) directly from PostGIS. **Phase 4.**
- **maptiler/tileserver-gl ★2.9k** — BSD-3-Clause. Serves pre-baked raster/vector tiles from MBTiles files. Use for the India basemap.
- **go-spatial/tegola ★1.5k** — MIT. Go-based alternative to Martin. Pick Martin unless Go is preferred for ops reasons.

### F.6 Tile generation
- **mapbox/tippecanoe ★3.1k** — BSD-2-Clause. The standard tool for baking GeoJSON into MBTiles/PMTiles. Run on a dev box, ship the output to R2. **Phase 3.**
- **protomaps/PMTiles ★3.0k** — BSD-3-Clause. Static-file format for tile serving — no tile-server daemon needed, served via HTTP range requests. **The right India basemap answer:** bake once with Tippecanoe, host on R2 as a static file, MapLibre GL JS reads it via the `pmtiles` protocol. **Phase 3.**
- **REJECT: protomaps/protomaps-leaflet** — maintenance mode per docs.protomaps.com; use MapLibre GL JS + PMTiles for new projects.

### F.7 OSM data import (India extract)
- **osm2pgsql-dev/osm2pgsql ★1.7k** — GPL-2.0 (fine alongside Hetja AGPL). The standard OSM-to-PostGIS importer. India extract is ~1.5 GB PBF; needs ~8 GB RAM to import. **Phase 5 (dev box bake).**
- **omniscale/imposm3 ★772** — Apache-2.0. Alternative importer; faster than osm2pgsql for some workloads.

### F.8 Isochrones (reachability maps)
- **Valhalla `/isochrone` endpoint** (MIT) — the right way to compute "this ambulance can reach anywhere in 8 minutes." Requires running Valhalla (Phase 5 second box).

### F.9 India boundary data (data, not code)
- **datameet/Municipal_Spatial_Data ★150** — community-maintained Indian municipal/ward boundary polygons. Use as the ground-truth geofence layer for Mumbai wards.

### F.10 The 40 KB scan-app budget (honesty rule)
Every recommendation in this stream is **incompatible with `apps/scan`**. Map UI belongs in `apps/web` (logged-in feeders/responders) and `apps/field`. INVARIANT 2 (location coarsening) means even a hypothetical 40 KB map UI couldn't show anything more precise than "Mumbai" to anonymous viewers — a printed place name communicates that better.

---


## §G. Auth, passkeys, encryption, DPDP & audit logging *(new — Stream D)*

Hetja's auth model is email magic-code (no passwords, no SMS) + `identity_hmac` (HMAC-SHA256 of email under a server-held pepper) + proof-of-work device tokens for anonymous writes. INVARIANT 3 enforces the privacy stance. Stream D researched the tooling that strengthens each layer without breaking the invariants.

### G.1 WebAuthn / passkeys (optional, never required)
- **MasterKale/SimpleWebAuthn ★2.3k** — [canonical](https://github.com/MasterKale/SimpleWebAuthn) — MIT, active. Optional passkey path for power-feeders; falls back to email code. **The correct Hetja shape:** "never require, always offer, fall back to email code" — same pattern as the camera `BarcodeDetector` fallback in `apps/scan`. **Caveat:** WebAuthn on ₹3,000 Android works (Android 9+, 2018) via Google Password Manager platform authenticator; the fingerprint is opportunistic (PIN/pattern fallback). **Phase 3, conditional on `apps/field` shipping.**
- **webauthn-open-source/fido2-lib ★444** — MIT. Server-side WebAuthn library; alternative to SimpleWebAuthn if you want server-only without the browser companion package.
- **REJECT: github/webauthn-json ★789** — **archived 2025-08-25**. GitHub's own wrapper; README now points to native WebAuthn API. Use `@simplewebauthn/browser` instead.

### G.2 OTP libraries (replace hand-rolled code)
- **yeojz/otplib ★2.3k** — MIT, active. Standard TOTP/HOTP library. Hetja rolls its own 6-digit code hashing today; `otplib` would standardize it. **Caveat:** Hetja's email codes aren't TOTP (they're random 6-digit, hashed with SHA-256+pepper, 5-min TTL, 3 attempts) — `otplib` is overkill unless TOTP is added later for admin 2FA.
- **hectorm/otpauth ★1.5k** — MIT. Lighter alternative if TOTP is needed.

### G.3 Phone number validation (closes the half-unverified `phone_verified_at` gap)
- **catamphetamine/libphonenumber-js ★3.0k** — [canonical](https://github.com/catamphetamine/libphonenumber-js) — MIT, active. JS port of Google's libphonenumber. Normalises `care_providers.phone` to E.164, validates mobile-only for India, formats for display. Tree-shakes to ~140 KB if you import only India metadata; **apps/web only, never apps/scan.** **Phase 1 — Stream D's #1 pick.**
- **google/libphonenumber ★18.2k** — Apache-2.0. The original Java/C++ library. Use as the reference if a Python or Ruby sidecar ever needs it.

### G.4 Email validation (Brevo bounce reduction)
- **mfbx9da4/deep-email-validator ★922** — MIT. Regex + DNS + SMTP-check validation. Cuts Brevo bounces before they hurt the 300/day quota.
- **mailcheck/mailcheck ★7.9k** — MIT. "Did you mean `gmail.com`?" typo suggestion. Low-activity since 2022; refresh the domain list and inline.

### G.5 Encryption at rest / field-level (closes the INVARIANT 3 gap)
- **dchest/tweetnacl-js ★1.9k** — [canonical](https://github.com/dchest/tweetnacl-js) — Unlicense (public domain), active. 7 KB NaCl `secretbox` for field-level encryption of `care_providers.phone`, `dogs.exact_lat/lng`, device tokens. Closes the gap between INVARIANT 3 (HMAC identity) and the columns INVARIANT 3 doesn't cover. **Phase 1 — Stream D's #2 pick.** No Argon2id needed (Hetja has no passwords).
- **jedisct1/libsodium.js ★1.2k** — ISC. Full libsodium bindings. Heavier than tweetnacl; pick only if you need additional primitives (signatures, hashing beyond what tweetnacl offers).
- **REJECT: brix/crypto-js ★16.4k** — README itself says "discontinued"; last push 2024-08-09. The 16k stars are historical; do not adopt.

### G.6 DPDP Act 2023 compliance (skepticism is the right stance)
- **No open-source DPDP tooling exists** as of 2026-08. The landscape is vendor SaaS (ComplyDP, PrivacyEngine, DPDPA.com, DPDStack, Seclore) — sales-funnel-heavy, not OSS.
- **Stream D §D.10 verdict:** the substantive compliance work is operational, not tooling. The deliverables are: a `privacy_preferences` table, a `data_subject_requests` table, a 30-line Fastify DSAR route, the `audit_log` table from §G.9 below, a written retention policy, a quarterly `/privacy` page review (HOW-IT-WORKS §4 already says "a privacy notice that describes storage you no longer do is simply false").
- **DPDP self-assessment checklist** (66 questions, static) exists under GitHub topic `dpdp-act` — useful as a one-off audit exercise, not a runtime dep.

### G.7 Sessions / cookies (currently no sessions)
- **vvo/iron-session ★4.1k** — [canonical](https://github.com/vvo/iron-session) — MIT, active. Encrypted cookies for stateless sessions. Hetja is currently stateless (each request validates a JWT or device token); iron-session is the right pick if any stateful surface (admin UI) is added.
- **fastify/fastify-secure-session ★228** — MIT. Fastify-native equivalent of iron-session.

### G.8 Bot detection beyond PoW (INVARIANT 3 tension — apply with care)
- **fingerprintjs/BotD ★1.4k** — MIT. Browser-side bot-detection boolean. Transmit only the boolean, never the raw fingerprint.
- **thumbmarkjs/thumbmarkjs ★1.1k** — MIT. Authenticated-side device fingerprint.
- **fingerprintjs/fingerprintjs ★28k** — MIT (open-source edition). Server-side signal, hashed under pepper. **Never on the anonymous scan page** — INVARIANT 3 tension. Adopt all three with the caveat: server-side or authenticated-side only.

### G.9 Audit logging (beyond the hash-chained ledger)
- **pgaudit/pgaudit ★1.7k** — [canonical](https://github.com/pgaudit/pgaudit)) — PostgreSQL License. DB-level audit floor: `CREATE EXTENSION pgaudit;` on existing PG 16, ships with the database, zero new services. Logs every write/DDL/role change. Requires `shared_preload_libraries` restart; set log rotation. **Phase 1 — Stream D's #3 pick.**
- **Hand-rolled `audit_log` table** — application-level audit log for queryable events (every scan, every feeder login, every API call). Pairs with pgaudit (DB-floor) + `medical_records` hash-chain (cryptographic). The `audit_log` table needs to be append-only but **not** tamper-evident in the cryptographic sense — you need to be able to redact PII from an old row under a DSAR erasure request, which a hash chain would prevent. The shape: a `redacted_fields` JSONB column, a `redact_at` timestamp, a scheduled job that nulls fields past retention.

### G.10 JWS / JWE / OIDC (signed device tokens, signed scan-page data)
- **panva/jose ★7.7k** — MIT. (Same as Stream A §D.1 — both streams independently converge.) Use for signed device tokens, signed scan-page proofs, JWKS publication of vet signing keys.
- **panva/openid-client ★2.4k** — MIT. If Hetja ever needs to act as an OIDC relying party (e.g., for partner-NGO SSO).
- **REJECT: cisco/node-jose ★721** — stale ~12 months; superseded by `panva/jose`.

### G.11 Secrets management (pepper rotation, env hygiene)
- **Infisical/infisical ★28.7k** — [canonical](https://github.com/Infisical/infisical) — MIT for non-`ee/` content, dual-licensed `ee/`. Long-term home for pepper + Brevo/VAPID/tunnel keys; enables real pepper rotation. **Phase 5 self-host** (cloud free tier first for non-pepper runtime secrets; keep pepper in OVH env until a second box exists).
- **DopplerHQ/cli ★390** — Apache-2.0. Hosted-only secrets platform. Cloud free tier for small teams; no self-host option. Use only if Infisical is rejected.
- **Stream I complement: getsops/sops ★22.8k + FiloSottile/age ★23.2k** — file-based secrets for `.env` in repo, decrypted at deploy time by GitHub Actions. **Adopt both Infisical (runtime) + SOPS+age (file-based)** — they're complementary, not contradictory.

### G.12 Crypto utilities (rejected)
- **REJECT: crypto-js (brix)** — discontinued per README.
- **REJECT: node-jose (cisco)** — superseded by `panva/jose`.
- **REJECT: zoran-php/fernet-nodejs ★11** — GPL-3.0 + tiny + stale.

---

## §H. Offline-first & field data collection *(new — Stream E)*

`apps/field`, the tagger portal, is "designed but not built." Taggers walk Mumbai streets putting collars on dogs — mobile, bad networks, bulk data entry. Feeders also log feeds and upload photos that need retry on flaky 4G. Stream E researched the offline-first ecosystem; the 40 KB scan-app budget remains incompatible with every recommendation here.

### H.1 Offline-first databases (for `apps/field`)
- **pubkey/rxdb ★23.3k** — [canonical](https://github.com/pubkey/rxdb) — Apache-2.0 core (premium tier for some modules). Offline-first store for `apps/field`; custom replication against existing Fastify API (no new service required). **The primary pick** — Next.js-first, browser-native, pairs with `apps/web` cleanly. **Phase 3.** Premium tier flagged but optional.
- **Nozbe/WatermelonDB ★10.5k** — MIT. React-Native-first; web support is secondary. **Soft-reject for Hetja** — Next.js-primary deployment means RxDB is the better fit.
- **PouchDB ★17.5k** — Apache-2.0. Mature, but requires CouchDB as the sync server (a second database alongside PG — wrong shape).
- **REJECT: realm/realm-js ★5.5k** — BSL-derived license, not OSI; RN-first.
- **REJECT: firebase/firebase-js-sdk ★4.8k** — proprietary backend; violates one-box rule + INVARIANT 3.

### H.2 CRDTs (collaborative multi-tagger entry)
- **yjs/yjs ★17.0k** — [canonical](https://github.com/yjs/yjs) — MIT, active. Per-dog CRDT documents for collaborative retag (two taggers editing the same dog's record from different fields). **Use server-issued slugs as Yjs doc names** — INVARIANT 1 (slug enumeration prevention) means the doc ID space is server-controlled. **Phase 3.**
- **Automerge/automerge ★18.0k** — MIT. Alternative CRDT library; pick Yjs unless a specific Automerge feature is needed.
- **jamsocket/y-sweet ★1.5k** — AGPL-3.0 (fine alongside Hetja AGPL). Rust backend for Yjs auth. **Phase 5 defer** — only if per-document Yjs auth becomes painful.

### H.3 Sync engines (Postgres ↔ SQLite)
- **PowerSync** (closed-source sync engine with OSS client SDK) — adds a sync service watching PG WAL. **Phase 5 defer** — adds a second service to babysit.
- **REJECT: ElectricSQL** — pivoted; old local-first-write product gone, now "agent platform built on sync." The new ElectricSQL is a different product.
- **REJECT: aspen-cloud/triplit** — bundled server+client that owns your data layer; violates "PG is source of truth."
- **DEFER: rocicorp/zero** — maintenance mode; active dev moved to `rocicorp/zero` (a new project). Defer both to Phase 5.

### H.4 Field data collection (the ODK legacy)
- **Open Data Kit (ODK)** — the gold standard for NGO field surveys. `getodk/odk` source is available but the production stack is heavy: Postgres + Redis + MongoDB + 2 Django + Celery + Enketo. **REJECT as a Hetja dependency** — too heavy for one-box. **Borrow the form-builder UX** — the conditional-logic + repeat-group + multiple-language patterns are the design precedent for the tagger-intake form.
- **KoboToolbox** — same ODK descendant, same heavy-stack problem. Same verdict.
- **SurveyJS ★4.2k** — MIT (core) + commercial (Pro). JSON-schema-driven forms with React renderer. Lighter than ODK; the right pick if a fully-dynamic form engine is needed (e.g., for different ABC camp intake workflows).

### H.5 Form builders (for the tagger portal)
- **react-hook-form/react-hook-form ★44.8k** — [canonical](https://github.com/react-hook-form/react-hook-form) — MIT, active. Headless form library with zod integration. **The primary pick** — schema-driven tagger forms where the zod schema in `packages/contracts` is the source of truth. Pairs with Stream D's `libphonenumber-js` (phone field) and Stream C's `placemark/check-geojson` (geofence polygon field). **Phase 3.**
- **REJECT: jaredpalmer/formik ★31k** — maintenance mode; maintainer recommends RHF.
- **immerjs/immer ★28.9k** — MIT. Immutable state with structural sharing — pairs with RHF for undo-stack on tagger forms.

### H.6 Mutation queues (resilient photo uploads on flaky 4G)
- **TanStack/query ★45k** — [canonical](https://github.com/TanStack/query) — MIT, active. Mutation queue with `persistQueryClient` over IndexedDB. Failed mutations enter paused-retry state when offline; persist metadata (URL, headers, photo-id reference) in IndexedDB via `jakearchibald/idb`. **Phase 2 — Stream E's #3 pick.**
- **SWR ★30k** — MIT. Lighter alternative if TanStack Query is overkill.
- **RTK Query ★2.2k** (part of Redux Toolkit) — MIT. Use only if Redux is already in the stack.

### H.7 Service workers deeper (beyond Workbox)
- **Workbox ★13.0k** — already in existing stack. Background Sync API is Chromium-only — iOS responders don't get it; Safari falls back to "replay on next navigation" (worse). Pair with TanStack Query for cross-browser coverage.
- **jakearchibald/idb ★6.5k** — ISC. Promise wrapper for IndexedDB. The right primitive for persisting TanStack Query client + photo bytes.

### H.8 Local-first patterns
- **Replicache** — maintenance mode; open-sourced and free, but active dev moved to `rocicorp/zero`. **Defer both to Phase 5.**
- **Immer patches** — for undo/redo on tagger forms. Pairs with RHF + Immer.

### H.9 Image upload with retry (resumable uploads to R2)
- **transloadit/uppy ★30.9k** — [canonical](https://github.com/transloadit/uppy) — MIT, active. Resumable uploads via tus protocol. **The most important honesty note in this stream:** R2 is S3-compatible, **NOT tus-compatible**. Uppy's `@uppy/tus` plugin cannot upload directly to R2. The two viable paths:
  - **(a) Uppy + `@uppy/tus` + tusd-as-systemd-unit + R2-as-S3-backend = fully resumable.** Needs `tus/tusd` (Go, MIT) as a new systemd unit. This is the right path for Mumbai 4G / 2G outer suburbs.
  - **(b) Uppy + `@uppy/aws-s3` + R2-direct = chunked with per-part retry, no full resume.** Lighter (no new service) but worse on flaky networks.
- **tus/tusd ★1.0k** — MIT. The Go server that sits in front of R2 if path (a) is chosen.
- **FilePond ★14.6k** — MIT. Lighter alternative to Uppy; less feature-rich but smaller bundle.

### H.10 Mobile field-collection (rejected)
- **KoBoCollect** — Android ODK client; doesn't apply to a Next.js-primary deployment.
- **CommCare** — commercial; skip.
- **REJECT: couchbase/couchbase-lite-react-native** — RN-only; requires Couchbase Server on box.

---

## §I. Search, analytics & dashboards *(new — Stream F)*

Hetja is a public-interest project. NGOs will ask: "How many dogs did we sterilize this quarter? Which wards have the most SOS calls? What's the median ack time? Show me a map of incidents." Stream F researched the search/analytics/BI stack — with the life-safety ethics rule that **A/B testing the SOS flow is forbidden**.

### I.1 Full-text search (in-Postgres, no new service)
- **paradedb/paradedb ★9.2k** — [canonical](https://github.com/paradedb/paradedb)) — AGPL-3.0 (fine alongside Hetja AGPL), active. **Stream F's #1 pick.** Tantivy-backed BM25 *inside Postgres* — no mirror pipeline, no index drift, no second service on the one-box. Search dogs/feeders/providers by name, area, notes. **Phase 3.**
- **Typesense/typesense ★22.6k** — GPL-3.0 (compatible with Hetja AGPL). Standalone search server. Heavier than ParadeDB; pick only if ParadeDB's Tantivy engine proves insufficient.
- **Meilisearch/Meilisearch ★49.4k** — MIT core (dual-licensed Aug 2025; CE stays MIT). Standalone search server. Same caveat as Typesense.
- **valeriansaliou/sonic ★1.7k** — MPL-2.0. Lightest option; index-only, no document store. Use only if the index size matters more than retrieval.
- **zincsearch/zincsearch ★3.4k** — Apache-2.0. Lighter Elasticsearch alternative.
- **pgroonga/pgroonga ★840** — PostgreSQL License. PG extension for full-text search; alternative to ParadeDB if Japanese/CJK support matters (it doesn't for Hetja's EN/HI/MR).

### I.2 Postgres-native analytics
- **pgvector** — already in. For semantic search across dog stories, feeder notes. Don't duplicate the AI layer here.
- **TimescaleDB ★23.3k** — [canonical](https://github.com/timescale/timescaledb) — Apache-2.0 (core) + TSL (extras). Hypertables + continuous aggregates for time-series: scans, SOS cases, ack-time-per-hour-of-day. **Phase 2 — Stream F's #3 pick.** The Apache-2.0 edition covers Hetja's needs; TSL extras are nice-to-have.
- **REJECT: timescale/promscale** — DEPRECATED 2023-04-30 per repo README + Tiger Data blog.

### I.3 Product analytics (DPDP-friendly, cookieless)
- **plausible/analytics ★28.5k** — [canonical](https://github.com/plausible/analytics) — AGPL-3.0 (fine alongside Hetja AGPL), active. Cookieless, privacy-respecting. **Cloud free tier ($9/mo) for first year** — self-host when 5 NGOs make the bill > ops cost. Tracker ships in `apps/web` only, **NEVER in `apps/scan`** (life-safety surface + 40 KB budget).
- **umami-software/umami ★38.2k** — [canonical](https://github.com/umami-software/umami) — MIT, active. Self-hosted-friendly; Node+PG fit for the one-box. **Pick if self-host is required** (MIT cleaner than AGPL for some org policies).
- **REJECT: matomo-org/matomo ★20k** — PHP/MySQL stack mismatch with Node+PG one-box.
- **PostHog/posthog ★26k** — cloud free tier (1M events/month). **NEVER self-host on OVH** — 16 GB RAM + ClickHouse + Kafka + Zookeeper + Postgres + Redis + Django. Use cloud free tier only.

### I.4 Dashboards / BI (NGO self-serve reporting)
- **metabase/metabase ★48.7k** — [canonical](https://github.com/metabase/metabase) — AGPL-3.0 (fine alongside Hetja AGPL), active. NGO self-serve BI. **Cloud Starter $85/mo for pilot** (5 users) — JVM is borderline OOM on the one-box; **self-host on second box at Phase 5.**
- **grafana/grafana ★76.3k** — AGPL-3.0 (fine alongside Hetja AGPL), active. Operational dashboards — ack-time P50/P95, SOS volume per ward, scan funnel. Go binary, ~150 MB RSS, fits the one-box. **Phase 4.**
- **REJECT: apache/superset ★64k** — Python/Flask/Redis/Celery heavier than Metabase on every axis. Superset's strength (SQL Lab) is for analysts, not NGO coordinators.
- **REJECT: Redash ★26k** — Python/Tornado/Redis; same one-box shape mismatch as Superset.

### I.5 Charts in React (for feeder dashboard, NGO dashboards)
- **tremorlabs/tremor-npm ★16.5k** — [canonical](https://github.com/tremorlabs/tremor-npm) — Apache-2.0, active. Copy-paste dashboard components on Tailwind+Radix. **The primary pick** — pin v3; the deprecated `tremorlabs/tremor` URL 404s (canonical is `tremor-npm`).
- **recharts/recharts ★27.5k** — MIT. Light charts on the feeder dashboard. Use when Tremor's dashboard component is overkill.
- **visgl/deck.gl ★14.4k** — MIT. GPU-accelerated geospatial viz layers; renders on top of MapLibre GL JS. **Phase 5, lazy-loaded on NGO dashboard route** — `HeatmapLayer({ data: sosCasesThisYear })` produces ward-level incident density.
- **Apache ECharts ★61k** — Apache-2.0. Most feature-complete; heaviest.
- **nivo ★13k** + **Visx ★19k** — MIT. Lower-level building blocks; pick only if Recharts/Tremor's defaults need overriding.

### I.6 Maps for dashboards
- **deck.gl + MapLibre GL JS** (above) — the right pair. Heatmaps, hex-binned incident counts, scatter plot of NGO locations.

### I.7 Scheduled report generation
- **graphile/worker ★2.3k** — already in existing stack. Use its crontab feature for weekly NGO reports (sterilization count, SOS volume, ack-time P50).
- **REJECT: node-cron ★2.5k** — in-process and dies on restart; redirect to `graphile/worker` cron.
- **diegomura/react-pdf ★16.7k** — MIT. Declarative PDF reports. Use for the weekly NGO PDF that pairs with `pdfkit` (imperative) for collar sheets.

### I.8 CSV/Excel export (government vet database intake)
- **exceljs/exceljs ★15.4k** — [canonical](https://github.com/exceljs/exceljs) — MIT, on npm. **The primary pick** for the VET-DATA-INTAKE.md flow — cell styling (highlight `phone_verified_at IS NULL` rows in yellow) wins over SheetJS.
- **SheetJS/sheetjs ★36.3k** — Apache-2.0 but **not on npm since 2022** (legal dispute with npm Inc.); install from `cdn.sheetjs.com` tarball. Supply-chain flag — use exceljs unless raw speed is decisive.

### I.9 Log aggregation
- **Vector (vectordotdev/vector) ★22.4k** — MPL-2.0. Ship pino logs to Grafana Cloud free tier (50 GB logs). **Phase 5** — zero local queryable store.
- **grafana/loki ★28.7k** — AGPL-3.0 (fine alongside Hetja AGPL). Self-host log aggregation; ~150 MB RAM. **Phase 5 OR Vector → Grafana Cloud free tier** (the lighter path).

### I.10 Feature flags / A/B testing (with ethics caveat)
- **flipt-io/flipt ★4.9k** — [canonical](https://github.com/flipt-io/flipt) — Fair Core License 1.0, MIT Future. Single Go binary, PG-backed. **The right pick for pure feature flags** (`FIRST_AID_ENABLED`, `apps/field` gradual rollout, AI kill-switch). FCL is fine for a single non-profit self-hosted deployment; document the 4-year conversion clause. **Phase 4.**
- **Unleash/unleash ★11k** — AGPL-3.0 (audit overturns the license rejection — Hetja AGPL makes it fine) but **operationally** Flipt is lighter (single Go binary vs Node + separate Postgres + 300-500 MB RAM). **REJECT on operational grounds.**
- **GrowthBook/growth-book ★4.5k** — MIT core. For A/B testing **non-life-safety UX only** (e.g., copy on the "About" page). **NEVER the SOS flow** — life-safety ethics. **Phase 5 conditional** — only if A/B testing becomes a real need.

### I.11 A/B testing ethics (life-safety)
Hetja is a life-safety system. A/B testing the SOS button copy, the SOS modal flow, or the SOS escalation timer is ethically equivalent to A/B testing a 911 dispatcher script. **The rule:** randomisation is forbidden on `/d/<slug>`, `/api/v1/sos/*`, and `/api/v1/care`. GrowthBook's flag can be used on `/about`, `/privacy`, `/training`, the feeder dashboard — anything but the life-safety path.

---

## §J. Vet/animal domain tools *(new — Stream G)*

Hetja exists in a world with veterinary standards, microchip registries, and animal-welfare software. Stream G researched the OSS landscape — and surfaced the recurring pattern: "adopt the schema even though the codebase is dead." Most of these are old (PHP-era shelter systems), US/UK-centric, or commercial-SaaS.

### J.1 Open-source shelter management (schema gold)
- **sheltermanager/asm3 ★143** — [canonical](https://github.com/sheltermanager/asm3) — GPL-3.0 (compatible with Hetja AGPL), active today. The canonical OSS shelter system. Python/PostgreSQL stack mismatch with Hetja's Node+PG; UI is dated. **Adopt the data model** (entry_type, deceased_date, rabies_tag, etc.), **not the code.** Phase 4 reference.
- **rubyforgood/shelter-assist ★15** — MIT. Foster-based rescue; closest to Hetja's feeder model. Rails, stale since 2022. Schema reference only.
- **GRISONRF/shelter ★5** — no license. Java/Spring Boot sample. Reject — schema too thin.

### J.2 Open-source vet practice management (a graveyard)
- **oldauntie/ababu ★26** — AGPL-3.0 (fine alongside Hetja AGPL), last push 2025-03. **The only OSS vet PMS with 2025 activity.** Problem-oriented medical record (POMR) pattern. Reach out to maintainer; conceptual peer, not a code dep.
- **CharltonIT/openvpms ★8** — custom OpenVPMS license; dormant since 2015. Adopt the POMR schema concepts only — the codebase is dead.
- **geosem42/PetCare ★24** — MIT. Laravel+Vue vet PMS. Low activity since 2023; schema reference.
- **REJECT: gnuvet/gnuvet ★0** — dormant 2015, zero stars.

### J.3 Pet adoption APIs (deferred — US/Canada-centric)
- **petfinder-com/petfinder-js-sdk ★62** — BSD-3-Clause. Official JS SDK for the Petfinder API. **Phase 5 defer** — only if Hetja ever publishes adoptable dogs; US/Canada only.
- **yez/rescue_groups ★6** — MIT. Ruby wrapper for RescueGroups.org API. Dormant 8+ years; schema reference only.

### J.4 ISO 11784/11785 microchip (hardware add-on, Phase 5)
- **s60sc/ESP32_RFID_Reader ★100** — AGPL-3.0 (fine alongside Hetja AGPL), active 2026-01. FDX-B + EM4100 reader firmware. **Phase 5, hardware add-on only** — relevant if `apps/field` gets a microchip-scanner peripheral for taggers.
- **decrazyo/fdxb ★119** — GPL-3.0 (compatible with Hetja AGPL). Bare Arduino FDX-B decoder — ~120 lines of readable C++; spec reference.
- **puremourning/petidlookup ★1** — Apache-2.0. US microchip registry fan-out pattern. Dormant 10 years; reference only.
- **REJECT: Dev-Thought/petcator ★0** — archived 2023-03; no license.
- **REJECT: mmsaki/dog-registry-blockchain-app ★4** — off-topic blockchain; Hetja's hash-chained `medical_records` already achieves tamper-evidence (INVARIANT 9). Adding blockchain is the canonical case of "we have a problem and we want to make it worse."

### J.5 Lost-pet re-ID (training scaffold)
- **owahltinez/triplet-loss-animal-reid ★14** — [canonical](https://github.com/owahltinez/triplet-loss-animal-reid) — MIT, active 2025-08. **The active MIT-licensed triplet-loss reference.** Pair with existing pgvector + DogFaceNet (existing §A). Train on Mumbai street-dog photos. **Phase 4.**
- **DariaKern/IndividualAnimalRe-IDDatasets ★51** — no license (reading list). Curated catalogue of animal re-ID datasets.

### J.6 Veterinary knowledge base
- **Vetdatahub/VetDataHub ★46** — MIT. Vet dataset catalogue. **Phase 4 reference** — reading list for the first-aid card evidence base.

### J.7 Indian context (limited OSS landscape)
- **Anwishta/Paws ★0** — GPL-3.0 (compatible with Hetja AGPL). Closest Indian OSS peer to Hetja (injured-stray reporting). **Reach out to maintainer; conceptual peer, not a code dependency.**
- **egovernments/divoc-docs ★3** — no license (docs only). Indian government's verifiable credential spec, built for 2B+ COVID certificates. **Adopt the schema (Phase 3)** — pair with Stream A's `did-jwt-vc`. The DIVOC platform itself (Java/Spring) is too heavy; the credential schema is the worked example for vet-signed vaccination VCs.
- **BMC Mumbai dog-census 2024-25** (data source, not GitHub) — ground-truth dataset. **Adopt Phase 0** — ingest as reference table; Hetja's coverage gap is measured against this.

### J.8 Standards referenced (no GitHub code)
- **ISO 11784/11785** — animal microchip standards (FDX-B, 134.2 kHz).
- **WOAH WAHIS** — World Organisation for Animal Health data standards.
- **AAHA Universal Microchip Lookup** — American Animal Hospital Association's microchip lookup service.
- **PetPoint / Shelter Animals Count** — US shelter data standards.
- **WHO GDHCN** — Global Digital Health Certification Network.

### J.9 The recurring pattern: "adopt the schema, not the code"
OpenVPMS (dead 2015) and ASM3 (active) both have schema value; the OSS vet-PMS space is a graveyard; `oldauntie/ababu` is the only one with 2025 activity. **The honest takeaway:** no mature open-source animal-welfare tool exists that Hetja can lift wholesale. The value of this stream is the schema patterns (POMR for medical records, ASM3's `entry_type`/`deceased_date`/`rabies_tag` columns, DIVOC's VC spec) and the training-scaffold repos (triplet-loss animal re-ID).

---

## §K. QR scanning, image processing & EXIF *(new — Stream H)*

Hetja's `apps/scan/components/QrScanner.tsx` uses the browser's `BarcodeDetector` with manual slug-entry fallback. The scan app has a hard 40 KB gzipped budget. Stream H researched the alternatives — with the 40 KB constraint treated as sacred throughout.

### K.1 JS QR scanning libs (polyfills for unsupported browsers)
- **Sec-ant/barcode-detector ★229** — [canonical](https://github.com/Sec-ant/barcode-detector) — MIT, active. **The polyfill of choice.** Preserves the existing `BarcodeDetector` call shape; ~3 KB JS + ~13 KB WASM lazy-loaded behind a dynamic `import()`. Closes the iOS Safari/Firefox gap without touching the 40 KB budget. **Phase 0 — Stream H's #1 pick.** The WASM compile cost on a Moto G is ~100-300 ms; acceptable for the "tap-to-load camera" path, not for the initial page.
- **cozmo/jsQR ★4.0k** — Apache-2.0. Pure-JS QR decoder (~13 KB gzipped). Use as a fallback if WASM compile proves too slow on low-end Android.
- **@zxing/library ★5.4k** + **@zxing/browser ★1.0k** — Apache-2.0. Multi-format barcode library; heavier than jsQR but supports more formats (Aztec, DataMatrix, PDF417). Use if collar codes ever migrate beyond QR.
- **metafloor/bwip-js ★1.6k** — NOASSERTION on API (effectively MIT per source headers). Barcode generator (not scanner); use for printing Aztec/DataMatrix if 9-char slug becomes too short.

### K.2 BarcodeDetector polyfills (continued)
- **Sec-ant/barcode-detector** (above) — the only maintained polyfill worth recommending. Google's `barcode-detector-polyfill` was an early prototype; the Sec-ant version superseded it.

### K.3 Image compression in browser (feeder photo upload on Mumbai 4G)
- **fengyuanchen/compressorjs ★5.8k** — [canonical](https://github.com/fengyuanchen/compressorjs) — MIT, active. ~9 KB gzipped. Auto-orient + compress in one dep; closes the sideways-photo bug class. **Phase 1 — Stream H's pick for `apps/web`.**
- **browser-image-compression ★14.4k** — MIT. Alternative if compressorjs's API shape doesn't fit; web-worker-based for non-blocking compression.
- **REJECT: @squoosh/lib** — explicitly deprecated by its own npm README. The squoosh.app web UI remains alive but the library is dead.

### K.4 EXIF / orientation (phone photos arrive with EXIF rotation)
- **MikeKovarik/exifr ★1.2k** — [canonical](https://github.com/MikeKovarik/exifr) — MIT, last push March 2024 (stable but quiet). 2 KB orientation-only build; full build ~12 KB. Extracts orientation + GPS in one library. **Pairs with compressorjs:** use exifr once to get orientation, feed both orientation and GPS to compressorjs.
- **hMatoba/piexifjs ★613** — MIT. EXIF write (not just read); use for in-band slug stamping on photos for provenance. The collar's slug is written into the photo's EXIF `UserComment` field at upload time — a third layer of provenance beyond the visible watermark and the hash chain.
- **blueimp-load-image ★4.5k** — MIT. Older alternative; exifr is the modern pick.

### K.5 Perceptual / image hashing (duplicate detection)
- **btd/sharp-phash ★69** — [canonical](https://github.com/btd/sharp-phash) — MIT, active. pHash on `sharp` output; pairs with Postgres `BIGINT` + `popcount(x # y)` for Hamming distance. Closes the "six-Tuesday-photos-of-the-same-dog" storage waste. ★69 is small; the algorithm is ~80 lines. If it goes stale, a ~100-line in-house implementation against `sharp` is realistic. **Phase 2.**
- **alternative:** write the pHash directly in the worker using `sharp`'s raw pixel API + a 32×32 DCT — ~100 lines, no dep.

### K.6 On-device image classification (lite alternatives to Transformers.js)
- **Transformers.js ★16.1k** — already in existing §A. The modern default for on-device inference.
- **TensorFlow.js ★18.5k** — Apache-2.0. Use only if ONNX proves fragile on target Android devices. The `coco-ssd` model (★14.8k via `tfjs-models`) is the lite detector fallback.

### K.7 Image cropping/editing (for the feeder's dog-face crop)
- **ValentinH/react-easy-crop ★2.8k** — [canonical](https://github.com/ValentinH/react-easy-crop) — MIT, active. 1:1 dog-face crop, ~7 KB, React-idiomatic. **Phase 2 — Stream H's pick for `apps/web`.** For a Next.js 14 App Router codebase, this beats cropperjs v2.
- **fengyuanchen/cropperjs ★13k** — MIT. The original cropping library; v2 is a Web Components rewrite (breaking change). Use only for `apps/field` if advanced rotate/flip/torch UI is needed.
- **react-image-crop ★4.1k** — MIT. Lighter alternative if react-easy-crop is overkill.

### K.8 Image watermarking (provenance for cruelty-case evidence)
- **zhensherlock/watermark-js-plus ★562** — MIT, very active (push 2026-08-13). Visible + blind watermark. **Phase 4.** The three-layer photo provenance pipeline:
  1. Visible watermark (hetja.in + slug, semi-transparent bottom-right).
  2. Blind watermark (embedded in pixel data, survives crop + resize).
  3. EXIF stamp (slug in `UserComment`, via piexifjs).
- **REJECT: Brian Gurwitz's watermarkjs ★1.1k** — dormant since Jan 2020; replaced by `watermark-js-plus`.

### K.9 Blur detection (reject bad photos at the edge)
- **timotgl/inspector-bokeh ★48** — [canonical](https://github.com/timotgl/inspector-bokeh) — MIT, active. Non-blocking pre-upload blur warning, ~3 KB. **Phase 4** — adds a "this photo looks blurry, retake?" prompt before the upload mutation enters TanStack Query's queue.
- **REJECT: thesimon82/Laplacian-Blur-Detector ★0** — no LICENSE file.
- **REJECT: puntorigen/blurry-detector ★1** — no LICENSE file.

### K.10 QR code variants (future-proofing if 9-char slug becomes too short)
- **node-qrcode ★8.2k** — already in existing stack. QR remains the right format for the 9-char slug alphabet `[a-km-z2-9]`.
- **bwip-js ★1.6k** — Aztec/DataMatrix support if a higher-density code is ever needed (e.g., embedding the HMAC signature directly in the code instead of as a query param).

### K.11 Camera access (in-app photo capture, `apps/web` only)
- **mozmorris/react-webcam ★1.8k** — MIT, active. ~3 KB gzipped. In-app "take photo now" capture. **Phase 2 — `apps/web` only.**
- **purple-technology/react-camera-pro ★232** — MIT. Mobile-first alternative. Defer — react-webcam is sufficient.

### K.12 EXIF GPS pipeline (INVARIANT 2 compliance)
The pairing: read GPS at upload for ward-level sighting tags (feeder's own view); strip GPS via `sharp({ withMetadata: false })` before R2 public bucket; originals-with-EXIF → R2 private bucket (feeder-visible only, never on the public dog page). This is the operational enforcement of INVARIANT 2 (location coarsening) for feeder photos.

### K.13 The 40 KB scan-app budget (honesty rule)
Every recommendation in this stream is **for `apps/web` or `apps/field`, never `apps/scan`**. The only scan-app-eligible picks are:
- `Sec-ant/barcode-detector` (~3 KB JS + ~13 KB WASM, lazy via dynamic import — never counts against initial bundle).
- `cozmo/jsQR` (~13 KB, only as a fallback if WASM proves too slow — also lazy).

---

## §L. DevOps, DR, secrets & feature flags *(new — Stream I)*

Hetja deploys via GitHub Actions → rsync → symlink flip → systemd restart, with auto-rollback. One OVH VPS, no inbound ports, Cloudflare tunnel. Four systemd units. PG16 + PostGIS + pgvector on the same box. The build was previously OOM-killed by running `next build` next to live services. Stream I researched the operational tooling — with the "runs on nothing" rule and the OOM-kill history as filters.

### L.1 Database backups (PG PITR — the largest DR gap)
- **wal-g/wal-g ★4.2k** — [canonical](https://github.com/wal-g/wal-g) — Apache-2.0, active. PG WAL archiving to R2, 5-min PITR. The append-only `medical_records` ledger becomes evidence-grade recoverable. **Phase 1 — Stream I's #1 pick.** Outbound-only HTTPS to R2, ~30 MB binary, no new service.
- **pgbackrest/pgbackrest ★4.3k** — MIT. Fuller-featured PG backup manager. Defer — wal-g is the simpler primary; reach for pgBackRest if you outgrow wal-g.
- **EnterpriseDB/barman ★3.2k** — GPL-3.0 (compatible with Hetja AGPL). Daemon-model PG backup. **Phase 5 (second box)** — the daemon model is right for a separate DR box, not the one-box.

### L.2 File backups (encrypted, off-box)
- **restic/restic ★35.5k** — [canonical](https://github.com/restic/restic) — BSD-2-Clause, active. Encrypted, deduped file backups of `/srv/hetja/` + systemd/Caddy config → R2. **Phase 1 — Stream I's #2 pick.** Outbound-only. Restic encrypts client-side; R2 sees ciphertext only. **Critical caveat:** don't include the pepper in a restic backup that goes to R2 — that's the one secret where offline copies are a liability.
- **kopia/kopia ★13.9k** — Apache-2.0. Same shape as restic with GUI. Defer — restic is simpler; kopia only if the on-call team wants visual restore browsing.

### L.3 Secrets management (pepper rotation, env hygiene)
- **getsops/sops ★22.8k** — MPL-2.0, active. File-based secrets for `.env` in repo, decrypted at deploy time by GitHub Actions. **Phase 5 (pepper rotation)** — pairs with Stream D's Infisical.
- **FiloSottile/age ★23.2k** — BSD-3-Clause, active. The encryption layer SOPS uses; can also be used standalone.
- **Infisical/infisical ★28.7k** — MIT for non-`ee/` content. (See Stream D §G.11 for the full entry.) **Adopt both** Infisical (runtime, cloud free tier first) + SOPS+age (file-based) — they're complementary.
- **REJECT: HashiCorp Vault** — daemon + storage backend; too heavy for one-box. Infisical cloud or SOPS+age is the right shape.

### L.4 Feature flags / gradual rollout
- **flipt-io/flipt ★4.9k** — Fair Core License 1.0, MIT Future. (See Stream F §I.10 for the full entry.) Single Go binary, PG-backed. **Phase 4.**
- **REJECT: Unleash/unleash ★11k** — AGPL-3.0 (audit overturns the license rejection — Hetja AGPL makes it fine) but **operationally** Node + separate Postgres + 300-500 MB RAM is heavier than Flipt. Flipt wins.
- **REJECT: GrowthBook/growth-book ★4.5k** — MIT core. For A/B testing only — never the SOS flow (life-safety ethics, see §I.11).

### L.5 Dependabot / Renovate (monorepo dep PRs)
- **renovatebot/renovate ★22.3k** — [canonical](https://github.com/renovatebot/renovate) — AGPL-3.0-only (fine alongside Hetja AGPL; the hosted Mend App is not a license event anyway), active. Per-dep PRs across the pnpm monorepo. **Phase 2 — Stream I's #4 pick.** Runs on GitHub infra so it can't OOM the box. Use the hosted Mend App, not self-host.
- **dependabot/dependabot-core ★5.7k** — MIT. GitHub's first-party dep bot. Start here (free, zero-config); switch to Renovate the day you find yourself merging five identical `bump next` PRs.

### L.6 Caddy plugins / reverse proxy extras
- **WeidiDeng/caddy-cloudflare-ip ★123** — [canonical](https://github.com/WeidiDeng/caddy-cloudflare-ip) — Apache-2.0. **Phase 1 — Stream I's #3 pick.** Caddy module that rewrites `X-Forwarded-For` from `CF-Connecting-IP`. **Fixes a real bug:** without it, `@fastify/rate-limit` sees ~20 Cloudflare edge IPs instead of the stranger's real IP — the rate limiter either under-limits (lets everything through) or over-limits (blocks everyone). One Caddyfile line, no new service. ★123 is small but it's the canonical Caddy module for this problem.
- **greenpau/caddy-security ★2.2k** — Apache-2.0. AAA plugin for Caddy v2. **Phase 3 defer** — conditional on `apps/field` SSO need; privacy tension with INVARIANT 3 (Google OAuth sees every tagger login).
- **REJECT: mholt/caddy-l4 ★1.7k** — Apache-2.0. L4 TCP/UDP proxy for Caddy. Cloudflare tunnel is HTTP-only; built-in `reverse_proxy` is enough.

### L.7 Container registry (skip — bare metal)
- **REJECT: distribution/distribution ★10.6k** — Apache-2.0. Hetja is bare metal, no containers. Reconsider if containerisation happens.
- **REJECT: deuxfleurs-org/garage ★4.3k** — AGPL-3.0 (audit overturns the license rejection) but **operationally** putting S3 on the same box as PG defeats the off-box DR story. R2 is already the right answer.

### L.8 Postgres monitoring & connection pooling
- **pgbouncer/pgbouncer ★4.3k** — ISC, active. Connection pooler (transaction mode). **Phase 2 — Stream I's pick, reinforced by Stream J from the perf angle.** Connection-storm protection (500 concurrent strangers → 20 PG backends, not 500). Worker stays direct PG for `LISTEN/NOTIFY`. Caveat: transaction-mode breaks named prepared statements; PG's unnamed-statement path works fine.
- **postgresml/pgcat ★4.0k** — MIT. Modern Rust pooler with sharding. **Phase 5 defer (multi-PG only)** — Hetja has one PG instance; pgcat's sharding features are dead weight.
- **supabase/supavisor ★2.3k** — Apache-2.0. Supabase's pooler; already there on the Supabase side. Defer until Mumbai migration.
- **prometheus-community/postgres_exporter ★3.6k** — Apache-2.0. PG metrics exporter. **Phase 4** — pair with Grafana; run on box, scrape from Grafana Cloud to avoid local Prometheus footprint.

### L.9 Process supervision (systemd is the answer)
- **REJECT: Unitech/pm2 ★43.3k** — AGPL-3.0 (audit overturns the license rejection — Hetja AGPL makes it fine) but **operationally** systemd already does cgroup isolation, restart-on-crash, journald log management. pm2 adds nothing.
- **DarthSim/overmind ★3.7k** — MIT. Procfile-based process manager. **Local dev only** — `pnpm dev` use; production uses systemd.

### L.10 Log aggregation
- **Vector (above, §I.9)** — MPL-2.0. Ship pino logs to Grafana Cloud.
- **grafana/loki ★28.7k** — AGPL-3.0 (fine alongside Hetja AGPL). Self-host log aggregation. ~150 MB RAM. **Phase 5** or use Vector + Grafana Cloud free tier (the lighter path).

### L.11 Status pages
- **upptime/upptime ★17.1k** — [canonical](https://github.com/upptime/upptime) — MIT, active. **Phase 1 — Stream I's #5 pick.** Static status page from GitHub Actions. Zero local footprint, no inbound port — perfect fit for the no-inbound-ports rule. 5-min granularity matches the worker's 8-min escalation window. Configure multi-site checks: `/api/v1/health` (Fastify health route) and `/api/v1/care` (real read endpoint) separately, so a partial outage is reported as partial.
- **cstate/cstate ★2.9k** — MIT. Hugo-based static status page (no auto-monitoring). Defer — Upptime does both monitoring and rendering.
- **REJECT: arachnys/cabot ★5.7k** — MIT. Lightweight PagerDuty. Django+Celery+Redis+PG is the Stream-B-Novu OOM-kill pattern at smaller scale. Defer to Phase 5 (second box).

### L.12 DNS management
- **octodns/octodns ★3.7k** + **DNSControl/dnscontrol ★3.9k** — both MIT. DNS-as-code from YAML / JS-like DSL. Defer — at 5 DNS records, Cloudflare web UI is fine. Reconsider after the first DNS-induced outage.

### L.13 TLS cert rotation
- **REJECT: acmesh-official/acme.sh ★47.5k** — GPL-3.0 (compatible with Hetja AGPL). ACME client. **Cloudflare terminates TLS** — Caddy's `auto_https` is off behind the tunnel; no local ACME needed.
- **REJECT: go-acme/lego ★9.8k** — MIT. ACME library. Same rejection reason.

### L.14 Restore-drill runbook (operational, not a repo)
No stream covered the actual restore-drill runbook — the quarterly exercise of restoring from backup to a fresh box and verifying the append-only `medical_records` ledger is intact. **Recommendation:** add a quarterly runbook that (a) spins up a fresh OVH box, (b) restores PG from wal-g, (c) restores files from restic, (d) verifies the Merkle root (Stream A #2) matches the production root, (e) verifies the hash chain on `medical_records` is intact, (f) tears down. Document the time-to-restore as the SLA.

---

## §M. Performance, caching & accessibility deeper *(new — Stream J)*

The stranger using the scan page is on a cheap Android, on Mumbai 4G, possibly panicking. Every kilobyte is a second. The page must be WCAG-AA accessible because they may have a disability. They may not be able to read — voice output matters (Stream B §E.7). Stream J researched the perf/a11y stack — with the 40 KB budget as the absolute filter.

### M.1 In-process caching (no Redis on the box)
- **isaacs/node-lru-cache ★5.9k** — [canonical](https://github.com/isaacs/node-lru-cache)) — BlueOak-1.0.0 (functionally MIT-equivalent), active. 60s TTL cache for `care_providers`, 5s TTL for dog pages. Drops `GET /api/v1/care` from ~80 ms (PG query) to ~3 ms (cache hit). **Phase 1 — Stream J's #1 pick.** In-process only — does not survive restarts, not shared across the 4 systemd units. Fine for read-only public data; **never for SOS case state.**
- **jaredwray/keyv ★3.2k** — MIT. Multi-backend K/V with uniform API. Defer — lru-cache is enough for the one-box; Keyv's value is backend-swappability later.
- **jaredwray/cacheable ★2.0k** (was `node-cache-manager`) — MIT. Multi-tier caching with coalescing. **Phase 3** — when single-layer LRU shows cache misses under viral-incident load; the coalescing defends against thundering-herd.

### M.2 Redis alternatives (rejected — no Redis workload)
- **REJECT: dragonflydb/dragonfly ★31k** — BUSL-1.1 (not Apache as older blog posts claim). Multi-threaded Redis-compatible. No Redis workload — BullMQ + rate-limiter-flexible both support PG backends; sessions are signed cookies.
- **REJECT: Snapchat/KeyDB ★12.5k** — BSD-3-Clause. Same reason.
- **REJECT: microsoft/garnet ★11.9k** — MIT. Same reason + C#/.NET runtime mismatch.

### M.3 HTTP compression & ETag
- **fastify/fastify-compress ★229** — [canonical](https://github.com/fastify/fastify-compress) — MIT, active. Brotli-4 default; ~2 KB saved per `/api/v1/care` call. **Phase 0.** Or compress at Caddy edge instead — pick one.
- **fastify/fastify-etag ★85** — [canonical](https://github.com/fastify/fastify-etag)) — MIT, active. 304 on conditional GET saves ~3 KB scan HTML on refresh. **Phase 0.** Never ETag the SOS state endpoint.
- **REJECT: @fastify/conditional-get** — does not exist as a separate plugin; ETag conditional GET is handled by `@fastify/etag`.

### M.4 Edge caching (Cloudflare)
- **Cloudflare Cache Rules + Caddy `Cache-Control` policy** (no repo) — **Phase 0, the single biggest perf win in the entire stream.** Mumbai stranger's `GET /api/v1/care` drops from ~200 ms (round-trip to OVH) to ~5 ms (Cloudflare Mumbai POP cached). `/d/*` and `/api/v1/dogs/*` are `no-store` (SOS state changes underneath); `/api/v1/care*` is 60s cache; `/_next/static/*` is 1-year immutable. **Zero new code.** Caveat: a misconfigured cache rule on `/d/*` is a life-safety bug, not a perf regression. Add a Playwright CI test that asserts `cf-cache-status: DYNAMIC` on `/d/<slug>` responses.
- **Cloudflare Workers (cloudflare/workers-sdk ★4.4k)** — Apache-2.0+MIT. **Phase 3 defer (architectural change)** — could host edge-responder for `/d/<slug>` static skeleton, dropping TTFB from 250 ms to 30 ms. Not Phase 0.

### M.5 CDN for static assets
- **REJECT: jsdelivr/jsdelivr ★6.3k** — MIT. OSS-only CDN for vendor JS. Next.js 14 tree-shaking usually beats CDN-loading for first-paint. Don't add a third-party trust dependency.

### M.6 Image optimization (the biggest perceived-perf win)
- **imgproxy/imgproxy ★11k** — [canonical](https://github.com/imgproxy/imgproxy) — Apache-2.0, active. 30 MB-RAM Go service behind Caddy `/img/*`. Drops the dog photo from 1.5 MB to ~80 KB (640×480) for the Mumbai 4G stranger. **Phase 2.** Honors Stream H's EXIF-GPS-strip invariant (imgproxy never re-introduces GPS). Alternative: `next/image` for `apps/web` (zero new dep, Next.js built-in); Cloudflare Images ($5/mo for 100k transformations) for hosted.
- **lovell/sharp ★32.6k** — already in existing stack. Resize before R2 upload at write time. imgproxy is the read-time complement.

### M.7 Bundle analysis
- **ai/size-limit ★6.9k** — [canonical](https://github.com/ai/size-limit) — MIT, active. Per-route bundle-size budgets on `apps/web`. **Phase 2.** Extends the 40 KB scan-app gate. A PR that adds a 50 KB date-picker library to `apps/web` gets rejected by CI before merge. Adds ~30 s to CI build — run only on the changed app.
- **bundlewatch/bundlewatch ★442** — MIT. Bundle-size tracking with dashboard. Defer — size-limit's gate is the gate; bundlewatch's trend is nice-to-have.

### M.8 Lighthouse CI
- **GoogleChrome/lighthouse-ci ★7.0k** — [canonical](https://github.com/GoogleChrome/lighthouse-ci) — Apache-2.0, active. Per-PR perf + a11y budgets on `/d/<slug>`: LCP < 2500 ms, CLS < 0.1, INP < 200 ms, a11y score > 95. **Phase 2.** ~60 s overhead; run in a separate GitHub Actions job. Lighthouse uses axe-core under the hood for a11y — coarser-grained than `@axe-core/playwright` directly.
- **harlan-zw/unlighthouse ★4.8k** — MIT. Whole-site Lighthouse sweep. **Phase 3 defer (nightly)** — catches regressions on routes not in the PR-diff path. Caveat: repo moved from `unlighthouse/unlighthouse` (404) to maintainer's personal account; LICENSE file missing from repo root (supply-chain flag).

### M.9 Web Speech API / TTS / STT (covered in Stream B)
See §E.7 above. Both streams converge: Native Web Speech API (Phase 0); easy-speech only if voice-loading bug bites in QA; meSpeak only if offline requirement is hard. **REJECT: responsiveVoice.js** (commercial, 150 KB, INVARIANT 3 violation) and **ar-tts** (Arabic-only).

### M.10 Accessibility deeper (beyond axe-core)
- **dequelabs/axe-core-npm ★718** — [canonical](https://github.com/dequelabs/axe-core-npm)) — MPL-2.0, active. npm monorepo for axe-core framework bindings. `@axe-core/playwright` in CI; assert no `serious` or `critical` WCAG-AA violations on `/d/<slug>` in every CI run. **Phase 1.** Colour-contrast rule does not run under jsdom — needs a real browser (Playwright solves this).
- **gka/chroma.js ★10.6k** — [canonical](https://github.com/gka/chroma.js) — Apache-2.0, active. Color library; contrast computation. **Phase 0** — CI script that asserts every text/background pair in `packages/design/tokens.css` meets WCAG-AA 4.5:1 contrast. Catches the next regression where someone darkens the SOS button's red from `#c0392b` to `#a93226` and drops contrast from 4.6:1 to 4.3:1. ~12 KB; only the `chroma.contrast()` function is used. A 20-line WCAG contrast formula is the leaner alternative.
- **pa11y/pa11y ★4.5k** — GPL-3.0 (compatible with Hetja AGPL). CLI a11y scanner. Defer — axe-core-in-Playwright is the right tool.
- **nvaccess/nvda ★2.6k** — GPL-2.0 (modified). Free Windows screen reader. **Manual testing only, not a dep** — release checklist: "Loaded scan page on Moto G with TalkBack + 4G throttle; pressed SOS button without looking."

### M.11 Color contrast
- **chroma.js (above)** — the CI assertion library.
- The actual color system lives in `packages/design/tokens.css`. CI script reads tokens, asserts contrast, fails the build on regression.

### M.12 Reduced motion / prefers-reduced-motion
- **CSS-only** — no JS library needed. `@media (prefers-reduced-motion: reduce) { ... }` in the global stylesheet.

### M.13 Focus management (SOS modal, camera permission dialog)
- **tailwindlabs/headlessui ★28.7k** — [canonical](https://github.com/tailwindlabs/headlessui) — MIT, active. Headless React+Vue components. `Dialog` (modal) with focus trap built in. **Phase 3 — `apps/web` + `apps/field`.** Easier to adopt than react-aria; less flexible.
- **theKashey/react-focus-lock ★1.4k** — MIT. Focus-trap React component. **Phase 3** for the SOS confirmation modal. Or use Headless UI's `Dialog` which has focus trap built in — pick one, don't use both.
- **focus-trap/focus-trap-react ★784** — MIT. Official React wrapper around `focus-trap`. Defer — pick one of `react-focus-lock` or Headless UI's Dialog.

### M.14 Form accessibility (tagger portal)
- **adobe/react-spectrum ★15.8k** — Apache-2.0. Adobe's `react-aria` + `react-aria-components`. **Phase 3 — `apps/field`** — accessible comboboxes/date-pickers out of the box. Headless, you write the JSX.
- **Headless UI (above)** — easier to adopt than react-aria; less flexible.

### M.15 Low-end device detection
- **Network Information API (no library)** — `navigator.connection.effectiveType` ('4g', '3g', '2g'). Use to adaptively degrade (e.g., skip imgproxy derivative on `2g` and show a placeholder). Privacy check (INVARIANT 2): `effectiveType` is not PII, but document the decision.
- **Web Vitals (below)** — the field measurement that closes the loop on every perf claim.

### M.16 Web Vitals
- **GoogleChrome/web-vitals ★8.6k** — [canonical](https://github.com/GoogleChrome/web-vitals) — Apache-2.0, active. 1.5 KB field measurement of LCP/CLS/INP on `apps/scan` + `apps/web`; `sendBeacon` to `/api/v1/metrics/web-vitals` with slug stripped to `/d/:slug` (INVARIANT 2). **Phase 1.** The truth-measurement that closes the loop on every perf claim. Privacy check: store `/d/:slug` not `/d/<slug>`.

### M.17 User-agent parsing (apps/web SSR, never apps/scan)
- **faisalman/ua-parser-js ★10.2k** — v1 MIT, v2 AGPL-3.0 (license change 2024). **Adopt v1 branch (MIT) for `apps/web` SSR** — pin v1; or accept AGPL v2 (fine alongside Hetja AGPL, but flag for legal). **Never on `apps/scan`** — use a 5-line regex instead (40 KB budget).
- **hgoebl/mobile-detect.js ★4.1k** — MIT. Lighter mobile-only UA parser. Defer — ua-parser-js v1 covers it.

### M.18 Canonical-URL corrections (supply-chain hygiene)
- `node-cache-manager/node-cache-manager` 301-redirects to `jaredwray/cacheable` (npm `cache-manager` v7.2.9 published from new repo).
- `unlighthouse/unlighthouse` 404s → moved to `harlan-zw/unlighthouse` (LICENSE file missing from repo root — supply-chain flag).
- `@axe-core/playwright` is a subpackage of `dequelabs/axe-core-npm` monorepo, not a separate repo.

---

---

## §N. Cross-stream synergies — the "work in group" output *(new — Audit §AUD.4)*

The 10 streams worked independently. The audit agent surfaced 20 cross-stream pairings — pairs, trios, and quartets of tools that should ship together. The top 10 are written below as combined sections, not separate entries. **The pairings are where Hetja's specific shape becomes legible.**

### N.1 The vet-VC pipeline (Stream A + Stream G)
**`decentralized-identity/did-jwt-vc` (A) + DIVOC schema (G) + `panva/jose` (A) + `vets.signing_key_pub` (existing schema)**

A vet signs a vaccination record with their `vets.signing_key_pub`. The credential is a JWT-VC whose payload follows the DIVOC schema (built for 2B+ COVID certs in India). Anyone scanning the collar can verify it via the vet's DID `did:web:hetja.in:vets/<vet_id>`, which resolves via a JWKS endpoint built with `panva/jose`. **Phase 3, conditional on second vet signing up.**

### N.2 The dog-photo pipeline (Stream H + Stream J + existing sharp)
**`imgproxy` (J) + `exifr` (H) + `compressorjs` (H) + existing `sharp` + R2**

- Feeder picks photo → `exifr.gps()` extracts GPS for ward-level sighting map (feeder's own view, never the public derivative).
- `exifr.orientation()` feeds `compressorjs` for auto-orient.
- `compressorjs` resizes to ~800 KB WebP + strips EXIF → display-size Blob (no GPS).
- `sharp({ withMetadata: false })` on the server strips EXIF definitively before R2 public bucket.
- Original-with-EXIF → R2 private bucket (feeder-visible only, never on dog page).
- `imgproxy` behind Caddy `/img/*` serves 640×480 derivative on demand to the scan page.
- **INVARIANT 2 honored:** the public derivative has no GPS; the feeder's own view has ward-level coarsened GPS; the precise GPS lives only in the private R2 bucket. **Phase 1-2.**

### N.3 The Telegram-Merkle-SOS pipeline (Stream B + Stream A)
**`telegraf` (B) + `merkletreejs` (A) + `panva/jose` (A) + existing `medical_records` hash chain**

The Telegram bot posts each SOS case to the city NGO channel. The bot's "case proof" command outputs a Merkle inclusion proof that an external auditor (a vet, a BMC officer, a court) can verify without seeing the whole table. The proof is generated in `packages/ledger` using `merkletreejs`, signed with `panva/jose`, and rendered as a base64url string the auditor pastes into `hetja.in/verify`. **Phase 2.**

### N.4 The resilient photo-upload UX pipeline (Stream E + Stream J + Stream H)
**`TanStack Query` (E) + `web-vitals` (J) + `compressorjs` (H) + `jakearchibald/idb` (E)**

- Feeder picks photo → `compressorjs` resizes + auto-orients → Blob.
- `useMutation` wraps the upload to R2; failed mutations enter paused-retry state when offline.
- Persist metadata (URL, headers, photo-id reference) in IndexedDB via `jakearchibald/idb`; store photo bytes in a separate IndexedDB object store keyed by photo-id.
- Optimistic UI: "queued → uploading → synced" (no spinner ambiguity).
- `web-vitals` measures real LCP/CLS/INP on the upload page; `sendBeacon` to `/api/v1/metrics/web-vitals` with slug stripped to `/d/:slug`. **Phase 2.**

### N.5 The forensic-grade audit trail (Stream D + Stream I + Stream A)
**`pgaudit` (D) + `wal-g` (I) + `merkletreejs` (A) + existing `medical_records` hash chain**

`pgaudit` logs every write/DDL/role change to the Postgres log; `wal-g` archives the WAL to R2 every 5 minutes; the Merkle root anchors the ledger state at known points. A forensic restore to "the state at 14:32 last Tuesday" is **admissible evidence** in a cruelty case, not just an operational convenience. The three layers partition cleanly: `pgaudit` is the DB-floor audit log; `wal-g` is the PITR substrate; `merkletreejs` is the cryptographic anchor. **Phase 1-2.**

### N.6 The Mumbai SOS heatmap (Stream C + Stream F)
**`maplibre-gl-js` (C) + `deck.gl` (F) + existing PostGIS**

`HeatmapLayer({ data: sosCasesThisYear, getPosition: c => [c.lng, c.lat] })` produces a ward-level incident heatmap on the NGO dashboard. The 25 seeded Mumbai NGOs cluster on 18 distinct coordinates (HOW-IT-WORKS §3.2) — a `ScatterplotLayer` with size-by-SOS-volume is the honest way to show this density without claiming precision the geocoding does not have. **Phase 5, lazy-loaded on the NGO dashboard route.**

### N.7 The real-IP-aware rate-limiting pipeline (Stream I + Stream J + existing)
**`caddy-cloudflare-ip` (I) + `@fastify/compress` (J) + existing `@fastify/rate-limit`**

Without `caddy-cloudflare-ip`, every stranger appears as one of ~20 Cloudflare edge IPs and the rate limiter either under-limits (lets everything through) or over-limits (blocks everyone). With it, `@fastify/rate-limit` sees the real IP and rate-caps per-stranger. `@fastify/compress` brotli-compresses the JSON response (~2 KB saved per `/api/v1/care` call). The three together turn the stranger's path from "broken rate-limiting + uncompressed JSON" into "real-IP rate caps + brotli + cached at Cloudflare edge". **Phase 0-1.**

### N.8 The duplicate-detection + lost-dog re-ID pipeline (Stream H + Stream G + existing)
**`btd/sharp-phash` (H) + `owahltinez/triplet-loss-animal-reid` (G) + existing pgvector + existing CLIP**

At photo upload, `sharp-phash` flags duplicates (Hamming distance ≤ 5 = "same photo"). The worker embeds via CLIP into pgvector for "find this dog by photo." The "missing dog" report flow uses triplet-loss embeddings for re-ID. **Matches are *suggestions* to the feeder, never auto-written to the ledger** (INVARIANT 9 honesty rule). **Phase 4.**

### N.9 The schema-driven tagger form (Stream E + Stream D + Stream C)
**`react-hook-form` (E) + `libphonenumber-js` (D) + `placemark/check-geojson` (C) + zod schema in `packages/contracts`**

The tagger-intake form is a zod schema in `packages/contracts`; RHF renders it; `libphonenumber-js` validates the phone field; `check-geojson` validates the geofence polygon on the save path. The form is the contract; the validators are pluggable. **Phase 3.**

### N.10 The status-monitoring triad (Stream I + Stream B + Stream F)
**`upptime` (I) + `telegraf` (B) + `grafana` (F)**

Upptime monitors `hetja.in` every 5 minutes from GitHub Actions and flips `status.hetja.in` to "degraded" if `hetja.in` is down; the Telegram bot posts to the city NGO channel when a case is opened or acked; Grafana shows the rolling P50 ack-time with a threshold line at 5 min so the team sees "we are slipping" before an NGO asks. **Three tools, three audiences** (public, responders, ops), one operational picture. **Phase 1-4.**

---

## §O. License conflict analysis — the AGPL finding *(new — Audit §AUD.2)*

**The single most important fact the audit surfaced:** Hetja's own repository is AGPL-3.0-licensed (`github.com/jabezcharles420/hetja`, license `AGPL-3.0`, public, last push 2026-08-13, verified directly via `api.github.com/repos/jabezcharles420/hetja`). This **inverts** the AGPL license anxiety that runs through Streams B, F, and I.

### O.1 The AGPL cluster (all license-fine alongside Hetja AGPL)
Self-hosting these tools on Hetja's box does not impose any source-disclosure obligation that Hetja does not already carry. The license flag becomes a non-issue; the operational constraint (OOM risk, one-box shape, redundant with existing tools) is the only real filter.

| Tool | Stream | Verdict |
|---|---|---|
| `metabase/metabase` ★48.7k | F | License fine. Operational: JVM 2-4 GB → cloud free tier first, self-host on second box. |
| `plausible/analytics` ★28.5k | F | License fine. Operational: Elixir runtime, ~150 MB → cloud first, self-host later. |
| `grafana/grafana` ★76.3k | F+I | License fine. Operational: Go binary ~150 MB → fits the one-box. |
| `grafana/loki` ★28.7k | I | License fine. Operational: ~150 MB → Phase 5 or Vector + Grafana Cloud. |
| `unleash/unleash` ★11k | I | License fine. Operational: Node + separate PG + 300-500 MB → Flipt is lighter. |
| `paradedb/paradedb` ★9.2k | F | License fine. Operational: PG extension, fits the one-box. |
| `renovatebot/renovate` ★22.3k | I | License fine (and the hosted Mend App is not a license event anyway). |
| `soketi/soketi` ★6k | B | License fine. Operational: `ws` is leaner. |
| `deuxfleurs-org/garage` ★4.3k | I | License fine. Operational: R2 is already the answer; defeats off-box DR. |
| `Unitech/pm2` ★43.3k | I | License fine. Operational: systemd already does cgroup isolation. |
| `oldauntie/ababu` ★26 | G | License fine. Operational: ★26 means small community; schema reference only. |
| `sheltermanager/asm3` ★143 | G | License fine (GPL-3.0 is one-way compatible with AGPL-3.0). Operational: Python stack mismatch — adopt schema only. |
| `s60sc/ESP32_RFID_Reader` ★100 | G | License fine. Operational: hardware add-on only. |
| `faisalman/ua-parser-js` v2 ★10.2k | J | License fine. Operational: pin v1 (MIT) for cleaner attribution; never on `apps/scan`. |
| `pa11y/pa11y` ★4.5k | J | License fine. Operational: axe-core-in-Playwright is the better tool. |
| `Project-OSRM/osrm-backend` ★7.97k | C | License fine (BSD-2-Clause). Operational: 4-8 GB RAM → second box. |
| `GIScience/openrouteservice` ★2.0k | C | License fine (GPL-3.0). Operational: Java, second box. |
| `EnterpriseDB/barman` ★3.2k | I | License fine (GPL-3.0). Operational: daemon-model for second DR box. |

### O.2 The GPL-3.0 cluster (browser-bundle ambiguity — still reject)
AGPL-Hetja does **not** resolve the GPL-3.0 browser-bundle distribution ambiguity. These remain rejected.

| Repo | Stream | Reason |
|---|---|---|
| `iden3/snarkjs` ★1.5k | A | GPL-3.0 + browser bundle; Hetja's scale doesn't justify ZK. |
| `iden3/circom` ★1.5k | A | GPL-3.0; build-time tool, same. |
| `sequentialread/pow-bot-deterrent` | A | GPL-3.0 + browser bundle; use `altcha-org/altcha` (MIT). |
| `tawn33y/whatsapp-cloud-api` | B | GPL-3.0; use `great-detail/WhatsApp-JS-SDK` (MIT). |

### O.3 The non-OSI license cluster (evaluate each on its own terms)
- **BUSL-1.1** (`dragonflydb/dragonfly`, Stream J): reject — no Redis workload.
- **Sustainable Use License** (`n8n-io/n8n`, Stream B): reject — Hetja may one day offer workflows to partner NGOs.
- **Fair Core License, MIT Future** (`flipt-io/flipt`, Stream I): **accept** — for a single non-profit self-hosted deployment, FCL is fine. Document the 4-year conversion clause.
- **TSL (Timescale License)** (`timescale/timescaledb` "Community Edition" extras, Stream F): **accept** — the Apache-2.0 edition covers Hetja's needs; the TSL extras are nice-to-have.
- **Realm Community License (BSL-derived)** (`realm/realm-js`, Stream E): reject — use RxDB or WatermelonDB.
- **BlueOak-1.0.0** (`isaacs/node-lru-cache`, Stream J): **accept** — functionally MIT-equivalent.
- **MPL-2.0** (multiple: `getsops/sops`, `vectordotdev/vector`, `valeriansaliou/sonic`, `dequelabs/axe-core`, `dequelabs/axe-core-npm`): **accept all** — file-level copyleft doesn't trigger on dependency use.
- **ISC** (`pgbouncer/pgbouncer`, `jakearchibald/idb`): **accept** — functionally BSD-2-Clause.
- **PostgreSQL License** (`pgaudit/pgaudit`, `pgroonga/pgroonga`): **accept** — BSD-like.
- **Unlicense** (`dchest/tweetnacl-js`): **accept** — public domain; the most permissive license in the entire stack.

### O.4 Does AGPL force source disclosure on Hetja?
**Yes, but Hetja already discloses.** AGPL-3.0 §13 says: if users interact with the modified version over a network, you must offer them the source of the *modified version* — including any modifications Hetja made to the AGPL-licensed code itself. Hetja's source is at `github.com/jabezcharles420/hetja`, public, last pushed 2026-08-13. The AGPL obligation is satisfied.

The Hetja team's choice of AGPL is deliberate. It signals: (1) **public-interest stance** — Hetja's source is open for any other city or NGO to fork and run; (2) **anti-enclosure** — no commercial vendor can take Hetja's code, host it as a service, and refuse to share modifications; (3) **license-compatibility with the OSS stack** — AGPL is compatible with most permissive licenses (MIT, BSD, Apache-2.0) and with GPL-family copyleft. Hetja can adopt any AGPL-3.0 tool without license friction.

### O.5 The recommendation
**Self-hosting AGPL tools (Metabase, Plausible, Grafana, Loki, ParadeDB, Unleash, Renovate, Soketi, Garage, pm2):** license is fine alongside Hetja's AGPL. The filter is operational (OOM risk, one-box shape, redundant with existing tools), not license. **Browser-bundled GPL-3.0 tools (snarkjs, sequentialread/pow-bot-deterrent, tawn33y/whatsapp-cloud-api):** reject on the browser-bundle ambiguity. **Sustainable Use License, BUSL, FCL, TSL, BSL:** evaluate each on its own terms; Hetja's AGPL does not make these compatible.

---

## §P. The "needs second box" cluster *(new — Audit §AUD.3)*

Every tool flagged across streams as too heavy for the one OVH VPS. Grouped by *why* it's too heavy. **This is the most important cross-stream pattern** — five streams independently converged on the same OOM-kill risk.

### P.1 RAM-hungry (1-16 GB)

| Tool | Stream | RAM | Verdict |
|---|---|---|---|
| `Project-OSRM/osrm-backend` ★7.97k | C | 4-8 GB at runtime + 6-8 GB disk for India CH | **Phase 5 (second box).** Use public OSRM demo for dev. |
| `valhalla/valhalla` ★6.1k | C | 4-8 GB at runtime + ~8 GB India tiles | **Phase 5 (second box).** |
| `graphhopper/graphhopper` ★6.6k | C | ~300 MB JVM baseline + India extract | **Phase 5 (second box).** |
| `GIScience/openrouteservice` ★2.0k | C | Java, similar to GraphHopper | **Phase 5 (second box, separate service).** |
| `metabase/metabase` ★48.7k | F | JVM, 2-4 GB RAM | **Phase 1 (Metabase Cloud Starter $85/mo) → Phase 5 (self-host on second box).** |
| `PostHog/posthog` ★26k self-host | F | 16 GB RAM + 4 vCPU + ClickHouse + Kafka + Zookeeper + Postgres + Redis + Django | **NEVER self-host on OVH.** Use PostHog cloud free tier (1M events/month). |
| `novuhq/novu` ★39.5k | B | Mongo + Redis + ~700 MB RSS | **Phase 5 (second box).** Architecturally right, wrong for one-box. Use hand-rolled fan-out for pilot. |
| `chatwoot/chatwoot` ★35.8k | B | Rails + Postgres + Redis + ~1.5 GB | **Phase 5 (second box).** |
| `arachnys/cabot` ★5.7k | I | Django + Celery + Redis + Postgres + ~300 MB | **Phase 5 (second box).** Use Uptime Kuma + Telegram bot for 3-person on-call. |
| `apache/superset` ★64k | F | Python/Flask + Redis + Celery | **REJECT.** Heavier than Metabase on every axis. |
| `matomo-org/matomo` ★20k | F | PHP-FPM + MySQL (second database) | **REJECT.** Stack mismatch. Use Umami or Plausible. |
| `asterisk/asterisk` + `signalwire/freeswitch` | B | Heavy PBX + UDP port requirement | **REJECT (UDP no-inbound-ports conflict).** Use Exotel hosted IVR. |
| `kobotoolbox/kobocat` + `kpi` | E | Postgres + Redis + MongoDB + 2 Django + Celery + Enketo | **REJECT (as dependency).** Reference only. |
| `infisical/infisical` ★28.7k self-host | D+I | ~200 MB RAM but real service | **Phase 5 (second box) OR cloud free tier first.** |
| `centrifugal/centrifugo` ★8.6k | B | ~30 MB RSS | **Phase 4.** Only when realtime fan-out volume grows beyond in-process `Map`. |
| `grafana/loki` ★28.7k self-host | I | ~150 MB RAM + R2 chunks | **Phase 5 OR Vector → Grafana Cloud free tier.** |

### P.2 Disk-hungry (1-8 GB on-disk)

| Tool | Stream | Disk | Verdict |
|---|---|---|---|
| OSM India extract (Geofabrik PBF) | C | ~1.5 GB PBF | **Phase 5 (dev box bake).** Needed for routing and self-hosted tiles. |
| OSRM/Valhalla CH data | C | 6-8 GB on disk | **Phase 5 (second box).** |
| India PMTiles basemap (Tippecanoe output) | C | 1-3 GB PMTiles file | **Phase 3 (bake on dev box, ship to R2).** No tile-server process needed; PMTiles is a static file. |
| `kobotoolbox` multi-container | E | several GB | **REJECT (as dependency).** |
| `wal-g` PG WAL archive | I | R2 storage (off-box, good) | **Phase 1 (adopt).** Outbound-only, off-box. |
| `restic` file backups | I | R2 storage (off-box, good) | **Phase 1 (adopt).** Outbound-only, off-box. |

### P.3 Service-count-heavy

| Tool | Stream | Services added | Verdict |
|---|---|---|---|
| `pelias/pelias` ★3.6k self-host | existing | Elasticsearch + Node (~4 GB RAM) | **Phase 5 (second box).** Use Photon for one-box. |
| HashiCorp Vault | (not in streams) | daemon + storage backend | **REJECT.** Infisical cloud or SOPS+age. |
| `apache/couchdb` ★6.4k (for PouchDB) | E | second database alongside PG | **REJECT.** PG stays canonical; use RxDB with custom replication. |
| `couchbase/couchbase-lite-react-native` | E | Couchbase Server + Sync Gateway | **REJECT.** Wrong shape for Next.js web. |
| `kobotoolbox` | E | 6 containers | **REJECT (as dependency).** |
| `electric-sql/electric` (old local-first) | E | sync service | **DEFER.** Project pivoted. |
| `powersync-ja/powersync-js` | E | sync service watching PG WAL | **Phase 5.** Adds a second service to babysit. |
| `jamsocket/y-sweet` ★1.5k | E | Rust binary | **DEFER.** Only if Yjs per-document auth becomes painful. |
| `triplit` | E | bundled server+client (owns data layer) | **REJECT (architectural).** Violates "PG is the source of truth". |
| `rocicorp/zero` | E | sync server process | **Phase 5.** Only if RxDB custom replication becomes painful. |
| `deuxfleurs-org/garage` ★4.3k | I | self-hosted S3 | **REJECT (operational).** R2 is already the answer. |
| `distribution/distribution` ★10.6k | I | OCI registry | **REJECT today (no containers).** Reconsider if containerisation happens. |
| `greenpau/caddy-security` ★2.2k | I | AAA plugin for Caddy | **Phase 3 (conditional on `apps/field` SSO).** |
| `Authelia` / `Authentik` (Stream I alternatives) | I | separate daemon | **DEFER.** Keep auth in Fastify; reconsider when tagger portal lands. |

### P.4 Cloud-free-tier picks (avoid the one-box entirely)

| Tool | Stream | Cloud free tier | Verdict |
|---|---|---|---|
| `PostHog/posthog` | F | 1M events/month free | **ADOPT (cloud).** Never self-host on OVH. |
| `metabase/metabase` | F | Cloud Starter $85/mo (5 users) | **ADOPT (cloud) for pilot.** Self-host on second box at Phase 5. |
| `plausible/analytics` | F | $9/mo cloud | **ADOPT (cloud) for first year.** Self-host when 5 NGOs make bill > ops cost. |
| `getsentry/sentry` | existing | cloud free tier | **ADOPT (existing, cloud).** Self-hosted is Kafka/ClickHouse, too heavy. |
| `grafana/grafana` + `grafana/loki` | F+I | Grafana Cloud free tier (50 GB logs) | **ADOPT (cloud) for logs.** Vector ships pino logs there. Self-host Grafana on box for dashboards. |
| `infisical/infisical` | D | cloud free tier (5 users) | **ADOPT (cloud) for non-pepper secrets.** Keep pepper in OVH env. |
| `pganalyze/collector` ★401 | I | SaaS free tier (1 server) | **DEFER (privacy trade-off).** Only with `log` + `explain` collection disabled. |

### P.5 Outright rejects (regardless of box count)
- `apache/superset` — heavier than Metabase on every axis.
- `matomo-org/matomo` — PHP/MySQL stack mismatch.
- `deuxfleurs-org/garage` — R2 is already the answer.
- `Unitech/pm2` — systemd is the answer.
- `dragonflydb/dragonfly` / `Snapchat/KeyDB` / `microsoft/garnet` — no Redis workload.
- `n8n-io/n8n` — Sustainable Use License, not OSI.
- `realm/realm-js` — BSL-derived, not OSI.
- `firebase/firebase-js-sdk` — proprietary backend.
- `couchbase/couchbase-lite-react-native` — RN-only, requires Couchbase Server.
- `mmsaki/dog-registry-blockchain-app` — off-topic blockchain.
- `Dev-Thought/petcator` — archived.
- `gnuvet/gnuvet` — dormant 2015.

---
## §Q. Top 25 priority list *(new — Audit §AUD.5)*

Combined from all 10 streams' top-5 lists. Ranked by Hetja-specific value (life-safety > ops > UX > BI), not by general popularity. A 1.5 KB lib that closes the iOS-push gap ranks higher than a 100k-star BI dashboard.

### Phase 0 — this week, zero new dependencies, life-safety

| # | Tool | Source | Why | License | Caveat |
|---|---|---|---|---|---|
| 1 | Cloudflare Cache Rules + Caddy Cache-Control policy | J §M.4 | Mumbai stranger's GET /api/v1/care drops from ~200 ms (round-trip to OVH) to ~5 ms (Cloudflare Mumbai POP cached). /d/* and /api/v1/dogs/* are no-store (SOS state changes underneath); /api/v1/care* is 60s cache; /_next/static/* is 1-year immutable. Zero new code; the single biggest perf win in the entire stream. | n/a | A misconfigured cache rule on /d/* is a life-safety bug. Add a Playwright CI test that asserts cf-cache-status: DYNAMIC on /d/<slug> responses. |
| 2 | Native Web Speech API (no repo) | B §E.7, J §M.9 | Closes the illiterate-user gap on the scan page at zero KB. `speechSynthesis.speak(new SpeechSynthesisUtterance("This dog is named Sheru. Press the SOS button to alert nearby responders."))` is a one-liner that works on 95%+ of Indian Android phones. | W3C spec | Voice quality varies; SpeechRecognition is online-only on Chrome. Honor the honesty rule: if the browser doesn't support it, the button isn't shown. |
| 3 | Sec-ant/barcode-detector ★229 | H §K.1 | Closes the iOS-Safari/Firefox QR-scanning gap. Drop-in polyfill preserves the existing apps/scan/components/QrScanner.tsx call shape — single conditional dynamic import. | MIT | ~3 KB JS + ~13 KB WASM (lazy, cacheable). The WASM compile cost on a Moto G is ~100-300 ms; acceptable for the "tap-to-load camera" path. |
| 4 | fastify/fastify-compress ★229 + fastify/fastify-etag ★85 | J §M.3 | Brotli-4 compresses /api/v1/care JSON from ~3.5 KB to ~1.2 KB. ETag + conditional GET saves the ~3 KB scan HTML body on refresh. | MIT | Or compress at Caddy edge instead — pick one. Never ETag the SOS state endpoint. |
| 5 | gka/chroma.js ★10.6k | J §M.10 | CI script that asserts every text/background pair in packages/design/tokens.css meets WCAG-AA 4.5:1 contrast. Catches the next regression where someone darkens the SOS button's red from #c0392b to #a93226 and drops contrast from 4.6:1 to 4.3:1. | Apache-2.0 | ~12 KB; only the chroma.contrast() function is used. A 20-line WCAG contrast formula is the leaner alternative. |

### Phase 1 — next, small deps, life-safety + ops

| # | Tool | Source | Why | License | Caveat |
|---|---|---|---|---|---|
| 6 | wal-g/wal-g ★4.2k | I #1 | PG WAL archiving to R2, 5-min PITR. The append-only medical_records ledger becomes evidence-grade recoverable. Closes the largest DR gap (HOW-IT-WORKS is silent on PG backups; Supabase mirror is not PITR). | Apache-2.0 | Outbound-only HTTPS to R2, ~30 MB binary. Don't include the pepper in a restic backup that goes to a third party. |
| 7 | restic/restic ★35.5k | I #2 | Encrypted, deduped file backups of /srv/hetja/ + systemd/Caddy config → R2. Complement to wal-g. | BSD-2-Clause | Outbound-only. Restic encrypts client-side; R2 sees ciphertext only. |
| 8 | WeidiDeng/caddy-cloudflare-ip ★123 | I #3 | Caddy module that makes @fastify/rate-limit see real client IPs instead of Cloudflare's. Without this, every stranger appears as one of ~20 CF edge IPs and the rate limiter is broken. One Caddyfile line. | Apache-2.0 | ★123 is small; the module is ~200 lines of Go. Fork if it ever goes stale. |
| 9 | panva/jose ★7.7k | A #1 | JOSE layer for vet-key rotation, JWKS, signed scan-page proofs. Replaces ad-hoc crypto in packages/ledger. | MIT | Unambiguous; both Stream A and Stream D converge on this. |
| 10 | catamphetamine/libphonenumber-js ★3.0k | D #1 | E.164 normalization for care_providers.phone. One-off migration script + Fastify pre-handler. Pairs directly with the existing phone_verified_at honesty rule. | MIT | Tree-shakes to ~140 KB if you import only India metadata; apps/web only, never apps/scan. |
| 11 | pgaudit/pgaudit ★1.7k | D #3 | DB-level audit floor. CREATE EXTENSION pgaudit; on existing PG 16, ships with the database, zero new services. | PostgreSQL License | Requires shared_preload_libraries restart. Set log rotation. Pairs with hand-rolled audit_log table for queryable application audit. |
| 12 | altcha-org/altcha ★2.7k | A #3 | Maintained PoW widget, replaces hand-rolled PoW on SOS endpoint. Closes the "challenge token can be reused" gap. | MIT | PoW has documented bypass techniques; treat as a throttle, not a gate. Server-side rate caps remain the real defence. |
| 13 | telegraf/telegraf ★9.2k | B #2 | Telegram bot for responder coordination; inline "Claim" button calls /sos/cases/:id/ack. Closes iOS-push gap for Telegram-using responders; no paid accounts. | MIT | Bot API 7.1 lags upstream. Web Push still needed for non-Telegram responders. |
| 14 | dchest/tweetnacl-js ★1.9k | D #2 | 7 KB NaCl secretbox for field-level encryption of care_providers.phone, dogs.exact_lat/lng, device tokens. Closes the gap between INVARIANT 3 (HMAC identity) and the columns INVARIANT 3 doesn't cover. | Unlicense | Public domain; the most permissive license in the entire stack. No Argon2id (Hetja has no passwords). |
| 15 | merkletreejs/merkletreejs ★1.2k | A #2 | Merkle root over each dog's medical_records rows on each insert, persisted alongside the chain head. The verifyProof function is what an external auditor would call against a printed root from a cruelty-case exhibit. | MIT | Server-side (packages/ledger), not in apps/scan. Browser build needs Buffer polyfill. |
| 16 | GoogleChrome/web-vitals ★8.6k | J §M.16 | 1.5 KB field measurement of LCP/CLS/INP on apps/scan + apps/web; sendBeacon to /api/v1/metrics/web-vitals with slug stripped to /d/:slug. The truth-measurement that closes the loop on every perf claim. | Apache-2.0 | Privacy check (INVARIANT 2): store /d/:slug not /d/<slug>. |
| 17 | isaacs/node-lru-cache ★5.9k | J §M.1 | 60s TTL cache for care_providers, 5s TTL for dog pages. Drops GET /api/v1/care from ~80 ms (PG query) to ~3 ms (cache hit). | BlueOak-1.0.0 | Functionally MIT-equivalent. In-process only — does not survive restarts, not shared across the 4 systemd units. Fine for read-only public data; never for SOS case state. |
| 18 | fengyuanchen/compressorjs ★5.8k + MikeKovarik/exifr ★1.2k | H §K.3 + §K.4 | Feeder photo upload: compressorjs auto-orients + compresses (~9 KB gzipped); exifr extracts orientation + GPS (~2 KB orientation-only build). Closes the sideways-photo bug class without a separate orientation dep. | MIT (both) | exifr's last push was March 2024; stable, but quiet. |
| 19 | imgproxy/imgproxy ★11k | J §M.6 | 30 MB-RAM Go service behind Caddy /img/*. Drops the dog photo from 1.5 MB to ~80 KB (640×480) for the Mumbai 4G stranger. Single biggest perceived-perf win. Honors Stream H's EXIF-GPS-strip invariant. | Apache-2.0 | Adds a service. Alternative: next/image for apps/web (zero new dep); Cloudflare Images ($5/mo for 100k transformations). |
| 20 | btd/sharp-phash ★69 | H §K.5 | Node-worker pHash for duplicate-photo detection. Pairs with Postgres BIGINT + popcount(x # y) for Hamming distance. Closes the "six-Tuesday-photos-of-the-same-dog" storage waste. | MIT | ★69 is small; algorithm is ~80 lines. If it ever goes stale, ~100-line in-house implementation against sharp is realistic. |
| 21 | ai/size-limit ★6.9k | J §M.7 | Per-route bundle-size budgets on apps/web. Extends the 40 KB scan-app gate. A PR that adds a 50 KB date-picker library to apps/web gets rejected by CI before merge. | MIT | Adds ~30 s to CI build. Run only on the changed app. |
| 22 | GoogleChrome/lighthouse-ci ★7.0k | J §M.8 | Per-PR perf + a11y budgets on /d/<slug>: LCP < 2500 ms, CLS < 0.1, INP < 200 ms, a11y score > 95. | Apache-2.0 | ~60 s overhead; run in a separate GitHub Actions job. Lighthouse uses axe-core under the hood for a11y — coarser-grained than @axe-core/playwright directly. |
| 23 | @axe-core/playwright (subpackage of dequelabs/axe-core-npm ★718) | J §M.10 | Playwright binding for the existing axe-core engine. Assert no serious or critical WCAG-AA violations on /d/<slug> in every CI run. | MPL-2.0 | Colour-contrast rule does not run under jsdom — needs a real browser (Playwright solves this). |
| 24 | renovatebot/renovate ★22.3k | I #4 | Per-dep PRs across the pnpm monorepo; CI gates run on every PR. Runs on GitHub infra so it can't OOM the box. AGPL-3.0-only is moot (Hetja is AGPL; hosted App is not a license event anyway). | AGPL-3.0-only (hosted Mend App) | Use the hosted Mend App, not self-host. Start with Dependabot (free, MIT, zero-config); switch to Renovate the day you find yourself merging five identical bump next PRs. |
| 25 | upptime/upptime ★17.1k | I #5 | Static status page from GitHub Actions. Zero local footprint, no inbound port — perfect fit for the no-inbound-ports rule. 5-min granularity matches the worker's 8-min escalation window. | MIT | Configure multi-site checks: /api/v1/health and /api/v1/care separately, so a partial outage is reported as partial. |

### Beyond the Top 25 (Phase 2-4 picks, in priority order)

26. **pgbouncer/pgbouncer ★4.3k** (I §L.8 + J §M.1 cross-ref) — connection-storm protection; Phase 2.
27. **TanStack/query ★~45k** (E #3) — feeder photo-upload mutation queue with IndexedDB persister; Phase 2.
28. **react-hook-form/react-hook-form ★~44.8k** (E #2) — schema-driven tagger form; Phase 3.
29. **pubkey/rxdb ★~23.3k** (E #1) — offline-first store for apps/field; Phase 3.
30. **yjs/yjs ★~17k** (E #5) — collaborative retag documents; Phase 3.
31. **transloadit/uppy ★30.9k** + tus/tusd (E #4) — resumable uploads with tusd-as-systemd-unit fronting R2; Phase 4.
32. **maplibre/maplibre-gl-js ★11.3k** (C #2) — mapping UI on apps/web; Phase 3.
33. **maplibre/martin ★3.8k** (C #3) — PostGIS-to-MVT for live data layers; Phase 4.
34. **protomaps/PMTiles ★3.0k** (C #4) — India basemap as static file; Phase 3.
35. **mapbox/tippecanoe ★3.1k** (C §F.6) — pre-bake India extract; Phase 3 dev box.
36. **websockets/ws ★22.8k** (B #4) — in-process responder real-time; Phase 3.
37. **MasterKale/SimpleWebAuthn ★2.3k** (D #4) — optional passkey path; Phase 3 conditional on apps/field.
38. **getsops/sops ★22.8k + FiloSottile/age ★23.2k** (I §L.3) — file-based secrets for .env in repo; Phase 5 (pepper rotation).
39. **flipt-io/flipt ★4.9k** (I §L.4) — feature flags; FCL license flagged; Phase 4.
40. **paradedb/paradedb ★9.15k** (F #1) — in-Postgres BM25; AGPL fine alongside Hetja AGPL; Phase 3.
41. **timescale/timescaledb ★23.3k** (F #3) — hypertables + continuous aggregates; Phase 2.
42. **umami-software/umami ★38.2k** (F #2 alt) — privacy-first analytics, Node+PG fit; Phase 1.
43. **plausible/analytics ★28.5k** (F #2) — privacy-first analytics, Elixir runtime; Phase 1 cloud free tier.
44. **metabase/metabase ★48.7k** (F #4) — NGO self-serve BI; Phase 1 Metabase Cloud Starter, Phase 5 self-host second box.
45. **grafana/grafana ★76.3k** (F #4 + I §L.10) — operational dashboards; Phase 4.
46. **vectordotdev/vector ★22.4k + Grafana Cloud free tier** (I §L.10) — log aggregation without local RAM; Phase 5.
47. **diegomura/react-pdf ★16.7k** (F §I.7) — declarative PDF reports; Phase 4.
48. **exceljs/exceljs ★15.4k** (F §I.8) — XLSX with cell styling for government intake; Phase 4.
49. **tremorlabs/tremor-npm ★16.5k** (F #5) — dashboard components on Tailwind+Radix; Phase 4. Pin v3.
50. **recharts/recharts ★27.5k** (F §I.5) — light charts on feeder dashboard; Phase 4.
51. **decentralized-identity/did-jwt-vc ★211 + DIVOC schema** (A #4 + G §J.7) — vet-signed vaccination VCs; Phase 3 conditional on second vet.
52. **owahltinez/triplet-loss-animal-reid ★14** (G §J.5) — lost-dog re-ID training scaffold; Phase 4.
53. **graphology/graphology ★1.7k** (A #5) — EigenTrust over feeder trust graph; Phase 4 conditional on 1000+ feeders.
54. **paulmillr/noble-hashes ★897** (A §D.3) — audited pure-JS hashes for packages/ledger browser code; Phase 2.
55. **sheltermanager/asm3 schema** (G §J.1) — adopt the data model, not the code; Phase 4 reference.
56. **egovernments/divoc-docs schema** (G §J.7) — adopt the credential schema; Phase 3.
57. **adobe/react-spectrum ★15.8k** (J §M.14) — accessible comboboxes/date-pickers for apps/field; Phase 3.
58. **tailwindlabs/headlessui ★28.7k** (J §M.13) — Headless React components for the SOS modal; Phase 3.
59. **zhensherlock/watermark-js-plus ★562 + hMatoba/piexifjs ★613** (H §K.8 + §K.4) — three-layer photo provenance (visible + blind + EXIF); Phase 5.
60. **timotgl/inspector-bokeh ★48** (H §K.9) — pre-upload blur warning; Phase 4.

### Phase 5+ (post-funding, second box)

61. **Project-OSRM/osrm-backend ★7.97k** (C #1) — drive-time routing.
62. **uber/h3 ★6.5k** (C #5) — geofence fan-out at scale.
63. **novuhq/novu ★39.5k** (B §E.3) — multi-channel notification orchestration.
64. **chatwoot/chatwoot ★35.8k** (B §E.6) — shared inbox.
65. **Infisical/infisical ★28.7k self-host** (D #5) — secrets platform.
66. **metabase/metabase self-host** (F #4) — when cloud bill > second-box cost.
67. **grafana/loki ★28.7k self-host** (I §L.10) — log aggregation (or stick with Vector + Grafana Cloud).
68. **Exotel hosted IVR** (B #5) — phone-call SOS line for illiterate users.
69. **great-detail/WhatsApp-JS-SDK ★39** (B #3) — WhatsApp Cloud API for stranger-facing SOS ack.
70. **sheltermanager/asm3 ★143** (G §J.1) — partner NGO shelter-ops software (hosted sheltermanager.com).
## §R. Corrections & "do not implement" flags *(new — Audit §AUD.6)*

The final arbiter's list. Every tool any stream flagged as archived, deprecated, license-changed, or wrong-domain.

### R.1 Archived (formally)

| Repo | Stream | Date | Reason / successor |
|---|---|---|---|
| `WhatsApp/WhatsApp-Nodejs-SDK` | B §E.1 | 2023-06-07 | Meta's official SDK; use `great-detail/WhatsApp-JS-SDK` (MIT) or raw `fetch`. |
| `salesforce/BLIP` | existing §A | 2026-03-03 | Use successor LAVIS for captioning. |
| `mapbox/geojsonhint` | C | 2024-05-28 | Use `placemark/check-geojson`. |
| `github/webauthn-json` | D §G.1 | 2025-08-25 | Use `@simplewebauthn/browser`. |
| `spruceid/didkit` | A §D.8 | 2025-07-10 | Use `spruceid/ssi` (active). |
| `ChainSafe/persistent-merkle-tree` | A §D.8 | 2022-03-18 | Use `merkletreejs/merkletreejs`. |
| `summa-dev/merkle-sum-tree-ts` | A §D.8 | 2023-02-03 | + GPL; archived + GPL = double no. |
| `worldcoin/world-id-js` | A §D.8 | 2023-04-10 | Superseded by `world-id-contracts` (also rejected on policy). |
| `Dev-Thought/petcator` | G §J.4 | 2023-03-08 | Microchip registry prototype that went nowhere. |
| `electric-sql/electric-old` | E §H.3 | (pivot) | Project pivoted; old local-first-write capabilities gone. |

### R.2 Deprecated (functionally dead, not formally archived)

| Repo | Stream | Status |
|---|---|---|
| `timescale/promscale` | F §I.2 | DEPRECATED 2023-04-30 per repo README + Tiger Data blog. |
| `decentralized-identity/ion` | A §D.8 | Dormant since 2023-08; Microsoft sunset ION network. |
| `proof-of-humanity/proof-of-humanity` | A §D.6 | Dormant since 2023-01; Kleros deprioritised PoH v2. |
| `brix/crypto-js` | D §G.5 | README itself says discontinued; last push 2024-08-09. |
| `cisco/node-jose` | D §G.10 | Stale ~12 months; superseded by `panva/jose`. |
| `jayhaluska/isolation-forest-js` | A | Dormant 2023-01; port the algorithm or use `divinator`. |
| `gnuvet/gnuvet` | G §J.2 | Dormant 2015; zero stars. |
| `CharltonIT/openvpms` | G §J.2 | Dormant 2015; adopt schema only. |
| `rubyforgood/shelter-assist` | G §J.1 | Low-activity since 2022; schema reference only. |
| `geosem42/PetCare` | G §J.2 | Low-activity since 2023; schema reference only. |
| `yec/rescue_groups` | G §J.3 | Dormant 8+ years. |
| `puremourning/petidlookup` | G §J.4 | Dormant 10 years; US-only. |
| `mailcheck/mailcheck` | D §G.4 | Low-activity since 2022; refresh domain list and inline. |
| `indutny/proof-of-work` | A §D.8 | Stale 2020; no license. |
| `digitalbazaar/equihash` | A | Stale 2017. |
| `Karma3Labs/rs-eigentrust-snaps` | A §D.5 | No license file; read for the algorithm, don't depend. |
| `thesimon82/Laplacian-Blur-Detector` | H §K.9 | ★0, no LICENSE file. |
| `puntorigen/blurry-detector` | H §K.9 | ★1, no LICENSE file. |
| `Brian Gurwitz's watermarkjs` | H §K.8 | Dormant since Jan 2020; replaced by `watermark-js-plus`. |
| `@squoosh/lib` | H §K.3 | Explicitly deprecated by own npm README. |
| `sptmru/voiceivr` | B §E.5 | ★6 stale POC, no license. |
| `protomaps/protomaps-leaflet` | C §F.6 | Maintenance mode per docs.protomaps.com; use MapLibre GL JS + PMTiles for new projects. |
| `rocicorp/replicache` | E §H.8 | Maintenance mode; active dev moved to `rocicorp/zero`. |
| `jaredpalmer/formik` | E §H.5 | Maintenance mode; maintainer recommends RHF. |
| `Bull v1` (existing doc) | existing | Maintenance-mode legacy; use BullMQ. |
| `tremorlabs/tremor` (deprecated URL) | F §I.5 | Use `tremorlabs/tremor-npm` (canonical). |
| `node-cache-manager/node-cache-manager` | J §M.1 | 301-redirects to `jaredwray/cacheable`. |
| `unlighthouse/unlighthouse` | J §M.8 | 404; moved to `harlan-zw/unlighthouse`. |
| `StackExchange/dnscontrol` | I §L.12 | 301-redirects to `DNSControl/dnscontrol`. |
| `cabotapp/cabot` | I worklog | 301-redirects to `arachnys/cabot`. |
| `garagehq/garage` | I worklog | 301-redirects to `deuxfleurs-org/garage`. |
| `postgresdec/pgcat` | I worklog | 301-redirects to `postgresml/pgcat`. |
| `github/dependabot-core` | I §L.5 | 301-redirects to `dependabot/dependabot-core`. |
| `umami-so/umami` | F §I.3 | 404; moved to `umami-software/umami`. |
| `zinclabs/zinc` | F §I.1 | 301-redirects to `zincsearch/zincsearch`. |
| `openstreetmap/osm2pgsql` | C §F.7 | 301-redirects to `osm2pgsql-dev/osm2pgsql`. |
| `drifting-in-space/y-sweet` | E §H.2 | Moved to `jamsocket/y-sweet`. |
| `electric-sql/electric-old` | E §H.3 | Archived; new ElectricSQL is a different product. |

### R.3 License-changed

| Repo | Stream | Old → New | Verdict |
|---|---|---|---|
| `mapbox/mapbox-gl-js` | C §F.2 | BSD-2 → proprietary in v2.0 (2021) | **REJECT.** Use `maplibre/maplibre-gl-js` (BSD-3-Clause fork). **The most important license correction in the entire doc.** |
| `Unleash/unleash` | I §L.4 | Apache-2.0 → AGPL-3.0 in 2023 | Fine alongside Hetja AGPL (audit overturns Stream I's AGPL rejection); Flipt still wins on operational grounds. |
| `faisalman/ua-parser-js` | J §M.17 | MIT (v1) → AGPL-3.0 (v2) in 2024 | Pin v1 for clean MIT; or accept AGPL v2 (fine alongside Hetja AGPL). Never on `apps/scan` (40 KB budget). |
| `dragonflydb/dragonfly` | J §M.2 | (always BUSL-1.1, but older blog posts claim Apache) | BUSL-1.1; reject (no Redis workload). |
| `redis` (upstream, not in streams) | (industry context) | BSD-3-Clause → BSL-1.1 in 7.4 (2024) | Linux Foundation forked Valkey; not directly relevant to Hetja since Hetja has no Redis workload. |

### R.4 Wrong-domain

| Repo | Stream | Reason |
|---|---|---|
| `deepinsight/insightface` | existing §A | Human faces + non-commercial pretrained weights; wrong domain for dog re-ID. |
| `mmsaki/dog-registry-blockchain-app` | G §J.4 | Off-topic blockchain; Hetja's hash-chained `medical_records` already achieves tamper-evidence (INVARIANT 9). |
| `ar-tts` | J §M.9 | Arabic-specific TTS; Hetja's locales are EN/HI/MR. |
| `responsiveVoice.js` | J §M.9 | Commercial, not OSS; 150 KB; sends device fingerprint to third party (INVARIANT 3 violation). |

### R.5 Wrong-stack / wrong-shape

| Repo | Stream | Reason |
|---|---|---|
| `matomo-org/matomo` | F §I.3 | PHP/MySQL stack mismatch with Node+PG one-box. |
| `apache/superset` | F §I.4 | Python/Flask/Redis/Celery heavier than Metabase. |
| `realm/realm-js` | E §H.1 | BSL-derived, not OSI; RN-first, web secondary. |
| `firebase/firebase-js-sdk` | E §H.1 | Proprietary Google-hosted service; violates one-box rule + INVARIANT 3. |
| `couchbase/couchbase-lite-react-native` | E §H.10 | RN-only; requires Couchbase Server on box. |
| `Nozbe/WatermelonDB` | E §H.1 (soft-reject) | RN-first; web support secondary; for Next.js-first, RxDB is better. |
| `aspen-cloud/triplit` | E §H.3 | Owns your data layer; violates "PG is source of truth". |
| `apache/couchdb` (for PouchDB) | E §H.1 | Second database alongside PG; wrong shape. |
| `deuxfleurs-org/garage` | I §L.7 | Self-hosted S3 on same box as PG defeats off-box DR. |
| `distribution/distribution` | I §L.7 | Hetja is bare metal, no containers. |
| `Unitech/pm2` | I §L.9 | systemd already does cgroup isolation, restart-on-crash, journald. |
| `mholt/caddy-l4` | I §L.6 | L4 TCP/UDP proxy unnecessary behind Cloudflare HTTP tunnel. |
| `dragonflydb/dragonfly` + `Snapchat/KeyDB` + `microsoft/garnet` | J §M.2 | No Redis workload; BullMQ + rate-limiter-flexible support PG backends. |
| `n8n-io/n8n` | B §E.3 | Sustainable Use License, not OSI; forbids hosting as a product for partner NGOs. |
| `Cabot` | I §L.11 | Django+Celery+Redis+PG is the Stream-B-Novu OOM-kill pattern at smaller scale. |
| `Asterisk` + `FreeSWITCH` | B §E.5 | Want UDP ports; no-inbound-ports rule kills them. |

### R.6 Supply-chain flags (not license, but operational)

| Repo | Stream | Issue |
|---|---|---|
| `SheetJS/sheetjs` | F §I.8 | Apache-2.0 but not on npm since 2022 (legal dispute with npm Inc.); install from `cdn.sheetjs.com` tarball. Or use `exceljs` (MIT, on npm). |
| `harlan-zw/unlighthouse` | J §M.8 | LICENSE file missing from repo root; license declared as MIT in `package.json#license`. Supply-chain flag — pin the version, audit before each upgrade. |
| `CharltonIT/openvpms` | G §J.2 | NOASSERTION (custom OpenVPMS license); read before any derivative use. |
| `metafloor/bwip-js` | H §K.1 | NOASSERTION on GitHub API (effectively MIT per source headers); metadata gap, not a license problem. |
| `maptiler/tileserver-gl` | C §F.5 | NOASSERTION on API; BSD-3-Clause per LICENSE file. |
| `protomaps/PMTiles` | C §F.6 | NOASSERTION on API; BSD-3-Clause per LICENSE file. |
| `valhalla/valhalla` | C §F.1 | NOASSERTION on API; MIT per LICENSE file. |
| `bjornharrtell/jsts` | C §F.4 | NOASSERTION on API; dual BSD-3-Clause OR EPL-2.0 per LICENSE file. |
| `flipt-io/flipt` | I §L.4 | NOASSERTION on API; Fair Core License 1.0, MIT Future per LICENSE file (not OSI-approved). |
| `Infisical/infisical` | D §G.11 | NOASSERTION on API; MIT for non-`ee/` content, dual-licensed `ee/` per LICENSE file. |
| `pgbouncer/pgbouncer` | I §L.8 | NOASSERTION on API; ISC per COPYRIGHT file (not the BSD-3-Clause commonly cited). |
| `libsodium.js` | D §G.5 | NOASSERTION on API; ISC per `package.json#license`. |
| `pgaudit/pgaudit` | D §G.9 | NOASSERTION on API; PostgreSQL License per LICENSE file. |
| `Snapchat/KeyDB` | J §M.2 | License file is `COPYING`, not `LICENSE` — naive raw fetch returns 404. |

---

## §S. Unresolved disagreements (debate outcomes) *(new — Audit §AUD.7)*

Where streams disagreed. The audit agent picked a side with reasoning, or escalated.

### S.1 Stream B vs audit: AGPL rejection of Soketi
- **Stream B position:** Soketi is REJECTED on AGPL-3.0 grounds.
- **Audit position:** Stream B's AGPL rejection is **wrong**. Hetja itself is AGPL-3.0; combining two AGPL works produces an AGPL derivative, which Hetja already is.
- **However:** Soketi is still rejected on operational grounds — `websockets/ws` in-process (Stream B's own primary pick) is leaner, and `centrifugal/centrifugo` (Apache-2.0) is the right alternative if a separate WebSocket server is ever needed.
- **Verdict: REJECT (operational, not license).** Stream B's primary recommendation (`ws`) stands; the license reasoning is corrected.

### S.2 Stream I vs audit: AGPL rejection of Unleash, Garage, pm2
- **Stream I position:** Unleash, pm2, and Garage are rejected on AGPL-3.0 grounds.
- **Audit position:** Stream I's AGPL rejections are **wrong** (same Hetja-AGPL finding). All three are still rejected on operational grounds: Unleash (Node + separate PG + 300-500 MB is heavier than Flipt's single Go binary), pm2 (systemd already does the job), Garage (R2 is already the right answer; S3 on the same box as PG defeats off-box DR).
- **Verdict: All three REJECTED (operational, not license).**

### S.3 Stream D vs Stream I: secrets management (Infisical vs SOPS+age)
- **Stream D §G.11:** Infisical (self-hosted or cloud free tier) for pepper rotation + env hygiene.
- **Stream I §L.3:** SOPS+age is the file-based alternative that fits the same problem without a running service.
- **Audit position:** Complementary, not contradictory. Stream I's intro explicitly says "Stream D wrote the canonical entries for Infisical/Doppler; I cover the file-based alternatives."
- **Verdict: ADOPT BOTH.** SOPS+age for the `.env` file in repo (decrypted at deploy time by GitHub Actions). Infisical cloud free tier for non-pepper runtime secrets (Brevo key, VAPID key, tunnel token). Keep pepper in OVH env until a second box justifies Infisical self-host.

### S.4 Stream F vs Stream I: feature flags (GrowthBook vs Flipt vs Unleash)
- **Stream F §I.10:** GrowthBook (MIT core, ~500 MB RAM) for feature flags + A/B testing. Never for SOS-flow A/B (life-safety ethics).
- **Stream I §L.4:** Flipt (Fair Core License, single Go binary, PG-backed) is the right one-box fit. Unleash (AGPL) mentioned but rejected.
- **Audit position:** Flipt and GrowthBook serve different use cases. Flipt is the right pick for pure feature flags — it's lighter and Git-native. GrowthBook is the right pick if A/B testing non-life-safety UX is needed.
- **Verdict: ADOPT Flipt (Phase 4), DEFER GrowthBook (Phase 5 conditional on A/B testing need). Unleash REJECTED (operational, not license — Flipt wins).**

### S.5 Stream F vs Stream I: log aggregation (Loki self-host vs Vector+Grafana Cloud)
- **Stream F:** Grafana self-hosted on the box (Go binary ~150 MB RSS).
- **Stream I:** Loki self-hosted (AGPL flag) OR Vector + Grafana Cloud free tier.
- **Audit position:** No real disagreement. Stream I's Vector + Grafana Cloud free tier is the lighter path; Stream F's Grafana self-host is for the dashboard. The two streams converge: self-host Grafana on the box for dashboards, ship logs to Grafana Cloud via Vector.
- **Verdict: ADOPT Grafana self-host on box (Phase 4) + Vector → Grafana Cloud free tier (Phase 5). Self-host Loki only if the SaaS dependency is rejected.**

### S.6 Stream A vs Stream D: fingerprintjs
- **Stream A:** `fingerprintjs/fingerprintjs` as a server-side signal hashed under pepper, never on the anonymous scan page (INVARIANT 3 tension).
- **Stream D:** `fingerprintjs/BotD` for browser-side bot detection (transmit only boolean, never raw fingerprint); `thumbmarkjs/thumbmarkjs` for authenticated-side device fingerprint.
- **Audit position:** ADOPT all three with the INVARIANT 3 caveat — never on the anonymous scan page, hash under pepper, use BotD as a one-bit boolean only.
- **Verdict: ADOPT all three (server-side or authenticated-side only).**

### S.7 Stream B vs Stream J: TTS for scan page
- **Stream B:** Native Web Speech API (zero KB) + `leaonline/easy-speech` (3 KB polyfill) + `meSpeak.js` (150 KB, offline, robotic).
- **Stream J:** Reinforces B; rejects `responsiveVoice.js` (commercial, 150 KB, INVARIANT 3 violation) and `ar-tts` (Arabic-only, irrelevant).
- **Audit position:** No disagreement. Both streams converge.
- **Verdict: Native Web Speech API (Phase 0); easy-speech only if voice-loading bug bites in QA; meSpeak only if offline requirement is hard. REJECT responsiveVoice + ar-tts.**

### S.8 Stream C vs Stream F: deck.gl on top of MapLibre GL JS
- **Stream C:** MapLibre GL JS for navigation UI on apps/web.
- **Stream F:** deck.gl renders on top of MapLibre GL JS for dashboards (heatmaps, hex-binned incident counts).
- **Audit position:** Explicit cross-reference; no disagreement.
- **Verdict: ADOPT both (Phase 3 MapLibre GL JS; Phase 5 deck.gl lazy-loaded on NGO dashboard route).**

### S.9 Stream I vs Stream J: pgbouncer
- **Stream I:** pgbouncer primary (transaction mode), pgcat for multi-PG, supavisor for Supabase migration.
- **Stream J:** Reinforces I from perf angle — connection-storm protection, prepared-statement caveat, TTFB on `/api/v1/care`.
- **Audit position:** No disagreement. Stream J adds the perf angle without overturning Stream I's recommendation.
- **Verdict: ADOPT pgbouncer (Phase 2). Worker stays direct PG for LISTEN/NOTIFY.**

### S.10 Stream F vs audit: SheetJS distribution channel
- **Stream F:** SheetJS is Apache-2.0 but not on npm since 2022; install from `cdn.sheetjs.com` tarball.
- **Audit position:** Supply-chain flag, not a license issue. Honest options: (a) adopt SheetJS with the CDN-install pattern documented, or (b) use `exceljs` (MIT, on npm) for cleaner distribution. For the government-intake use case (highlighting `phone_verified_at IS NULL` rows in yellow), exceljs's cell styling wins.
- **Verdict: ADOPT exceljs (Phase 4) as primary; SheetJS as fallback if raw speed becomes decisive.**

### S.11 Stream J vs audit: ua-parser-js v2 AGPL
- **Stream J:** `faisalman/ua-parser-js` v2 is AGPL-3.0 since 2024; v1 is MIT.
- **Audit position:** AGPL v2 is fine alongside Hetja AGPL, but the v1 branch is cleaner attribution. For `apps/scan` (40 KB budget), use a 5-line regex instead. For `apps/web` SSR, use ua-parser-js v1 (MIT) or `hgoebl/mobile-detect.js` (MIT, 12 KB).
- **Verdict: ADOPT ua-parser-js v1 (MIT branch) for apps/web SSR; 5-line regex for apps/scan.**

### S.12 Stream G vs audit: ASM3 adoption
- **Stream G:** Adopt the ASM3 schema, not the code (Python/PostgreSQL stack mismatch; GPL-3.0).
- **Audit position:** GPL-3.0 is one-way compatible with AGPL-3.0 (combined work becomes AGPL, which Hetja already is). So the license is not a blocker. The stack mismatch (Python+PostgreSQL vs Node+PG) is the real reason to skip the code.
- **Verdict: ADOPT schema only (Phase 4 reference). Code license is fine; stack is not.**

### S.13 Stream F vs audit: node-cron redirect
- **Stream F:** node-cron is in-process and dies on restart; redirect to `graphile/worker` cron (already in existing stack).
- **Audit position:** No disagreement. The redirect is correct.
- **Verdict: REJECT node-cron. Use graphile/worker's crontab.**

### S.14 Stream E vs audit: Replicache vs Zero
- **Stream E:** Replicache is maintenance mode; active dev moved to `rocicorp/zero`.
- **Audit position:** Defer both to Phase 5. RxDB's custom replication is the primary pick; reach for Zero only if RxDB becomes painful.
- **Verdict: DEFER both (Phase 5).**

### S.15 Stream H vs audit: cropperjs v2 vs react-easy-crop
- **Stream H:** `cropperjs` v2 (Web Components, breaking rewrite) or `react-easy-crop` (React-idiomatic, smaller).
- **Audit position:** For a Next.js 14 App Router codebase, `react-easy-crop` is the better default (React-native, 7 KB, no Web Components). `cropperjs` v2 is the right pick only for a future `apps/field` tagger portal that needs advanced rotate/flip/torch UI.
- **Verdict: ADOPT react-easy-crop for apps/web (Phase 2). DEFER cropperjs v2 for apps/field.**

### S.16 Stream E vs audit: R2 + tusd
- **Stream E:** R2 is S3-compatible, NOT tus-compatible. Uppy's `@uppy/tus` plugin cannot upload directly to R2. Need `tusd` (Go, MIT) as a systemd unit in front of R2.
- **Audit position:** This is the single most-important honesty note in Stream E. Two viable paths: (a) Uppy + `@uppy/tus` + tusd-as-systemd-unit + R2-as-S3-backend = fully resumable; (b) Uppy + `@uppy/aws-s3` + R2-direct = chunked with per-part retry, no full resume. Hetja's bad-network use case (Mumbai 4G, 2G in outer suburbs) means full resume matters.
- **Verdict: ADOPT Uppy + tusd + R2 (Phase 4). The tusd Go service is the only new systemd unit Stream E requires.**

### S.17 Stream B vs Stream F vs Stream I: PostHog
- **Stream B:** Not covered.
- **Stream F:** PostHog self-host needs 16 GB RAM + ClickHouse + Kafka + Zookeeper + Postgres + Redis + Django. Use cloud free tier.
- **Stream I:** PostHog cloud free tier is the right shape; self-host only on second box.
- **Audit position:** No disagreement. Cloud free tier only.
- **Verdict: ADOPT PostHog cloud free tier (1M events/month). NEVER self-host on OVH.**

### S.18 ESCALATE TO USER DECISION: Exotel vs no-IVR
- **Stream B:** Exotel is the only IVR architecture that fits the no-inbound-ports deployment. ~₹1,000/month + ₹0.50/min. Paid service.
- **Audit position:** This is the only recommendation in the audit that introduces a recurring paid service. Trade-off: Exotel closes the illiterate-user gap (a stranger who cannot read the scan page can call the Hetja number); the cost is ~₹1,000/month + per-minute fees, which violates the "runs on nothing" rule.
- **Verdict: ESCALATE TO USER.** Two paths:
  - (a) Adopt Exotel when the illiterate-user gap proves wider than Web Speech can close (some users won't scan a QR at all). Phase 4.
  - (b) Reject Exotel; rely on Web Speech + a follow-up design for a phone-call fallback that doesn't require paid IVR.
  - The decision depends on Hetja's funding trajectory and the actual measured illiterate-user gap in the pilot.

---

## §T. What's STILL missing *(new — Audit §AUD.8)*

After all 10 streams' research, what did no stream cover that Hetja probably needs?

### T.1 DPDP consent flows (operational, not tooling)
Stream D §G.6 says "the substantive compliance work is operational" — a `privacy_preferences` table, a `data_subject_requests` table, a 30-line Fastify route, the `audit_log` table from §G.9. **What's missing:** the actual consent UI at the point of collection, the DSAR intake form, the retention-policy enforcement jobs, the breach-notification runbook. These are design gaps, not tooling gaps. **Recommendation:** the team should write a DPDP section that lists the operational deliverables (not repos): consent UI mockup, DSAR route spec, retention policy doc, breach runbook.

### T.2 RTI (Right to Information) workflow
India's RTI Act 2005 applies to public authorities. BMC is a public authority; Hetja's partner-NGO dogs may be subject to RTI requests routed through BMC. **No stream covered** an RTI-response template, workflow, or data-export format. **Recommendation:** add an RTI section with a response template (CSV of dog-level data redacted to ward-level for INVARIANT 2), a 30-day SLA workflow, and a clear policy on what Hetja-disclosed data looks like vs what BMC-disclosed data looks like.

### T.3 Volunteer management / scheduling
The responder roster needs rotation, scheduling, time-off, escalation tiers. The `feeder_role` gate (admin/vet/bmc_officer) covers access control, not scheduling. **No stream covered** an OSS volunteer-management tool. Volgistics is the commercial standard; the OSS landscape is sparse. **Recommendation:** defer to a hand-rolled `responder_rota` table in Postgres + a Grafana dashboard. Do not adopt a separate volunteer-management platform.

### T.4 Donations / fundraising
Hetja is a non-profit; no stream covered OSS donation platforms. **Candidate tools not covered:** `polar.sh/polar` (MIT, sponsorship/donations for OSS-adjacent projects), Stripe Checkout (proprietary but standard), Givebutter (commercial). For Indian NGOs, Razorpay + UPI is the operational default. **Recommendation:** defer to a hand-rolled `/donate` route with Razorpay Checkout + UPI deep links. No new OSS dep needed.

### T.5 Volunteer training / onboarding content
The first-aid card is "vet-approval pending" (HOW-IT-WORKS §9). The broader volunteer onboarding (how to scan, how to ack, how to safely approach an injured dog, how to log a feed) is content, not code. **No stream covered** an OSS LMS (Moodle, Open edX) for training modules. For Hetja's scale, an LMS is overkill — a static Next.js `/training` route with video embeds + a quiz-zod-schema is enough. **Recommendation:** defer to a content production effort, not a tooling effort.

### T.6 Printer hardware integration (collar printing at scale)
Existing doc has `node-qrcode` + `pdfkit` for collar-sheet PDF generation. But the actual printer hardware (Zebra ZPL, Brother label printers, thermal printers) integration is uncovered. **No stream covered** ZPL libraries, print-spooler integration, or the hardware side of "print 500 collars in an afternoon at a sterilization camp." **Recommendation:** add a printer-hardware section listing Zebra ZPL libraries (`python-zpl2` for reference, Node ZPL generators), Brother printer SDKs (proprietary), and a recommendation to use CUPS + the existing `pdfkit` PDF pipeline for the first 1000 collars.

### T.7 Photo provenance / deepfake detection
Stream H covers visible + blind watermarking (`watermark-js-plus`) + EXIF stamping (`piexifjs`) — three layers of provenance. **No stream covered** C2PA (Content Authenticity Initiative) provenance signing or deepfake-detection libraries. For a street-dog platform where photos may be evidence in cruelty cases, C2PA would strengthen chain-of-custody. **Candidate tools not covered:** `c2pa-org/c2pa-typescript` (MIT, but pre-1.0), contentcredentials.org (the public verifier). **Recommendation:** defer C2PA to Phase 6 — the standard is still maturing, and the watermark + EXIF + hash-chain pipeline (Stream H + Stream A) is sufficient for pilot-scale evidence. Track C2PA for the post-funding phase.

### T.8 Multilingual OCR (for vet certificates in Marathi)
Stream G §J.7 mentions DIVOC for verifiable credentials but assumes the vet's PMS issues the VC digitally. In practice, many Mumbai partner clinics hand-write or print paper certificates in Marathi that need digitization. **No stream covered** OCR for Devanagari. Tesseract (Apache-2.0) has Devanagari support; PaddleOCR has stronger multilingual models; `tesseract.js` (Apache-2.0) is the browser-side path. **Candidate tools not covered:** `tesseract.js/tesseract.js` ★35k+ Apache-2.0 (browser + Node), PaddleOCR (Apache-2.0, Python). **Recommendation:** add `tesseract.js` to the Phase 4 plan for the tagger-portal "scan paper certificate → digitize" flow. Pair with the existing pgvector + CLIP pipeline for "match this paper cert to an existing dog record."

### T.9 Calendar/scheduling for sterilization camps
The ABC (Animal Birth Control) programme runs periodic sterilization camps. The operational shape: BMC/NGO schedules a camp at a vet clinic, dogs are intaked, surgeries performed, dogs released. Vet rostering, dog intake slots, post-op tracking — all calendar-shaped. **No stream covered** a calendar/scheduling tool. **Candidate tools not covered:** `calcom/cal.com` ★30k+ AGPL-3.0 (fine alongside Hetja AGPL), `baikal/cal` (GPL-3.0, CalDAV server). **Recommendation:** add `cal.com` (AGPL-3.0, fine alongside Hetja AGPL) to Phase 4 for the ABC camp scheduling. Pairs with `responder_rota` for vet rostering.

### T.10 Geofence drawing UI
Stream C §F.4 mentions `placemark/check-geojson` for validation. But the actual geofence-drawing UI (a tagger or admin drawing a polygon on a map and saving it to PostGIS) needs a drawing library. **No stream covered** `leaflet-draw` or `mapbox-gl-draw` (or the MapLibre equivalent). **Candidate tools not covered:** `Leaflet/Leaflet.draw` ★2.3k BSD-2-Clause, `mapbox/mapbox-gl-draw` ★2.4k BSD-3-Clause (works with MapLibre GL JS via a small adapter), `geoman-io/leaflet-geoman` (commercial + free). **Recommendation:** add `Leaflet/Leaflet.draw` (BSD-2-Clause) or `mapbox-gl-draw` (BSD-3-Clause, works with MapLibre GL JS) to the Phase 3 apps/field plan. Pair with `placemark/check-geojson` for validation on save.

### T.11 Audit-log redaction under DSAR
Stream D §G.9 says "audit logs need to be append-only but not tamper-evident in the cryptographic sense (you need to be able to redact PII from an old row under a DSAR erasure request, which a hash chain would prevent)." **No stream covered** the actual redaction-tooling pattern. The shape: a `redacted_fields` JSONB column on `audit_log`, a `redact_at` timestamp, a scheduled job that nulls fields past retention, and a "redaction log" that records what was redacted when. **Recommendation:** add a DSAR-redaction design section. Not a repo; a pattern.

### T.12 Mobile-responsive print CSS for collar sheets
Existing doc has `pdfkit` for collar sheets. But the actual CSS for A4 label sheets (Avery L7160, etc.) is uncovered. **No stream covered** print-CSS specifically. `pdfkit` is imperative (move-to, line-to); `react-pdf` is declarative but doesn't ship a label-sheet template. **Recommendation:** defer to a content/template effort — a `packages/design/collar-templates/` directory with A4 PDF templates for the 3 most common label sheets (Avery L7160, Herma 4281, local Indian equivalents).

### T.13 Rabies vaccination batch tracking
Stream G §J.4 mentions ISO 11784/11785 microchip standards and DIVOC for VC. But rabies vaccine batch numbers have regulatory reporting requirements in India — adverse events per batch must be reported to the Drugs Controller General of India (DCGI). **No stream covered** a batch-tracking schema or a DCGI adverse-event reporting workflow. **Recommendation:** add a `vaccine_batches` table to the schema design (batch_number, manufacturer, expiry_date, route_of_administration), a `vaccine_adverse_events` table, and a quarterly DCGI reporting job in the worker. Not a repo; a schema and a workflow.

### T.14 Field-data offline maps for taggers
Stream E covers offline-first data sync (RxDB) but not offline map tiles. A tagger in Dharavi without signal needs the map tiles cached on their phone. Stream C covers self-hosted tiles via PMTiles (served via HTTP range requests, no tile-server daemon). PMTiles can be cached via service worker, but no stream connected the dots. **Recommendation:** add an Offline-maps section that combines Stream C's PMTiles + Stream E's service worker. The pattern: bake India extract to PMTiles, host on R2, service worker on `apps/field` caches the Mumbai tile range on first visit (could be ~50 MB), tagger works offline with cached tiles + RxDB data.

### T.15 Out-of-band incident comms (when hetja.in is down)
If Cloudflare tunnel goes down, the SOS flow is broken. The worker can't reach the API; the API can't reach PG. **No stream covered** an out-of-band fallback. Stream B covers Telegram bots but not as a "hetja.in is down" fallback path. **Recommendation:** add an Out-of-band-fallback design section. Two paths: (a) Telegram bot as a "hetja.in is down" mode — responders know to monitor the city NGO channel even without the API; (b) Cloudflare Workers edge-responder (Stream J §M.4) that returns a static "hetja.in is degraded, call [Exotel number]" page if the origin is unreachable. The right answer is both, layered.

### T.16 Animal cruelty case file generation
Stream A mentions "a cruelty-case exhibit" for medical_records hash-chain verification, but no stream covered generating a court-admissible case file (PDF bundle with all evidence, signed Merkle roots, witness statements, photo provenance trail). This would be the deliverable in a real cruelty prosecution under the Prevention of Cruelty to Animals Act 1960. **Recommendation:** add a Cruelty-case-file design section. The deliverable: a PDF generated by `react-pdf` (Stream F §I.7) that includes (a) the dog's full record, (b) all `medical_records` rows with hash-chain verification printout (Stream A's `merkletreejs` inclusion proof), (c) all photos with three-layer provenance (Stream H's watermark + EXIF + visible mark), (d) the Merkle root signed by `panva/jose` (Stream A #1), (e) a witness-statement template. Not a repo; a workflow + a PDF template.

### T.17 Partner-NGO data-sharing agreements
Stream G mentions "outreach to Anwishta/Paws maintainer" but no stream covered the legal/operational side of data-sharing agreements with partner NGOs (model clauses, audit rights, data-minimisation principles, sub-processor restrictions). **Recommendation:** add an NGO-data-sharing design section. The deliverable: a model data-sharing agreement template (CC-BY-SA licensed, so other Indian dog-welfare platforms can reuse), a `partner_ngo_agreements` table in PG, and a `partner_ngo_data_access` audit log.

### T.18 Volunteer safety / SOS-for-volunteers
A responder driving to an injured dog at 2 AM is at personal risk. No stream covered a personal-safety feature for responders (e.g., a check-in timer, an "I'm not safe" panic button, location-sharing with a trusted contact). This is life-safety for the volunteer, not the dog — and it's a real gap. **Recommendation:** add a Volunteer-safety design section. The deliverable: a `responder_check_ins` table (responder_id, expected_back_at, last_lat_lng, status), a worker job that escalates if a check-in is missed, a panic-button route on apps/web that triggers immediate escalation to a trusted contact (defined in `feeders.emergency_contact_hmac` — note: requires extending INVARIANT 3 to allow one HMAC'd emergency contact per responder).

### T.19 Government vet database intake (VET-DATA-INTAKE.md)
HOW-IT-WORKS §9 references this. Stream F §I.8 covers CSV/Excel export (SheetJS / exceljs) but no stream covers the actual intake workflow: CSV → government portal → reconciliation → error correction → re-export. **Recommendation:** add a Vet-data-intake design section. The deliverable: an export job (graphile/worker cron + exceljs), a reconciliation script that diffs the government portal's response against the exported CSV, an error-correction UI on apps/field for taggers to fix mismatches.

### T.20 ABC (Animal Birth Control) surgery scheduling + tracking
Stream G mentions ASM3 schema and ABC programme but no stream covered the specific ABC surgery workflow: intake → pre-op → surgery → post-op → release. This is the operational core of every ABC NGO. **Recommendation:** add an ABC-workflow design section. The deliverable: an `abc_camps` table, an `abc_intakes` table (dog_id, camp_id, intake_at, intake_weight, intake_condition), an `abc_surgeries` table (intake_id, vet_id, surgery_at, surgery_type, anaesthesia, complications), an `abc_releases` table (intake_id, release_at, release_weight, release_condition). Not a repo; a schema and a workflow that maps onto the existing `medical_records` hash-chain.

### T.21 Slack/Discord for partner-NGO comms (not in streams)
Stream B covers Telegram bots but no stream covered Slack/Discord for partner-NGO internal comms. Many Indian NGOs use WhatsApp Groups informally; some use Slack. **Recommendation:** defer — Telegram (Stream B) is the right OSS-friendly path. Slack/Discord would be a partner-NGO choice, not a Hetja dependency.

### T.22 Heat-index / weather API for sterilization camp scheduling
ABC camps are scheduled around weather — Mumbai monsoon makes surgery risky. No stream covered a weather API integration. **Recommendation:** defer — OpenWeatherMap (free tier) or the Indian Meteorological Department's RSS feeds are the right path. Not a Hetja dependency; a content embed on the ABC camp scheduling UI.

### T.23 Multilingual content rendering (Devanagari + Latin)
Stream B covers Web Speech for TTS; the existing doc covers next-intl for i18n. But the actual rendering of mixed Devanagari + Latin text (e.g. "Sheru नाम का कुत्ता") needs font fallback and CSS shaping. **Recommendation:** defer to a `packages/design` design effort — Inter for Latin, Noto Sans Devanagari for Hindi/Marathi, with CSS `font-family` fallback chains. Not a repo; a CSS policy.

### T.24 Backup-restore drill / runbook
Stream I §L.1 + §L.2 cover wal-g + restic backups to R2. But no stream covered the actual restore-drill runbook — the quarterly exercise of restoring from backup to a fresh box and verifying the append-only `medical_records` ledger is intact. **Recommendation:** add a Restore-drill design section. The deliverable: a quarterly runbook that (a) spins up a fresh OVH box, (b) restores PG from wal-g, (c) restores files from restic, (d) verifies the Merkle root (Stream A #2) matches the production root, (e) verifies the hash chain on `medical_records` is intact, (f) tears down. Document the time-to-restore as the SLA.

### T.25 Subreddit / community forum
No stream covered an OSS community forum for Hetja's volunteer + feeder community. Discourse (GPL-3.0) is the canonical OSS forum; Flarum (MIT) is the lighter alternative. **Recommendation:** defer to Phase 5+ — Hetja's community is small enough that a Telegram group (Stream B's recommendation) suffices. Discourse becomes interesting at 1000+ active feeders.
## §U. Priority roadmap — phases, ordered by Hetja-specific value

This is the consolidated, audited roadmap. Each phase is gated on the previous one. The life-safety picks come first because a dog dying untreated is the failure mode; the BI dashboards come last because a missed ack-time P50 is a slip, not a death.

### Phase 0 — this week, zero new dependencies, life-safety
1. **Cloudflare Cache Rules + Caddy Cache-Control policy** — `/api/v1/care*` 60s cache; `/d/*` and `/api/v1/dogs/*` no-store; `/_next/static/*` 1-year immutable. Add a Playwright CI test asserting `cf-cache-status: DYNAMIC` on `/d/<slug>`.
2. **Native Web Speech API** on `apps/scan` — one-liner that speaks the dog's name + SOS prompt. Honor the honesty rule: if `speechSynthesis` is unavailable, the button isn't shown.
3. **`Sec-ant/barcode-detector` polyfill** — drop-in behind a dynamic import on `apps/scan`. Closes the iOS Safari/Firefox gap without touching the 40 KB budget.
4. **`@fastify/compress` + `@fastify/etag`** — brotli-4 on `/api/v1/care` JSON, ETag on the scan HTML. Never ETag the SOS state endpoint.
5. **`gka/chroma.js` CI contrast script** — assert every text/background pair in `packages/design/tokens.css` meets WCAG-AA 4.5:1.
6. **Raise `DEVICE_POW_DIFFICULTY`** from 14 to 18–20 (existing TODO from HOW-IT-WORKS §9).

### Phase 1 — next, small deps, life-safety + ops
7. **`wal-g/wal-g`** — PG WAL archiving to R2, 5-min PITR. The medical ledger becomes evidence-grade recoverable.
8. **`restic/restic`** — encrypted file backups of `/srv/hetja/` → R2. Pairs with wal-g.
9. **`WeidiDeng/caddy-cloudflare-ip`** — fix the broken rate-limiting bug where every stranger appears as one of ~20 CF edge IPs. One Caddyfile line.
10. **`panva/jose`** — JOSE layer for vet-key rotation, JWKS, signed scan-page proofs.
11. **`catamphetamine/libphonenumber-js`** — E.164 normalization for `care_providers.phone`. One-off migration script + Fastify pre-handler.
12. **`pgaudit/pgaudit`** — `CREATE EXTENSION pgaudit;` on existing PG 16. Pairs with a hand-rolled `audit_log` table.
13. **`altcha-org/altcha`** — replace hand-rolled PoW on the SOS endpoint.
14. **`telegraf/telegraf`** — Telegram bot for responder coordination; inline "Claim" button calls `/sos/cases/:id/ack`.
15. **`dchest/tweetnacl-js`** — 7 KB NaCl `secretbox` for field-level encryption of `care_providers.phone`, `dogs.exact_lat/lng`, device tokens.
16. **`merkletreejs/merkletreejs`** — Merkle root over each dog's `medical_records` rows on each insert. INVARIANT 9 upgrade.
17. **`GoogleChrome/web-vitals`** — 1.5 KB field measurement of LCP/CLS/INP on `apps/scan` + `apps/web`.
18. **`isaacs/node-lru-cache`** — 60s TTL cache for `care_providers`, 5s TTL for dog pages.
19. **`fengyuanchen/compressorjs` + `MikeKovarik/exifr`** — feeder photo upload: auto-orient + compress + extract GPS (ward-level only, strip before R2 public bucket).
20. **`@axe-core/playwright`** in CI — assert no `serious`/`critical` WCAG-AA violations on `/d/<slug>`.
21. **`upptime/upptime`** — static status page from GitHub Actions. 5-min granularity.
22. **`plausible/analytics` cloud free tier** (or `umami-software/umami` self-host) — cookieless analytics on `apps/web` only, never `apps/scan`.

### Phase 2 — 1-2 months, ops hardening + DR
23. **`imgproxy/imgproxy`** — 30 MB Go service behind Caddy `/img/*`. Drops the dog photo from 1.5 MB to ~80 KB for the Mumbai 4G stranger.
24. **`btd/sharp-phash`** — duplicate-photo detection in the worker.
25. **`ai/size-limit`** — per-route bundle-size budgets on `apps/web`. Extends the 40 KB scan-app gate.
26. **`GoogleChrome/lighthouse-ci`** — per-PR perf + a11y budgets on `/d/<slug>`.
27. **`renovatebot/renovate`** (hosted Mend App) — per-dep PRs across the pnpm monorepo.
28. **`pgbouncer/pgbouncer`** — connection-storm protection. Worker stays direct PG for `LISTEN/NOTIFY`.
29. **`TanStack/query`** — feeder photo-upload mutation queue with IndexedDB persister; offline-replay on reconnect.
30. **`timescale/timescaledb`** — hypertables + continuous aggregates for scans, SOS cases, ack-time-per-hour.
31. **`paulmillr/noble-hashes`** — audited pure-JS hashes for `packages/ledger` browser code.

### Phase 3 — building the unbuilt surfaces (`apps/field`, `apps/shell`)
32. **`apps/field` (the tagger portal)** — built with:
    - `refine` or `react-admin` (existing §C) for the admin/CRUD framework
    - `react-hook-form` + `libphonenumber-js` + `placemark/check-geojson` for the schema-driven tagger form
    - `pubkey/rxdb` for offline-first store
    - `yjs/yjs` for collaborative retag documents
    - `adobe/react-spectrum` for accessible comboboxes/date-pickers
    - `Leaflet/Leaflet.draw` or `mapbox-gl-draw` for the geofence-drawing UI
33. **`apps/shell` (the native wrapper)** — `capacitor` (existing §C) to close the iOS-push gap.
34. **`maplibre/maplibre-gl-js`** — mapping UI on `apps/web` and `apps/field`.
35. **`protomaps/PMTiles` + `mapbox/tippecanoe`** — India basemap baked on a dev box, hosted on R2 as a static file. PMTiles served via HTTP range requests, no tile-server daemon.
36. **`websockets/ws`** — in-process responder real-time on `apps/web`.
37. **`MasterKale/SimpleWebAuthn`** — optional passkey path for power-feeders (falls back to email code).
38. **`tailwindlabs/headlessui`** — Headless React components for the SOS modal (built-in focus trap).
39. **`paradedb/paradedb`** — in-Postgres BM25 search. AGPL fine alongside Hetja AGPL.
40. **`decentralized-identity/did-jwt-vc` + DIVOC schema** — vet-signed vaccination VCs. Conditional on second vet signing up.
41. **`egovernments/divoc-docs` schema** — adopt the credential schema for the vet-VC pipeline.
42. **`calcom/cal.com`** — ABC sterilization camp scheduling. AGPL fine alongside Hetja AGPL.

### Phase 4 — AI pilot + partner-NGO tooling
43. **AI wound-detection** — Label Studio/CVAT (existing §A) for annotation; Grounding DINO to bootstrap labels; CLIP embeddings for photo→dog matching. **Everything gated as *AI-suggested*, never written to the ledger** (INVARIANT honesty rule).
44. **`owahltinez/triplet-loss-animal-reid`** — lost-dog re-ID training scaffold. Pair with existing pgvector + CLIP.
45. **`transloadit/uppy` + `tus/tusd`** — resumable photo uploads via tus, with tusd-as-systemd-unit fronting R2.
46. **`exceljs/exceljs`** — XLSX with cell styling for government vet-database intake.
47. **`diegomura/react-pdf`** — declarative PDF reports for weekly NGO summaries + cruelty-case-file generation.
48. **`tremorlabs/tremor-npm` + `recharts`** — dashboard components on the NGO dashboard.
49. **`grafana/grafana`** self-host — operational dashboards (ack-time P50/P95, SOS volume per ward).
50. **`flipt-io/flipt`** — feature flags (`FIRST_AID_ENABLED`, `apps/field` gradual rollout, AI kill-switch). FCL license flagged.
51. **`maplibre/martin`** — PostGIS-to-MVT for live data layers on the NGO dashboard.
52. **`prometheus-community/postgres_exporter`** — PG metrics, scraped by Grafana Cloud.
53. **`tesseract.js`** — Devanagari OCR for paper vet-certificate digitization in the tagger portal.
54. **`timotgl/inspector-bokeh`** — pre-upload blur warning on feeder photos.
55. **`graphology/graphology`** — EigenTrust over the feeder trust graph. Conditional on 1000+ feeders.
56. **`centrifugal/centrifugo`** — separate WebSocket server, only if in-process `ws` becomes a bottleneck.
57. **Exotel hosted IVR** — *user decision* — phone-call SOS line for the illiterate-user gap. Adopt when Web Speech proves insufficient.

### Phase 5 — post-funding, second box
58. **Second OVH/Indian box** — the trigger for everything in this phase.
59. **`Project-OSRM/osrm-backend`** — drive-time routing to injured dogs.
60. **`uber/h3`** — geofence fan-out at city-of-Mumbai scale.
61. **`novuhq/novu`** — multi-channel notification orchestration (replaces hand-rolled fan-out).
62. **`chatwoot/chatwoot`** — shared inbox for feeder↔stranger communication.
63. **`Infisical/infisical`** self-host — secrets platform for pepper rotation.
64. **`metabase/metabase`** self-host — when cloud bill > second-box cost.
65. **`grafana/loki`** self-host — log aggregation (or stick with Vector + Grafana Cloud).
66. **`great-detail/WhatsApp-JS-SDK`** — WhatsApp Cloud API for stranger-facing SOS ack + 2-way photo upload.
67. **`sheltermanager/asm3`** — partner NGO shelter-ops software (hosted sheltermanager.com).
68. **`arachnys/cabot`** — PagerDuty-style on-call when the team grows past 3-5 people.
69. **OSM India extract** on the dev box — needed for routing and self-hosted tiles.
70. **Pelias self-host** — when Photon's fair-use becomes insufficient.

### Continuously (no phase)
- **`next-intl`** (EN/HI/MR) — Devanagari rendering with Inter + Noto Sans Devanagari fallback chain.
- **Photon batch-geocoding** of the ~25 centroid-only care providers — close the `distanceM IS NULL` gap.
- **Hand-rolled 2 KB service worker** for `apps/scan` offline — Workbox is too heavy for the 40 KB budget.
- **`node-qrcode` error-correction H** collar sheets — for scratched street collars.
- **BMC Mumbai dog-census 2024-25** — one-off import as a reference table.
- **Quarterly restore-drill runbook** — verify the Merkle root and `medical_records` hash chain after a fresh-box restore.
- **Quarterly `/privacy` page review** — a privacy notice that describes storage you no longer do is simply false (HOW-IT-WORKS §4).

---

## §V. The audit's closing principles

1. **Lead with the life-safety picks.** The Top-25 list is ranked by Hetja-specific value, not popularity. A 1.5 KB lib that closes the iOS-push gap (web-vitals, barcode-detector polyfill) ranks higher than a 100k-star BI dashboard. The Phase 0 section is the most important section.
2. **The AGPL license anxiety is over.** Hetja is AGPL-3.0. The doc no longer repeats the AGPL hedging that runs through Streams B, F, and I. Self-hosting Metabase/Plausible/Grafana/Loki/Unleash/ParadeDB/Renovate/Soketi on Hetja's box is license-fine; the operational concern (OOM risk, one-box shape, redundant with existing tools) is the only real filter.
3. **The cross-stream pairings are the value of the audit.** §N lists 10 pairings; the most important are the dog-photo pipeline (imgproxy + exifr + compressorjs + sharp + R2), the vet-VC pipeline (did-jwt-vc + DIVOC + jose + vets.signing_key_pub), the Telegram-Merkle-SOS pipeline (telegraf + merkletreejs + jose), and the forensic-grade audit trail (pgaudit + wal-g + merkletreejs). The pairings are where Hetja's specific shape becomes legible.
4. **The honesty rule applies to tooling too.** A tool that claims to solve a problem it doesn't (n8n's "Sustainable Use License" that forbids hosting as a product; SheetJS's npm-absence; Mapbox's license change) is rejected on the same grounds that `distanceM` is `null` until geocoding lands. The system is allowed to know less than it wants. It is not allowed to claim more than it knows.

---

*Generated by an 11-agent research swarm (10 stream researchers + 1 cross-stream auditor) · 2026-08-13 IST · all star counts and license fields verified live via GitHub REST API where rate-limit allowed, otherwise via HTML page scrape + raw LICENSE file fetch cited inline · the single most-important verification — Hetja's own AGPL-3.0 license — was confirmed directly.*
