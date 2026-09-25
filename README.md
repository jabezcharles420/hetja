# Hetja

*Hetja* is Icelandic for **hero**. Not the metaphorical kind. The literal kind:
someone who acts with courage when they have nothing to gain and everything to
lose.

It is also the name given, far too late, to a stray dog that walked three
kilometres through the rain behind a frightened child, barking down every wild
dog on the road, and was poisoned years later. It had no tag. Nobody had written
down that it existed. [That story is here](docs/design/MEMORIAL-CONTENT.md), and
it is the reason this repository exists.

Hetja is city-scale infrastructure for keeping street dogs alive: a QR collar
tag, a public scan page that works on any phone with no install, a geofenced SOS
network, a ward-level map of Mumbai, and a tamper-evident medical ledger.

> No stray sleeps hungry, lives in untreated pain, or dies without emergency care.

## Open source, and staying that way

A system that holds a register of every stray dog in a city should not be a black
box, and it should not be owned.

Anyone can read the code that decides how a dog's location is coarsened, how an
emergency is escalated, and what a stranger is allowed to see. If we get any of
that wrong, someone outside this project should be able to prove it. The
[invariants](docs/INVARIANTS.md) are not marketing; they are commitments, and
publishing the code is what turns a commitment into something auditable instead
of something you have to take on trust.

It also means this does not die with us. If the funding stops or the servers go
dark, the schema, the invariants and the trust engine can be picked up and run by
someone else in another city, without asking permission.

Fork it. Run it in your city. Tell us what we got wrong.

## What it does today

Every screen below is built to the Claude Design handoffs (v4, then v5 and
v6 on top of it; see Design). The app has four tabs, **Home, Map, Scan, Me**.
On a desktop wider than 744 px the app is an invitation instead: "Hetja lives
on your phone", with a QR to open the same page there.

- **Scan** (`/scan`). The camera opens by itself and a found QR opens the dog.
  After six seconds without a read it offers three ways on: type the code,
  find the dog by ward and photo, or **Dog is hurt · Send SOS anyway**. Typing
  forgives the usual slips (0 for O, 1 or l for I), works with only some of
  the letters, and a near miss asks "Is it her?" with the dog's photo instead
  of a dead end. **Find by ward and photo** (`/scan/find`) shows the ward's
  collared dogs, narrowed by coat colour.
- **The collar page** (`/d/<code>`). What a stranger sees after pointing their
  phone's own camera at a collar: photo (or the dog's initial), name, ward,
  vaccinated and sterilised status (only what a vet has recorded; "unknown"
  otherwise, never a guessed "no"), the first names of the dog's feeders
  (each can opt out), the story they wrote, the collar code with Copy, and
  one red button, **{Name} needs help**, which works before the page has
  finished loading. A saved copy still opens offline. A dog nobody has
  vouched for yet says Unverified; a tag someone reported as being on the
  wrong dog says so; a dog that has died keeps a quiet memorial page. **Report
  a tag problem** (damaged, found on the ground, wrong dog, too tight) tells
  the dog's feeders.
- **SOS**. Three choices ("Hurt, but moving", "Can't get up, or bleeding",
  "Something else"), an optional note or photo, then send. No account. The
  location is asked for once, in words, before the browser asks. The reporter
  then follows the case on the same screen: who was told, "Priya is on the
  way", three first-aid lines while they wait, a way to send the responder an
  update or say "I had to leave", and the outcome (taken to a vet, treated on
  the spot, not found, or died). Tappable numbers for vets and NGOs are there
  throughout (confirmed numbers only; see Contributing); with no signal the message is written for the phone's own SMS
  app. Nobody's personal number is ever shown.
- **An SOS with no known dog.** An unknown or unreadable collar still gets an
  SOS: it needs the reporter's location, works in Mumbai only, and is located
  to the ward; a "Can't get up, or bleeding" report pages that ward's feeders
  and every report escalates to the nearest vets. Its limits are tighter than
  for a report about a known dog.
- **The responder's SOS page** (`/sos/<case>`). Where a push lands: the dog,
  the ward, how far away, when it escalates, and **I'm going** (or "I can't go
  right now"). The exact spot unlocks only after taking the case, with
  directions; then "Tell the reporter you're close", "With Rani", "I can't
  make it after all" (which hands the case back and pages again), and how it
  ended.
