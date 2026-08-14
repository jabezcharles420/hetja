# Hetja — what it is, and how it actually works

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

A street dog wears a collar with a QR code. Anyone who finds the dog — no app,
no account, no login — scans it with their phone's camera and gets a page that
tells them who this dog is, whether it is vaccinated, who feeds it, and a single
large button for "this dog is hurt". Pressing that button puts the nearest
vets, NGOs and ambulances on their screen with tappable phone numbers, and
simultaneously wakes up the people nearby who have said they will help.

Everything else in the repository exists to make those two screens true.

---

## 2. The people involved

Hetja has four kinds of user, and they do not share an interface. That
separation is deliberate — see §4.

**The stranger.** Someone who happens to find a dog. They are the only user who
matters at the moment of an emergency, they will never install anything, they
may be panicking, and they may be on a bad connection on a Mumbai street. They
get one page, no account, and are never asked to sign in. Ninety percent of all
traffic is this person.

**The feeder.** Someone who feeds and watches over specific dogs in their area.
They sign in (emailed code — no passwords, no SMS), log feeds, upload photos,
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

## 3. The two flows that matter

### 3.1 Scan

A collar's QR encodes a URL:

```
https://hetja.in/d/<slug>?s=<signature>
```

`slug` is nine characters from a deliberately reduced alphabet
(`[a-km-z2-9]` — no `l`, no `0`, no `1`) so a human can read one off a collar
and type it in without ambiguity. It is **random**, not sequential: you cannot
enumerate the city's dogs by counting upward (INVARIANT 1).

`s` is `base64url(HMAC-SHA256(qr_secret, slug))`. The server recomputes it and
refuses to resolve a slug whose signature doesn't match, which means a printed
collar cannot be forged and a scraper cannot fabricate valid URLs. The secret
lives only in the server's environment and in one row of the database — never
in any client bundle.

Two paths reach that URL, and both work:

- **The phone's own camera app.** This is the normal path and requires nothing
  from us. iOS Camera and Android's viewfinder both recognise a QR and offer to
  open the link.
- **In-page, from hetja.in itself.** `apps/web/components/QrScanner.tsx` uses
  the browser's built-in `BarcodeDetector` behind an explicit "Use camera"
  button. It never requests the camera on page load — an unprompted permission
  dialog is how you teach people to hit "Deny". Where the browser has no
  `BarcodeDetector`, or permission is denied, or there is no camera, it falls
  through to manual slug entry and says which of those happened rather than
  showing a broken viewfinder.

The page that opens shows the dog's name and photo, sterilisation and
vaccination status, last-seen date, and its story. What it deliberately does
**not** show is the dog's exact location or the feeder's phone number
(INVARIANTs 2 and 3). Locations are coarsened to a ward-level cell before they
reach an anonymous viewer, because a precise live location for a street dog is
a targeting tool for anyone who wants to hurt it, and there are such people.

### 3.2 Danger

On the scan page there is one primary action: the dog is hurt. Pressing it does
two independent things, and neither waits for the other.

**It shows the caller who to phone, immediately.** `GET /api/v1/care` returns
up to eight nearby providers — free NGOs, government facilities, charity
hospitals, and paid clinics — each with a tappable number, whether they have an
ambulance, whether they are open 24×7, and what they cost. This is a read-only
public directory: it works with no login, no device token and no network round
trips beyond the one request, because in an emergency the fastest useful thing
is a phone number.

The ordering is the interesting part. Providers with genuinely geocoded
coordinates come first, sorted by true distance. Providers whose coordinates
are only a locality-centroid estimate come after, and are sorted by
**has_ambulance → cost_tier (free before subsidised before paid) → open 24×7 →
name** rather than by distance. Distance is omitted entirely for those rows and
a place name is shown instead.

That is not fussiness. Twenty-five of the seeded Mumbai organisations collapse
onto eighteen distinct coordinates, because they were estimated from ward
centroids rather than geocoded from addresses. Sorting by that distance
produced a confident-looking "BHL Bird Helpline — 0 m away". Someone reading
that skips a hospital that is actually closer. `distanceM` is now `null`
unless the coordinate is real, and the API states which contract applies via
`geoPrecision`. **A measurement we don't have is not reported as zero.**

Phone numbers carry the same honesty rule. `phone_verified_at` is surfaced to
the client, not collapsed into a boolean, so a number nobody has ever called is
shown *as unconfirmed* rather than either hidden or presented as fact. About
thirty of the seeded NGO numbers are still `NULL` here. Someone has to pick up
a phone and call them; there is no way to shortcut that.

