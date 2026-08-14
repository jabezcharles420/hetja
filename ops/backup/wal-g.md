# wal-g PITR activation (enhancement stack §L.1, Phase 1 #6)

wal-g v3.0.8 is installed at `/usr/local/bin/wal-g` (PostgreSQL build).
It is **configured but dormant**: continuous archiving needs (a) R2
credentials and (b) one PostgreSQL restart. The interim restic job
(`ops/backup/restic-backup.sh`, daily 02:15 IST) already protects the
database with daily logical dumps, so nothing is unprotected while wal-g
waits.

## Step 1 — credentials (root only)

Add to `/root/.backup-env`:

```
WALG_S3_PREFIX=s3:https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/hetja-wal
AWS_ACCESS_KEY_ID=<R2 Access Key ID>
AWS_SECRET_ACCESS_KEY=<R2 Secret Access Key>
```

(shared with restic's R2 config in the same file)

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

```bash
# one-off
PGHOST=/var/run/postgresql PGUSER=postgres wal-g backup-push /var/lib/postgresql/16/main
# recurring (hourly is plenty on top of restic's daily dump)
systemctl --user enable --now hetja-walg.timer
```

## Step 4 — restore drill (quarterly, per HOW-IT-WORKS)

Follow the restore-drill runbook: fresh box → `wal-g backup-fetch` →
`wal-g wal-fetch` to the desired point → verify the `medical_records` hash
chain and the Merkle root (packages/ledger) match production's published
root. Document time-to-restore as the SLA.
