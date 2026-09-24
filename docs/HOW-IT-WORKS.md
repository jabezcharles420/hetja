# Hetja: what it is, and how it actually works

This document is the one to read first. The [README](../README.md) says *why*
Hetja exists; [AGENTS.md](../AGENTS.md) says how to get it running on a fresh
machine; [INVARIANTS.md](INVARIANTS.md) lists the fifteen rules the system is
not allowed to break. This one explains the thing itself: what happens when a
stranger scans a dog's collar, what happens when they say the dog is hurt, and
what is holding all of that up.

Where something is designed but not built, it says so. There is no value in a
document that describes an aspiration as if it were running.

---

## 1. The one-sentence version

A street dog wears a collar with a QR code. Anyone who finds the dog (no app,
no account, no login) scans it with their phone's camera and gets a page that
tells them who this dog is, whether it is vaccinated, when it was last fed, and
a single large button: "This dog needs help". One more tap to say how bad it is
and one to send, and the nearest vets, NGOs and ambulances are on their screen
with tappable phone numbers, while the people nearby who have said they will
help are woken up.

Everything else in the repository exists to make those two screens true.

---

## 2. The people involved

Hetja has four kinds of user, and they do not share an interface. That
separation is deliberate; see §4.

**The stranger.** Someone who happens to find a dog. They are the only user who
matters at the moment of an emergency, they will never install anything, they
may be panicking, and they may be on a bad connection on a Mumbai street. They
get one page, no account, and are never asked to sign in. Ninety percent of all
traffic is this person.

**The feeder.** Someone who feeds and watches over specific dogs in their area.
They sign in (emailed code, no passwords, no SMS), log feeds, upload photos,
and can be woken by an SOS near them. They accumulate a *trust score* over
time, which is what earns them the right to do higher-stakes things.

**The responder.** A feeder, NGO worker or vet who has opted in to being
notified about emergencies in a geofenced area. When an SOS opens, they get a
push notification. The first one to acknowledge it owns the case; everyone else
is told to stand down so five people don't drive to the same dog.

**The tagger.** NGO or municipal staff who physically put collars on dogs and
enrol them into the system. This is a small number of trained people doing
bulk data entry, which is a completely different job from everything above.

---

## 3. The flows that matter

### 3.1 Scan

A collar's QR encodes a URL:

```
https://hetja.in/d/<slug>?s=<signature>
```

`slug` is nine characters from a deliberately reduced alphabet
(`[a-km-z2-9]`: no `l`, no `0`, no `1`) so a human can read one off a collar
and type it in without ambiguity. It is **random**, not sequential: you cannot
enumerate the city's dogs by counting upward (INVARIANT 1).

`s` is `base64url(HMAC-SHA256(qr_secret, slug))`. The server recomputes it and
refuses to resolve a slug whose signature doesn't match, which means a printed
collar cannot be forged and a scraper cannot fabricate valid URLs. The secret
lives only in the server's environment and in one row of the database, never
in any client bundle.

Two paths reach that URL, and both work:

- **The phone's own camera app.** This is the normal path and requires nothing
  from us. iOS Camera and Android's viewfinder both recognise a QR and offer to
  open the link.
- **In-page, from hetja.in/scan.** `apps/web/components/QrScanner.tsx` (screen
  02) opens the camera as soon as the page loads, because the design says so
  ("It opens by itself. No button needed.") and because someone who tapped
  **Scan a collar** has already asked for the camera. This reverses the earlier
  rule of asking only behind a "Use camera" button; the permission prompt now
  follows an explicit tap on the home page rather than a cold visit. It uses
  the native `BarcodeDetector` where it exists and lazily imports the small
  `barcode-detector` polyfill elsewhere. If permission is denied or there is no
  camera, the frame goes away and the code input takes focus. Every code,
  scanned or typed, is checked against `GET /api/v1/dogs/:slug` before leaving
  the page, so a wrong code gets "No dog with that code" instead of a dead
  profile.

The page that opens (screen 03) shows the dog's photo (or its initial on a
pastel circle), name, ward (`K/W ward · Andheri West`), vaccinated and
sterilised status, when it was last fed, the collar code, its story and how
many feeders wrote it. Status comes only from vet-recorded evidence: vaccinated
is "yes" or "unknown", sterilised is "yes", "no" or "unknown", and "no" is never
shown without evidence. What the page deliberately does **not** show is the
dog's exact location or anyone's phone number (INVARIANTs 2 and 3). Locations
are coarsened to the ward before they reach an anonymous viewer, because a
precise live location for a street dog is a targeting tool for anyone who wants
to hurt it, and there are such people. Feeder information is counts only: how
many feed it, how many wrote its story, never who.

