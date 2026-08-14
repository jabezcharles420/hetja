# Credits

Hetja is built from the [enhancement-stack research document](hetja-enhancement-stack.md)
(prepared by an 11-agent research swarm, 2026-08-13), which web-verified every
entry against its canonical GitHub repository. Everything adopted from it is
credited here, with the canonical source and license. When a tool's code or
algorithm is adapted rather than installed, this file says so.

## Wave 1 — Phase 0 (life-safety, zero/small deps)

| Adoption | Source (canonical) | License | Where used | Notes |
|---|---|---|---|---|
| Cloudflare Cache Rules + Caddy Cache-Control policy | Cloudflare docs / Caddy docs (no repo) | n/a | `ops/caddy/Caddyfile` | `/api/v1/care*` 60s; `/d/*` + API catch-all `no-store`; `/_next/static/*` immutable. Guarded by `ops/check-caddy-cache.sh` in CI. Cloudflare dashboard rules are the edge half (documented in `docs/ops/CACHING.md`). |
| Native Web Speech API (illiterate-user gap) | W3C spec (no repo) | W3C | `apps/scan/src/ui.ts` | Zero-KB; button only rendered when `speechSynthesis` exists (honesty rule). |
| `Sec-ant/barcode-detector` (QR polyfill) | github.com/Sec-ant/barcode-detector | MIT | `apps/web/components/QrScanner.tsx` | Lazy dynamic import; ~3 KB JS + ~13 KB WASM, never in the initial bundle. |
| `@fastify/compress` + `@fastify/etag` | github.com/fastify/fastify-compress · github.com/fastify/fastify-etag | MIT | `apps/api/src/server.ts` | Brotli/gzip + conditional GET; SOS and dog paths explicitly excluded (never ETag life-safety state). Tested in `apps/api/src/server.test.ts`. |
| WCAG-AA contrast gate | WCAG 2.2 (no repo); formula per W3C relative luminance | n/a | `ops/contrast-gate.sh` | Parses `packages/design/tokens.css`; zero-dep implementation (no chroma.js needed for 6 tokens). |
| `DEVICE_POW_DIFFICULTY` 14 → 18, then → **16** | existing codebase; recommendation from enhancement-stack §B / HOW-IT-WORKS §9 | n/a | `apps/api/src/config.ts`, `apps/api/src/routes/devices.ts` | The 18 was measured wrong: ALTCHA encodes difficulty as a hex prefix, so it rounded up to **20** effective bits (~2^20, not the ~2^17 recorded here), which the scan solver finished only 4 times in 10 inside its 20 s budget. 16 lands on 16 exactly (25/25, ~1 s). Reverted to 16 and capped at 20 on 2026-08-14; see `docs/HOW-IT-WORKS.md` §9 for the measurements and why the PoW is a throttle rather than the gate. |

## Wave 2 — Phase 1 (small deps, life-safety + ops)

