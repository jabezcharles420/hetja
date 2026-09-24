# Hosting hetja.in

> **Current hosting: [`ops/room/README.md`](../room/README.md).** Since
> 2026-09-24 the box is shared with an autonomous agent that has priority.
> Caddy, cloudflared, Node and the four services run in a capped systemd slice
> as the unprivileged `hetja` user (`hetja-caddy.service`,
> `hetja-tunnel.service`, ...), installed by `ops/room/bootstrap-room.sh`, not
> by this file's `setup-tunnel.sh`. The routing, the tunnel's public hostnames
> and the reasoning below still apply; sections that describe the old
> single-tenant box are marked **Historical**.

## The constraint

This VPS has **no public IP**. It is a NAT'd container:

```
$ ip -4 addr           # 10.10.10.101/24 on eth1, default via 10.10.10.1
$ curl api.ipify.org   # 152.228.227.51  (the host's address, shared)
```

The only forwarded port is SSH (external `20095` → internal `22`). Ports 80, 443
and 8080 on `152.228.227.51` are answered by a **different Caddy on the Proxmox
host**, verified by stopping this container's Caddy and watching
`Server: Caddy` keep replying. Binding a marker server to ports 20090–20100, 80,
443 and 8082 and probing each from outside produced no hits.

So pointing `hetja.in` at `152.228.227.51` would send visitors to someone else's
server. Two ways out:

| Option | Needs |
|---|---|
| **Cloudflare Tunnel** (chosen) | Nothing from the host operator. cloudflared dials out. |
| Host-side forward | The Proxmox operator to forward 80/443 → `10.10.10.101`, or add a `reverse_proxy hetja.in → 10.10.10.101:80` vhost to their Caddy. |

## How traffic flows

```
browser ──https──> Cloudflare edge (TLS terminates here)
                        │  encrypted tunnel, outbound only
                        v
                   cloudflared  (this container)
                        │  plain HTTP
                        v
                   Caddy :80
                        ├── /api/v1/*  ──> 127.0.0.1:8080   Fastify API
                        ├── /d/*       ──> 127.0.0.1:8081   collar landing
                        └── everything ──> 127.0.0.1:3100   Next.js PWA
```

Everything is one origin on purpose:

* `apps/scan` hardcodes a same-origin `/api/v1` prefix (`src/api.ts`,
  `service-worker.ts`), so the API *must* be reachable at that path.
* Same-origin means the web app's API calls involve no CORS preflight. (The
  production web build now calls `https://api.hetja.in` instead, set by
  `NEXT_PUBLIC_API_URL` in `deploy.yml`, so its calls are cross-origin and the
  API's `CORS_ORIGINS` allows `hetja.in` and `www.hetja.in`. The scan app is
  still same-origin.)
* The feeder access token lives in `localStorage` and service-worker scope is
  per-origin, so `www` redirects to the apex rather than serving in parallel.
* Collar URLs stay short enough to etch: `https://hetja.in/d/c3di5esh8?s=…`.

Because Caddy sits behind the tunnel and never sees the internet, `auto_https`
is **off** and the site addresses are written `http://`. ACME could not work here
regardless: nothing reaches port 80 from outside.

### Real client IPs (the tunnel makes everything look like loopback)

cloudflared terminates the tunnel on the box itself, so every connection
reaches Caddy from 127.0.0.1. The `real_ip` snippet in `ops/caddy/Caddyfile`
rewrites the edge's `CF-Connecting-IP` into `X-Forwarded-For`, so the API sees
the stranger's actual address.