A dog whose registration is still `pending_activation`, or has `expired`, is
not public at all: `GET /api/v1/dogs/:slug` answers 404 for it, except to the
registrator who filed it. That was a real bug until 2026-09-24 (see
[BUGS.md](BUGS.md)).

A signed-in feeder who scans with the phone camera also gets a quiet "Feeding
{Name}? Log a feed" link under the SOS button. Strangers see nothing extra, and
the SOS stays the one loud action.

### 3.2 Danger

On the collar page there is one primary action: **This dog needs help**. It
opens a whole-screen step (screen 04, "How bad is it?") with three choices,
which map onto the API's severity enum in `apps/scan/src/format.ts`:

| The stranger picks | Severity sent |
|---|---|
| "Hurt, but moving" (limping, a wound, not eating) | `serious` |
| "Can't get up, or bleeding" (needs a vet now) | `critical` |
| "Something else" (missing, scared, or being harmed) | `serious` |

The screen never sends `minor`. **Send SOS** stays disabled until a choice is
made. A note and a photo are optional; the photo is EXIF-stripped on
the server and saved only for a case the request actually opened, and it is
not part of the report's dedupe key, so a different photo cannot mint a "new"
case around the INVARIANT 7 cap.

The send is one `POST /api/v1/reports`, and the answer carries two things.

**Who to phone.** The response includes `nearbyCare`: up to eight providers
near the dog (free NGOs, government facilities, charity hospitals, and paid
clinics), each with a tappable number, whether they have an ambulance, whether
they are open 24×7, and what they cost. The sent screen (05) lists them as
Call rows. If the dog has no position on file, or the report itself failed,
the page falls back to `GET /api/v1/care` from the visitor's own location, and
if that is impossible too it says so and gives honest guidance, never a
made-up number. With no signal at all, it offers a prefilled text message
instead. This is a change from the earlier design, where the call list
appeared the instant the button was pressed and did not wait for the report;
the v4 flow puts one choice in between, and every degraded path still ends in
something the caller can act on.

The ordering is the interesting part. Providers with genuinely geocoded
coordinates come first, sorted by true distance. Providers whose coordinates
are only a locality-centroid estimate come after, and are sorted by
**has_ambulance → cost_tier (free before subsidised before paid) → open 24×7 →
name** rather than by distance. Distance is omitted entirely for those rows and
a place name is shown instead.

That is not fussiness. Twenty-five of the seeded Mumbai organisations collapse
onto eighteen distinct coordinates, because they were estimated from ward
centroids rather than geocoded from addresses. Sorting by that distance
produced a confident-looking "BHL Bird Helpline: 0 m away". Someone reading
that skips a hospital that is actually closer. `distanceM` is now `null`
unless the coordinate is real, and the API states which contract applies via
`geoPrecision`. **A measurement we don't have is not reported as zero.**

Phone numbers carry the same honesty rule. `phone_verified_at` is surfaced to
the client, not collapsed into a boolean, so a number nobody has ever called is
shown *as unconfirmed* rather than either hidden or presented as fact. About
thirty of the seeded NGO numbers are still `NULL` here. Someone has to pick up
a phone and call them; there is no way to shortcut that.

**An SOS case.** The same request creates a case, and the worker fans out
push notifications to responders near the dog (feeders with SOS paging on,
enough trust for the severity, and a geotagged feed within 2 km in the last 30
days). This is rate-capped, because an unauthenticated endpoint that can notify
unbounded numbers of people is a harassment vector (INVARIANT 7). If no
eligible responder exists, it escalates to tier 2 immediately rather than
waiting out a timer. Otherwise an unacknowledged case escalates after eight
minutes.

`POST /api/v1/sos/cases/:id/ack` claims a case. It is a conditional update
(`WHERE acked_by IS NULL AND resolved_at IS NULL`), so the first writer wins
atomically, a closed case can never be walked back open, and everyone
else gets a 409 and a stand-down. This is what makes the programme's headline
metric (median acknowledgement under five minutes) measurable at all.

**The reporter can see that someone is coming.** While the sent screen is
visible, the reporter's phone polls `GET /api/v1/reports/:caseId/status` every
15 seconds, for at most ten minutes, and stops for good once the case is taken
or closed. The pills read "Waiting for reply" until then. The route answers
only the device token (or signed-in account) that filed the report, returns
four fields (state and three timestamps) and nothing about who took it
(INVARIANT 3), gives the same 404 for "not yours" as for "does not exist" so
case ids cannot be probed, and is rate-limited per device, not per IP
(INVARIANT 6).