| Adoption | Source (canonical) | License | Where used | Notes |
|---|---|---|---|---|
| `isaacs/node-lru-cache` | github.com/isaacs/node-lru-cache | BlueOak-1.0.0 | `apps/api/src/routes/care.ts`, `apps/api/src/routes/dogs.ts` | 60s TTL care-provider directory, 5s TTL dog pages. Deliberately NOT applied to the shared `getNearbyCare()` (SOS path always reads fresh). Errors and 404s never cached. |
| `GoogleChrome/web-vitals` pattern | github.com/GoogleChrome/web-vitals | Apache-2.0 | `apps/api/src/routes/metrics.ts`, `packages/db/migrations/0013_web_vitals.sql` | Anonymous `POST /api/v1/metrics/web-vitals` (slug-stripped paths only — server rejects anything carrying a real collar slug or `?s=` signature); feeder-authed aggregate GET. |
| RFC 6962 (Certificate Transparency) Merkle tree — **not** a library | IETF RFC 6962 §2.1 (no repo) | n/a (spec) | `packages/ledger/src/merkle.ts` | Per-append Merkle root over the chain's canonical record hashes; O(log n) `verifyInclusion` for external auditors. Leaves are `SHA256(0x00‖hash)`, nodes `SHA256(0x01‖L‖R)`, split at the largest power of two below `n`. **`merkletreejs` was adopted here in wave 2 and has since been removed** — its `duplicateOdd` option made an `n`-record and an `(n+1)`-record ledger produce the same root (CVE-2012-2459 shape), and the missing leaf/node domain separation let an internal node be passed off as a leaf, forging a proof for a record that does not exist. A published spec an auditor can check us against independently was the better dependency. |
| `panva/jose` — signed chain head (Ed25519/EdDSA) | github.com/panva/jose | MIT | `packages/ledger/src/signing.ts` | Compact JWS over `{head, merkleRoot, recordCount, ledger}` with `sub: did:web:hetja.in:vets/<vetId>`, `iat` and a mandatory `exp` (48 h = two INVARIANT 10 publish cycles); verification requires the expected `ledgerId` and rejects a token with no `exp`. Keygen + JWK export so the public half can later be served at a `did:web` JWKS endpoint (`jwks()` helper). |
| `altcha-org/altcha` (via `altcha-lib`) — device proof-of-work | github.com/altcha-org/altcha | MIT | `apps/api/src/lib/device.ts`, `apps/api/src/routes/devices.ts` | ALTCHA v2 SHA-256 challenges: HMAC-signed parameters (self-authenticating, no server-side challenge store), server-side single-use registry, `expiresAt` enforced by the library. Replaces the hand-rolled PoW whose challenge token was replayable. The `apps/scan` client solves with a hand-written Web Crypto loop rather than the ALTCHA widget, to stay inside INVARIANT 13's 40 KB budget. |
| `catamphetamine/libphonenumber-js` — E.164 normalization | github.com/catamphetamine/libphonenumber-js | MIT | `apps/api/src/lib/phone.ts`, `packages/db/migrations/0013_phone_e164.sql` | `/min` metadata variant, India default region, landlines deliberately accepted (`/mobile` would reject real directory numbers such as SPCA Parel's landline — the number a stranger actually calls). |

## Wave 3 — Phase 1 ops (backups, real-IP, DR)

| Adoption | Source (canonical) | License | Where used | Notes |
|---|---|---|---|---|
| `wal-g/wal-g` — PG WAL archiving | github.com/wal-g/wal-g | Apache-2.0 | `/usr/local/bin/wal-g`, `ops/backup/wal-g.md` | v3.0.8 installed; dormant until R2 creds land in `/root/.backup-env` (activation steps + restore drill documented). Interim protection: restic daily `pg_dump`. |
| `restic/restic` — encrypted file backups | github.com/restic/restic | BSD-2-Clause | `ops/backup/restic-backup.sh`, `ops/systemd/hetja-restic.{service,timer}` (daily 02:15 IST) | Encrypted snapshots of the daily PG dump, `.env.production` secrets, Caddy/PG configs, systemd units. R2-ready via `/root/.backup-env`. **Still writing to a local interim repo (`/srv/hetja-backups/restic`) — i.e. on the same disk it is backing up — until R2 credentials exist. That is not yet an off-box backup.** |
| `pgaudit/pgaudit` — DB-level audit floor | github.com/pgaudit/pgaudit | PostgreSQL License | `docs/ops/AUDIT-LOGGING.md` | **Documented, not yet applied to the box.** Deliberately not a migration: CI's `postgis/postgis:16-3.4` container has no `pgaudit.so`, so a `CREATE EXTENSION` migration would either fail every run or be silently skipped — the same failure mode as 0013's conditional CHECK. Needs `shared_preload_libraries` + a full restart, i.e. a human in a maintenance window. The doc settles two non-obvious calls: `pgaudit.log_parameter = off` (bind parameters would copy plaintext phone numbers, free-text SOS notes and exact coordinates into an unrotated log — email is safe, it is HMAC'd before it reaches SQL), and bounded log rotation (audit logs filling the disk stops PostgreSQL accepting writes, which stops the SOS path). |
| `WeidiDeng/caddy-cloudflare-ip` | github.com/WeidiDeng/caddy-cloudflare-ip | Apache-2.0 | `ops/caddy/Caddyfile` | Caddy rebuilt (v2.11.4 + module); `trusted_proxies cloudflare` + `header_up X-Forwarded-For {CF-Connecting-IP}`. Fixes request logging — without it every stranger arrives as the loopback tunnel connector (verified live: API logs the real client IP). Guarded by `ops/check-caddy-cache.sh`. **Requires `TRUST_PROXY` to be set in `apps/api/.env.production`**; it defaults to `0`, and at `0` Fastify ignores `X-Forwarded-For` entirely, so the Caddy half is inert alone. |

## Wave 3b — photo pipeline (feeder photo pipeline + web-vitals clients)

| Adoption | Source (canonical) | License | Where used | Notes |
|---|---|---|---|---|
| `fengyuanchen/compressorjs` — browser-side photo compress + EXIF strip | github.com/fengyuanchen/compressorjs | MIT | `apps/web/lib/photo.ts`, `apps/web/components/FeedButton.tsx` | Re-encodes through a fresh `<canvas>`: auto-orient (`checkOrientation`), WebP where supported else JPEG, quality 0.8, capped 1600px. `retainExif: false` + `strict: false` mean the output carries no EXIF/GPS (the lib's only EXIF re-insertion path is guarded by `retainExif`); verified again with exifr on the output before upload. Dynamic-imported so the initial dog page pays nothing. |
| `MikeKovarik/exifr` — EXIF/GPS/orientation reader | github.com/MikeKovarik/exifr | MIT | `apps/web/lib/photo.ts` | Extracts orientation + GPS from the picked photo. GPS is coarsened to ward via `@hetja/contracts` `coarsenToWard` (INVARIANT 2) and feeds ward-level sighting data; the feeder's own device location stays the separate, consented `captureGeo` channel. Also used as the post-compression assertion that no GPS/orientation survived. |
| `GoogleChrome/web-vitals` — client Core Web Vitals reporting | github.com/GoogleChrome/web-vitals | Apache-2.0 | `apps/web/lib/web-vitals.ts` + `components/WebVitalsReporter.tsx`, `apps/scan/src/web-vitals.ts` | LCP/CLS/INP/TTFB beamed to `POST /api/v1/metrics/web-vitals` (§M.16) with slug-stripped paths (`/d/:slug`, `/dog/:slug` — never the real collar code). In `apps/scan` it is the one permitted dependency (~1.5 KB gz after tree-shaking; scan bundle stays far under the 40 KB budget). |
## Wave 4 — a11y + regression gates

| Adoption | Source (canonical) | License | Where used | Notes |
|---|---|---|---|---|
| `@axe-core/playwright` (of `dequelabs/axe-core-npm`) | github.com/dequelabs/axe-core-npm | MPL-2.0 | `apps/web/e2e/a11y.spec.ts`, `.github/workflows/a11y.yml` | Top-25 #23. No `serious`/`critical` WCAG 2 A/AA violations on the six static routes at 390×844. Zero found on adoption, nothing disabled. `incomplete` findings are reported but not blocking — the only current ones are `color-contrast` on two decorative glyphs, which SC 1.4.3 does not govern. |
| `@playwright/test` | github.com/microsoft/playwright | Apache-2.0 | `apps/web/playwright.config.ts`, `apps/web/e2e/` | The first real browser in this repo's CI. jsdom does no cascade and no computed layout, which is why a bug that zeroed the horizontal gutter on every text block below the hero survived 21 test files. `mobile-layout.spec.ts` now asserts gutter, no-flush-text, no-horizontal-overflow and heading spacing per route, and was verified to fail when the bug is re-injected. |
| RFC 6962 Merkle tree (replacing `merkletreejs`) | IETF RFC 6962 §2.1 | n/a (spec) | `packages/ledger/src/merkle.ts` | See the Wave 2 row above for why the library was removed. |

## Evaluated and deliberately NOT adopted

Recording these so nobody re-does the analysis, and so "not done" is
distinguishable from "not noticed".

| Item | Source | Why not |
|---|---|---|
| `dchest/tweetnacl-js` field encryption (Top-25 #14) | §G.5 | The columns it names (`dogs.exact_lat/lng`) do not exist, and the ones that do are GIST-indexed `GEOGRAPHY` columns that `ST_DWithin` scans to find responders — you cannot run a spatial predicate on ciphertext. The backup threat it targets is already covered by restic's client-side encryption. Full reasoning in `docs/INVARIANTS.md` → "Spec corrections" #4. |
| `upptime/upptime` (Top-25 #25) | §L.11 | Commits response-time data to its own repository on every check. Against `deploy.yml`'s push-to-main trigger that would have redeployed production every few minutes on a 2 GB box. Upptime ships as a standalone repo upstream and that is where it belongs; `deploy.yml` also gained a `paths-ignore` filter so documentation commits stop triggering deploys. |
| `telegraf/telegraf` responder bot (Top-25 #13) | §E.2 | Free, and genuinely closes the iOS-push gap for Telegram-using responders. Deferred because it needs a bot token and a decision about which channel responders actually watch — operational choices, not engineering ones. Nothing blocks it technically. |
| `plausible/analytics` / `umami-software/umami` (Top-25 #22) | §I.3 | Plausible's cloud tier is a recurring cost, which is ruled out. Umami self-hosted is free and MIT and fits the Node+Postgres stack, but adds a service to a box that `AGENTS.md §g` records has OOM-killed its own live services. Deferred as an operational trade, not a licensing one. Note the existing `web_vitals` table already answers the performance questions analytics would; what it does not answer is traffic. |
| `imgproxy` (#19), `sharp-phash` (#20), `size-limit` (#21), `lighthouse-ci` (#22) | §J, §H | Phase 2 in the enhancement stack's own roadmap (§U), not Phase 1. Not started. |
| `pgaudit` | §G.9 | Documented and ready but **not applied to the box** — needs `shared_preload_libraries` and a full PostgreSQL restart. See `docs/ops/AUDIT-LOGGING.md`. |

## Sources researched and evaluated (2026-08-13)

Full evaluation of all researched projects — adopted, deferred, and rejected —
is in the [enhancement-stack document](hetja-enhancement-stack.md). This file
credits what is *used*.
