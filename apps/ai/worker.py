# Hetja AI worker (apps/ai) — Python 3.11
# Phase 0: validation harness with a pluggable detector interface. The real
# YOLO fine-tune (dog presence + food presence) plugs in here; the API never
# blocks on inference (the worker consumes validate_scan jobs and writes
# scans.ai_validation JSONB + review_status).
#
# Usage (dev):
#   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
#   .venv/bin/python worker.py --once          # process one job, exit
#   .venv/bin/python worker.py                 # poll loop

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any, Optional

import psycopg2
import psycopg2.extras

PG_DSN = os.environ.get(
    "HETJA_PG_DSN",
    "host=127.0.0.1 dbname=hetja user=app_user password=8ffe587d42b5b5a56109fc1234b4d59309e2a87efa1b3fe4e17a7141feea851e",
)

POLL_S = 5


@dataclass
class Detection:
    label: str
    confidence: float


class Detector:
    """Pluggable detector. Phase 0 stub: returns 'no_dog' so nothing is
    auto-passed until the fine-tuned YOLO model is deployed."""

    def detect(self, image_path: str) -> list[Detection]:
        # TODO(Phase 1): YOLOv8 fine-tune for dog-presence + food-presence.
        return [Detection(label="no_dog", confidence=0.0)]


def claim_job(conn: Any) -> Optional[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            # `run_after <= now()` and `failed_at IS NULL` must both be here to
            # match apps/worker/src/index.ts's claimNext. Without the first, this
            # worker claims jobs the TypeScript worker has deliberately backed
            # off after a failure, defeating the retry delay. Without the second,
            # it resurrects rows that were dead-lettered on purpose (migration
            # 0016) and runs them forever. Both workers register a handler for
            # `validate_scan`, so they see the same rows and have to agree on
            # what "claimable" means.
            """SELECT id, payload FROM jobs
               WHERE kind = 'validate_scan'
                 AND run_after <= now()
                 AND (locked_until IS NULL OR locked_until < now())
                 AND failed_at IS NULL
               ORDER BY run_after LIMIT 1 FOR UPDATE SKIP LOCKED"""
        )
        row = cur.fetchone()
        if row is None:
            return None
        job_id, payload = row["id"], row["payload"]
        cur.execute(
            "UPDATE jobs SET locked_until = now() + interval '60 seconds', attempts = attempts + 1 WHERE id = %s",
            (job_id,),
        )
        conn.commit()
        return {"id": job_id, "payload": payload}


def write_result(conn: Any, job_id: int, scan_id: str, validation: dict[str, Any], review: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE scans SET ai_validation = %s, review_status = %s WHERE id = %s",
            (json.dumps(validation), review, scan_id),
        )
        # Delete THE JOB WE PROCESSED, by id.
        #
        # This was `DELETE FROM jobs WHERE id = (SELECT id FROM jobs
        # WHERE kind='validate_scan' ORDER BY id LIMIT 1)` — a fresh lookup
        # ordered by `id`, while claim_job selects by `run_after`. Whenever more
        # than one validate_scan job was queued and the lowest-id row was not the
        # one claimed, this destroyed a DIFFERENT job: that scan was never
        # validated and never flagged, which is a direct breach of INVARIANT 14
        # ("flags, never silently rejects"). Meanwhile the job that actually ran
        # was never deleted, so its 60s lease expired and it re-ran forever,
        # incrementing attempts with no cap.
        cur.execute("DELETE FROM jobs WHERE id = %s", (job_id,))
        conn.commit()


def process_once(conn: Any, detector: Detector) -> int:
    job = claim_job(conn)
    if job is None:
        return 0
    payload = job["payload"]
    scan_id = payload.get("scanId")
    photo = payload.get("photoPath")
    if not scan_id or not photo:
        # dead job — drop it
        with conn.cursor() as cur:
            cur.execute("DELETE FROM jobs WHERE id = %s", (job["id"],))
            conn.commit()
        return 1
    detections = detector.detect(photo)
    dog_present = any(d.label == "dog" and d.confidence >= 0.5 for d in detections)
    validation = {
        "model": "stub-v0",
        "dog_present": dog_present,
        "food_present": any(d.label == "food" for d in detections),
        "detections": [{"label": d.label, "confidence": round(d.confidence, 3)} for d in detections],
    }
    review = "auto_passed" if dog_present else "flagged"  # INVARIANT 14: flag, never silently reject
    write_result(conn, job["id"], scan_id, validation, review)
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="process one job and exit")
    args = ap.parse_args()
    detector = Detector()
    conn = psycopg2.connect(PG_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    processed = 0
    while True:
        try:
            processed += process_once(conn, detector)
        except Exception as exc:  # noqa: BLE001
            print(f"worker error: {exc}", file=sys.stderr)
            # rollback() on an already-closed connection raises, and raising
            # from inside this handler propagated straight out of main() and
            # killed the process. PostgreSQL restarts are routine here — every
            # migration and every deploy touches it — so "the database blinked"
            # was a fatal error for a worker that nothing restarts (there is no
            # hetja-ai.service). Reconnect instead of dying.
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                try:
                    conn.close()
                except Exception:  # noqa: BLE001
                    pass
                if args.once:
                    return 1
                print("worker: reconnecting to PostgreSQL", file=sys.stderr)
                time.sleep(POLL_S)
                conn = psycopg2.connect(PG_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
        if args.once:
            break
        time.sleep(POLL_S)
    conn.close()
    print(f"processed {processed} job(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
