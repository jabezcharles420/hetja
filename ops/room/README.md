# The room: Hetja on a shared box

Since 2026-09-24 the production box (LXC, 2 vCPU, 3 GB RAM, behind NAT, SSH
on `152.228.227.51:20095`) is shared with an autonomous agent that **has
priority**. Hetja lives in a resource-capped "room" that cannot starve it,
cannot out-remember it, and steps aside when memory gets tight.

## The contract

| Resource | Hetja | Why |
|---|---|---|
| CPU | `CPUWeight=20` vs the agent's default 100, hard `CPUQuota=60%` | The box runs at load ~10 on 2 cores all day. Under contention Hetja gets about a sixth. |
| Memory | `MemoryHigh=300M`, `MemoryMax=360M`, `MemorySwapMax=192M` | Sized from the agent's watchdog, which restarts its browser below 250 MB available. At the browser's own ceiling the agent leaves about 590 MB, so Hetja stays under about 340 MB. |
| OOM | `OOMScoreAdjust=1000` on every unit | A global OOM kills Hetja first. |
| Memory guard | `hetja-guard.timer` (every 60 s) | Stops the whole site below 400 MB available and brings it back above 900 MB. |
| Privilege | User `hetja` (uid 999), no sudo, no password | Only Caddy holds `CAP_NET_BIND_SERVICE`, for 127.0.0.1:80. |
| Network | Everything on 127.0.0.1 (80, 3100, 8080, 8081) | The only way in is the Cloudflare Tunnel, which dials out. |
| Disk | `/srv/hetja`, `/etc/hetja`, `hetja*` units | Nothing else on the box is touched. No apt, no system node. |

Database: **Supabase** (no Postgres on the box). Credentials are GitHub
secrets; the box copy is `/srv/hetja/shared/api.env` (0600, hetja).

## Layout

```
/srv/hetja/            root 0755
  bin/                 root: node, caddy, cloudflared (pinned, sha256-verified),
                       hetja-deploy, hetja-guard
  opt/node-v22.x/      root
  releases/<id>/       hetja: web/ api/ worker/ scan/ Caddyfile REVISION
  current -> releases/<id>
  shared/              hetja: api.env, web.env, deploy-stamp, caddy/
  photos/              hetja: uploaded dog photos
  incoming/            hetja: where the runner drops a release
/etc/hetja/tunnel.env  root 0600: TUNNEL_TOKEN (never readable by hetja)
```

## How a deploy works

`.github/workflows/deploy.yml` builds everything on the GitHub runner (never on
the box), runs `ops/room/build-release.sh`, writes the env files from secrets,
then as `hetja`:

1. `scp` the tarball and env files to `/srv/hetja/incoming/`
2. `hetja-deploy <id>`: unpack, validate the Caddyfile, flip `current`,
   write `shared/deploy-stamp`
3. `hetja-restart.path` (root) sees the stamp and restarts `hetja-*` only
4. health checks for up to 180 s; if they fail, it rolls back to the previous release

Pushes to `main` deploy and migrate Supabase. Manual runs
(`gh workflow run deploy.yml --ref <branch>`) migrate only with
`-f supabase_migrate=true`.

## Operating it (as root on the box)

```bash
systemctl status hetja.target 'hetja-*'          # everything
systemd-cgtop -1 | grep hetja                    # live CPU/memory of the room
journalctl -u hetja-api -n 100                   # logs per service
systemctl stop hetja.target                      # take the site down, agent untouched
cat /var/log/hetja-guard.log                     # when the guard paused the site
```

Remove the room entirely:

```bash
systemctl disable --now hetja.target hetja-guard.timer
rm /etc/systemd/system/hetja* && systemctl daemon-reload
rm -rf /srv/hetja /etc/hetja && userdel hetja
```

## One-time setup

`ops/room/bootstrap-room.sh` (idempotent; `APPLY=0` is a dry run that only
prints). The tunnel token goes in on stdin, never argv:

```bash
tar -czf - -C ops/room bootstrap-room.sh hetja-deploy.sh hetja-guard.sh units \
  | ssh aic 'mkdir -p /tmp/hetja-room && tar --no-same-owner -xzf - -C /tmp/hetja-room'
printf 'TUNNEL_TOKEN=%s\n' "$TOKEN" \
  | ssh aic "cd /tmp/hetja-room && APPLY=1 DEPLOY_PUBKEY='ssh-ed25519 ...' bash bootstrap-room.sh"
```
