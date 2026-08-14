# wal-g PITR activation (enhancement stack §L.1, Phase 1 #6)

wal-g v3.0.8 is installed at `/usr/local/bin/wal-g` (PostgreSQL build).
It is **configured but dormant**: continuous archiving needs (a) R2
credentials and (b) one PostgreSQL restart. The interim restic job
(`ops/backup/restic-backup.sh`, daily 02:15 IST) already protects the
database with daily logical dumps, so nothing is unprotected while wal-g
waits.

## Step 1 — credentials (root only)

One file, `/root/.backup-env`, feeds **both** restic and wal-g. Create it with
mode `600` before anything else — `ops/backup/restic-backup.sh` refuses to run
without it, and `hetja-walg.service` loads it as its `EnvironmentFile`.

```bash
install -m 600 /dev/null /root/.backup-env
cat > /root/.backup-env <<'CONF'
# --- shared R2 credentials (Cloudflare R2 -> Manage API tokens -> Object Read & Write)
AWS_ACCESS_KEY_ID=<R2 Access Key ID>
AWS_SECRET_ACCESS_KEY=<R2 Secret Access Key>
# R2 is S3-compatible but has no regions. "auto" is required, not cosmetic:
# the AWS SDK refuses to sign a request with no region set.
AWS_DEFAULT_REGION=auto

# --- restic (encrypted file + pg_dump snapshots)
RESTIC_REPOSITORY=s3:https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>
RESTIC_PASSWORD_FILE=/root/.backup-env.restic-pw

# --- wal-g (WAL archiving + base backups for PITR)
WALG_S3_PREFIX=s3:https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/hetja-wal
CONF
```

Then the restic repository password. This is **the** thing to not lose: restic
encrypts client-side, which is the property that makes it safe to hand ciphertext
to Cloudflare — and it also means a lost password is a lost backup, with no
recovery path whatsoever.

```bash
openssl rand -base64 48 > /root/.backup-env.restic-pw
chmod 600 /root/.backup-env.restic-pw
# Store a copy somewhere that is NOT this box and NOT this R2 bucket.
# A backup whose password only exists on the machine it protects is decoration.
cat /root/.backup-env.restic-pw
```

`<ACCOUNT_ID>` is on the R2 overview page; `<bucket>` is a bucket you create
there. The free tier is 10 GB, which is ample for a `pg_dump` plus configs plus
WAL at pilot scale. Do **not** put `HETJA_HMAC_PEPPER`,
`HETJA_LEDGER_SIGNING_JWK` or any other KMS-held secret into the restic
fileset — the point of the pepper living outside the database is defeated if it
travels with the backup of that database.

Verify restic first, since it needs no PostgreSQL restart:

```bash
systemctl start hetja-restic.service     # runs it once, now
systemctl status hetja-restic.service    # must be "deactivating"/"inactive (dead)", not "failed"
set -a; . /root/.backup-env; set +a
restic snapshots                         # should list the snapshot just taken
```

A non-zero exit marks the unit failed on purpose: a backup that has been quietly
failing for a month is worse than none, because you believe you have one.

## Step 2 — enable archiving (one PG restart)

As root (ident `rootasdba`):

```sql
ALTER SYSTEM SET wal_level = replica;
ALTER SYSTEM SET archive_mode = on;
ALTER SYSTEM SET archive_command =
  'PGHOST=/var/run/postgresql PGUSER=postgres /usr/local/bin/wal-g wal-push "%p"';
ALTER SYSTEM SET archive_timeout = 60;
```

then `systemctl restart postgresql` (brief API outage — the deploy runbook
already treats restarts as routine). Verify:

```sql
SELECT * FROM pg_stat_archiver;
```

`archived_count` climbing = WAL is landing in R2.

## Step 3 — base backups

WAL alone restores nothing; it is replayed *on top of* a base backup. Take one by
hand first, then enable the timer.

```bash
# one-off, to confirm credentials and the data directory path
PGHOST=/var/run/postgresql PGUSER=postgres wal-g backup-push /var/lib/postgresql/16/main
wal-g backup-list                        # should show one entry

# recurring: every 6h, 00:40/06:40/12:40/18:40 IST (see the unit for why not hourly)
systemctl enable --now hetja-walg.timer
systemctl list-timers hetja-walg.timer   # confirm the next elapse
```

`ops/bootstrap.sh` installs `hetja-walg.{service,timer}` but deliberately does
**not** enable the timer, because base backups before step 2 would produce
backups with no WAL to replay. Enabling it is this step.

Note the unit is a system unit, not `systemctl --user`: it runs as root against
the cluster's data directory, not in a login session. An earlier version of this
document said `systemctl --user enable --now hetja-walg.timer` and the unit did
not exist in the repository at all — both fixed 2026-08-14, and
`ops/check-systemd.sh` now fails CI if a committed unit is left un-installed by
bootstrap.

## Step 4 — restore drill (quarterly, per HOW-IT-WORKS)

Follow the restore-drill runbook: fresh box → `wal-g backup-fetch` →
`wal-g wal-fetch` to the desired point → verify the `medical_records` hash
chain and the Merkle root (packages/ledger) match production's published
root. Document time-to-restore as the SLA.
