# Owner to-do (decisions and account access)

Things the overnight work of 2026-09-24/25 (and the design v5, v6 and v7
builds that followed) could not do without you: they need your accounts, money, or a
policy decision. Everything that could be done
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

## Before launch (design v5 and v6)

6. **Have a practising vet read the first-aid lines.** The reporter's "While
   you wait" card (N10, `apps/scan/src/firstaid.ts`) now ships by your
   decision, three lines verbatim from the mock: keep traffic and people back,
   don't lift a dog that can't stand or give food or water, keep your hands
   away from the dog's face. These are the holding instructions a frightened
   stranger follows until help arrives, and the mock itself asks for a vet's
   review before launch. Change the words only with that review.
7. **Check "About ₹150".** The first-dog screen (V13, `/register`) tells a new
   registrator a collar costs "About ₹150", shipped as the designer wrote it.
   Confirm it against what a print shop and a collar actually cost in Mumbai.
8. **The dogs already in the production database.** The live map said 4 dogs
   were waiting for dinner. Confirm they are real dogs with real feeders, or
   remove them (with a checked backup: `dogs` rows are referenced by the
   append-only ledger) before launch, so the first strangers do not see test
   data.
9. **Translations, if you want Hindi or Marathi.** N14 (the language setting)
   was designed and deliberately not built: no Language row ships in Settings
   until human translations exist. Machine translation of SOS and first-aid
   copy is not an option. Sheets already print Devanagari dog names.
10. **Confirm vet and NGO numbers.** Every number is shown, confirmed ones
    first, but until the first monthly CSV of confirmed details is applied
    (see Monthly, below), each one says "Number not confirmed yet" on a
    stranger's SOS screen.

## Before the v7 portals go live

11. **Add `admin.hetja.in` to the Cloudflare tunnel.** Zero Trust, then
    Networks, then Tunnels, then the hetja tunnel, then Public Hostname: add
    `admin.hetja.in` with service `http://localhost:80` (the same origin as
    `hetja.in`; Caddy tells them apart by host and sends the bare host to
    `/admin`). Until it exists the portal also works at `hetja.in/admin`.
12. **Add the two new GitHub secrets.** `HETJA_OWNER_EMAILS`: your sign-in
    address (comma-separated if there is more than one Owner). It is turned
    into an identity HMAC when the API boots; it is never written to the
    database or a log, and never committed (like every secret, it sits in
    `api.env` on the box). `HETJA_DOCS_KEY`: `openssl rand -base64 32`. Both are optional
    to the deploy: without the first nobody is Owner by configuration, and
    without the second vet and NGO applications cannot upload documents
    (503) while everything else runs.
13. **Keep `HETJA_DOCS_KEY` in your password manager as well.** It encrypts
    the certificates and photo IDs vets and NGOs upload. Losing it is not a
    disaster (documents are deleted 30 days after each decision anyway): it
    only makes the documents still awaiting review unreadable, and those
    applicants would have to upload again. Unlike `HETJA_QR_SECRET`, it can be
    replaced; do not rotate it while applications are waiting.
14. **Sign in once with the Owner address.** Sign in at `admin.hetja.in` (or
    `hetja.in/login`) with the address in `HETJA_OWNER_EMAILS`, so the account
    exists. The Owner role is granted to the account whose identity matches;
    from then on add the rest of the team in Team and roles (A6).
15. **Upload the government vets and NGOs.** Put them in the monthly care CSV
    with the new v7 columns (`is_person`, `is_government`, `reg_no`,
    `wards`; see [VET-DATA-INTAKE.md](VET-DATA-INTAKE.md)) and run the "Care
    directory import" workflow, dry run first. A government vet or hospital
    must be `cost_tier` `free`: Hetja labels it "Government vet · free" or
    "Government hospital · free" everywhere, and the import refuses anything
    else. Once a government vet has a verified Hetja account, link the two in
    the admin portal (A2, "link to directory").
16. **The first-aid lines still need a vet's review** (item 6). v7 adds vets
    who can sign records on Hetja; one of the first could read the three
    "While you wait" lines.

## Cloudflare dashboard (free plan)

- **Rate limiting rule** (one on the free plan): POST to
  `/api/v1/devices/token`, `/api/v1/devices/challenge`, `/api/v1/auth/otp`,
  `/api/v1/auth/verify`; 8 requests per 10 s per IP; block for 10 s.
- **WAF custom rules:** block methods other than GET, HEAD, POST, PATCH,
  OPTIONS; block `.php`, `/.env`, `/wp-*` probes.
- **Cache Rules:** cache the paths Caddy now marks `s-maxage=60`
  (`/api/v1/wards` as an exact path, `/api/v1/map/wards` list,
  `/api/v1/map/places*`, `/api/v1/stats/impact`, `/api/v1/heatmap*`) and
  `/api/v1/care*`; bypass `/d/*`, `/sos*`, `/reports*`, and
  `/api/v1/map/wards/*`. This is the main fix for slowness: the box is in
  Europe, so an edge cache in Mumbai removes the round trip for public reads.
  Design v5 and v6 added no cached public GET: `ops/caddy/Caddyfile` is
  unchanged, and the new reads (`/api/v1/dogs/lookup`,
  `/api/v1/wards/<id>/dogs`, `/api/v1/dogs/<slug>/week`, the SOS case and
  reporter status) fall to the API's `no-store` catch-all. Keep them out of
  the cache: the two finding reads are rate limited per caller, and a rule on
  `/api/v1/wards*` would catch `/api/v1/wards/<id>/dogs` too.
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
| D7 | One open case per dog | Later reports join the open case instead of paging again. **Partly built (v6 L7):** a device that already has an open case on the dog is refused a second one and shown that case (who took it, when, "Add an update"); a different reporter's report still opens its own case |
| D8 | What an acker sees | **Decided and built (v5, v6):** the exact spot only after taking the case ("The exact spot unlocks when you tap I'm going"); before that, the ward and, for an eligible responder, a distance rounded to 100 m |
| D9 | "Get alerts for ward": should the home ward drive paging? | **Decided and built (v5 N1, Settings):** a feeder's chosen wards (up to 6) drive paging, as well as recent feeds near the dog; with wards set, a feeder is paged only for dogs in them. Quiet hours and a pause of up to 30 days hold paging back too |
| D10 | OTP: per-address daily cap, device token required to send | 10/day; device token after the client update |
| D11 | Global device-token mint bucket | Raise to about 1000/day now that the per-IP limit exists |
| D12 | Supabase: revoke `anon` on the three dog RPCs | Revoke (the web app does not use them) |
| D13 | Moderation tooling (suspend account, block device, take down photo) | **Built (v7 admin portal):** Feeders has suspend and block device, Dogs and Reports take down a photo; every action is in the audit log |
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
  When it lapses the map and the vets-near-you map show no street tiles at
  all (ward pills and pins still draw on a plain background) until you
  replace the `ESRI_API_KEY` secret. There is no keyless fallback any more:
  CARTO now needs a key too.
