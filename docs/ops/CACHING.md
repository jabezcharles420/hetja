# Cache policy (enhancement stack §M.4)

One contract, two halves. Caddy sets the origin headers; Cloudflare Cache Rules
honor the same paths at the edge. **/d/* (collar pages) and the API catch-all
are `no-store` on purpose** — a collar page shows SOS state that changes
underneath it, so a stale copy is a life-safety bug, not a perf regression.

## Origin half (Caddy) — `ops/caddy/Caddyfile`

| Path | `Cache-Control` | Why |
|---|---|---|
| `/api/v1/care*` | `public, max-age=60, s-maxage=60` | Care directory is stable enough for a 60 s edge/UA cache; it is also the hottest read endpoint. |
| `/d/*` | `no-store` | Collar landing page; must always show current SOS state. |
| `/api/v1/*` (catch-all) | `no-store` | Everything else is stateful or per-stranger. |
| `/_next/static/*` | `immutable` (long max-age) | Content-addressed build assets. |

Order matters in the Caddyfile: the specific `care*` handle comes before the
API catch-all.

## Edge half (Cloudflare dashboard → Caching → Cache Rules)

The dashboard rules must match the same paths and TTLs as the origin headers:

- `hetja.in/api/v1/care*` → cache, TTL 60 s (or "respect origin" with the
  origin's `s-maxage=60`).
- `hetja.in/d/*` → **bypass cache** (no-store).
- `hetja.in/api/v1/*` → bypass cache (no-store).
- `hetja.in/_next/static/*` → cache with origin's `immutable` directive.

If the edge and origin disagree, the stricter of the two wins only where it is
enforced; a misconfigured bypass on `/d/*` at the edge would serve stale SOS
state. When in doubt, curl both hops:

```bash
curl -sI https://hetja.in/d/<slug> | grep -i cache-control   # no-store
curl -sI https://hetja.in/api/v1/care?lat=19.07&lng=72.88 | grep -i cache-control
```

## CI guard

`ops/check-caddy-cache.sh` asserts the Caddy half of the contract on every
push (no-store on `/d/*`, no `max-age` on it, 60 s on `care*`, immutable on
`_next/static`). The Cloudflare dashboard half is manual — check it after any
tunnel/domain reconfiguration.

## Related: real client IPs

The same Caddy config carries the `real_ip` snippet (`header_up X-Forwarded-For
{CF-Connecting-IP}` + `trusted_proxies cloudflare` from the
`caddy-cloudflare-ip` module) so the API rate-limiter sees per-stranger
addresses through the tunnel — see `ops/caddy/HOSTING.md`.