- **Log a feed** (`/feed`). For signed-in feeders: one dog, or several from a
  round in one go; optional photo, optional "How did it go?" (Ate it all, Ate
  a little, Didn't eat, Looks unwell) and a note. "Looks unwell" can tell the
  dog's other feeders; it suggests an SOS and never raises one by itself.
  Works offline and sends when the phone is back online.
- **Sign in** (`/login`). Email, then a six-digit code that works for five
  minutes. No password, no SMS. A first sign-in goes to **Become a feeder**
  (`/welcome`): your shown name, your wards, SOS alerts and quiet hours.
- **Me** (`/me`). Signed out, what signing in unlocks. Signed in: streak,
  trust, your dogs, a checklist on day one, and rows for My dogs, Alerts (with
  an unread count), the SOS alerts switch (turning it off offers a pause),
  Register a dog and Settings. **Alerts** (`/alerts`) lists the last 14 days.
  **Settings** (`/settings`): name, wards, alerts (SOS only or all, quiet
  hours, pause), "Show my first name on dogs' pages", download my data, sign
  out, delete my account.
- **My dogs** (`/me/dogs`). Every dog you registered or fed in 60 days, what
  needs doing first, and other people's new dogs you can confirm. Each dog has
  a private week view, a story to write, a tag page (reprint, spare, history)
  and **Update on a dog**: not seen, adopted, or passed away (which a second
  feeder confirms).
- **Register a dog and print its tag** (`/register`). A face photo, a
  duplicate check in the ward, name and markings, confirm; then the code and
  its QR, and a print screen that builds a real PDF in the browser (ten small
  tags and a collar band, or one large tag and a wall notice, A4 or Letter),
  shares it with a print shop, or gives the 40 mm laser sheet for etched TPU.
  A batch sheet takes up to eight dogs. Scanning the tag once, next to the
  dog, switches it on; a wrong tag is caught and named. At most two dogs wait
  for their collars at a time.
- **Vet checkup** (`/vet/<code>`, vet accounts). Rabies, sterilisation, next
  vaccine due, a note for feeders; written to the tamper-evident ledger, and
  it verifies the dog.
- **Map** (`/map`). All of Mumbai by ward: which wards have a dog that needs
  help, which are waiting for dinner, who has not been logged today, and the
  vets and NGOs nearby, with "open now" where the hours say so. Dogs are
  counted per ward, never placed on a street.
- **Marketing and reading pages**: Home, About, How it works, FAQ, Privacy,
  Contact, and `/hetja`, the memorial. English only for now: Hindi and
  Marathi wait for human translations.

What is designed but not finished is listed plainly in
[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) §9.

## What's here

```
apps/
  scan/     the public collar page + SOS: static HTML + vanilla TS, <40 KB gzipped
  web/      everything else: Next.js 14 App Router (PWA)
  api/      Fastify 5 + zod, /api/v1/*
  worker/   job queue: SOS fan-out, escalation, retention, registration expiry
  ai/       Python: photo validation, re-identification (Phase 2)
packages/
  db/       migrations, seed, care-directory importers, connection pool
  contracts/  zod schemas and ward data shared client <-> server
  ledger/   hash chain + daily anchor for medical records
  design/   tokens.css: the design v4 tokens, one source for both surfaces
  pow/      ALTCHA proof-of-work solver for anonymous device tokens
docs/
  queries/  every documented SQL query, EXPLAIN-checked in CI
ops/        the shared-box room (ops/room), Caddy, gates, Supabase, runbook
```

The collar page is deliberately framework-free. A citizen standing over an
injured dog on 4G gets served static HTML under a hard 40 KB gzipped budget,
enforced in CI; a framework runtime alone would exceed it. It is 39,101 bytes
of its 40,960 today, 11.2 KB of which is a small Inter subset for Android. The
v6 screens paid for themselves with three cuts: the HTML is minified at build
time, 20 rarely used ASCII symbols left the font subset, and the web-vitals
package gave way to the browser's own measurements.

## Architecture, briefly

The public site is `hetja.in` and the API also answers at `api.hetja.in`.
Caddy routes `/d/*` to the scan app, `/api/v1/*` to the API and everything
else to the web app; the worker has no port. The production database is
**Supabase** (PostgreSQL with PostGIS, pgvector and pgcrypto). Anonymous reads
never see a position finer than a ward, contact details are only ever stored
as an HMAC, and medical records are append-only and hash-chained. The long
version is [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Hosting, briefly

Hetja runs in a resource-capped "room" on a small shared box whose other
tenant, an autonomous agent, has priority: a systemd slice with hard CPU and
memory caps, an unprivileged `hetja` user, Caddy on loopback only, a Cloudflare
Tunnel as the only way in, and a memory guard that takes the whole site down
before it can crowd the agent. Pushing to `main` builds everything on a GitHub
runner, ships one tarball, flips a symlink, health-checks and rolls back on
failure. The contract and the commands are in
[ops/room/README.md](ops/room/README.md).

## Developing

You do not need a server. [AGENTS.md](AGENTS.md) is the full operating guide;
the short version:

```sh
pnpm install --frozen-lockfile
pnpm --filter @hetja/ledger build      # libraries first: consumers resolve
pnpm --filter @hetja/contracts build   # them through dist/, which is gitignored
pnpm --filter @hetja/db build

pnpm --filter @hetja/web dev           # the web app; talks to NEXT_PUBLIC_API_URL
                                       # (default http://localhost:8080)
pnpm --filter @hetja/api dev           # the API (needs a database, below)
pnpm --filter @hetja/scan start        # build and serve the collar page on :8081

pnpm -r typecheck
pnpm --filter @hetja/web test          # no database needed
bash ops/security-gate.sh
pnpm --filter @hetja/scan size:gate    # the 40 KB budget
```

The API, worker and db tests need a real **PostgreSQL 16 with PostGIS and
pgvector**, in a database whose name ends in `_test`. On Windows the simplest
route is WSL (Ubuntu 24.04); the recipe is in [AGENTS.md](AGENTS.md) §f.

## Design

Design v4 was made in Claude Design: an Apple product-page look for Mumbai's
street dogs, with bold tight headlines, a pink and peach aurora on marketing
pages, blue pill buttons, white rounded cards and a black privacy band. The
rules underneath are older than the look: one loud button per screen (blue,
or red for SOS only), colour never alone, 44px targets, and plain white fast
screens for the collar page and SOS.

Two more handoffs built on it without changing the look. **v5** audited the
live site and added the missing pages (become a feeder, alerts, settings, my
dogs, a vet's checkup, the SOS page for responders), registering and printing
a tag, and what happens when a tag breaks. **v6** polished every screen, gave
each dog's feeders a first name, followed an SOS through to its outcome, and
made desktop an invitation to use a phone.

Each handoff (spec, mocks, rendered boards) is kept in the repo:
[docs/design/v4-handoff/](docs/design/v4-handoff/README.md),
[docs/design/v5-handoff/](docs/design/v5-handoff/CONTRACT.md) and
[docs/design/v6-handoff/](docs/design/v6-handoff/CONTRACT.md); the v5 and v6
folders each carry a `CONTRACT.md` with the owner's decisions and every place
the build deliberately departs from a mock. The values live in
[packages/design/tokens.css](packages/design/tokens.css), the components in
`apps/web/components/ds`, and the rationale in
[docs/design/HETJA-DESIGN.md](docs/design/HETJA-DESIGN.md).

## Specification

Fifteen numbered invariants (fourteen from the original build guide, one
added during implementation) encode decisions that must not regress:
random slugs, ward-level coordinates for anonymous reads, HMAC'd contact
details, offline conflict resolution on `captured_at`, ledger chaining from
the first migration. Several are enforced by CI gates rather than
convention. See [docs/INVARIANTS.md](docs/INVARIANTS.md) for the full list
and the reasoning behind each one.

The product's original working title has been fully renamed out of the
codebase: package names, env vars, storage keys, systemd units, the repo
path and the database all read Hetja now.

## More

- [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md): what the system does and why.
- [docs/FEATURE-GUIDE.md](docs/FEATURE-GUIDE.md): every feature, screen by screen, and where its code lives.
- [AGENTS.md](AGENTS.md): how to work on it and how code reaches production.
- [ops/room/README.md](ops/room/README.md): hosting on the shared box.
- [docs/BUGS.md](docs/BUGS.md): the bug inventory, fixed and open.
- [docs/OWNER-TODO.md](docs/OWNER-TODO.md): decisions and account steps waiting on the maintainer.
- [docs/CREDITS.md](docs/CREDITS.md): what Hetja is built from, with licences.
- [docs/VET-DATA-INTAKE.md](docs/VET-DATA-INTAKE.md): how the vet and NGO list is kept.
- [docs/MAKING-A-COLLAR.md](docs/MAKING-A-COLLAR.md): the physical tag.
- [docs/design/MEMORIAL-CONTENT.md](docs/design/MEMORIAL-CONTENT.md): the dog Hetja is named for.

## Licence

[GNU AGPL-3.0](LICENSE).

Chosen deliberately over a permissive licence. Anyone may use, modify and run
Hetja, but anyone who runs a *modified* version as a network service must publish
their changes. That is what makes the promises in this README checkable rather
than merely stated: every deployment's geo-coarsening, escalation logic and
anonymous-read surface stays inspectable, including deployments we do not control.

A consequence worth knowing if you fork this: **AGPL section 13 requires that
remote users of a network-facing instance be offered its source.** Both public
surfaces therefore carry a "Source" link in the footer, and if you deploy a
modified Hetja you must point that link at *your* source, not ours.

## Contributing

The most useful contributions right now are not code:

- **Confirming phone numbers.** The vet and NGO list is Hetja's own list,
  refreshed monthly from a CSV of details confirmed with each provider
  ([docs/VET-DATA-INTAKE.md](docs/VET-DATA-INTAKE.md)). Most numbers are still
  unconfirmed. Volunteer-run numbers change often, and a number nobody has
  called must never be presented as confirmed.
- **First-aid copy review by a practising vet.** The three "While you wait"
  lines a reporter sees until help arrives now ship, by the owner's decision,
  exactly as designed. They still want a qualified person's review before
  launch. Wrong first-aid advice in an emergency causes harm.
- **Ward-level geocoding** for directory entries currently marked `TODO: geocode`.

For code, the invariants are the contract. If a change touches geo precision,
phone handling, the ledger, or anonymous write paths, expect the security gate in
CI to argue with you. That is the gate working.