**It opens an SOS case.** In parallel, `POST /api/v1/sos/report` creates a
case and the worker fans out push notifications to responders whose geofence
contains the dog — rate-capped, because an unauthenticated endpoint that can
notify unbounded numbers of people is a harassment vector (INVARIANT 7). If no
eligible responder exists, it escalates to tier 2 immediately rather than
waiting out a timer. Otherwise an unacknowledged case escalates after eight
minutes.

`POST /api/v1/sos/cases/:id/ack` claims a case. It is a conditional update
(`WHERE acked_by IS NULL`), so the first writer wins atomically and everyone
else gets a 409 and a stand-down. This is what makes the programme's headline
metric — median acknowledgement under five minutes — measurable at all.

---

## 4. The four apps, and why they are separate

```
apps/
  scan     vanilla TypeScript, no framework      -> hetja.in/d/<slug>
  web      Next.js 14 App Router                 -> hetja.in
  api      Fastify 5 + zod                       -> hetja.in/api/v1
  worker   background jobs (SOS fan-out, escalation, push)
  shell    native wrapper — EMPTY, not built
  ai       vision/embedding helpers
packages/
  contracts  zod schemas shared by API and clients — the single source of truth
  db         pool, migrations, slug generation and signing
  design     tokens.css — the Swiss/Inter/white design system
  ledger     hash-chained append-only medical ledger
```

The split is about failure domains, not tidiness.

`apps/scan` is the life-safety surface. It is plain TypeScript with zero
dependencies, held under a **40 KB gzipped CI budget** that fails the build if
exceeded, because the person using it is on a phone on a street and every
kilobyte is a second. It must not share a deployment with anything else, so a
bad release of an admin feature cannot take down the page a stranger needs.

`apps/web` is everything a logged-in feeder does — richer, heavier, and allowed
to be. `/hetja` is the memorial page. `/privacy` is a DPDP notice and is
treated as a factual document: when the login moved from phone to email, that
page had to change in the same commit, because a privacy notice that describes
storage you no longer do is simply false.

`apps/field`, the tagger portal, is **designed but not built**. It needs
`POST /api/v1/dogs` and a retag route, neither of which exists yet. Access
there will be gated on `feeder_role` (`admin`/`vet`/`bmc_officer`), not on trust
score — the trust ≥ 50 gate is roughly forty-five scans of tenure, which would
lock out the pilot staff who have to retag on day one.

---

## 5. Data

Eighteen tables in PostgreSQL 16, with PostGIS for geography and pgvector for
image embeddings. The ones to know:

| Table | What it holds |
|---|---|
| `dogs`, `collars` | the register; a collar binds a slug to a dog |
| `scans` | every resolution of a slug, coarsened |
| `feeders` | accounts; identified by `identity_hmac`, never a raw address |
| `medical_records` | append-only, hash-chained treatment ledger |
| `sos_cases`, `sos_notifications` | the case machine and its delivery receipts |
| `care_providers` | the public vets/NGO directory behind the danger flow |
| `vets` | *contracted* partner clinics — signing keys, MOUs, retainers |
| `geofences`, `feeder_territories` | who gets woken for what |
| `trust_events` | the audit trail behind every trust score |
| `otp_codes`, `push_subscriptions` | login codes and push endpoints |

Two of those distinctions carry weight.

**`care_providers` is not `vets`.** `vets` is a contractual registry: it has
`signing_key_pub NOT NULL`, `mou_signed_at`, `retainer_paise`. Those columns
are meaningless for an NGO we have no relationship with and merely *list*. So
listing lives in its own table, with one optional bridge (`vet_id`) for the
case where a listed provider also happens to be a contracted partner.

**`medical_records` is append-only, and enforced twice.** On the self-hosted
database, `UPDATE` and `DELETE` are revoked from the application role. On
Supabase, where no such role exists, a `BEFORE UPDATE OR DELETE` trigger blocks
it for *every* role including the owner. Each record carries the hash of the
previous one, so an altered history fails verification even if someone gets
write access to the table (INVARIANT 9). A dog's treatment history is evidence
in a cruelty case; it has to be worth something in front of someone who doesn't
trust us.

---

## 6. Auth, and why there is no SMS

Login is a six-digit code emailed to the feeder. No passwords, no phone
numbers, no SMS — SMS costs money per message, and this has to run on nothing.
Email goes out via Brevo's permanent free tier (300/day) from
`no-reply@hetja.in`, with SPF, DKIM and DMARC on the domain so it lands in
inboxes rather than spam.

Codes live in Postgres, hashed (`SHA-256(pepper:code)`), with a five-minute TTL
and three attempts. They used to live in an in-memory `Map`, which lost every
pending code on restart and could not work with more than one process. In
production the API now **refuses to boot** without SMTP credentials rather than
starting up and silently sending nothing — which was the original bug, and the
kind that surfaces only when a real person cannot log in.

