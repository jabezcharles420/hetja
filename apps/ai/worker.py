# StrayNet AI worker (apps/ai) — Python 3.11
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
    "STRAYNET_PG_DSN",
    "host=127.0.0.1 dbname=straynet user=app_user password=straynet_dev_2026",
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
            """SELECT id, payload FROM jobs
               WHERE kind = 'validate_scan' AND (locked_until IS NULL OR locked_until < now())
               ORDER BY run_after LIMIT 1 FOR UPDATE SKIP LOCKED"""
        )
        row = cur.fetchone()
        if row is None:
            return None
        job_id, payload = row
        cur.execute(
            "UPDATE jobs SET locked_until = now() + interval '60 seconds', attempts = attempts + 1 WHERE id = %s",
            (job_id,),
        )
        conn.commit()
        return {"id": job_id, "payload": payload}


def write_result(conn: Any, scan_id: str, validation: dict[str, Any], review: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE scans SET ai_validation = %s, review_status = %s WHERE id = %s",
            (json.dumps(validation), review, scan_id),
        )
        cur.execute("DELETE FROM jobs WHERE id = (SELECT id FROM jobs WHERE kind='validate_scan' ORDER BY id LIMIT 1)")
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
    write_result(conn, scan_id, validation, review)
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
            conn.rollback()
        if args.once:
            break
        time.sleep(POLL_S)
    conn.close()
    print(f"processed {processed} job(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
