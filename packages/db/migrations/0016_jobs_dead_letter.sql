-- Give the job queue somewhere to put a job it has given up on.
--
-- apps/worker's retry logic could not work, and the reason was structural: the
-- claim, the handler call and the DELETE all ran inside ONE transaction. When a
-- handler threw, `withTx` issued ROLLBACK — which discarded the
-- `attempts = attempts + 1` increment and the `locked_until` lease along with
-- the handler's own writes. So `attempts` never advanced, the `attempts >=
-- MAX_ATTEMPTS` dead-letter branch was unreachable, and the job was left with
-- its original `run_after` for `claimNext`'s `ORDER BY run_after LIMIT 1` to
-- select again two seconds later. Forever.
--
-- Worse than the wasted work: the throw propagated out of the per-job
-- transaction into the batch loop, so a single poison job stopped the tick
-- before any OTHER job ran. One `escalate_sos` whose dog row had been deleted
-- would silently halt the 8-minute SOS escalation for the entire system, with
-- `console.error("worker tick error:")` as the only evidence.
--
-- Splitting that into three transactions (claim, run, settle) makes the
-- dead-letter branch reachable for the first time, and a reachable dead-letter
-- branch needs somewhere to write. Deleting an exhausted job is not an option
-- here — these are SOS escalations and push fan-outs, and a life-safety job that
-- vanishes after eight failures is the silent-rejection failure mode that
-- INVARIANT 14 exists to forbid. So the row stays, marked, with the error that
-- stopped it.
--
-- Additive: two nullable columns and one index. Nothing is dropped or rewritten.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS failed_at  TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_error TEXT;

COMMENT ON COLUMN jobs.failed_at IS
  'Set when the job exhausted MAX_ATTEMPTS. Such rows are parked, never claimed '
  'again, and never deleted — an operator has to look at them. Query with '
  'SELECT id, kind, attempts, last_error FROM jobs WHERE failed_at IS NOT NULL.';
COMMENT ON COLUMN jobs.last_error IS
  'Message from the most recent failure, truncated. Diagnostic only.';

-- The claim query now carries `AND failed_at IS NULL`, so it needs a partial
-- index whose predicate agrees, or every 2s poll degrades to a scan that reads
-- the dead letters it is about to discard.
--
-- Added under a NEW name rather than redefining `jobs_ready_ix` in place. A
-- `DROP INDEX` here would trip the deploy pipeline's destructive-change gate
-- (.github/workflows/deploy.yml) and red-build the Migrate job — verified by
-- running that gate's exact shell over this file. The gate exempts only
-- `DROP TRIGGER/FUNCTION IF EXISTS`, and AGENTS.md §g is explicit that
-- `-- MIGRATION-APPROVED:` must not be pasted in to silence it.
--
-- So `jobs_ready_ix` stays. It is now redundant — same leading column, weaker
-- predicate — and costs a little write amplification on a table that is already
-- tuned for churn (autovacuum_vacuum_scale_factor = 0.01). Dropping it is a
-- one-line follow-up that wants a human and a checked backup, which is exactly
-- the judgement the gate exists to force.
CREATE INDEX IF NOT EXISTS jobs_ready_live_ix ON jobs (run_after)
  WHERE locked_until IS NULL AND failed_at IS NULL;

-- A dead letter must not wedge the daily anchor scheduler. `enqueueAnchorJobIfDue`
-- refuses to enqueue while ANY anchor_ledger row exists, so without this the
-- first exhausted anchor job would silently stop INVARIANT 10 forever; the
-- worker's matching query now filters on failed_at IS NULL too.
CREATE INDEX IF NOT EXISTS jobs_kind_live_ix ON jobs (kind) WHERE failed_at IS NULL;