### 3.3 Feed

Signed-in feeders log a feed on screen 06 (`/feed?dog=<code>`). The photo is
optional now, and so is "How did it go?": **Ate it all**, **Ate a little**,
**Didn't eat**, **Looks unwell**. The choice is stored as
`scans.feed_outcome` (`ate_all`, `ate_some`, `didnt_eat`, `unwell`; migration
`0024`), written only when the scan row is first created, so an offline replay
can never rewrite it (INVARIANT 5). Older rows and feeds without a choice stay
`NULL`, because there is nothing true to backfill with.

"Looks unwell" is a **flag for a human, never an action**. The screen suggests
raising an SOS and does not raise one; the server never opens a case from it
(INVARIANT 14), and it does not touch `review_status`, because INVARIANT 15
counts rejected and flagged scans toward pausing a feeder, and reporting a sick
dog must never count against the person who reported it. Feeds go through the
same offline queue as before, and a signed-in response includes the feeder's
streak so the screen can say "Keeps your streak at N days" truthfully.

### 3.4 Map

`/map` (screen 19) shows all of Mumbai, and only Mumbai. Its data is three
public reads in `apps/api/src/routes/map.ts`:

- `GET /api/v1/map/wards`: every BMC ward with three counts (active dogs, dogs
  not fed since midnight in Mumbai, open SOS cases) and the newest open case's
  severity and time, at a **fixed, hand-placed ward centre**
  (`BMC_WARD_CENTROIDS` in `@hetja/contracts`). The point is the same for every
  request, so it cannot leak where any dog, reporter or feeder is.
- `GET /api/v1/map/wards/:wardId`: one ward's counts, its open cases (severity,
  time, state and whether responders were paged; no note, no reporter, no
  photo, no position), and up to three vets and NGOs in or near it.
- `GET /api/v1/map/places?bbox=`: listed vets and NGOs with a real geocoded
  point inside a box, for pins. A provider whose position is only a locality
  estimate never gets a pin, because it would be drawn in the wrong place.

**Everything about dogs is aggregated to the ward** (INVARIANT 2). The only
phone numbers are organisations' published numbers from `care_providers`
(INVARIANT 3). The reads are 60-second caches.

**Case ids are not public.** Taking a case (`POST /sos/cases/:id/ack`) is first
writer wins, so publishing ids on an anonymous map would let any new account
claim every open case and stop it escalating. The ward detail returns a case id
only to a signed-in caller who meets the same responder rules the fan-out uses
(SOS paging on, trust 40 or more, 60 for critical) or who already holds the
case; that answer is per caller and never cached. That is what makes the map's
**I can go and help** button safe. **Get alerts for {ward} ward** sets the
feeder's home ward and turns SOS paging on (`PATCH /api/v1/feeders/me`); note
that paging itself still follows recent feeds near the dog, not the home ward.

The vets and NGOs on the map are Hetja's own list, refreshed monthly from a CSV
of details confirmed with each provider (`packages/db/src/import-care.ts`, run
through the `care-import.yml` workflow, dry-run by default; retired rows are
unlisted, never deleted). Google Maps is used only to find leads; Google Places
content is never stored, per Google's terms. See
[VET-DATA-INTAKE.md](VET-DATA-INTAKE.md).

Base tiles are Esri's Light Gray static basemap (ArcGIS Location Platform, a
referrer-restricted key in `NEXT_PUBLIC_ESRI_API_KEY`), falling back to CARTO's
keyless light tiles when there is no key or Esri refuses it.
**Mumbai only.** `MUMBAI_BOUNDS` in `packages/contracts/src/wards.ts`
(18.88 to 19.30 N, 72.76 to 73.00 E) is the whole world as far as the map is
concerned: the tile layer is bounded to it (no tile outside Mumbai is ever
requested), the view cannot be panned past it, and `/api/v1/map/places`
clamps any box to it and answers 400 for a box entirely outside it.

### 3.5 Registration's self-reported medical status

The New dog screen (10) asks whether the dog is vaccinated and sterilised.
Those answers are stored as `dogs.vaccinated_reported` and
`dogs.sterilised_reported` (migration `0025`) and are **never read by any
public route**. The profile's Vaccinated and Sterilised pills come only from
vet-verified medical records, which is what the screen's caption promises:
"Vets can confirm medical status later."

---

## 4. The four apps, and why they are separate

