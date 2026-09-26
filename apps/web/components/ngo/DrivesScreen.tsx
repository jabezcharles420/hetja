"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ngoApi, type DriveSummary } from "./ngo-api";
import { driveSub } from "./ngo-copy";
import { ActiveNgo, errorWords, isCoordinator, LoadError, Loading, NgoFrame } from "./NgoGate";
import styles from "./ngo.module.css";

/**
 * Drives (designed: the list N2's "Drives" row opens when more than the
 * next one matters). Upcoming and running first, finished ones after.
 */

/** Finished drives, and any whose day is long over, go under Past. */
export function splitDrives(
  drives: DriveSummary[],
  now = Date.now(),
): { upcoming: DriveSummary[]; done: DriveSummary[] } {
  const by = (a: DriveSummary, b: DriveSummary) => Date.parse(a.startsAt) - Date.parse(b.startsAt);
  const past = (d: DriveSummary) => d.state === "finished" || Date.parse(d.startsAt) < now - 18 * 3600_000;
  return {
    upcoming: drives.filter((d) => !past(d)).sort(by),
    done: drives.filter(past).sort((a, b) => -by(a, b)),
  };
}

export default function DrivesScreen(): React.JSX.Element {
  return (
    <ActiveNgo next="/ngo/drives" frame={{ href: "/ngo", label: "NGO" }}>
      {(_ngo, role) => <Drives canPlan={isCoordinator(role)} />}
    </ActiveNgo>
  );
}

function Row({ d }: { d: DriveSummary }): React.JSX.Element {
  return (
    <li>
      <Link href={`/ngo/drives/${encodeURIComponent(d.id)}`} className={styles.row}>
        <span className={styles.rowText}>
          <span className={`${styles.rowTitle} ${styles.rowTitleBold}`}>{d.place} drive</span>
          <span className={styles.rowSub}>{driveSub(d)}</span>
        </span>
        <span className={`${styles.rowEnd} ${d.state === "running" ? styles.ok : ""}`}>
          {d.state === "running" ? "Started" : d.state === "finished" ? "Finished" : d.dogCount === 1 ? "1 dog" : `${d.dogCount} dogs`} ›
        </span>
      </Link>
    </li>
  );
}

function Drives({ canPlan }: { canPlan: boolean }): React.JSX.Element {
  const [drives, setDrives] = useState<DriveSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchIt = useCallback(() => {
    setError(null);
    ngoApi.getDrives().then((r) => setDrives(r.drives), (err: unknown) => setError(errorWords(err)));
  }, []);
  useEffect(() => fetchIt(), [fetchIt]);

  const split = drives ? splitDrives(drives) : null;

  return (
    <NgoFrame back={{ href: "/ngo", label: "NGO" }}>
      <div className={`h-container ${styles.body} ${styles.tight}`}>
        <div className={styles.headRow}>
          <h1 className={styles.title}>Drives</h1>
          {canPlan && (
            <Link href="/ngo/drives/new" className={styles.pillBlue}>
              New drive
            </Link>
          )}
        </div>
        {!split ? (
          error ? (
            <LoadError message={error} onRetry={fetchIt} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <h2 className={styles.label}>Coming up · {split.upcoming.length}</h2>
            {split.upcoming.length === 0 ? (
              <p className={`${styles.card} ${styles.cardSub}`}>
                No drives planned. A drive collars, vaccinates and sterilises the dogs of one street in a morning.
              </p>
            ) : (
              <ul className={styles.list}>
                {split.upcoming.map((d) => (
                  <Row key={d.id} d={d} />
                ))}
              </ul>
            )}
            {split.done.length > 0 && (
              <>
                <h2 className={`${styles.label} ${styles.gapAbove}`}>Past · {split.done.length}</h2>
                <ul className={styles.list}>
                  {split.done.map((d) => (
                    <Row key={d.id} d={d} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </NgoFrame>
  );
}
