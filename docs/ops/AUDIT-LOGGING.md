# Database audit logging (pgaudit)

Enhancement stack §G.9 / Top-25 #11. This is the **DB-level audit floor**: it
records what actually happened inside PostgreSQL, independent of whether the
application chose to log it. It complements, and does not replace, the two audit
mechanisms Hetja already has:

| Layer | What it proves | Where |
|---|---|---|
| `medical_records` hash chain + Merkle root | a medical record was not altered or reordered after the fact | `packages/ledger`, INVARIANT 8/9/10 |
| pgaudit (this document) | every write, DDL and role change against the cluster, including ones made by a human with a `psql` prompt | PostgreSQL server log |
| a queryable `audit_log` table | application-level events you want to *search* (and be able to redact under a DPDP erasure request) | **not built** — see "What is still missing" |

The distinction matters. The hash chain is the strongest of the three and the
narrowest: it covers one table. pgaudit is the widest and the weakest: it is a
log file, so it proves nothing against an attacker who already has root on the
box — but it is exactly what answers "who ran the UPDATE that changed those
twelve rows on the 14th", which the chain cannot answer because the chain only
tells you *that* something no longer verifies.

## Why this is not a migration

`CREATE EXTENSION pgaudit;` looks like it belongs in `packages/db/migrations/`.
It must not go there.

CI runs migrations against the `postgis/postgis:16-3.4` service container
(`.github/workflows/ci.yml`), which does not ship `pgaudit.so`. A migration
containing `CREATE EXTENSION pgaudit` would fail every CI run, and the usual
workaround — `CREATE EXTENSION IF NOT EXISTS` wrapped in an exception handler —
would make the statement succeed while doing nothing, which is worse: the repo
would then claim an audit floor it does not have on any database. That is the
same class of mistake as migration `0013`'s conditionally-skipped CHECK
constraint, and as the restic timer that was documented but never installed.

pgaudit is also not a schema change. It needs `shared_preload_libraries`, which
needs a **full restart** of PostgreSQL — not a `reload`. That is a box
operation with a service interruption, so it belongs in a runbook where a human
reads it, not in an unattended deploy step.

## Install (Ubuntu 24.04, PostgreSQL 16)

```bash
apt-get install -y postgresql-16-pgaudit

# shared_preload_libraries requires a RESTART, not a reload. Everything that
# talks to this cluster drops its connections: the API, the worker, and any
# in-flight SOS write. Do this in a maintenance window, not while a
# sterilisation camp is uploading.
psql -c "ALTER SYSTEM SET shared_preload_libraries = 'pgaudit';"

# What to record. Deliberately NOT 'read': the collar-scan path is almost
# entirely reads, and logging them would multiply log volume by a large factor
# for information the application already has.
psql -c "ALTER SYSTEM SET pgaudit.log = 'write, ddl, role';"
psql -c "ALTER SYSTEM SET pgaudit.log_catalog = off;"      # skip pg_catalog noise
psql -c "ALTER SYSTEM SET pgaudit.log_relation = on;"      # one entry per relation touched
psql -c "ALTER SYSTEM SET pgaudit.log_statement_once = on;"

# Privacy: see the section below before changing this one.
psql -c "ALTER SYSTEM SET pgaudit.log_parameter = off;"

systemctl restart postgresql
psql -d hetja -c "CREATE EXTENSION IF NOT EXISTS pgaudit;"
psql -d hetja -c "SHOW shared_preload_libraries;"          # must list pgaudit
```

Apply the `CREATE EXTENSION` to `hetja`. Do **not** bother with the `_test`
databases — the suite creates and drops them, and auditing test writes is noise.

## `pgaudit.log_parameter = off` is a privacy decision, not a default

With `log_parameter = on`, pgaudit writes the bind parameters of every audited
statement into the server log. Work through what that actually captures here.

The login path is fine: `apps/api/src/lib/hmac.ts` computes
`identityHmac(email, pepper)` in the application, so the value that reaches SQL
is already an HMAC (INVARIANT 3 holds at the database boundary, not just in the
schema). An audit log full of `identity_hmac` values leaks nothing a database
dump would not.

These, however, arrive in the clear and would be copied into a plaintext log
file with no retention policy and no access control beyond filesystem
permissions:

- **`care_providers.phone_e164`** — a real phone number. Still plaintext at
  rest; field-level encryption (enhancement stack §G.5, `tweetnacl-js`) is the
  Top-25 item that would fix that and is not done.