```
apps/
  scan     vanilla TypeScript, no framework      -> hetja.in/d/<slug> (profile + SOS)
  web      Next.js 14 App Router                 -> hetja.in (everything else, incl. /map)
  api      Fastify 5 + zod                       -> hetja.in/api/v1, api.hetja.in
  worker   background jobs (SOS fan-out, escalation, push, expiry, retention)
  shell    native wrapper: EMPTY, not built
  ai       vision/embedding helpers
packages/
  contracts  zod schemas and ward data shared by API and clients; the single source of truth
  db         pool, migrations, slug generation and signing, care-directory importers
  design     tokens.css: the design v4 tokens from the Claude Design handoff
  ledger     hash-chained append-only medical ledger
  pow        ALTCHA proof-of-work solver for anonymous device tokens
```

The split is about failure domains, not tidiness.

`apps/scan` is the life-safety surface. It is plain TypeScript with zero
dependencies, held under a **40 KB gzipped CI budget** that fails the build if
exceeded, because the person using it is on a phone on a street and every
kilobyte is a second. It runs as its own service (`hetja-scan`), so a crash in
the web app or the API's heavier routes cannot take down the page a stranger
needs. It does ship in the same release tarball as everything else, so a bad
release is health-checked and rolled back as a whole.

`apps/web` is everything else: scanning from the site, logging feeds, signing
in, Me, registering a dog, the map, and the marketing and reading pages.
Richer, heavier, and allowed to be. `/hetja` is the memorial page. `/privacy` is a DPDP notice and is
treated as a factual document: when the login moved from phone to email, that
page had to change in the same commit, because a privacy notice that describes
storage you no longer do is simply false.

`apps/field`, the tagger portal, was the original name for a bulk-enrolment
surface gated on `feeder_role` (`admin`/`vet`/`bmc_officer`). It is not a
separate app. The **registrator surface that ships in `apps/web` plus
`POST /api/v1/registrations` *is* that portal**: sign up → register the dog you
look after → print the collar (`docs/MAKING-A-COLLAR.md`) → attach it → scan it
to activate. `POST /api/v1/dogs` (admin enrolment, `apps/api/src/routes/enrolment.ts`)
exists and is the operator counterpart. What remains unbuilt from the original
`apps/field` scope is the **re-tag route**: a replacement collar keeps the same
slug (`GET /api/v1/registrations/:slug` returns the same `collarUrl` forever), but
there is no dedicated retag endpoint yet. Trust ≥ 50 would have locked out pilot
staff who need to retag on day one, which is why access gates on role, not score.

---

## 5. Data

Twenty-two domain tables plus `schema_migrations` in PostgreSQL 16, with PostGIS
for geography and pgvector for image embeddings. Fifteen of them come from
`0001_init.sql`; `care_providers` (0008), `otp_codes` (0010),
`push_subscriptions` (0011), `web_vitals` (0013), `refresh_tokens` (0017),
`spent_challenges` (0021) and `collar_reissues` (0023) arrived later. Earlier
versions of this paragraph said "eighteen", then "nineteen" (which omitted the
0017 and 0021 tables), while `WORK-REPORT.md` said "15". None matched the
database, which `\dt` counts even higher because PostGIS ships its own
`spatial_ref_sys`. The count is checkable:
`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN
('schema_migrations', 'spatial_ref_sys')`. Migrations `0024` and `0025` added
columns, not tables: `scans.feed_outcome` and
`dogs.vaccinated_reported` / `dogs.sterilised_reported` (§3.3, §3.5). The ones
to know:

| Table | What it holds |
|---|---|
| `dogs`, `collars` | the register; a collar binds a slug to a dog |
| `scans` | every resolution of a slug, coarsened |
| `feeders` | accounts; identified by `identity_hmac`, never a raw address |
| `medical_records` | append-only, hash-chained treatment ledger |
| `sos_cases`, `sos_notifications` | the case machine and its delivery receipts |
| `care_providers` | the public vets/NGO directory behind the danger flow |
| `vets` | *contracted* partner clinics: signing keys, MOUs, retainers |
| `geofences`, `feeder_territories` | who gets woken for what |
| `trust_events` | the audit trail behind every trust score |
| `otp_codes`, `push_subscriptions` | login codes and push endpoints |

Two of those distinctions carry weight.

**`care_providers` is not `vets`.** `vets` is a contractual registry: it has
`signing_key_pub NOT NULL`, `mou_signed_at`, `retainer_paise`. Those columns
are meaningless for an NGO we have no relationship with and merely *list*. So
listing lives in its own table, with one optional bridge (`vet_id`) for the
case where a listed provider also happens to be a contracted partner.

