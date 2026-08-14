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
| `DEVICE_POW_DIFFICULTY` 14 → 18 | existing codebase; recommendation from enhancement-stack §B / HOW-IT-WORKS §9 | n/a | `apps/api/src/config.ts`, `apps/api/src/routes/devices.ts` | ~2^17 avg attempts (~0.5 s); test timeout raised accordingly. |

## Wave 2 — Phase 1 (small deps, life-safety + ops)

| Adoption | Source (canonical) | License | Where used | Notes |
|---|---|---|---|---|
| `isaacs/node-lru-cache` | github.com/isaacs/node-lru-cache | BlueOak-1.0.0 | `apps/api/src/routes/care.ts`, `apps/api/src/routes/dogs.ts` | 60s TTL care-provider directory, 5s TTL dog pages. Deliberately NOT applied to the shared `getNearbyCare()` (SOS path always reads fresh). Errors and 404s never cached. |
| `GoogleChrome/web-vitals` pattern | github.com/GoogleChrome/web-vitals | Apache-2.0 | `apps/api/src/routes/metrics.ts`, `packages/db/migrations/0013_web_vitals.sql` | Anonymous `POST /api/v1/metrics/web-vitals` (slug-stripped paths only — server rejects anything carrying a real collar slug or `?s=` signature); feeder-authed aggregate GET. |
| `merkletreejs` — Merkle inclusion proofs over the ledger chain | github.com/merkletreejs/merkletreejs | MIT | `packages/ledger/src/merkle.ts` | Per-append Merkle root over the chain's canonical record hashes (leaf = `LedgerRecord.hash`, so tree and chain agree); O(log n) `verifyInclusion` for external auditors. Tree uses `duplicateOdd`; proofs are extracted from the library's layers because its own proof walk drops the self-duplicate for the last leaf of odd trees. |
| `panva/jose` — signed chain head (Ed25519/EdDSA) | github.com/panva/jose | MIT | `packages/ledger/src/signing.ts` | Compact JWS over `{head, merkleRoot, recordCount}` with `sub: did:web:hetja.in:vets/<vetId>`; keygen + JWK export so the public half can later be served at a `did:web` JWKS endpoint (`jwks()` helper). |

## Wave 3 — Phase 1 ops (backups, real-IP, DR)

| Adoption | Source (canonical) | License | Where used | Notes |
|---|---|---|---|---|
| `wal-g/wal-g` — PG WAL archiving | github.com/wal-g/wal-g | Apache-2.0 | `/usr/local/bin/wal-g`, `ops/backup/wal-g.md` | v3.0.8 installed; dormant until R2 creds land in `/root/.backup-env` (activation steps + restore drill documented). Interim protection: restic daily `pg_dump`. |
| `restic/restic` — encrypted file backups | github.com/restic/restic | BSD-2-Clause | `ops/backup/restic-backup.sh`, `hetja-restic.timer` (daily 02:15 IST) | Encrypted snapshots of the daily PG dump, `.env.production` secrets, Caddy/PG configs, systemd units. R2-ready via `/root/.backup-env`; running against a local interim repo until R2 creds exist. |
| `WeidiDeng/caddy-cloudflare-ip` | github.com/WeidiDeng/caddy-cloudflare-ip | Apache-2.0 | `ops/caddy/Caddyfile` | Caddy rebuilt (v2.11.4 + module); `trusted_proxies cloudflare` + `header_up X-Forwarded-For {CF-Connecting-IP}` — the tunnel fix that makes `@fastify/rate-limit` see per-stranger IPs (verified live: API logs the real client IP). Guarded by `ops/check-caddy-cache.sh`. |

## Sources researched and evaluated (2026-08-13)

Full evaluation of all researched projects — adopted, deferred, and rejected —
is in the enhancement-stack document. This file credits what is *used*.