> An earlier version of this paragraph said the rewrite exists so that
> `@fastify/rate-limit` "sees the stranger's actual address", and that without
> it "the API would rate-limit the whole city as one IP". Neither is true.
> `@fastify/rate-limit` is not a dependency of `apps/api` and is registered
> nowhere, so there was no per-IP limiter to fix, and there should not be a
> general one, because INVARIANT 6 rate-limits per account or per attested
> device token *precisely because* Indian carrier CGNAT makes an IP a poor
> identity. What the rewrite genuinely buys is correct request logging, and the
> ability to put a flood cap on device-token **minting** later: bounding how
> many tokens one address can obtain, which is a different question from capping
> what a user may do.
>
> One operational catch: `TRUST_PROXY` must be set in `apps/api/.env.production`
> (usually `1`). It defaults to `0`, and at `0` Fastify ignores `X-Forwarded-For`
> altogether and `request.ip` stays loopback, so the Caddy half of this fix is
> inert on its own.

**Historical:** the room runs stock Caddy without this module and trusts
private ranges instead (`ops/room/Caddyfile.global`), since behind the tunnel
every request comes from loopback. On the old box, Caddy was rebuilt with the
`caddy-cloudflare-ip` module (`trusted_proxies cloudflare`), which marks
Cloudflare edge addresses as trusted so the header survives on the CDN-direct
path too. Verified live 2026-08-14 (API logs show the real remote address, not
127.0.0.1); guarded by `ops/check-caddy-cache.sh` in CI.

## Setup

### 1. Cloudflare

1. Add `hetja.in` to Cloudflare (Free plan is enough). It will show two
   nameservers, e.g. `xxx.ns.cloudflare.com`.
2. In Dynadot → **My Domains → Name Servers**, set those two. (That page was
   empty, so there is nothing to undo.) Activation usually takes minutes.
3. Zero Trust → **Networks → Tunnels → Create a tunnel** → *Cloudflared*.
4. Add public hostnames, all pointing at the same local service:

   | Subdomain | Domain | Service |
   |---|---|---|
   | *(blank)* | hetja.in | `http://localhost:80` |
   | `www` | hetja.in | `http://localhost:80` |
   | `api` | hetja.in | `http://localhost:80` |

   Caddy does the path routing, so every hostname points at port 80.
5. Copy the tunnel token from the **Install** step.

No A/AAAA records are needed; Cloudflare creates proxied CNAMEs for the tunnel.

### 2. On the VPS

In the room the tunnel token goes into `/etc/hetja/tunnel.env` (root, 0600) on
stdin through `ops/room/bootstrap-room.sh`; see
[`ops/room/README.md`](../room/README.md), "One-time setup".

**Historical** (old box):

```sh
sudo /root/hetja/ops/caddy/setup-tunnel.sh <TUNNEL_TOKEN>
```

Idempotent: it re-installs the service if run again.

### 3. Verify

```sh
curl -sI https://hetja.in/
curl -s  "https://hetja.in/api/v1/heatmap?ward=A"
curl -sI "https://hetja.in/d/c3di5esh8"      # must be 200 text/html
```

Then check the proxy hop count. The room's `api.env` sets `TRUST_PROXY=1`
(one hop: cloudflared to Caddy to the API). Only log accuracy is affected, since rate limits key on account/device
token rather than IP (INVARIANT 6).

## Rebuilding the web app after a domain change

`NEXT_PUBLIC_*` values are inlined at **build** time, so changing
`NEXT_PUBLIC_API_URL` (set in `deploy.yml`'s build step, currently
`https://api.hetja.in`) requires a new build. In the room that means a push:
nothing is ever built on the shared box, and editing `web.env` there and
restarting does nothing.

**Historical** (old box):

```sh
pnpm --filter @hetja/web build && systemctl restart hetja-web
```

## Services (the room)

| Unit | Port | Bound to |
|---|---|---|
| `hetja-web` | 3100 | 127.0.0.1 |
| `hetja-api` | 8080 | 127.0.0.1 |
| `hetja-scan` | 8081 | 127.0.0.1 |
| `hetja-caddy` | 80 | 127.0.0.1 only (`default_bind`), admin endpoint off |
| `hetja-tunnel` | none | outbound only |

On the old box Caddy was the system `caddy` unit on all interfaces and the
tunnel was `cloudflared`.

All three app ports are loopback-only, so even if a port-forward appeared they
could not be reached without going through Caddy.