**`medical_records` is append-only, and enforced twice.** On a self-hosted
database (CI, tests, the old box), `UPDATE` and `DELETE` are revoked from the
application role. On Supabase, which is production, a `BEFORE UPDATE OR DELETE`
trigger blocks it for *every* role including the owner. Each record carries the hash of the
previous one, so an altered history fails verification even if someone gets
write access to the table (INVARIANT 9). A dog's treatment history is evidence
in a cruelty case; it has to be worth something in front of someone who doesn't
trust us.

---

## 6. Auth, and why there is no SMS

Login is a six-digit code emailed to the feeder. No passwords, no phone
numbers, no SMS. SMS costs money per message, and this has to run on nothing.
Email goes out via Brevo's permanent free tier (300/day) from
`no-reply@hetja.in`, with SPF, DKIM and DMARC on the domain so it lands in
inboxes rather than spam.

Codes live in Postgres, hashed (`SHA-256(pepper:code)`), with a five-minute TTL
and three attempts. They used to live in an in-memory `Map`, which lost every
pending code on restart and could not work with more than one process. In
production the API now **refuses to boot** without SMTP credentials rather than
starting up and silently sending nothing, which was the original bug, and the
kind that surfaces only when a real person cannot log in.

Contact information is never stored raw. `identity_hmac` is
HMAC-SHA256 of the address under a server-held pepper (INVARIANT 3). Not a bare
hash: an email address has little enough entropy that a plain SHA-256 of it is
reversible with a wordlist.

Anonymous clients that need to write (a stranger reporting an injury) get a
*device token* minted by `POST /api/v1/devices/challenge` + `/token` against an
ALTCHA v2 proof-of-work (an HMAC-signed, single-use challenge solved
client-side), so the write endpoints are not open to trivial scripted abuse
without demanding an account from someone standing next to a bleeding dog.

---

## 7. Where it runs

```
phone ──https──> Cloudflare edge ──tunnel──> cloudflared ──> Caddy 127.0.0.1:80
                                                              ├── /api/v1/*  -> hetja-api    :8080
                                                              ├── /d/*       -> hetja-scan   :8081
                                                              └── /*         -> hetja-web    :3100
                                                                              hetja-worker (no port)
                                        all of the above ──TLS──> Supabase (PostgreSQL, Mumbai)
```

The box is a small LXC container (2 vCPU, 3 GB RAM) behind NAT with **no
inbound web port**. `cloudflared` dials *out* to Cloudflare and traffic comes
back down that tunnel, so hetja.in works without a public web port, and
Cloudflare terminates TLS. Caddy listens on loopback only, runs with
`auto_https off`, and has no admin endpoint. `hetja.in` is registered at
Dynadot with its nameservers pointed at Cloudflare; `api.hetja.in` reaches the
same Caddy and is the origin the web app calls.

**Since 2026-09-24 the box is shared** with an autonomous agent that has
priority, and Hetja lives in a "room" built so it cannot hurt that agent: a
systemd slice capped at 60% of one core and 360 MB of memory, weighted to get
about a sixth of the CPU under contention, with every unit first in line for
the OOM killer; an unprivileged `hetja` user with no sudo; pinned,
checksum-verified Node, Caddy and cloudflared under `/srv/hetja/bin` (no apt,
no system Node); and a memory guard that stops the whole site below 400 MB
available and restarts it above 900 MB. The full contract, the layout and the
operating commands are in [ops/room/README.md](../ops/room/README.md).

Because every request arrives at Caddy from loopback, the room's Caddy trusts
private ranges and copies Cloudflare's `CF-Connecting-IP` into
`X-Forwarded-For` (the `real_ip` snippet in `ops/caddy/Caddyfile`), and the API
runs with `TRUST_PROXY=1`. Rate limits do not depend on it: they key on the
account or the device token, never the IP (INVARIANT 6). What it buys is
accurate request logs.

**The production database is Supabase**, in Mumbai, reached through its
session pooler with TLS required. There is no PostgreSQL on the box. This
reverses the old arrangement, in which a PostgreSQL on the (single-tenant) box
was authoritative and the Supabase project a hardened mirror that served no
reads. That box was reset, and the mirror became production. The project has
RLS on, exact coordinates unreachable from the anon key, and writes from the
anon key only through `SECURITY DEFINER` RPCs that check the slug signature.
`ops/supabase/01_schema.sql` is a hand-maintained schema file and is still
several migrations behind `packages/db/migrations` (last synchronised through
`0009`); the live project does not depend on it, because the Migrate job
applies every migration to it, but a fresh project bootstrapped from that file
alone would be wrong. Regenerate it (`pg_dump --no-privileges`, requalified per
`ops/supabase/README.md`) before using it for anything.

