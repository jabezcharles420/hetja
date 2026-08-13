# Hetja — Complete Build Work Report

*Status: live document — final sections updated after the production build + deploy.*
*Author: Hermes (admin agent) · Period: 2026-08-04 → 2026-08-12*

---

## 0. TL;DR

**Hetja** — a production-grade civic-tech network for
Mumbai's stray dogs — was designed, built, tested and **deployed on this VPS**.
**172 automated tests green**, 5 parallel-agent build waves, 2 deep research
rounds, security hardening applied from the findings, and a full mobile-first
frontend (Next.js 14 PWA) with a bespoke design system. Built with the opencode CLI
as parallel sub-agents per the user's mandate; no OOMs (waves + memory monitoring).

---

## 1. Infrastructure work (pre-app, same period)

### 1.1 Fleet consolidation (8 → 4 agents)
- Deleted agents: **vonlenska, photonics** (08-04), **phd, prof_outreach** (08-06) —
  units removed, homes purged (~250 MB freed), sibling masks regenerated,
  watchdog/backup scripts updated. Fleet now: default (admin) + whatsapp + studies + aigithub.
- **phd** was factory-reset (state wiped, scripts + SOUL kept).

### 1.2 OOM-proofing the 3 GB box (user mandate: "never again")
- All gateways run `gateway run --replace` + `MemoryHigh/Max 500M/700M` (default
  unit hardened via drop-in — hermes regenerates its unit on supervised start).
- **memguard.sh** in every home — heavy cron scripts refuse/defer when free RAM < 350 MB.
- **Cross-agent sentinel** (host timer, every 10 min) watches the admin gateway + RAM.
- 512 MB zram swap confirmed; swapfile blocked by LXC seccomp.
- Result: 4 agents ≈ 600 MB resident, ~2.3 GB free. The Aug-05 outage class
  (stale instance → 18 h crash-loop) is structurally impossible now (`--replace`).

### 1.3 aigithub sleep-mode
- Gateway asleep by default; 5 script jobs on host systemd timers (delivery via the
  admin bot); wakes 19:59–20:45 for the daily LLM report; sentinel moved to a host timer.

### 1.4 Cron failure remediation (Aug-04)
- 4 root causes fixed: YouTube RSS transient 404s (3-strike counter), a stale whatsapp
  watchdog cron (removed), arXiv 429s (backoff), LLM provider hangs
  (`HERMES_CRON_TIMEOUT=1200` on all gateways). Backup repo history purged of a
  committed model cache (689 MB → 297 MB).

---

## 2. The Hetja build

### 2.1 Specs consumed
- `StrayNet_Architecture_Blueprint_v1.1.pdf` (33 pp) + `Executive_Summary_v1.1.pdf`
  + the step-by-step BUILD_GUIDE + roadmap/diagrams images.

### 2.2 Stack (per blueprint, adapted to the VPS)
| Layer | Choice | Why |
|---|---|---|
| API | Node 22 + **Fastify 5** + TypeScript strict | p95 < 150 ms target, zero-framework hot path |
| DB | **PostgreSQL 16 + PostGIS + pgvector** | geo queries, embeddings later |
| Ledger | Custom hash-chain package (@straynet/ledger) | INVARIANT 9/10 tamper-evidence |
| Frontend | **Next.js 14 App Router** PWA (Hetja) | mobile-first feeder app |
| Scan hot path | Vanilla TS static landing, **7.3 KB gzipped** | < 40 KB budget (18 %) |
| Queue | Postgres `jobs` table, `SKIP LOCKED` | no Redis (blueprint rule) |
| AI | Python worker, pluggable detector (YOLO Phase 1) | flag, never auto-reject (INVARIANT 14) |

### 2.3 Database (migrations 0001–0005)
- 15 tables: dogs, collars, feeders, scans (client_uuid UNIQUE — idempotent offline
  replays), sos_cases/sos_notifications, medical_records (**append-only**, REVOKE
  UPDATE/DELETE — tests prove it), ledger_anchors, trust_events, geofences,
  feeder_territories (single-primary partial index), dog_stories, jobs (autovacuum
  tuned), vets (linked to feeders).
- Seed: Phase-0 dogs + collars + feeder with random non-sequential slugs (INVARIANT 1).
- **3 documented spec corrections** (in `docs/INVARIANTS.md`): scans partitioning
  (unique-on-partitioned impossible in PG — hash-partition strategy for Phase 2),
  ledger payload columns (store exactly what you hash), vets.feeder_id link.

### 2.4 API surface (all verified by route tests)
- **auth**: OTP (dev-mode code, hashed, 5-min TTL, 3 attempts), JWT access/refresh,
  phone_hmac (never bare phones), attested device tokens with PoW fallback.
- **dogs**: anon profile, HMAC-signed `?s=` slug, **ward-level geo only** (INVARIANT 2).
- **scans**: idempotent by client_uuid, captured_at LWW with received_at tie-break,
  photo → storage (async, never blocks on AI).
- **sos**: severity routing (minor/serious validate first; critical immediate),
  per-token caps 2/day 5/week, 2-km fan-out (partial GIST index, trust floors
  40/60), zero-eligible → tier 2, 8-min escalation job.
- **medical**: vet writes (Ed25519 clinic signature, is_verified=true) + feeder
  self-reports (false); chained writes under `pg_advisory_xact_lock`; corrections append.
- **ledger**: daily anchor + public `/ledger/verify` (tamper-evidence anyone can run).
- **trust**: event catalog, baseline-30 score, disputes reverse deltas, provisional
  feeders auto-pause after 3 serial rejects.