Contact information is never stored raw. `identity_hmac` is
HMAC-SHA256 of the address under a server-held pepper (INVARIANT 3). Not a bare
hash — an email address has little enough entropy that a plain SHA-256 of it is
reversible with a wordlist.

Anonymous clients that need to write (a stranger reporting an injury) get a
*device token* minted by `POST /api/v1/devices/challenge` + `/token` against an
ALTCHA v2 proof-of-work (an HMAC-signed, single-use challenge solved
client-side), so the write endpoints are not open to trivial scripted abuse
without demanding an account from someone standing next to a bleeding dog.

---

## 7. Where it runs

```
phone ──https──> Cloudflare edge ──tunnel──> cloudflared ──> Caddy :80
                                                              ├── /api/v1/*  -> hetja-api    :8080
                                                              ├── /d/*       -> hetja-scan   :8081
                                                              └── /*         -> hetja-web    :3000
                                                                              hetja-worker (no port)
```

The box is a small OVH VPS behind NAT with **no inbound ports open**.
`cloudflared` dials *out* to Cloudflare and traffic comes back down that
tunnel, so hetja.in works without a public web port, and Cloudflare terminates
TLS. Caddy runs with `auto_https off` because it is behind the tunnel and must
not try to obtain its own certificate.

`hetja.in` is registered at Dynadot with its nameservers pointed at Cloudflare.

cloudflared terminates the tunnel on the box itself, so connections reach Caddy
from loopback. Caddy rewrites `CF-Connecting-IP` into `X-Forwarded-For` (the
`real_ip` snippet, with `trusted_proxies cloudflare` via the
`caddy-cloudflare-ip` module) so the API's per-IP rate limits see the stranger's
real address instead of capping the whole city as one IP — verified live
2026-08-14, guarded by `ops/check-caddy-cache.sh` in CI. See
`ops/caddy/HOSTING.md` for the tunnel setup.

The authoritative database is PostgreSQL on that same box. A Supabase project
in Mumbai (`mipvvlrzovevmjzlyxfr`) holds a hardened mirror — RLS on, exact
coordinates unreachable from the anon key, writes only through
`SECURITY DEFINER` RPCs that check the slug signature. It is not currently
serving reads; the plan is to repoint after the VPS itself moves to India, so
the app and its database are not on opposite sides of the planet.

Four systemd units (`hetja-api`, `hetja-web`, `hetja-worker`, `hetja-scan`)
keep things alive. They exist because the web app was previously running inside
a background worker's cgroup and got SIGKILLed along with it — an outage with
no error message anywhere.

---

## 8. Getting code from a laptop into production

Push to `main`. That is the intended interface, and mostly it is the real one.

```
git push ──> GitHub Actions
              ├── CI gates ────── typecheck · tests (ephemeral Postgres+PostGIS)
              │                   security-gate.sh · check-queries.sh · 40 KB size gate
              │                   destructive-migration gate
              └── on green ────── build web + scan ON THE RUNNER
                                  rsync -> /srv/hetja/releases/<ts>-<sha>/
                                  flip the `current` symlink, restart, health-check
                                  auto-rollback if health fails
```

Builds are split by cost. `next build` needs about a gigabyte, and running it
next to the live services is what OOM-killed them before, so **web and scan are
built on the runner** and the box receives finished bundles. **`api` and
`worker` are plain `tsc`** — seconds, negligible memory — and they run from the
git checkout rather than a release directory, so `deploy-remote.sh` resets that
checkout to the exact deployed SHA and builds them there.

That second half was missing for a while, and it is worth knowing why it went
unnoticed: the pipeline shipped web and scan, restarted all four units, and
reported success, while `hetja-api` kept executing whatever stale `dist/`
happened to be in the checkout. Everything was green. An API-only commit simply
never arrived. There is now an explicit post-deploy assertion that the
checkout's `HEAD` equals the deployed SHA, because a health check proves the API
*answers* — not that it is answering from this commit.

Three gates are worth naming because they say no to real things:

- **The destructive-migration gate** fails the build if a migration contains
  `DROP TABLE`, `TRUNCATE`, `DELETE FROM` and so on without an explicit
  `-- MIGRATION-APPROVED: <reason>` marker. It matches destructive *statements*,
  not the mere appearance of the words, so `ON DELETE CASCADE`, `DROP DEFAULT`
  and `GRANT … DELETE` don't trip it — a gate that cries wolf teaches people to
  paste the approval marker reflexively, and then it protects nothing.
- **`ops/security-gate.sh`** refuses code that returns raw coordinates to
  anonymous callers or adds a bare `phone`/`email` column.
- **The 40 KB budget** on `apps/scan`.