Uploaded photos live on the box in `/srv/hetja/photos` (`STORAGE_BACKEND=local`)
and Caddy serves them at `/photos/*` on `api.hetja.in`.

---

## 8. Getting code from a laptop into production

Push to `main`. That is the intended interface, and it is the real one.

```
git push ──> GitHub Actions
              ├── Gate ──────── typecheck · all tests (ephemeral PostGIS + pgvector)
              │                 security gate · EXPLAIN gate · 40 KB size gate
              │                 contrast gate · Caddy cache gate · systemd gate
              ├── Migrate ───── destructive-migration gate
              │                 read-only report of Supabase's state
              │                 apply new migrations to Supabase
              └── Deploy ────── build EVERYTHING on the runner, one tarball
                                scp to the box as `hetja`, hetja-deploy <id>:
                                unpack, validate, flip releases/current, stamp
                                root path unit restarts hetja-* only
                                health-check up to 180 s, roll back if not healthy
                                then check https://hetja.in through Cloudflare
```

Nothing is built on the box. The old pipeline built `api` and `worker` there
from a git checkout at `/root/hetja`, and before that it once shipped only web
and scan while restarting all four units, which went green with a stale API.
Neither can happen now: every package is built on the runner into one release,
`hetja-deploy` refuses a release that lacks any service's entry point, and the
release directory carries a `REVISION` file with the SHA it was built from.

The deploy user cannot restart anything itself. It writes a stamp file, and a
root-owned systemd path unit (`hetja-restart.path`) restarts exactly the
`hetja-*` services. `/srv/hetja` itself stays root-owned so the deploy user can
never swap the binaries root runs; the `current` symlink therefore lives in
`/srv/hetja/releases/`.

Three gates are worth naming because they say no to real things:

- **The destructive-migration gate** fails the build if a migration contains
  `DROP TABLE`, `TRUNCATE`, `DELETE FROM` and so on without an explicit
  `-- MIGRATION-APPROVED: <reason>` marker. It matches destructive *statements*,
  not the mere appearance of the words, so `ON DELETE CASCADE`, `DROP DEFAULT`
  and `GRANT … DELETE` don't trip it. A gate that cries wolf teaches people to
  paste the approval marker reflexively, and then it protects nothing.
- **`ops/security-gate.sh`** refuses code that returns raw coordinates to
  anonymous callers or adds a bare `phone`/`email` column.
- **The 40 KB budget** on `apps/scan`.

Migrations go to **one** database now, Supabase, from the Migrate job. Pushes
to `main` always migrate; a manual run (`gh workflow run deploy.yml --ref
<branch>`) migrates only with `supabase_migrate=true`.

Rollback is automatic for code and **not** for schema. If the health checks
fail, `current` flips back to the previous release and the services restart on
it. An applied migration stays applied. That is safe only because the
destructive gate keeps unattended changes additive, and additive changes are
backward compatible with the code being rolled back to.

### Working locally

You do not need to touch the box. Clone, install, work, push:

```bash
git clone git@github.com:jabezcharles420/hetja.git
cd hetja && pnpm install

pnpm --filter @hetja/ledger build      # libraries first: consumers resolve
pnpm --filter @hetja/contracts build   # them through dist/, which is gitignored
pnpm --filter @hetja/db build

pnpm -r typecheck
./ops/security-gate.sh                 # 7 checks, no database needed
./ops/check-queries.sh
pnpm --filter @hetja/scan size:gate    # the 40 KB budget

git push                               # -> gates -> migrate -> deploy
```

Run the gates before pushing. They are the same scripts CI runs, so a local
failure is a CI failure you didn't wait ten minutes to discover.

**The test suite needs a database, and that is the one thing that isn't
one-command on a laptop.** `pnpm -r test` inserts real rows, so
`apps/api/vitest.setup.ts` refuses to run against any database whose name
doesn't end in `_test`, because `medical_records` is append-only, so rows written
there by a test can never be deleted again. It needs PostgreSQL with **PostGIS,
pgvector and pgcrypto**, and a stock Homebrew PostgreSQL has only the last of
those.

Two ways to get one:

```bash
# Matches CI exactly (postgis/postgis:16-3.4 + pgvector). Needs a Docker daemon;
# on macOS with Colima that means `colima start` first.
docker run -d --name hetja-test -p 55432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=hetja_dev_2026 \
  -e POSTGRES_DB=hetja_test postgis/postgis:16-3.4
docker exec hetja-test bash -c \
  'apt-get update -qq && apt-get install -y -qq postgresql-16-pgvector'
psql "postgresql://postgres:hetja_dev_2026@127.0.0.1:55432/hetja_test" \
  -c 'CREATE EXTENSION postgis; CREATE EXTENSION vector; CREATE EXTENSION pgcrypto;'

# Or add the extensions to an existing local PostgreSQL:
brew install postgis pgvector
```