- **stories/moderation**: feeder-written, versioned, admin approve/reject (+trust coupling).
- **heatmap**: public hunger map, 200 m cells, **k-anonymity (≥ 3 dogs)**, centroids only.
- **territories**: geofences, ward claims with single-primary enforcement.
- **gamification**: deterministic streaks, 6-badge catalog, idempotent awards.
- Security: helmet, pino PII redaction, pinned trustProxy, tightened CORS.

### 2.5 Worker + AI
- Worker: SKIP-LOCKED queue with validate_scan / escalate_sos / retention /
  anchor_ledger handlers. AI worker: Python harness, verified end-to-end (claims →
  flags → writes validation).

### 2.6 The Hetja frontend (mobile-first, complete package)
- **Design system** (`docs/design/HETJA-DESIGN.md`): forest/amber/cream tokens,
  Fraunces + Nunito Sans, rounded cards/pills, paw illustration, motion rules,
  mobile-first (48 px targets, safe areas, bottom nav, install prompt).
- Pages: landing (hero "Every street has a hero.", stats, 3-step how-it-works),
  dog profile (photo card, status pills, sticky Feed/SOS bar, offline-aware queue),
  scan (camera hint + code entry, offline), login (OTP, split panel), me (streak,
  badges, trust ring), about, how-it-works, privacy (DPDP), faq, contact.
- PWA: manifest, icon, service worker (shell cache, network-first medical),
  offline.html fallback, Background Sync feed queue.
- **63 + web tests green** (landing, collar parsing, offline queue, api client, streak).

### 2.7 Research (2 deep dives, both actioned)
- **RESEARCH-1** (philosophy/ethics/retention): coordination-layer thesis, 6 missing
  loops (BMC ABC handshake, feeder mentorship, adoption, lost-dog alerts, org SOS
  routing, anon→care funnel), WhatsApp Business API substrate, iNaturalist-style
  geo-custody tiers, k-anonymity heatmap (implemented), retention science.
- **RESEARCH-2** (technical): CGNAT-safe rate limiting (device-token keys — implemented
  philosophy), hash-partition-by-client_uuid for Phase 2, HNSW > IVFFlat, CPU YOLO
  cost, WhatsApp read-receipt → ack mapping, push layering (implemented guidance:
  helmet, redaction, trustProxy pin).

### 2.8 CI + ops
- GitHub Actions (migrations → EXPLAIN gate → typecheck → tests → security gate 7/7).
- `ops/check-queries.sh` (INVARIANT 12), `ops/security-gate.sh`, `ops/RUNBOOK.md`
  (SLOs, PITR drill, DPDP erasure), systemd units (api :8080, worker, scan :8081),
  `ops/deploy.sh`, gitignored production secrets.

---

## 3. How the build ran (multi-agent orchestration)

- opencode CLI (1.18.16) as sub-agents, `cd <dir> && opencode run -m ...` (learned:
  `-c` is `--continue`, not a workdir).
- 6 build waves + 2 research agents, 2–3 concurrent (memory-capped), each agent's
  output **independently verified** (child self-reports are never trusted): every
  wave's tests re-run, bugs fixed by me (e.g. RealDictRow unpack, shared-Response
  mock bug, 8-char slug regex, stale dist builds, phone regex).
- Agent permission walls (no /tmp writes, no server starts, no psql-as-postgres)
  → agents write files + run in-repo tests; I do the privileged verification.

---

## 4. Test totals (final)

| Suite | Tests |
|---|---|
| @straynet/db (slugs, migration) | 8 |
| @straynet/contracts (schemas, geo) | 11 |
| @straynet/ledger (chain, anchor) | 5 |
| @straynet/api (auth/dogs/scans/sos/medical/ledger/trust/stories/heatmap/territories/gamification) | 69 |
| @straynet/web (Hetja frontend) | 63+ |
| **Total** | **~155** |

## 5. How to run it
```bash
cd /root/straynet
pnpm install
pnpm --filter @straynet/db migrate && pnpm --filter @straynet/db seed
pnpm --filter @straynet/api dev        # API on :8080
pnpm --filter @straynet/worker dev     # job queue
cd apps/web && pnpm dev --port 3100    # Hetja frontend
# Production: bash ops/deploy.sh (systemd: straynet-api/worker/scan)
```

## 6. Status of the outstanding items
- [x] **Deployed on the VPS (2026-08-12)**: `straynet-api` (:8080, healthz 200),
      `straynet-worker` (active), `straynet-scan` (:8081, 200) as systemd services;
      DB has 63 dogs (seed + test data). Production builds green for all apps
      (Next.js build: 10 pages, 87.4 kB shared JS; scan: 7.3 kB gzipped).
- [ ] **First push to GitHub** — waiting on the `hetja` repo (deploy key ready;
      add it to the repo's Deploy Keys with write access).
- [x] Frontend visual pass — tokens + SSR verified; headless-Chrome screenshots
      blocked in this container (design gate = 79 tests + token/SSR checks).

## 7. Final test totals (2026-08-12)
| Suite | Tests |
|---|---|
| @straynet/db | 8 |
| @straynet/contracts | 11 |
| @straynet/ledger | 5 |
| @straynet/api (13 route files) | 69 |
| @straynet/web (17 test files) | 79 |
| **Total** | **172** |

All suites green, 0 typecheck errors across api/worker/packages, security gate
7/7, EXPLAIN gate 3/3, production builds passing.

*— End of report. Full commit history in the local repo (24 commits) and the
private backup (Hermes_aic).*
