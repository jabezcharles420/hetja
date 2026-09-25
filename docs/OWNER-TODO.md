# Owner to-do (decisions and account access)

Things the overnight work of 2026-09-24/25 could not do without you: they need
your accounts, money, or a policy decision. Everything that could be done
safely without you is already built, tested and deployed (see
[WORK-REPORT.md](WORK-REPORT.md) and [BUGS.md](BUGS.md)).

Ordered by how much they matter.

## Do soon

1. **Rotate the Cloudflare tunnel token.** It was pasted into a chat. Zero
   Trust, then Networks, then Tunnels, then the hetja tunnel, then Configure:
   "Refresh token". Put the new value in `/etc/hetja/tunnel.env` on the box
   (root, `TUNNEL_TOKEN=...`), then `systemctl restart hetja-tunnel`.
2. **Save the generated app secrets** (JWT, HMAC pepper, QR secret, device
   secret, VAPID keys) into your password manager. They exist only as GitHub
   secrets and on the box. `HETJA_QR_SECRET` becomes irreplaceable the
   moment the first collar is printed.
3. **Check the unknown SSH key.** Root's `authorized_keys` on the box holds
   `fenqinyang@Fens-MacBook-Air.local`. Remove it if you don't recognise it.
4. **Upgrade Next.js 14 to 15.** `pnpm audit` (report-only in CI) shows a
   critical advisory in next that is fixed only in 15.5.24 or later, plus
   highs in nodemailer, fast-uri and postcss. A major upgrade needs testing,
   so it was not done unattended.
5. **Backups.** The old nightly restic and pg_dump jobs belonged to the reset
   box. Supabase is now the database: check which backups your Supabase plan
   includes (the free plan has no point-in-time recovery). `/srv/hetja/photos`
   is not backed up (photos expire after 7 days anyway).

## Cloudflare dashboard (free plan)

- **Rate limiting rule** (one on the free plan): POST to
  `/api/v1/devices/token`, `/api/v1/devices/challenge`, `/api/v1/auth/otp`,
  `/api/v1/auth/verify`; 8 requests per 10 s per IP; block for 10 s.
- **WAF custom rules:** block methods other than GET, HEAD, POST, PATCH,
  OPTIONS; block `.php`, `/.env`, `/wp-*` probes.
- **Cache Rules:** cache the paths Caddy now marks `s-maxage=60`
  (`/api/v1/wards`, `/api/v1/map/wards` list, `/api/v1/map/places*`,
  `/api/v1/stats/impact`, `/api/v1/heatmap*`) and `/api/v1/care*`; bypass
  `/d/*`, `/sos*`, `/reports*`, and `/api/v1/map/wards/*`. This is the main
  fix for slowness: the box is in Europe, so an edge cache in Mumbai removes
  the round trip for public reads.
- Security level medium, Browser Integrity Check on, Always Use HTTPS,
  minimum TLS 1.2. Keep Bot Fight Mode OFF (it cannot be scoped per path on
  the free plan and would break `fetch`). Never put Managed Challenge on
  `/api`.
- **Content Security Policy** is shipped in report-only mode. After a few
  days with no violations in the browser console on `/`, `/map`, `/scan` and
  `/d/<slug>`, switch the header name to `Content-Security-Policy` in
  `ops/caddy/Caddyfile` (the check script accepts both).

## Policy decisions (the audit's D items)

| # | Decision | Suggested default |
|---|---|---|
| D2 | Turnstile on sign-in (free, needs keys and a privacy note) | Yes on `/login` before sending a code; never on `/d/` |
| D3 | Device-token expiry | 45 days, old tokens accepted until a cutoff date |
| D4 | Should the registrator's own account/device count toward SOS corroboration? Should a scan far from the dog's ward move the dog? | No, and no beyond 5 km |
| D5 | Acked cases left unresolved | Re-escalate after 60 min; a non-moderator's "false alarm" becomes "resolved, pending review" |
| D6 | Public timing on the map/profile | Round SOS times to 10 min and "last fed" to 15 min for anonymous viewers |
| D7 | One open case per dog | Later reports join the open case instead of paging again |
| D8 | What an acker sees | Dog, photo and a 500 m area, eligible ackers only |
| D9 | "Get alerts for ward": should the home ward drive paging? | Yes, as well as recent feeds (the caption is honest either way) |
| D10 | OTP: per-address daily cap, device token required to send | 10/day; device token after the client update |
| D11 | Global device-token mint bucket | Raise to about 1000/day now that the per-IP limit exists |
| D12 | Supabase: revoke `anon` on the three dog RPCs | Revoke (the web app does not use them) |
| D13 | Moderation tooling (suspend account, block device, take down photo) | Build next |
| D14 | Feed-trust daily cap (shipped at 8) | Confirm or change `FEED_TRUST_DAILY_CAP` |
| D15 | Image moderation | Only signed-in or reviewed photos become the public portrait |
| D16 | Thumbnails / object storage | 480 px client thumbnails; R2 later |
| D17 | Geo-block at the edge | Non-India only on OTP send; never on `/d/*` or `/reports` |

Full evidence and reasoning: the audit report summarised in
[BUGS.md](BUGS.md) (2026-09-25) and [INVARIANTS.md](INVARIANTS.md).

## Monthly

- **Vet and NGO list:** fill `packages/db/data/care/TEMPLATE.csv` with details
  confirmed from each provider (Google Maps only to find leads), commit it,
  run the "Care directory import" workflow as a dry run, then with apply and
  `yes-i-mean-it`. See [VET-DATA-INTAKE.md](VET-DATA-INTAKE.md).
- **ArcGIS key expiry:** set a reminder a week before the date on the key.
  When it lapses the map falls back to CARTO tiles until you replace the
  `ESRI_API_KEY` secret.
