# Hetja

*Hetja* is Icelandic for **hero**. Not the metaphorical kind — the literal kind:
someone who acts with courage when they have nothing to gain and everything to
lose.

It is also the name given, far too late, to a stray dog that walked three
kilometres through the rain behind a frightened child, barking down every wild
dog on the road, and was poisoned years later. It had no tag. Nobody had written
down that it existed. [That story is here](docs/design/MEMORIAL-CONTENT.md), and
it is the reason this repository exists.

Hetja is city-scale infrastructure for keeping street dogs alive: a QR collar
tag, a public scan page that works on any phone with no install, a geofenced SOS
network, and a tamper-evident medical ledger.

> No stray sleeps hungry, lives in untreated pain, or dies without emergency care.

## Open source, and staying that way

A system that holds a register of every stray dog in a city should not be a black
box, and it should not be owned.

Anyone can read the code that decides how a dog's location is coarsened, how an
emergency is escalated, and what a stranger is allowed to see. If we get any of
that wrong, someone outside this project should be able to prove it. The
[invariants](docs/INVARIANTS.md) are not marketing — they are commitments, and
publishing the code is what turns a commitment into something auditable instead
of something you have to take on trust.

It also means this does not die with us. If the funding stops or the servers go
dark, the schema, the invariants and the trust engine can be picked up and run by
someone else in another city, without asking permission.

Fork it. Run it in your city. Tell us what we got wrong.

## What's here

```
apps/
  scan/     the public collar landing — static HTML + vanilla TS, <40 KB gzipped
  web/      the feeder PWA — Next.js 14 App Router
  api/      Fastify gateway
  worker/   job queue: SOS fan-out, escalation, retention
  ai/       Python: photo validation, re-identification (Phase 2)
packages/
  db/       migrations, seed, connection pool
  contracts/  zod schemas shared client ↔ server
  ledger/   hash-chain + daily anchor
  design/   design tokens — one source of truth for both surfaces
docs/
  queries/  every documented SQL query, EXPLAIN-checked in CI
ops/        bootstrap, systemd units, Caddy, Supabase migration, runbook
```

The public scan page is deliberately framework-free. A citizen standing over an
injured dog on 4G gets served static HTML under a hard 40 KB gzipped budget,
enforced in CI — a framework runtime alone would exceed it.

## Running it

**[AGENTS.md](AGENTS.md) is the authoritative setup guide**, written so a coding
agent on a fresh Ubuntu box can bring the whole stack up unattended. The database
is managed Postgres, so there is no PostGIS or pgvector to install locally.

```sh
git clone <this repo> && cd hetja
./ops/bootstrap.sh
```

## Design

Swiss wayfinding, not editorial minimalism — the references are Otl Aicher's
Munich 1972 signage and Vignelli's NYC subway diagram. A stranger navigating an
unfamiliar system under stress is a signage problem: fixed vocabulary, one
decision per surface, information ranked by consequence. Inter on white, one
accent colour reserved for emergencies, structure from hairlines rather than
shadows.

Tokens live in `packages/design/tokens.css` and are consumed by both surfaces.
Rationale in [docs/design/HETJA-DESIGN.md](docs/design/HETJA-DESIGN.md).

## Specification

Fifteen numbered invariants (fourteen from the original build guide, one
added during implementation) encode decisions that must not regress —
random slugs, ward-level coordinates for anonymous reads, HMAC'd phone
numbers, offline conflict resolution on `captured_at`, ledger chaining from
the first migration. Several are enforced by CI gates rather than
convention. See [docs/INVARIANTS.md](docs/INVARIANTS.md) for the full list
and the reasoning behind each one.

The product's original working title has been fully renamed out of the
codebase -- package names, env vars, storage keys, systemd units, the repo
path and the database all read Hetja now.

## Licence

[GNU AGPL-3.0](LICENSE).

Chosen deliberately over a permissive licence. Anyone may use, modify and run
Hetja — but anyone who runs a *modified* version as a network service must publish
their changes. That is what makes the promises in this README checkable rather
than merely stated: every deployment's geo-coarsening, escalation logic and
anonymous-read surface stays inspectable, including deployments we do not control.

A consequence worth knowing if you fork this: **AGPL section 13 requires that
remote users of a network-facing instance be offered its source.** Both public
surfaces therefore carry a "Source" link in the footer, and if you deploy a
modified Hetja you must point that link at *your* source, not ours.

## Contributing

The most useful contributions right now are not code:

- **Verifying phone numbers.** The care directory ships ~25 Mumbai NGO and
  hospital numbers marked unverified. Volunteer-run numbers change often, and a
  number nobody has called must never be presented as confirmed.
- **First-aid copy review by a practising vet.** The holding-instruction cards
  are built but disabled until a qualified person signs off. Wrong first-aid
  advice in an emergency causes harm.
- **Ward-level geocoding** for directory entries currently marked `TODO: geocode`.

For code, the invariants are the contract. If a change touches geo precision,
phone handling, the ledger, or anonymous write paths, expect the security gate in
CI to argue with you — that is the gate working.
