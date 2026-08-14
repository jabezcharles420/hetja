# Backups (enhancement stack §L.1/§L.2, Phase 1 #6-7)

Two mechanisms, one config file, and one thing that only you can decide.

| | what it saves | where it goes | status |
|---|---|---|---|
| `restic` | nightly `pg_dump -Fc`, `.env.production` secrets, Caddy/PG/systemd configs | wherever `RESTIC_REPOSITORY` points | works today |
| `wal-g` | continuous WAL, for point-in-time recovery | an object store (S3-compatible, GCS, Azure) | installed, dormant |

## Why the destination matters more than the mechanism

**The single most important thing in any of these backups is
`HETJA_QR_SECRET`.** It is the HMAC key baked into every QR code already
printed and glued to a physical collar. It exists in exactly one gitignored file
on one disk. Lose it and every collar already on a dog stops verifying — not
degraded, stops — and no amount of code in git or schema in Supabase brings it
back. See `AGENTS.md` §d.

And **Supabase is not a database backup.** It holds a mirror of the *schema*;
the deploy pipeline applies migrations to it and nothing copies rows. Its tables
are correctly shaped and empty. Losing this box's disk loses `dogs`, `scans`,
`medical_records`, `feeders`, `sos_cases` and fourteen other tables — including
the append-only hash-chained ledger that exists specifically to be evidence.

## Destination: Google Drive via rclone (the no-payment-card path)

Chosen 2026-08-14 because **Cloudflare R2 requires a payment method on file
even for its free 10 GB tier**, and this project runs on nothing. Google Drive's
15 GB free tier needs no card, and restic encrypts client-side either way, so
Google only ever holds ciphertext.

Two honest consequences of that choice, stated up front:

1. **wal-g cannot target Google Drive.** Its storage backends are
   S3-compatible, GCS, Azure, Swift, file and SSH — Drive is not among them, and
   Drive's semantics (no multipart, rate-limited metadata) are a poor fit for WAL
   archiving anyway. So **there is no 5-minute PITR on this path.** What you get
   is nightly logical dumps, i.e. a recovery point of up to 24 hours old. §5
   below describes the middle option if that is not good enough.
2. Drive's API is rate-limited and slower than an object store. Fine for a
   `pg_dump` plus configs at pilot scale; revisit if the dump grows past a few GB.

If you later get a card-free S3-compatible option (Backblaze B2's 10 GB free
tier does not require a card at time of writing — verify before relying on it),
switching is two lines in `/root/.backup-env` and turns on real PITR.

## Verified live on 2026-08-14

This is no longer aspirational. On `aic` (the production box):

```
rclone about gdrive:        Total 15 GiB / Free 13.573 GiB
restic snapshots            8fce079b  2026-08-14 23:20:00  jabez-vps-essential-2gb
                            /etc/caddy, /etc/postgresql/16/main,
                            /root/.config/systemd/user,
                            apps/api/.env.production, apps/web/.env.production,
                            the pg_dump
```

First backup took **4m40s** — Drive is slow, as warned above. And the restore
drill was run, not just documented:

| table | production | restored from Drive |
|---|---|---|
| `medical_records` | 85 | **85** |
| `dogs` | 88 | **88** |
| `care_providers` | 93 | **93** |

Both `.env.production` files came back out of the snapshot too, so
`HETJA_QR_SECRET` is recoverable from a backup as well as from a password
manager.

### One discrepancy this repository should own

`ops/bootstrap.sh` installs `hetja-restic.{service,timer}` as **system** units
(`WantedBy=multi-user.target`), and `ops/check-systemd.sh` gates that. But the
live box does not use them: it has `hetja-restic.timer` as a **user** unit under
`/root/.config/systemd/user/`, enabled and active, next fire 02:15 IST, running
this same script. That is why the older instruction said
`systemctl --user enable --now hetja-walg.timer` — it was correct for how the
box was actually built, and my earlier "the `--user` was wrong" correction was
itself too confident.

Nothing was changed about the scheduling: repointing `RESTIC_REPOSITORY` was
enough, and the existing user timer picks it up. Left alone deliberately —
installing the system units on top would give this box **two** timers running
the same backup.

For a fresh box, bootstrap's system units are still the right thing. If you ever
run `bootstrap.sh` on *this* box, disable the user timer first:

```bash
systemctl --user disable --now hetja-restic.timer
```

## Step 1 — install and authorise rclone

`rclone` needs a browser once, to complete Google's OAuth. The box has no
browser, so do the authorisation **on your own machine** and paste the token
over. This is exactly what `rclone authorize` is for.

On the box:

```bash
curl https://rclone.org/install.sh | sudo bash
rclone version
```

On **your own machine** (where a browser can open), install rclone the same way,
then:

```bash
rclone authorize "drive"
```

A browser opens, you sign in to the Google account whose 15 GB you are using,
and rclone prints a long `{"access_token":…}` blob. Copy the whole thing.

Back on the box:

```bash
rclone config
# n) New remote
# name> gdrive
# Storage> drive
# client_id>        (blank — press Enter)
# client_secret>    (blank)
# scope> 1          (full access; "drive.file" also works and is narrower)
# root_folder_id>   (blank)
# service_account_file> (blank)
# Edit advanced config? n
# Use auto config? n          <-- IMPORTANT: say no, this box has no browser
# config_token> <paste the blob from your machine>
# Configure this as a Shared Drive? n
# y) Yes this is OK
# q) Quit
```

Verify, and create the folder:

```bash
rclone about gdrive:                       # shows your quota — proves auth works
rclone mkdir gdrive:hetja-backups
rclone lsd gdrive:                         # hetja-backups should be listed
```

If `rclone about gdrive:` fails, nothing below will work. Fix it here.

## Step 2 — the credentials file

One file, `/root/.backup-env`, feeds both restic and wal-g. Mode `600`.

```bash
install -m 600 /dev/null /root/.backup-env
cat > /root/.backup-env <<'CONF'
# Google Drive via rclone. No keys here — rclone holds the OAuth token in
# /root/.config/rclone/rclone.conf, which is itself worth protecting.
RESTIC_REPOSITORY=rclone:gdrive:hetja-backups
RESTIC_PASSWORD_FILE=/root/.backup-env.restic-pw
CONF
```

Then the repository password — **the one secret with no recovery path**:

```bash
openssl rand -base64 48 > /root/.backup-env.restic-pw
chmod 600 /root/.backup-env.restic-pw
cat /root/.backup-env.restic-pw
```

Store that copy somewhere that is **not this box and not that Drive account**. A
password manager, or written down. restic's client-side encryption is what makes
handing ciphertext to Google acceptable; it is also what makes a lost password an
unrecoverable backup, permanently, with no reset link.

While you are in a password manager: **put `HETJA_QR_SECRET` in it too.** That
one line is the difference between "the box died" and "every collar in the field
died", and it takes ten seconds.

## Step 3 — run it and confirm

```bash
systemctl start hetja-restic.service
systemctl status hetja-restic.service      # must not say "failed"
journalctl -u hetja-restic.service -n 30 --no-pager

set -a; . /root/.backup-env; set +a
restic snapshots                           # lists the snapshot just taken
restic ls latest | head                    # and what is inside it
```

`ops/backup/restic-backup.sh` checks the backend before doing any work, so a
missing `rclone` or an expired token fails immediately with a message naming the
fix, rather than as an opaque error at 02:15 in a log nobody reads.

The timer (`hetja-restic.timer`, daily 02:15 IST) is already enabled by
`ops/bootstrap.sh`. Confirm the schedule:

```bash
systemctl list-timers hetja-restic.timer
```

## Step 4 — prove you can restore (do this once, now)

A backup you have never restored is a hypothesis.

```bash
mkdir -p /tmp/restore-drill && cd /tmp/restore-drill
set -a; . /root/.backup-env; set +a
restic restore latest --target .
find . -name '*.dump' -o -name '.env.production' | head

# and that the dump is actually loadable — into a scratch database, never hetja
createdb drill_restore
pg_restore -d drill_restore --no-owner "$(find . -name 'hetja.dump' | head -1)"
psql -d drill_restore -c "SELECT count(*) FROM medical_records;"
dropdb drill_restore
```

If the count matches production, you have a working backup. Write down how long
it took — that number is your RTO, and `ops/RUNBOOK.md` asks for it.

## Step 5 — PITR, if 24 hours of loss is too much

Skip this unless you need it. wal-g cannot reach Drive, but it *can* archive WAL
to a local directory, which restic then ships nightly. That gives you replay to
any point since the last base backup, at the cost of losing whatever WAL has not
yet been shipped when the disk dies — so it narrows the window without closing
it.

Add to `/root/.backup-env`:

```
WALG_FILE_PREFIX=/srv/hetja-wal
```

then `mkdir -p /srv/hetja-wal`, and add `/srv/hetja-wal` to the `restic backup`
paths in `ops/backup/restic-backup.sh`. Watch the disk: WAL accumulates, and
`archive_timeout = 60` means a segment a minute even when idle. Prune with
`wal-g delete retain FULL 2 --confirm` on a schedule.

Honest assessment: this is a real improvement over nightly-only, and it is
strictly worse than WAL going straight off-box. If PITR genuinely matters for the
medical ledger, the right fix is a card-free S3-compatible bucket, not this.

---

# wal-g reference (for an S3-compatible destination)

The rest of this document applies **only** if `RESTIC_REPOSITORY`/`WALG_S3_PREFIX`
point at an S3-compatible store. wal-g v3.0.8 is installed at
`/usr/local/bin/wal-g` (PostgreSQL build) and is **dormant**: continuous
archiving needs credentials and one PostgreSQL restart.

## S3 path, step 1 — credentials (root only)

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

## S3 path, step 2 — enable archiving (one PG restart)

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

## S3 path, step 3 — base backups

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

## Restore drill (quarterly, per HOW-IT-WORKS) — applies to either path

Follow the restore-drill runbook: fresh box → `wal-g backup-fetch` →
`wal-g wal-fetch` to the desired point → verify the `medical_records` hash
chain and the Merkle root (packages/ledger) match production's published
root. Document time-to-restore as the SLA.
