# Hetja — Research Note 2

**Scope:** operational hardening — Fastify production hardening, Postgres at 5M+ rows/yr,
push reliability in India, CPU-only photo validation, and Phase-2 re-identification.
**Method:** repo walk-through (`apps/api/src/server.ts`, `apps/api/src/routes/*.ts`,
`packages/db/migrations/*.sql`, `apps/worker/src/index.ts`, `apps/ai/worker.py`, `ops/RUNBOOK.md`)
+ web research (Fastify/pino/helmet docs, PostgreSQL 15 docs, pgvector README, Meta/Twilio WhatsApp
pricing, FCM docs, Ultralytics benchmarks, animal re-ID literature). Research only — **no code was
modified.** Invariant references are to the build guide / migration comments in the repo.
**Status:** v1, for review. Complements RESEARCH-1.md (philosophy, data ethics, retention).

---

## 0. Executive summary

- **Rate limiting under CGNAT is a key-choice problem, not a plugin problem.** `@fastify/rate-limit`
  defaults to an IP-based key with a `/64` IPv6 mask — exactly wrong for Jio/Airtel pools that share
  one public IP (INVARIANT 6 already forbids IP keys for writes). The plugin's `keyGenerator` must be
  set to the attested device token / feeder id, and the **in-memory store** is fine only while the
  API is a single process (the repo's "no Redis" rule rules out the default shared store). Other
  high-leverage, low-effort fixes: pin `trustProxy` to the real reverse proxy (today it is `true` =
  any client can forge `X-Forwarded-For`), add pino `redact` for `phone_hmac`/lat/lng/device tokens,
  add `@fastify/helmet`, and tighten CORS from reflect-any-origin to the scan origin.

- **Postgres partitioning that preserves `client_uuid` idempotency is a hash-partition-by-`client_uuid`
  job.** PG 15 requires every UNIQUE/PRIMARY KEY on a partitioned table to include all partition-key
  columns, so range-by-`received_at` breaks the global unique index. **Hash-by-`client_uuid`** makes
  the unique index structurally global (each UUID lands in exactly one partition), keeps
  `ON CONFLICT (client_uuid) DO NOTHING` working (the existing `scans.ts`/`sos.ts` code), and even
  makes the offline-replay lookup prune to one partition. Exclusion constraints are explicitly *not*
  allowed across a partitioned table in PG 15 — they are a dead end for the global guarantee. The
  `jobs` table already has `autovacuum_vacuum_scale_factor = 0.01`; it needs the insert/delete-churn
  companions, and `ai_validation` JSONB needs a size discipline. For pgvector at 100 K rows of
  768-dim, **HNSW over IVFFlat** (no retraining, incremental inserts, cosine/IP ops; halfvec to halve
  the working set).

- **Push on Jio/Airtel CGNAT is layered, and only SMS is a guarantee.** No inbound sockets means no
  server-pushed WebSockets; FCM/WebPush (outbound persistent connection), WhatsApp (stored-and-forward)
  and SMS (cellular control plane, works with data off) are the working channels. WhatsApp Business API
  is the best primary for feeders — 531 M Indian users, template "utility" messages, and **read
  receipts via webhook** that map exactly onto `sos_notifications.delivered_at/acked_at`. FCM/WebPush
  is a free parallel path but OEM battery savers (Xiaomi/Oppo/Vivo/Realme) kill it; SMS stays the
  escalation/guarantee path for vets (already `channel='sms'` in the worker). Cost at Phase 2 (10 K
  tags): WhatsApp utility is ₹0.0014·Meta + BSP ≈ ₹0.20–0.55/msg; realistic SOS fan-out volume lands
  ~₹35–60 K/yr (~$450–700) — affordable, and free-form/utility is untaxed inside the 24 h customer
  service window.

- **YOLOv8n is the right CPU default; `-s` buys little for dog/food presence.** Official Ultralytics
  CPU numbers (YOLO26 family, 640 px ONNX): nano ~39 ms vs small ~87 ms on their reference CPU; on a
  2-vCPU shared box plan 1.5–3× that (p50 ~100–250 ms nano, p95 ~400–700 ms). Batching (8–16) and
  ONNX Runtime INT8 quantization (~2–3×, ~1–2 pt mAP cost) cover throughput; even so, ~14 K scans/day
  at 5 M/yr is far under what 2 vCPU INT8 sustains (~260 K–700 K images/day) — CPU-only is fine for
  years; serverless GPU only matters for training, not inference.

- **Re-ID: raw CLIP cosine is a baseline, not the answer.** The wildlife Re-ID literature is
  unambiguous — a domain-specific descriptor (MegaDescriptor, arXiv 2311.09118) outperforms CLIP and
  DINOv2 "by a significant margin", and post-hoc metric heads barely move a general-purpose manifold
  (AnimalCLEF-2025, arXiv 2509.12353). With few labeled images per dog, the pragmatic MVP is
  **open-set retrieval**: a frozen descriptor, k-NN over `dogs.cv_embedding` via a pgvector HNSW index,
  ward/recency pre-filter, and a mandatory human-confirm step (the `identify` scan type already
  exists). Data-efficient fine-tuning at ~3 images/identity is demonstrated (arXiv 2512.08198), so a
  metric head can come later as galleries grow.

Ranked, actionable recommendations are in §6.

---

## 1. Fastify production hardening

Current state (`apps/api/src/server.ts`): Fastify 5, `logger: { level }` (no redaction),
`trustProxy: true`, `@fastify/cors` with `origin: true` (reflect any origin), graceful shutdown on
`SIGTERM`/`SIGINT` → `app.close()` + `process.exit(0)`, single process. No rate-limit plugin, no
helmet, no under-pressure, no `bodyLimit`/timeout overrides. Anonymous writes are already
device-token attested (`apps/api/src/lib/device.ts`; INVARIANT 6 subjects), SOS has per-token DB caps
(`apps/api/src/routes/sos.ts`, INVARIANT 7), OTP has an in-memory attempt cap. There is **no global
request rate limiter** and `POST /api/v1/auth/otp` is effectively unthrottled at the HTTP layer.

### 1.1 Rate limiting that survives CGNAT (INVARIANT 6)

The default `@fastify/rate-limit` key is `normalizeIP(request.ip, ipv6Subnet=64)` — a shared Jio/Airtel
pool of thousands of subscribers sits behind one public IP, so any IP-based key both (a) lets one bad
device exhaust a whole pool's budget and (b) is forgeable while `trustProxy: true`. The plugin is the
right tool, but only with a non-IP `keyGenerator`:

```js
await app.register(import("@fastify/rate-limit"), {
  global: false,
  max: 1000, timeWindow: "1 minute",
  keyGenerator: (request) =>
    request.headers["x-device-token"] ??       // anonymous writes (attested, INVARIANT 6)
    request.user?.feederId ??                   // authed feeders (JWT sub)
    (request.ip + "|anon"),                    // last-resort for reads only
});
```

- **Route-level config** (`config: { rateLimit: {...} }`) lets you keep reads loose and make writes
  strict: `/auth/otp` and `/auth/verify` get a low `max` + shared `groupId` (OTP brute-force/phone
  bombing), `/api/v1/scans` a moderate cap, `/healthz` exempted. `ban` + `onBanReach` can blacklist a
  token that keeps hammering after 429s. `enableDraftSpec: true` switches to the IETF rate-limit
  headers.
- **Store choice vs the repo's no-Redis rule:** the default store is an in-memory LRU — correct and
  free **only if the API stays a single process** (§1.5). Multi-worker clusters need `redis` (ioredis)
  *or* a custom store; the plugin ships an official **Sequelize-PostgreSQL** store example, so a PG
  store fits the stack if clustering happens. There is also `fastify.createRateLimit()` for manual
  checks (e.g. incrementing only on failed OTP attempts).
- CGNAT pitfall to log: if a whole carrier pool ever gets 429s, that is the signature of an IP-keyed
  limiter (RUNBOOK already flags this as a bug — now it is testable).
- Sources: [@fastify/rate-limit README](https://raw.githubusercontent.com/fastify/fastify-rate-limit/main/README.md),
  [Fastify `trustProxy` docs](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

### 1.2 Security headers and CORS

- Add `@fastify/helmet` (fastify 5-compatible `>=12.x`): HSTS, `X-Content-Type-Options: nosniff`,
  frame guard, `Referrer-Policy`, CSP. For a JSON API the big wins are `nosniff` + HSTS; if the PWA is
  ever served from the API origin, CSP needs `worker-src`/`script-src` handling (helmet's
  `enableCSPNonces` exists if you go there). Route-level `{ helmet: false }` escape hatch is supported.
- Tighten CORS. `origin: true` reflects whatever `Origin` the caller sends — standard practice is to
  allow only the known scan origin(s) (and dev origins in non-prod). Add `Vary: Origin` so caches keep
  origins straight.
- Sources: [@fastify/helmet README](https://raw.githubusercontent.com/fastify/fastify-helmet/master/README.md),
  [helmet](https://helmetjs.github.io/).

### 1.3 pino redaction for PII

The logger currently has no `redact`. PII/pseudonymous data that reaches logs includes `phone` (raw,
in OTP request bodies if ever logged), `phone_hmac` (feeders), `device_token`, `photoBase64`, `geo`
lat/lng, and JWT/`Authorization`. Wire redaction into the existing logger config:

```js
logger: {
  level: ...,
  redact: {
    paths: [
      "req.headers.authorization", "req.headers['x-device-token']",
      "phone", "phone_hmac", "device_token", "deviceToken",
      "lat", "lng", "geo", "photoBase64", "token", "secret",
    ],
    censor: "[redacted]",
  },
}
```

- Explicit paths (no wildcards) cost ~2% of `JSON.stringify`; wildcards cost ~50% — enumerate the
  fields. `redact.remove: true` drops `photoBase64` entirely (large base64 blobs shouldn't be in logs
  at all).
- Prefer request logging that only captures `reqId`, `method`, `url`, `statusCode` (default Fastify
  `req` serializer already omits headers — keep it that way; never log raw bodies).
- Sources: [pino redaction docs](https://github.com/pinojs/pino/blob/main/docs/redaction.md).

### 1.4 Graceful shutdown and timeouts

The existing `SIGTERM`/`SIGINT` → `app.close()` path is correct; harden it:

- Fastify defaults already set `return503OnClosing: true` (LB drains traffic) and `forceCloseConnections`
  `'idle'`. Add a **drain timeout** (if `app.close()` exceeds N s, `process.exit(1)` so the supervisor
  restarts), and `await app.ready()` before `listen` to remove the startup race.
- The **worker** (`apps/worker/src/index.ts`) has no signal handling — a `SIGTERM` mid-poll leaves
  `SELECT ... FOR UPDATE SKIP LOCKED` locks parked for `LOCK_SECONDS` and drops in-flight jobs. Add
  `SIGTERM` handling that stops the loop (jobs are safe — `locked_until` expires) and closes the pool.
- DoS posture: set `requestTimeout`, `connectionTimeout`, `maxRequestsPerSocket`, and `handlerTimeout`
  (Fastify 5's cooperative timeout with `request.signal`). `bodyLimit` stays 1 MiB by default — workable
  for the client's 1280 px/0.8 downscaled JPEGs, but see §1.6 for moving photos out of the JSON body.
- Sources: [Fastify Server reference](https://fastify.dev/docs/latest/Reference/Server/),
  [fastify-traps / graceful-shutdown plugins](https://github.com/dnlup/fastify-traps).

### 1.5 Cluster vs single process on 2 vCPU

- Fastify is I/O-bound and async; a single Node process will idle the second vCPU once CPU-bound work
  (JSON serialization, HMAC, PoW verify, cipher) is non-trivial. The SLO load here is small (5 M scans/
  yr ≈ 14 K/day ≈ <0.2 req/s average) — **single process is correct for the pilot**, with the AI worker
  as a separate Python process and Postgres on the same box. Do not cluster yet.
- When to cluster: sustained CPU > ~50% on the API, or when you add synchronous CPU work. Use PM2
  `cluster_mode` (or Node `cluster`) with **2 workers** (one per vCPU). Caveats: (1) each worker gets
  its own in-memory rate-limit store → clustering **breaks per-account limits unless the store moves to
  PG/Redis** (ties to §1.1); (2) keep-alive sockets need a reverse proxy / LB; (3) plan the box so the
  API (0.5–1 core), AI worker (1–2 cores) and Postgres (0.5 core) don't oversubscribe 2 vCPU — a 2
  worker cluster plus a busy AI worker will thrash.
- Sources: [Node.js cluster docs](https://nodejs.org/api/cluster.html),
  [Fastify benchmarks (single-threaded framing)](https://fastify.dev/benchmarks/).

### 1.6 Load protection and the photo path

- `@fastify/under-pressure` (core plugin): 503 when event-loop delay/heap/RSS exceed thresholds —
  complements `return503OnClosing` so a slow DB doesn't wedge the box.
- Photo uploads currently ride as base64 in the JSON body of `POST /api/v1/scans`
  (`photoBase64` in `apps/api/src/routes/scans.ts`). That costs ~33% bandwidth, caps file size at
  `bodyLimit`, and leaves large blobs in request buffers. Recommend: `@fastify/multipart` for
  `multipart/form-data`, or (better at Phase 2) client → S3/R2 presigned upload with the API only
  receiving the key — `photo_s3_key` already exists.
- Sources: [@fastify/under-pressure](https://github.com/fastify/under-pressure),
  [@fastify/multipart](https://github.com/fastify/fastify-multipart).

---

## 2. Postgres at 5M+ rows/yr

Relevant current schema: `scans` is a **plain** table with `client_uuid UUID NOT NULL` +
`CREATE UNIQUE INDEX scans_client_uuid_uix ON scans (client_uuid)` (INVARIANT 5 — offline-replay
idempotency), and the 0001 migration comment already flags the Phase-2 need. `dogs.cv_embedding
VECTOR(768)`. `jobs` already sets `autovacuum_vacuum_scale_factor = 0.01`. `ai_validation JSONB` grows
per scan.

### 2.1 Partitioning that keeps `client_uuid` globally unique

**PG 15 constraint (the core problem):** a unique/primary-key constraint on a declaratively partitioned
table *must include every partition-key column* — the per-partition indexes can only prove uniqueness
within a partition, so the partition structure itself must prevent cross-partition duplicates. Range
partitioning by `received_at` therefore forces `UNIQUE (client_uuid, received_at)`, which is useless
for replay idempotency (a retry with the same `client_uuid` but a different `received_at` would not
conflict). This is exactly the trap the 0001 comment calls out. (Also: `ON CONFLICT` on inheritance
partitioning is unreliable; declarative partitioning is required, and it works — including
`ON CONFLICT (client_uuid) DO NOTHING` — on PG 15.)

**Recommended: hash-partition `scans` by `client_uuid`.** The partition key is *in* the unique index,
so `UNIQUE (client_uuid)` is genuinely global across all partitions:

```sql
CREATE TABLE scans (
  ... -- existing columns
) PARTITION BY HASH (client_uuid);

CREATE TABLE scans_p00 PARTITION OF scans FOR VALUES WITH (MODULUS 16, REMAINDER 0);
-- ... p01..p15
CREATE UNIQUE INDEX scans_client_uuid_uix ON scans (client_uuid);
CREATE INDEX scans_received_ix   ON scans (received_at);
CREATE INDEX scans_dog_ix        ON scans (dog_id, received_at DESC);
```

- **Why 16 partitions:** PG's own guidance is to keep partition counts modest (a few hundred is fine;
  thousands hurt planning). ~5 M rows/yr over 16 partitions ≈ ~300 K rows/partition/yr — indexes stay
  hot and cache-resident; 16 leaves room for several years before re-partitioning becomes a question.
  Hash partitions are stable (no monthly DDL churn).
- **Idempotency is preserved and *sped up*:** the existing
  `INSERT ... ON CONFLICT (client_uuid) DO NOTHING` (scans.ts, sos.ts) still works; replay lookups
  (`SELECT ... WHERE client_uuid = $1` in sos.ts) now **prune to a single partition**. `received_at`-
  and `dog_id`-based queries (LWW in scans.ts, `scans_dog_ix`, heatmap) don't prune by hash key but are
  served by the per-partition `(dog_id, received_at)` index.
- **Migration cost — be honest about it:** you cannot convert a plain table into a partitioned one.
  Phase 2 needs: create the partitioned `scans_new`, backfill in batches (`INSERT INTO scans_new
  SELECT ... FROM scans ORDER BY received_at LIMIT 50000` loops), build `CONCURRENTLY` indexes per
  partition, rename, drop. Run it as a maintenance window; the current 0001 comment says "fine to ~5M
  rows/yr at Phase 0–1" — the trigger to execute is index size / bloat, not row count alone
  (rule of thumb: partition when the table grows past memory).
- **Why not exclusion constraints:** PG 15 forbids a whole-table exclusion constraint on a partitioned
  table — you can only put `EXCLUDE (client_uuid WITH =)` (btree_gist) on each leaf, which gives *no*
  cross-partition guarantee. Dead end for this requirement.
- Sources: [PostgreSQL 15 — declarative partitioning + limitations](https://www.postgresql.org/docs/15/ddl-partitioning.html).

### 2.2 Interim alternative: a `scan_dedup` guard table

If partitioning is deferred, a thin guard table preserves the guarantee cheaply:
`scan_dedup(client_uuid UUID PRIMARY KEY, scan_id UUID)` with `INSERT ... ON CONFLICT DO NOTHING`
inside the same transaction as the scan insert. Doubles a write and needs transactional care, but it
is a low-risk Phase 1/2 bridge and stops the `scans_client_uuid_uix` bloat while the plain table stays.
Recommend only as a stopgap — the hash partition is the durable answer.

### 2.3 JSONB payload growth (`ai_validation`, `jobs.payload`, `medical_records.payload`)

- `ai_validation` per scan accumulates detections. Discipline: store a **compact summary** in JSONB
  (`dog_present`, `food_present`, max conf, box count, model, version) and push full detection/heatmap
  artifacts to object storage; cap the array; strip NMS/crops from the DB payload. Wide TOASTed jsonb
  is fine for point lookups but penalises seq scans — keep heatmap/recent queries projecting only the
  columns they need.
- `jobs.payload` and `medical_records.payload` are small and write-once; leave as-is. Note
  `ai_validation` is updated once per scan (write-then-read), so its VACUUM pressure is low — the
  pressure is all in `jobs` (§2.4).
- Sources: [PostgreSQL TOAST / storage](https://www.postgresql.org/docs/15/storage-toast.html).

### 2.4 Autovacuum tuning for the `jobs` queue table

`jobs` is a high-churn queue: one INSERT per scan/SOS (`sos.ts` enqueues `escalate_sos`, etc.) and one
DELETE per completed job (`apps/worker/src/index.ts`). That is ~2× writes on a hot index
(`jobs_ready_ix (run_after) WHERE locked_until IS NULL`). The existing
`autovacuum_vacuum_scale_factor = 0.01` is the right base; complete it:

```sql
ALTER TABLE jobs SET (
  autovacuum_vacuum_scale_factor      = 0.01,
  autovacuum_vacuum_threshold         = 50,
  autovacuum_vacuum_insert_threshold  = 200,   -- PG 13+: catches INSERT-only churn
  autovacuum_analyze_scale_factor     = 0.01
);
```

- The 2 s poll + batch-10 worker deletes inside the processing transaction (good — the job and its
  DELETE commit together), but dead tuples still accumulate between autovacuum runs. Monitor
  `n_dead_tup` on `jobs`; if index bloat appears despite tuning, run a low-traffic-window `REINDEX
  TABLE CONCURRENTLY jobs` and consider bumping `maintenance_work_mem`.
- Longer-term option: skip a DB queue for the hot validation path if `jobs` ever dominates — but at
  this volume the tuned table is fine (and the queue-depth metric in RUNBOOK already gives you the
  alert).
- Sources: [PostgreSQL autovacuum parameters](https://www.postgresql.org/docs/15/runtime-config-autovacuum.html).

### 2.5 pgvector index: IVFFlat vs HNSW for 768-dim at 100K rows

- **HNSW is the default.** Better speed-recall trade-off, **no training step and no re-clustering** —
  crucial here because re-ID embeddings arrive incrementally (IVFFlat wants the index created on data
  and periodically rebuilt as the corpus grows; `lists`/`probes` need re-tuning). 100 K × 768-dim
  float32 ≈ 307 MB of vectors; an HNSW index roughly doubles that — fits in RAM on the 2-vCPU box,
  but see halfvec below.
- **Use cosine/IP semantics correctly:** if embeddings are L2-normalized (CLIP and most descriptors
  are), pgvector recommends **inner product** (`vector_ip_ops`) over cosine (`vector_cosine_ops`) for
  speed — for normalized vectors the ranking is identical (cosine = IP on unit vectors).
- Build with `CREATE INDEX CONCURRENTLY ... USING hnsw (cv_embedding vector_ip_ops) WITH (m=16,
  ef_construction=64)` (defaults), `maintenance_work_mem` sized, and tune per-query `hnsw.ef_search`
  (higher = recall, slower). At ≤~50 K rows an exact scan is already sub-100 ms warm — **start exact,
  add HNSW when it stops being instant**; check recall against exact search after adding the index.
- Storage: consider `halfvec` (half-precision) to halve the working set — pgvector supports
  half-precision columns and indexing; the recall cost is usually tiny at 768-dim. This keeps the whole
  index hot on a small box as Phase-2 galleries grow.
- Sources: [pgvector README — HNSW/IVFFlat, halfvec, ops](https://github.com/pgvector/pgvector).

---

## 3. Push reliability in India

Current state: PWA service worker + Background Sync (`apps/scan/src/service-worker.ts`), offline queue
+ `flushOnOpen` (RESEARCH-1 flagged both as non-negotiable), `sos_notifications` has
`channel/sent_at/delivered_at/acked_at/stood_down`, and the worker's `escalate_sos` already inserts
`channel='sms'` rows for vets/BMC. No push provider is wired yet.

### 3.1 Channel matrix (what actually works on Jio/Airtel CGNAT)

CGNAT means **no inbound socket**: server-pushed WebSockets and P2P are off the table. Every working
channel is outbound-connection-based or carrier-plane-based:

| Channel | Mechanism behind CGNAT | Delivery | Receipts | Cost (IN) |
|---|---|---|---|---|
| **FCM** (Android via Play services) | client keeps an outbound connection to Google | good, but OEM battery savers kill it | **aggregated** via Data API/BigQuery; no per-msg read | free |
| **WebPush** (Chrome/FF/Safari push service) | SW outbound connection to browser push service | fair on Chrome/Android; worse on OEM doze + iOS Safari minority | SW app-level ack only | free |
| **WhatsApp Business API** | stored-and-forward on WhatsApp infra | **best of the app channels** (delivers even if app briefly offline) | **read receipts via webhook** (`sent`/`delivered`/`read`) | Meta $0.0014 + BSP/msg (utility) |
| **SMS** | cellular control plane — works with data off | guaranteed arrival; text-only, 160/70 chars | DLR from BSP (aggregated, imperfect) | ~₹0.09–0.20 transactional + DLT |

Ordered by reliability-for-SOS on Indian Android: **SMS > WhatsApp ≥ FCM > WebPush**, but by
engagement and actionability (media, location, buttons, tap-through): **WhatsApp ≫ FCM > WebPush >
SMS**. So: *WhatsApp is the operational substrate; SMS is the guarantee; FCM/WebPush is the free
parallel* — this is exactly the RESEARCH-1 §2.2–2.3 recommendation operationalized.

- Jio 5G's IPv6-only transport (Anurag Bhatia) is *not* a problem for push (all of the above work over
  IPv6); the real killers are OEM battery optimizers (Xiaomi/Oppo/Vivo/Realme/OnePlus), Chrome's idle
  handling of Background Sync, and — the reason Background Sync can't be the only path — Android
  killing the process. `flushOnOpen` + offline queue remain the load-bearing fallback.
- Sources: [FCM — understand message delivery](https://firebase.google.com/docs/cloud-messaging/understand-delivery),
  [WebPush (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
  [PureVPN — ISPs using CGNAT](https://www.purevpn.com/blog/top-isps-using-cgnat/),
  [Anurag Bhatia — India internet / Jio 5G](https://anuragbhatia.com/post/2023/02/jio-5g-ipv6-only/).

### 3.2 WhatsApp Business API as the substrate

- **Onboarding reality:** the API is only reachable through a Business Solution Provider (BSP) — Meta
  Cloud API, Twilio, Gupshup, Interakt, MSG91, etc. Plan for: business verification + a dedicated
  phone number, **template approval** (an SOS template must be registered as **utility** so it can be
  sent business-initiated outside the 24 h customer-service window), and **opt-in** capture (Meta
  policy — a checkbox is not enough; use an opt-in message at feeder onboarding, and store it next to
  `consent_version`).
- **Receipts = the `sos_notifications` lifecycle, finally fillable.** WhatsApp status webhooks report
  `sent` → `delivered` → `read`. Map them: `sent_at` (API accepted), `delivered_at` (WhatsApp
  delivered), `acked_at` (read — or app-level "I'm on my way" button → true operational ack). The
  escalation job should be driven off *acked*, never off *sent*.
- **Free-form note:** inside a 24 h customer service window, free-form (non-template) messages are
  allowed and utility templates are **unbilled** — so a feeder who just messaged the system can be
  fanned out at ₹0 beyond the Meta fee. Optimize fan-out order to exploit this.
- Sources: [WhatsApp Business pricing (Meta rate cards)](https://developers.facebook.com/docs/whatsapp/pricing),
  [Twilio WhatsApp pricing (IN rates: utility $0.0014, marketing $0.0118, auth $0.0014; Twilio fee $0.005)](https://www.twilio.com/en-us/whatsapp/pricing),
  [ISB — WhatsApp by governments in India](https://blogs.isb.edu/bhartiinstitute/2025/03/11/whatsapp-use-by-governments-in-india-bridging-governance-and-citizens-through-govtech/).

### 3.3 Delivery receipts + ack tracking (schema-aware)

- Extend `sos_notifications` semantics (not necessarily schema): a per-channel message id column
  (`whatsapp_msg_id`, `fcm_msg_id`) for reconciliation; `status` enum
  `queued → sent → delivered → acked → failed/expired`. `stood_down` already exists for early
  cancellation.
- FCM gives **aggregated** delivery analytics only (Data API: `delivered`/`pending`/`dropped*`
  percentages, `deliveredNoDelay`, `delayedDeviceOffline`, `delayedMessageThrottled`, `priorityLowered`;
  BigQuery export for individual message logs). Per-message *device-arrived* truth must come from the
  app: the service worker acks on receipt (`POST /ack`). This is also the "SOS silenced by the OS"
  detector RESEARCH-1 asked for — an opened case with push-sent-but-no-ack is a canary.
- SMS DLRs exist per message but are best-effort; treat SMS as fire-and-forget with a soft DLR.
- Sources: [FCM Data API / BigQuery delivery](https://firebase.google.com/docs/cloud-messaging/understand-delivery),
  [FCM — manage registration tokens](https://firebase.google.com/docs/cloud-messaging/manage-tokens) (stale tokens → `droppedDeviceInactive`).

### 3.4 Costs at Phase 2 (10 K tags) — budget model

Numbers: Meta utility fee **$0.0014/msg** in India (marketing would be $0.0118 — never mis-categorize
SOS as marketing); BSP fee ₹0.10–0.30/msg via Indian BSPs (Twilio adds $0.005). Blended ≈ ₹0.20–0.55
per delivered utility message. SMS transactional ≈ ₹0.09–0.20 via DLT. FCM/WebPush: free.

| Scenario | Volume | WhatsApp (utility) | SMS (escalation only) | Total/yr |
|---|---|---|---|---|
| 5 SOS/day × 15 feeders + 3 vets | ~33 K utility + ~5.5 K SMS | ~₹9–18 K | ~₹0.5–1.1 K | **~₹10–20 K (~$120–240)** |
| 30 SOS/day × 15 feeders + 3 vets | ~198 K utility + ~33 K SMS | ~₹53–108 K | ~₹3–7 K | **~₹56–115 K (~$670–1.4 K)** |

Plus lost-avoided cost: the 24 h customer-service window makes post-interaction utility messages free,
and volume-tiered BSP contracts push toward the low end. Conclusion: WhatsApp-first SOS is a
**hundreds-of-dollars-per-year** line item, not a blocker — consistent with RESEARCH-1's "affordable
at Phase 2" claim.
- Sources: [Twilio IN rate card (CSV)](https://www.twilio.com/content/dam/twilio-com/pricing-data/en/WhatsAppPricing-pricing-details.csv),
  [MSG91 (Indian BSP) pricing](https://msg91.com/sms).

---

## 4. CPU-only photo validation

Current state: `apps/ai/worker.py` polls `validate_scan` jobs, `Detector.detect()` is a stub; the
fine-tuned YOLO (dog-presence + food-presence) is Phase 1. Client downscales to 1280 px/0.8 before
upload. The API never blocks on inference. Box: 2 vCPU shared, shared with API + Postgres.

### 4.1 YOLOv8n vs -s on 2 vCPU

Ultralytics' official CPU (ONNX, 640 px) figures — YOLO26 family on their reference machine:
**nano 38.9 ms vs small 87.2 ms** (params 2.4 M vs 9.5 M; FLOPs 5.4 B vs 20.7 B). The YOLOv8 line
(relevant to the existing `ultralytics` requirement) was ~80 ms / ~128 ms on the older Xeon benchmark.
A **2-vCPU shared cloud box** runs 1.5–3× slower than those reference machines (no boost headroom,
co-tenancy noise):

| | p50 (single image) | p95 (single image) | batched (16) per-image | mAP50-95 |
|---|---|---|---|---|
| **YOLOv8n / YOLO26n** | ~100–250 ms | ~400–700 ms | ~60–150 ms | 37.3 / 40.9 |
| **YOLOv8s / YOLO26s** | ~250–500 ms | ~800–1500 ms | ~150–350 ms | 44.9 / 48.6 |

- **Recommendation: nano by default.** The task is binary-ish (dog present? food present?) on
  downscaled, mostly-ideal photos — architecture size is not where accuracy lives; the **fine-tune
  dataset is**. Keep `-s` in the training harness and A/B both on a held-out set of flagged vs
  auto-passed photos; ship whichever meets the precision/recall bar on the fine-tuned task. Expected
  gains from nano→small on a 2-class presence task are well under the latency 2–3× you pay.
- Throughput sanity: 5 M scans/yr ≈ ~14 K photos/day ≈ ~0.16 images/s average. Even at p95 ~600 ms
  single-threaded, nano on one core sustains ~1.5–2 images/s — **two orders of magnitude of headroom**.
- Source: [Ultralytics — Detect models/speed table](https://docs.ultralytics.com/tasks/detect/).

### 4.2 Quantization, batching, threading

- **INT8 via ONNX Runtime** (export `format=onnx`, static-quantize, run with `ort`) gives ~2–3× CPU
  speedup for ~1–2 mAP points — for a presence gate that trade is a steal. OpenVINO is an alternative
  with similar gains. Keep the FP32 artifact for the A/B harness.
- **Batching helps throughput, not latency**: batch 8–16 in the worker (the poll loop already batches
  claims, BATCH=10) to amortize per-call overhead; do not run concurrent inferences beyond the 2 cores.
  Set `OMP_NUM_THREADS`/`ORT_NUM_THREADS = 2` and **pin** — the box also runs the API and Postgres
  (§1.5 budget: API 0.5–1 core, AI 1–2, DB 0.5).
- Keep `INVARIANT 14` semantics: low-confidence / "no dog" → `flagged`, never silently rejected.
- Sources: [Ultralytics — export to ONNX](https://docs.ultralytics.com/integrations/onnx/),
  [ONNX Runtime quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html).

### 4.3 When to move to serverless GPU

- **Inference: not for years.** INT8 nano on 2 vCPU sustains ~3–8 images/s batched ≈ 260 K–700 K
  images/day vs the ~14 K/day you'll actually see. The honest trigger is operational, not raw load:
  sustained `validate_scan` queue depth, or a moderation-latency SLO that CPU can't hit.
- **Training is the real GPU buyer.** Fine-tuning YOLO and (Phase 2) the re-ID head is where a GPU
  (or a hosted notebook, Colab/T4, or a one-off serverless GPU job) pays; keep inference on CPU.
- If you do go serverless-GPU for inference (T4 does nano in ~2–4 ms), keep the **same ONNX artifact**
  so the swap is config-only. Do not couple the API to inference.
- Source: [Ultralytics — performance](https://docs.ultralytics.com/guides/performance/).

---

## 5. Re-ID (Phase 2) — "sighting without collar" (M7 from RESEARCH-1)

Context: `dogs.cv_embedding VECTOR(768)` is nullable (Phase-2 column); `scan_type 'identify'` exists;
the monsoon makes collars consumables so a no-collar visual-ID path is a P0 product need
(RESEARCH-1 R7). Reality: 1–5 labeled photos per dog at best, coming from low-end Android cameras in
Mumbai weather.

### 5.1 Metric learning options: CLIP-cosine vs metric-specific models

- **Raw CLIP embeddings are a weak baseline for individual-ID.** CLIP is trained for image–text
  alignment; its cosine space separates categories, not individuals within a species. The animal Re-ID
  literature is decisive: **MegaDescriptor** — the first Re-ID foundation model (ViT backbone,
  trained on wildlife datasets) — "outperforms ... CLIP and DINOv2 by a significant margin" on animal
  Re-ID benchmarks; and AnimalCLEF-2025 shows a domain-specific backbone (MegaDescriptor) beating
  general-purpose DINOv2 even before metric learning, with triplet/proxy heads adding almost nothing on
  a general-purpose manifold (0.13 vs 0.03 gain).
- **Metric-specific training is the right long-term tool**: ArcFace / SphereFace2 + triplet / circle
  losses on a fine-tuned backbone. The CVPR-2022 Pet Biometric Challenge recipe (dog nose-print Re-ID,
  86.67% AUC) shows the few-shot essentials: heavy offline augmentation + joint
  cross-entropy + triplet + circle. Note dog **face/coat** Re-ID is harder than nose-print; plan for a
  human-confirm step in the product, always.
- Sources: [WildlifeDatasets / MegaDescriptor](https://arxiv.org/abs/2311.09118),
  [AnimalCLEF-2025: domain-specific backbones + metric heads](https://arxiv.org/abs/2509.12353),
  [Dog nose-print Re-ID (Pet Biometric Challenge)](https://arxiv.org/abs/2205.15934).

### 5.2 Dataset reality (few labeled images per dog) → open-set retrieval

- Treat it as **open-set**: "is this a known dog?" + "which dog, among known dogs?" — never closed-set
  classification over all dogs. At 1–5 images/identity, closed-set training is infeasible and
  overfits.
- Few-shot is workable: on-device animal Re-ID fine-tuned at **~3 images/identity** (MobileNetV2-based)
  achieves competitive retrieval (arXiv 2512.08198). So: bootstrap galleries at collar registration
  (require a **face + body photo pair** — capture protocol matters more than architecture), grow
  galleries from ack'd sightings, and re-tune the accept/reject similarity threshold on a small
  validation set.
- Sources: [Animal Re-ID on microcontrollers (3-shot fine-tuning)](https://arxiv.org/abs/2512.08198),
  [IndivAID — CLIP adaptation for animal Re-ID](https://arxiv.org/abs/2410.22927).

### 5.3 Pragmatic MVP: image-similarity index on pgvector

1. **Pick the frozen descriptor, then the column.** `cv_embedding` is `VECTOR(768)` — CLIP ViT-L/14
   or MegaDescriptor-Medium-class embeddings fit; CLIP ViT-B/32 (512-dim) needs an `ALTER COLUMN ... 
   TYPE vector(512)`. Decide the descriptor first (MegaDescriptor if available — it beats CLIP
   outright), normalize embeddings, and use `vector_ip_ops` (cosine-equivalent on unit vectors).
2. **Query:** k-NN over `dogs.cv_embedding` (exact while small; **HNSW** once >~50–100 K rows, §2.5),
   **pre-filter by `ward_id` + `last_seen_at` recency** to cut candidates and cost, return top-k with
   distances.
3. **Close the loop with a human.** Show the feeder/volunteer the top-k ("Is this Rosie?") — identity
   is confirmed by people, model rank is only a shortlist. On confirm, write a normal `identify` scan
   and update the gallery. **Never auto-assign** on borderline scores; flag for the moderation queue.
4. **Gallery, not a single vector.** One `cv_embedding` per dog can't represent pose/lighting spread.
   Add `dog_embeddings(dog_id, embedding, source_scan_id, captured_at)` (per-photo) and treat
   `dogs.cv_embedding` as the curated prototype; the worker gets a `reid_ingest` job kind to compute
   and upsert embeddings as photos are ack'd.
5. **Quality gating:** reject blur/motion shots before embedding (cheap heuristics or the YOLO conf),
   dedupe near-identical captures, and let a confirmed match add a positive training signal for the
   eventual metric head (§5.4).
6. **DPDP note (ties to RESEARCH-1 §3):** embeddings are reversible-ish fingerprints of a specific
   animal at a known spot — treat the embedding table as personal-adjacent data; it's in scope for E4's
   conservative treatment, not a public endpoint.

### 5.4 The metric-head path when data allows

Trigger: a few hundred dogs × 5+ gallery images. Then: fine-tune a metric head (ArcFace + triplet,
MegaDescriptor as init) using the WildlifeDatasets toolkit, validate with an AnimalCLEF-style
open-set protocol (attach-to-known + discover-new), and deploy as a new worker job — same pgvector
index, just a better embedding. This is a later-phase upgrade, not a prerequisite for the MVP.
Sources: [WildlifeDatasets](https://arxiv.org/abs/2311.09118), [open-set animal Re-ID (AnimalCLEF-26)](https://arxiv.org/abs/2608.02469).

---

## 6. Ranked recommendations

Scoring: **Impact** = effect on the mission (SOS reliability, data integrity, feed/validation
throughput, re-ID). **Effort** = implementation + operations cost. Tiers: **P0** do next
(high impact / low–med effort), **P1** plan for next cycle, **P2** later. Within tier, best first.
Each item: one-line rationale + primary source.

| # | Recommendation | Impact | Effort | Tier |
|---|---|---|---|---|
| 1 | F1 Rate-limit by device-token/account via `@fastify/rate-limit` `keyGenerator` (never IP) + route config for OTP/scan/write | High | Low | P0 |
| 2 | F5 pino `redact` for `phone_hmac`, lat/lng, `device_token`, `photoBase64`, auth headers | High | Low | P0 |
| 3 | F2 Pin `trustProxy` to the real proxy + tighten CORS to known origins | High | Low | P0 |
| 4 | D4 Complete `jobs` autovacuum tuning (insert threshold/analyze) | High | Low | P0 |
| 5 | M1 Layered SOS fan-out: WhatsApp utility (primary) + FCM/WebPush (parallel) + SMS (guarantee/escalation) | High | Med | P0 |
| 6 | M2 Delivery-receipt lifecycle on `sos_notifications` (sent→delivered→acked) + WhatsApp status webhook + app-level FCM ack | High | Med | P0 |
| 7 | M4 OEM battery-saver mitigation + keep `flushOnOpen`/offline queue as the load-bearing fallback | High | Med | P0 |
| 8 | I1 YOLOv8n default for CPU validation; A/B vs -s on the fine-tuned task, not raw mAP | High | Low | P0 |
| 9 | I2 ONNX INT8 + thread pinning + batch 8–16 in the AI worker | High | Low | P0 |
| 10 | D1 Hash-partition `scans` by `client_uuid` (16 partitions, `UNIQUE(client_uuid)`) at the Phase-2 maintenance window | High | Med | P1 |
| 11 | X3 Re-ID MVP: descriptor (MegaDescriptor-class) + pgvector HNSW k-NN + ward/recency filter + human-confirm `identify` flow | High | Med | P1 |
| 12 | X2 Capture protocol + `dog_embeddings` gallery table (face+body at registration, grow from ack'd sightings) | High | Med | P1 |
| 13 | X1 Adopt MegaDescriptor-class descriptor over raw CLIP; treat CLIP cosine as baseline only | High | Med | P1 |
| 14 | F3 `@fastify/helmet` security headers (HSTS, nosniff, CSP for PWA if served) | Med | Low | P1 |
| 15 | F6 Graceful-shutdown hardening: drain timeout, `await app.ready()`, worker SIGTERM handling | Med | Low | P1 |
| 16 | D3 JSONB payload discipline on `ai_validation` (compact summary in DB, full artifacts to object storage) | Med | Low | P1 |
| 17 | D5 HNSW `vector_ip_ops` index on `cv_embedding` (start exact, HNSW >50–100 K; halfvec to halve working set) | Med | Low | P1 |
| 18 | F8 `@fastify/under-pressure` + request/handler timeouts; move photo upload to binary/presigned in Phase 2 | Med | Med | P1 |
| 19 | M3 Publish the push cost model (§3.4) as a Phase-2 budget guardrail | Low | Low | P1 |
| 20 | D2 `scan_dedup` guard table as a stopgap only if D1 is deferred | Med | Med | P2 |
| 21 | F7 Cluster/PM2 ×2 workers only when API CPU >50% — with the rate-limit store moved to PG | Med | Med | P2 |
| 22 | I3 Serverless-GPU only when `validate_scan` queue depth demands it; keep one ONNX artifact | Low | Low | P2 |
| 23 | X4 Metric-head fine-tune (ArcFace+triplet on MegaDescriptor) at a few hundred dogs × 5+ photos | Med | High | P2 |

### P0 — do next

1. **F1 — Rate-limit by subject, not IP.** The single most CGNAT-correct hardening step: override
   `@fastify/rate-limit`'s default IP key with the attested device token / feeder id (INVARIANT 6),
   set strict caps on `/auth/otp`/`/auth/verify` (currently unthrottled), moderate caps on scan writes,
   `enableDraftSpec` headers, `ban` for repeat 429s. In-memory store while single-process; PG store if
   clustering. Rationale: prevents OTP abuse and write-path floods without ever locking a Jio/Airtel
   pool. Source: [@fastify/rate-limit](https://raw.githubusercontent.com/fastify/fastify-rate-limit/main/README.md).

2. **F5 — pino redaction.** Wire `redact` (explicit paths) for `phone`, `phone_hmac`, `device_token`,
   `lat`/`lng`, `photoBase64`, auth headers; consider `redact.remove: true` for base64. Rationale: the
   register's pseudonymous PII (RESEARCH-1 E4) must not land in logs; ~2% cost with explicit paths.
   Source: [pino redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md).

3. **F2 — Pin trust and origins.** Replace `trustProxy: true` with the actual reverse-proxy CIDR /
   hop count, and CORS `origin: true` with the scan origins. Rationale: forgeable `X-Forwarded-For`
   makes any IP-derived value (and future IP logic) spoofable; reflect-any-origin CORS is a footgun.
   Source: [Fastify `trustProxy`](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

4. **D4 — Complete `jobs` autovacuum tuning.** Add `autovacuum_vacuum_threshold=50`,
   `autovacuum_vacuum_insert_threshold=200`, `autovacuum_analyze_scale_factor=0.01` next to the existing
   `scale_factor=0.01`. Rationale: the queue's INSERT+DELETE churn is the schema's hottest write path;
   this is a two-line change that prevents the RUNBOOK's queue-bloat failure mode. Source:
   [PG autovacuum](https://www.postgresql.org/docs/15/runtime-config-autovacuum.html).

5. **M1 — Layered SOS fan-out.** WhatsApp utility template as the operational primary (feeders), FCM/
   WebPush as the free parallel (PWA), SMS as the escalation/guarantee path (vets/BMC — already
   `channel='sms'`). Rationale: RESEARCH-1 R2/R10 — 531 M users, read receipts, works behind CGNAT;
   only SMS guarantees arrival. Source: [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing),
   [FCM delivery](https://firebase.google.com/docs/cloud-messaging/understand-delivery).

6. **M2 — Receipt lifecycle + ack tracking.** Map WhatsApp `sent/delivered/read` webhooks and an
   app-level FCM ack onto `sos_notifications` (`sent_at/delivered_at/acked_at` + status); drive the
   8-min escalation off *acked*, never *sent*. Rationale: without this, "SOS silenced by the OS" is
   invisible and the escalation job runs blind. Source: [FCM — understand delivery](https://firebase.google.com/docs/cloud-messaging/understand-delivery).

7. **M4 — Treat push as best-effort; harden the fallback.** Document battery-saver whitelisting for
   the PWA, keep `flushOnOpen` + offline queue, and make the no-ack canary a real alert. Rationale:
   OEM doze on Indian Android is the #1 delivery killer; the 8-min escalation must not depend on push.
   Source: [WebSocket vs push (CGNAT)](https://websocket.org/guides/use-cases/notifications/).

8. **I1 — YOLOv8n by default.** Ship nano for the presence gate; A/B vs `-s` on the fine-tuned
   validation set. Rationale: 2–3× cheaper than small for a 2-class presence task where fine-tune data,
   not architecture, drives accuracy; CPU headroom is ~100× at Phase-2 volume. Source:
   [Ultralytics detect speed table](https://docs.ultralytics.com/tasks/detect/).

9. **I2 — INT8 + batching + thread pinning.** ONNX Runtime INT8 (~2–3×), batch 8–16 in the worker,
   `OMP_NUM_THREADS=2`, pin cores against API/DB. Rationale: converts the already-cheap nano into a
   trivial load while keeping p95 bounded. Source: [ONNX quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html).

### P1 — next cycle

10. **D1 — Hash-partition `scans` by `client_uuid`.** The only partitioning scheme that preserves the
    global `UNIQUE(client_uuid)` idempotency guarantee (partition key is in the unique index). Plan the
    backfill maintenance window at Phase 2. Rationale: keeps INVARIANT 5 at 5M+ rows/yr without
    exclusion-constraint dead ends. Source: [PG 15 partitioning limitations](https://www.postgresql.org/docs/15/ddl-partitioning.html).
11. **X3 — Re-ID MVP on pgvector.** Frozen descriptor + HNSW k-NN + ward/recency filter + human-confirm
    `identify` flow; exact search while small. Rationale: delivers M7 ("sighting without collar") with
    today's data; no model training required. Source: [pgvector](https://github.com/pgvector/pgvector).
12. **X2 — Gallery + capture protocol.** Face+body photo pair at registration, `dog_embeddings`
    per-photo table, `reid_ingest` worker job. Rationale: few-shot Re-ID needs gallery depth more than
    architecture; 3-shot fine-tuning is proven. Source: [MCU animal Re-ID (3-shot)](https://arxiv.org/abs/2512.08198).
13. **X1 — Descriptor choice.** Adopt a MegaDescriptor-class model over raw CLIP. Rationale: the
    literature shows domain-specific descriptors dominate general-purpose manifolds for individual-ID.
    Source: [MegaDescriptor](https://arxiv.org/abs/2311.09118).
14. **F3 — Helmet.** HSTS + nosniff + frame/referrer policy (+CSP if API serves the PWA). Rationale:
    standard, cheap baseline headers. Source: [@fastify/helmet](https://raw.githubusercontent.com/fastify/fastify-helmet/master/README.md).
15. **F6 — Shutdown hardening.** Drain timeout, `await app.ready()`, worker SIGTERM. Rationale:
    "graceful" today is half-graceful (worker ignores signals). Source: [Fastify Server reference](https://fastify.dev/docs/latest/Reference/Server/).
16. **D3 — JSONB discipline on `ai_validation`.** Compact summary in DB, full detections to object
    storage, caps on array size. Rationale: keeps 5M rows/yr scans lean and seq scans fast.
    Source: [PG TOAST](https://www.postgresql.org/docs/15/storage-toast.html).
17. **D5 — HNSW index + halfvec option.** `vector_ip_ops` on normalized embeddings; add when the exact
    scan stops being instant; halfvec halves the working set. Rationale: 768-dim at 100 K rows stays
    RAM-resident. Source: [pgvector indexing](https://github.com/pgvector/pgvector).
18. **F8 — Load protection + binary uploads.** `@fastify/under-pressure`, request/handler timeouts, and
    move photos to multipart/presigned S3 in Phase 2. Rationale: base64-in-JSON caps at `bodyLimit` and
    wastes ~33% bandwidth. Source: [@fastify/under-pressure](https://github.com/fastify/under-pressure).
19. **M3 — Cost guardrail.** Bake §3.4's model into the Phase-2 budget (WhatsApp utility
    ₹0.20–0.55/msg → ~₹10–115 K/yr by SOS volume). Rationale: keeps the WhatsApp decision honest and
    observable. Source: [Twilio IN rates](https://www.twilio.com/content/dam/twilio-com/pricing-data/en/WhatsAppPricing-pricing-details.csv).

### P2 — later

20. **D2 — `scan_dedup` guard** only if D1 slips. 21. **F7 — Cluster ×2 when CPU-bound**, with a PG
    rate-limit store. 22. **I3 — Serverless GPU** when queue depth demands it; one ONNX artifact.
    23. **X4 — Metric-head fine-tune** when galleries reach a few hundred dogs × 5+ photos.

---

## 7. Primary source list

**Fastify / Node hardening.** [@fastify/rate-limit README](https://raw.githubusercontent.com/fastify/fastify-rate-limit/main/README.md),
[Fastify Server reference (trustProxy, timeouts, closing)](https://fastify.dev/docs/latest/Reference/Server/),
[@fastify/helmet](https://raw.githubusercontent.com/fastify/fastify-helmet/master/README.md),
[@fastify/under-pressure](https://github.com/fastify/under-pressure),
[@fastify/multipart](https://github.com/fastify/fastify-multipart),
[pino redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md),
[fastify-traps](https://github.com/dnlup/fastify-traps),
[Node.js cluster](https://nodejs.org/api/cluster.html),
[Fastify benchmarks](https://fastify.dev/benchmarks/).

**Postgres / pgvector.** [PG 15 — declarative partitioning & limitations](https://www.postgresql.org/docs/15/ddl-partitioning.html),
[PG 15 — autovacuum parameters](https://www.postgresql.org/docs/15/runtime-config-autovacuum.html),
[PG 15 — TOAST](https://www.postgresql.org/docs/15/storage-toast.html),
[pgvector README (HNSW, IVFFlat, halfvec, ops, exact search)](https://github.com/pgvector/pgvector).

**Push / WhatsApp / SMS / India network.** [Meta — WhatsApp pricing / rate cards](https://developers.facebook.com/docs/whatsapp/pricing),
[Twilio — WhatsApp pricing (India utility $0.0014, marketing $0.0118, auth $0.0014; $0.005 fee)](https://www.twilio.com/en-us/whatsapp/pricing),
[Twilio — WhatsApp IN rate card CSV](https://www.twilio.com/content/dam/twilio-com/pricing-data/en/WhatsAppPricing-pricing-details.csv),
[MSG91 — Indian SMS/WhatsApp BSP](https://msg91.com/sms),
[FCM — understand message delivery / Data API / BigQuery](https://firebase.google.com/docs/cloud-messaging/understand-delivery),
[FCM — manage registration tokens](https://firebase.google.com/docs/cloud-messaging/manage-tokens),
[Web Push API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
[PureVPN — ISPs using CGNAT](https://www.purevpn.com/blog/top-isps-using-cgnat/),
[Anurag Bhatia — Jio 5G IPv6-only](https://anuragbhatia.com/post/2023/02/jio-5g-ipv6-only/),
[WebSocket vs push](https://websocket.org/guides/use-cases/notifications/).

**CPU inference / YOLO.** [Ultralytics — Detect (speed/params/FLOPs)](https://docs.ultralytics.com/tasks/detect/),
[Ultralytics — ONNX export](https://docs.ultralytics.com/integrations/onnx/),
[Ultralytics — performance](https://docs.ultralytics.com/guides/performance/),
[ONNX Runtime — quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html).

**Re-ID.** [WildlifeDatasets / MegaDescriptor](https://arxiv.org/abs/2311.09118),
[AnimalCLEF-2025 — domain-specific backbones vs general-purpose + metric heads](https://arxiv.org/abs/2509.12353),
[Dog nose-print Re-ID — Pet Biometric Challenge recipe](https://arxiv.org/abs/2205.15934),
[Animal Re-ID on microcontrollers (3-shot fine-tuning)](https://arxiv.org/abs/2512.08198),
[IndivAID — CLIP adaptation for animal Re-ID](https://arxiv.org/abs/2410.22927),
[Open-set animal Re-ID (AnimalCLEF-26)](https://arxiv.org/abs/2608.02469).

---

*Next steps suggested: treat §6 P0 items 1–4 (Fastify: rate-limit, redaction, trust/CORS, jobs vacuum)
as a single "hardening sprint"; P0 items 5–7 (WhatsApp fan-out + receipts + battery-saver mitigations)
as the SOS workstream with RESEARCH-1's R2/R10; validate I1/I2 in the `apps/ai` harness before Phase 1;
spin up the X3 Re-ID spike (descriptor → pgvector k-NN → confirm flow) against the existing `identify`
scan type.*