On Windows, use WSL (Ubuntu 24.04) with the distribution's
`postgresql-16`, `postgresql-16-postgis-3` and `postgresql-16-pgvector`
packages, and run the suite from a copy of the repo inside the WSL filesystem.
The exact recipe is in [AGENTS.md](../AGENTS.md) §f.

Then apply migrations and run the suite:

```bash
export PGHOST=127.0.0.1 PGPORT=55432 PGDATABASE=hetja_test \
       PGUSER=postgres PGPASSWORD=hetja_dev_2026
pnpm --filter @hetja/db migrate
pnpm test                              # = pnpm -r --workspace-concurrency=1 test
```

The suites run one package at a time on purpose: they share one database, and
run concurrently the worker's queue tests claimed jobs the API's SOS tests were
asserting on.

One non-obvious thing if you build the database by hand: **migrations must be
applied as a superuser, so `postgres` owns the tables**, exactly as in
production. If `app_user` owns them instead, `0001_init.sql`'s
`REVOKE UPDATE, DELETE ON medical_records FROM app_user` strips the owner's own
rights, and the referential-integrity trigger behind `DELETE FROM dogs` then
fails as that owner: 48 test failures with nothing obviously wrong. This cost a
day in CI.

[AGENTS.md](../AGENTS.md) is the instruction set for handing this repository to
an agent. `ops/bootstrap.sh`, which used to bring a whole single-tenant Linux
box up, is historical now; the shared box is provisioned once with
`ops/room/bootstrap-room.sh` and never builds anything.

---

## 9. What is deliberately not finished

- The dedicated **re-tag route** (replacement collar keeps the same slug; no
  separate re-tag endpoint yet). `apps/field` as a standalone app is not
  planned; its scope is delivered as the registrator surface in `apps/web`
  (`POST /api/v1/registrations` + `POST /api/v1/dogs` for the operator path).
- `apps/shell`: the native wrapper. iOS requires add-to-home-screen before Web
  Push works at all, so until this exists, iOS responders are not reliably
  reachable. The UI says so rather than implying a safety net that isn't there.
- The first-aid instruction card is behind `FIRST_AID_ENABLED=false` until a
  practising vet signs off the wording. Bad first-aid advice given to a
  frightened stranger can kill a dog faster than doing nothing.
- `validate_scan` has **no producer**. Nothing enqueues it, so `ai_validation`
  stays `NULL`, `review_status` stays `pending` forever, and INVARIANT 15's
  gate can never fire from real AI output. It is recorded in
  `apps/worker/src/index.ts` `JOB_PRODUCERS` as `NONE -- see docs/INVARIANTS.md`
  rather than pretended.
- `ledger_anchors.published_url` is **`''`**, so INVARIANT 10 is not satisfied.
  The daily anchor is computed, Merkle-rooted and signed when a key is
  configured, but only ever held by us, and the invariant's whole point is a
  head published somewhere the operator does not solely control. `anchorMessage()`
  in `@hetja/ledger` exists to give a deterministic payload for that still-missing
  third-party publication.
- `STORAGE_BACKEND=s3` has **no delete path** in this build. The retention
  handler logs and returns, so photos are retained forever when that backend is
  selected. The `local` path is the only one that actually deletes.
- 93 `care_providers` are listed (25 curated + 68 imported from the maintainer's
  2026-08 verified Mumbai CSV); 43 carry phone numbers, none claimed verified
  (`phone_verified_at` stays NULL, per the honesty rule in migration 0008).
- Most `care_providers` coordinates are locality estimates, not geocoded
  points (12 exact as of the 2026-08-14 import, 81 `locality`). Every
  `phone_verified_at` is `NULL` (nobody has called these numbers), and
  every `locality` row's `distanceM` is `null` by contract rather than a
  confident 0 m. See [VET-DATA-INTAKE.md](VET-DATA-INTAKE.md); this is the gap
  the incoming government vet database is meant to close. Those counts are the
  2026-08 import. From 2026-09 the list is refreshed monthly from a CSV of
  details confirmed with each provider (`import-care.ts`, `care-import.yml`),
  which sets `phone_verified_at` to the date the row was confirmed; until the
  first monthly file is applied, the numbers above stand. Only rows with a real
  point get a pin on the map.
