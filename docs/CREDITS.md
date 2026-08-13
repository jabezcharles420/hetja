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

## Sources researched and evaluated (2026-08-13)

Full evaluation of all researched projects — adopted, deferred, and rejected —
is in the enhancement-stack document. This file credits what is *used*.
