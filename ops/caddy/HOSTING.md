# Hosting hetja.in

## The constraint

This VPS has **no public IP**. It is a NAT'd container:

```
$ ip -4 addr           # 10.10.10.101/24 on eth1, default via 10.10.10.1
$ curl api.ipify.org   # 152.228.227.51  (the host's address, shared)
```

The only forwarded port is SSH (external `20095` → internal `22`). Ports 80, 443
and 8080 on `152.228.227.51` are answered by a **different Caddy on the Proxmox
host** — verified by stopping this container's Caddy and watching
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
* Same-origin means the web app's API calls involve no CORS preflight.
* The feeder access token lives in `localStorage` and service-worker scope is
  per-origin, so `www` redirects to the apex rather than serving in parallel.
* Collar URLs stay short enough to etch: `https://hetja.in/d/c3di5esh8?s=…`.

Because Caddy sits behind the tunnel and never sees the internet, `auto_https`
is **off** and the site addresses are written `http://`. ACME could not work here
regardless — nothing reaches port 80 from outside.

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

No A/AAAA records are needed — Cloudflare creates proxied CNAMEs for the tunnel.

### 2. On the VPS

```sh
sudo /root/straynet/ops/caddy/setup-tunnel.sh <TUNNEL_TOKEN>
```

Idempotent: it re-installs the service if run again.

### 3. Verify

```sh
curl -sI https://hetja.in/
curl -s  "https://hetja.in/api/v1/heatmap?ward=A"
curl -sI "https://hetja.in/d/c3di5esh8"      # must be 200 text/html
```

Then check the proxy hop count — see the note printed by `setup-tunnel.sh`.
`TRUST_PROXY` is `1`; with both cloudflared and Caddy in front it may need to be
`2`. Only log accuracy is affected, since rate limits key on account/device
token rather than IP (INVARIANT 6).

## Rebuilding the web app after a domain change

`NEXT_PUBLIC_*` values are inlined at **build** time. Changing
`NEXT_PUBLIC_API_URL` in `apps/web/.env.production` therefore requires a rebuild;
restarting the service alone does nothing:

```sh
pnpm --filter @straynet/web build && systemctl restart straynet-web
```

## Services

| Unit | Port | Bound to |
|---|---|---|
| `straynet-web` | 3100 | 127.0.0.1 |
| `straynet-api` | 8080 | 127.0.0.1 |
| `straynet-scan` | 8081 | 127.0.0.1 |
| `caddy` | 80 | all interfaces (unreachable from outside) |
| `cloudflared` | — | outbound only |

All three app ports are loopback-only, so even if a port-forward appeared they
could not be reached without going through Caddy.