- The four databases on the old box were **`SQL_ASCII` / `C` collation**,
  which bites Devanagari dog or feeder names on ordering and case-folding.
  Supabase, now production, has not been re-checked here; check `\l` on the
  project before relying on non-Latin sorting. Changing collation is a
  dump-and-restore, so it is recorded rather than fixed.
- **In production the API connects to Supabase as the project's `postgres`
  user** (`PGUSER=postgres.<ref>`, written by `deploy.yml`), not as `app_user`.
  The `app_user` REVOKEs that CI and the tests reproduce therefore do not bind
  the live API, and INVARIANT 8 there rests on the `BEFORE UPDATE OR DELETE`
  trigger in `ops/supabase/03_hardening.sql`, which is not a migration. Check
  that the trigger exists on the live project rather than assuming it.
- **No backup job runs for the room.** The restic and `pg_dump` timers in
  `ops/backup` and `ops/systemd` belonged to the old box and its local database.
  Production data is in Supabase (whatever the project's plan backs up, which
  is not verified here), and uploaded photos in `/srv/hetja/photos` are not
  backed up at all.
- **The daily ledger anchor is unsigned in the room.** `deploy.yml` writes no
  `HETJA_LEDGER_SIGNING_JWK`, so anchors publish unsigned: degraded, but honest.
- **The SOS sent screen does not say how many people were told.** The mock's
  "3 of Bruno's feeders and 1 vet" needs counts the API does not return, so the
  screen says the dog's feeders and a vet nearby "are being told" and nothing
  more precise.
- **A feeder's home ward does not drive paging yet.** The map's "Get alerts for
  {ward} ward" stores the ward and turns SOS paging on, but the fan-out still
  selects responders by recent feeds within 2 km of the dog.
- `DEVICE_POW_DIFFICULTY` is **16**, capped at 20. It went 14 → 18 on 2026-08-13 (enhancement stack Phase 0 #6) and 18 → 16 on 2026-08-14, which needs explaining because it reads like a retreat.

  ALTCHA encodes difficulty as a hex key prefix, and a hex digit is 4 bits, so the configured number rounds **up** to a nibble boundary. 18 therefore meant **20** effective bits, ~2^20 ≈ 1.05M expected hashes, not the ~2^18 it looks like. The `apps/scan` solver could not finish that inside its own 20-second budget: measured 4/10 solves on a dev laptop, and a ₹8,000 Android is slower. When it fails, `getDeviceToken()` returns undefined, the SOS report 401s, and the stranger standing over a hurt dog is told to phone instead: the exact degrade the module exists to prevent. 16 lands on 16 exactly and solves 25/25 in about a second.

  Two measurements are worth recording because they change how much the number matters. First, hashing was never the bottleneck: the old solver yielded with `setTimeout(0)` after every 48-hash batch, and the browser's 4 ms clamp on nested timers made the *yields* ~90% of the wall clock (0.009 ms/hash of real work versus 0.32 ms/hash with the timer tax). That is fixed independently by yielding on a 16 ms wall-clock budget via `MessageChannel`, which is ~900× cheaper per yield. Second, the PoW is not what bounds abuse at either setting. A native `createHash` loop on this box does ~696k hashes/s, i.e. 1.5 s per token at 20 bits and 0.09 s at 16. What bounds abuse is INVARIANT 7's 2/day + 5/week cap per attested device, and that cap was **not being enforced at all** until 2026-08-14: Node's base64 decoder ignores non-alphabet characters, so `tok`, `tok=`, `tok==` and `tok!` all verified as the same device while counting as three different rate-limit subjects. One solve bought unlimited SOS budget at any difficulty. Treat the PoW as a throttle; the cap is the gate.

  Device challenges are ALTCHA v2 (HMAC-signed parameters) since 2026-08-14, and single-use across restarts since migration `0021` recorded spent challenges in the database.
- The git history still contains the old working title in commit messages.
  Rewriting it invalidates every SHA, so it happens once, last.

---

## 10. The rule underneath all of it

The system is allowed to know less than it wants to. It is not allowed to
*claim* more than it knows.

That is why a distance is `null` instead of `0`, why an uncalled phone number
is labelled unconfirmed instead of shown plainly, why the scan page stopped
advertising a camera it did not have, and why the API refuses to start rather
than pretend to send an email. Every one of those was a bug where the software
looked like it was working. On a system whose failure mode is a dog dying
untreated, looking like it works is the most dangerous state available.

The fifteen [invariants](INVARIANTS.md) are the codified version of that, and
several of them are enforced by CI rather than by good intentions.