- **Free-text user content** — SOS report `note` (up to 500 characters, written
  by an anonymous stranger), feeder-written dog stories, `display_name`.
- **Exact coordinates.** `routes/sos.ts` reads `dogs.last_seen_geo` at full
  precision on purpose, to size the responder radius. INVARIANT 2 governs what
  an anonymous caller *receives*; it does not stop a precise coordinate from
  being written into an audit log, and the rationale for INVARIANT 2 —
  "a precise last-seen point for a dog a feeder cares for is also, functionally,
  a precise location for that feeder" — applies to a log file just as much as to
  a response body.

So: `off`. You lose the ability to see exactly which values a rogue statement
wrote, and keep the fact that it wrote, when, to which relation, as whom. If a
specific investigation needs parameters, turn it on for that window
deliberately and turn it off afterwards, and note that the log then contains
personal data and falls under the same retention and erasure obligations as the
database.

## Log rotation is load-bearing, not housekeeping

pgaudit writes to the PostgreSQL server log. This box is a 2 GB VPS, and
`AGENTS.md` §g records that an unbounded process has already OOM-killed the live
services here once. The disk equivalent is just as real: **if audit logs fill
the disk, PostgreSQL stops accepting writes, and the SOS path stops working.**
An audit trail that takes down the life-safety path is a worse outcome than no
audit trail.

```bash
psql -c "ALTER SYSTEM SET logging_collector = on;"
psql -c "ALTER SYSTEM SET log_directory = 'log';"
psql -c "ALTER SYSTEM SET log_filename = 'postgresql-%Y-%m-%d.log';"
psql -c "ALTER SYSTEM SET log_rotation_age = '1d';"
psql -c "ALTER SYSTEM SET log_rotation_size = '64MB';"
psql -c "ALTER SYSTEM SET log_truncate_on_rotation = on;"
systemctl restart postgresql
```

Then bound the total, because rotation alone does not:

```bash
# Keep 30 days. Adjust once you have measured a week of real volume -- do not
# guess from this file.
cat >/etc/logrotate.d/hetja-pgaudit <<'CONF'
/var/lib/postgresql/16/main/log/postgresql-*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    nocreate
}
CONF
logrotate --debug /etc/logrotate.d/hetja-pgaudit     # dry run first
```

Add a disk-usage check to whatever watches this box. `ops/RUNBOOK.md`'s
monitoring section is the place for it.

## Verify it is actually on

```bash
psql -d hetja -c "SHOW shared_preload_libraries;"              # includes pgaudit
psql -d hetja -c "SELECT extname FROM pg_extension WHERE extname='pgaudit';"
psql -d hetja -c "CREATE TABLE _pgaudit_probe(x int); DROP TABLE _pgaudit_probe;"
tail -n 20 /var/lib/postgresql/16/main/log/postgresql-$(date +%F).log | grep AUDIT
```

If the last command prints nothing, pgaudit is installed but not recording, and
you have the worst of both worlds — the cost of the extension and the false
belief that you have an audit floor. The most common causes are a `reload`
instead of a `restart`, or `pgaudit.log` left unset.

## Backups

`ops/backup/restic-backup.sh` currently snapshots the nightly `pg_dump` plus
`.env.production` and the Caddy/PostgreSQL/systemd configs. It does **not**
include the PostgreSQL log directory, so audit logs are not backed up and do not
survive a box loss. That is a deliberate default rather than an oversight —
audit logs are large, compress poorly once rotated, and (per the parameter
discussion above) may contain personal data you would rather not ship to a third
party. If a compliance obligation ever requires retaining them off-box, add the
log directory to that script explicitly and revisit `pgaudit.log_parameter`
first.

## What is still missing

pgaudit is the floor, not the whole story. The enhancement stack (§G.9, §T.11)
also calls for a queryable, application-level `audit_log` table — every scan,
every feeder login, every API call — and is explicit about why it must **not**
be hash-chained: a DPDP erasure request requires redacting PII from an old row,
which a hash chain would prevent. The designed shape is a `redacted_fields`
JSONB column, a `redact_at` timestamp, and a scheduled job that nulls fields
past retention.

None of that is built. INVARIANT 11 (DPDP erasure) is marked `🔶 design` in
`docs/INVARIANTS.md` and this is the missing half of it.