Migrations go to **two** databases: the pipeline applies them to Supabase, and
`deploy-remote.sh` applies them to the live PostgreSQL on the box before
restarting anything. The second half was missing at first, which was the more
dangerous of the two deploy gaps — the API reads the local database, so a new
migration reached the Supabase copy that currently serves nothing and never
reached the one being queried. Migrations run as `postgres`, never as
`app_user`, because the creating role owns what it creates and an owner's rights
cannot be revoked; see [the runbook](../ops/RUNBOOK.md) for the mechanism.

Rollback is automatic for code and **not** for schema. If the health ladder
fails, `current` flips back to the previous release *and* the checkout resets to
the previous SHA and rebuilds — both halves or neither, because rolling back
only the front end while leaving a broken API running produces a failed re-check
for a reason that has nothing to do with the rollback. An applied migration
stays applied. That is safe only because the destructive gate keeps unattended
changes additive, and additive changes are backward compatible with the code
being rolled back to.

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
doesn't end in `_test` — `medical_records` is append-only, so rows written
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

Then apply migrations and run the suite:

```bash
export PGHOST=127.0.0.1 PGPORT=55432 PGDATABASE=hetja_test \
       PGUSER=postgres PGPASSWORD=hetja_dev_2026
pnpm --filter @hetja/db migrate
pnpm -r test
```

One non-obvious thing if you build the database by hand: **migrations must be
applied as a superuser, so `postgres` owns the tables**, exactly as in
production. If `app_user` owns them instead, `0001_init.sql`'s
`REVOKE UPDATE, DELETE ON medical_records FROM app_user` strips the owner's own
rights, and the referential-integrity trigger behind `DELETE FROM dogs` then
fails as that owner — 48 test failures with nothing obviously wrong. This cost a
day in CI.

`ops/bootstrap.sh` does all of the above on a **Linux** host, and
[AGENTS.md](../AGENTS.md) is the instruction set for handing this repository to
an agent on a new machine and having it come up unattended. Neither is written
for macOS.

---

## 9. What is deliberately not finished

- `apps/field`, the tagger portal, plus `POST /dogs` and the retag route.
- `apps/shell` — the native wrapper. iOS requires add-to-home-screen before Web
  Push works at all, so until this exists, iOS responders are not reliably
  reachable. The UI says so rather than implying a safety net that isn't there.
- The first-aid instruction card is behind `FIRST_AID_ENABLED=false` until a
  practising vet signs off the wording. Bad first-aid advice given to a
  frightened stranger can kill a dog faster than doing nothing.
- ~30 `care_providers` phone numbers are unverified.
- Most `care_providers` coordinates are locality estimates, not geocoded
  points. See [VET-DATA-INTAKE.md](VET-DATA-INTAKE.md) — this is the gap the
  incoming government vet database is meant to close.
- `DEVICE_POW_DIFFICULTY` is **16**, capped at 20. It went 14 → 18 on 2026-08-13 (enhancement stack Phase 0 #6) and 18 → 16 on 2026-08-14, which needs explaining because it reads like a retreat.

  ALTCHA encodes difficulty as a hex key prefix, and a hex digit is 4 bits — so the configured number rounds **up** to a nibble boundary. 18 therefore meant **20** effective bits, ~2^20 ≈ 1.05M expected hashes, not the ~2^18 it looks like. The `apps/scan` solver could not finish that inside its own 20-second budget: measured 4/10 solves on a dev laptop, and a ₹8,000 Android is slower. When it fails, `getDeviceToken()` returns undefined, the SOS report 401s, and the stranger standing over a hurt dog is told to phone instead — the exact degrade the module exists to prevent. 16 lands on 16 exactly and solves 25/25 in about a second.

  Two measurements are worth recording because they change how much the number matters. First, hashing was never the bottleneck: the old solver yielded with `setTimeout(0)` after every 48-hash batch, and the browser's 4 ms clamp on nested timers made the *yields* ~90% of the wall clock (0.009 ms/hash of real work versus 0.32 ms/hash with the timer tax). That is fixed independently by yielding on a 16 ms wall-clock budget via `MessageChannel`, which is ~900× cheaper per yield. Second, the PoW is not what bounds abuse at either setting — a native `createHash` loop on this box does ~696k hashes/s, i.e. 1.5 s per token at 20 bits and 0.09 s at 16. What bounds abuse is INVARIANT 7's 2/day + 5/week cap per attested device, and that cap was **not being enforced at all** until 2026-08-14: Node's base64 decoder ignores non-alphabet characters, so `tok`, `tok=`, `tok==` and `tok!` all verified as the same device while counting as three different rate-limit subjects. One solve bought unlimited SOS budget at any difficulty. Treat the PoW as a throttle; the cap is the gate.

  Device challenges are ALTCHA v2 (HMAC-signed parameters, single-use per process lifetime) since 2026-08-14.
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
