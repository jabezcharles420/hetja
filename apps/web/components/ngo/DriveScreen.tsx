"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Sheet, StickyFooter } from "@/components/ds";
import { ngoApi, type DriveDetail, type DriveDog, type DriveTask } from "./ngo-api";
import { collarActions, driveCounts, driveDogLine, driveNote, driveSub, moreLine, shortName, vetSignHref } from "./ngo-copy";
import { ActiveNgo, errorWords, isCoordinator, LoadError, Loading, NgoFrame } from "./NgoGate";
import styles from "./ngo.module.css";

/**
 * N5 Collar and sterilisation drive (design v7). The dogs listed for the
 * drive, each tapped to check off. Collars and sterilisation are ticked
 * here; a vaccination is never ticked here: the lead vet signs it through
 * the vet signing flow (V3), which is what makes it "Vet signed". "Start
 * drive" is the one main button; once it is on, a coordinator gets
 * "Finish drive", and a finished drive says so. Feeders of the listed dogs
 * get a heads-up the day before (a worker job).
 */

export const FIRST_DOGS = 3;

function clockWords(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    .format(new Date(iso))
    .replace(" ", "")
    .toLowerCase();
}

/** "Started at 7:04am. Tap a dog to check it off." */
export function startedWords(iso: string | null | undefined): string {
  return iso ? `Started at ${clockWords(iso)}. Tap a dog to check it off.` : "Started. Tap a dog to check it off.";
}

/** "Finished at 11:40am. 16 of 18 dogs done." */
export function finishedWords(iso: string | null | undefined, done: number, listed: number): string {
  const when = iso ? `Finished at ${clockWords(iso)}.` : "Finished.";
  return `${when} ${done} of ${listed} ${listed === 1 ? "dog" : "dogs"} done.`;
}

const TASK_WORD: Record<DriveTask, string> = {
  collar: "Collar",
  vaccinate: "Anti-rabies",
  sterilise: "Sterilise, to the clinic",
};

export default function DriveScreen({ driveId }: { driveId: string }): React.JSX.Element {
  return (
    <ActiveNgo next={`/ngo/drives/${driveId}`} frame={{ href: "/ngo/drives", label: "Drives" }}>
      {(_ngo, role) => <Drive driveId={driveId} canFinish={isCoordinator(role)} />}
    </ActiveNgo>
  );
}

function Drive({ driveId, canFinish }: { driveId: string; canFinish: boolean }): React.JSX.Element {
  const [d, setD] = useState<DriveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dog, setDog] = useState<DriveDog | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const fetchIt = useCallback(() => {
    setError(null);
    ngoApi.getDrive(driveId).then(setD, (err: unknown) => setError(errorWords(err)));
  }, [driveId]);
  useEffect(() => fetchIt(), [fetchIt]);

  if (!d) {
    return (
      <NgoFrame back={{ href: "/ngo/drives", label: "Drives" }} mist={false}>
        <div className={`h-container ${styles.body}`}>
          {error ? <LoadError message={error} onRetry={fetchIt} /> : <Loading />}
        </div>
      </NgoFrame>
    );
  }

  const counts = driveCounts(d.dogs);
  const shown = expanded ? d.dogs : d.dogs.slice(0, FIRST_DOGS);
  const hidden = d.dogs.length - shown.length;

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await ngoApi.startDrive(driveId);
      setD({ ...d, state: "running", startedAt: r?.startedAt ?? new Date().toISOString() });
    } catch (err) {
      setProblem(errorWords(err, "Could not do that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await ngoApi.finishDrive(driveId);
      setD({ ...d, state: "finished", finishedAt: r?.finishedAt ?? new Date().toISOString() });
    } catch (err) {
      setProblem(errorWords(err, "Could not do that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const onDog = (next: DriveDog) => setD((x) => (x ? { ...x, dogs: x.dogs.map((g) => (g.id === next.id ? next : g)) } : x));

  return (
    <NgoFrame back={{ href: "/ngo/drives", label: "Drives" }} mist={false}>
      <div className={`h-container ${styles.body}`}>
        <div className={styles.head}>
          <h1 className={styles.title}>{d.place} drive</h1>
          <p className={styles.sub}>{driveSub(d)}</p>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statNum}>{counts.listed}</span>
            <span className={styles.statLabel}>dogs listed</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{counts.sterilise}</span>
            <span className={styles.statLabel}>need sterilising</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{d.collarsPacked}</span>
            <span className={styles.statLabel}>collars packed</span>
          </div>
        </div>

        <div className={styles.stack10}>
          <h2 className={styles.label}>Dogs · tap to check off</h2>
          {d.dogs.length === 0 ? (
            <p className={styles.lead}>No dogs listed yet.</p>
          ) : (
            <ul className={`${styles.list} ${styles.listMist}`}>
              {shown.map((g) => {
                const line = driveDogLine(g);
                return (
                  <li key={g.id}>
                    <button type="button" className={styles.row} onClick={() => setDog(g)}>
                      <span className={styles.rowTitle}>{g.name ?? "No name yet"}</span>
                      <span className={`${styles.rowEnd} ${line.done ? styles.ok : ""}`}>{line.text}</span>
                    </button>
                  </li>
                );
              })}
              {hidden > 0 && (
                <li>
                  <button type="button" className={`${styles.row} ${styles.rowMore}`} onClick={() => setExpanded(true)}>
                    <span>{moreLine(hidden)}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              )}
            </ul>
          )}
          <p className={styles.note}>{driveNote(d.leadVet)}</p>
          <Link href={`/register/new?drive=${encodeURIComponent(d.id)}`} className={`${styles.linkBtn} ${styles.linkStart}`}>
            Collar a dog who isn&apos;t on Hetja yet ›
          </Link>
        </div>
      </div>

      {d.state === "planned" || (d.state === "running" && canFinish) ? (
        <StickyFooter background="white" divider={false}>
          <div className={styles.footer}>
            {problem && (
              <p className={styles.error} role="alert">
                {problem}
              </p>
            )}
            {d.state === "running" && (
              <p className={`${styles.note} ${styles.center}`} role="status">
                {startedWords(d.startedAt)}
              </p>
            )}
            {d.state === "planned" ? (
              <button type="button" className={styles.inkBtn} disabled={busy} onClick={() => void start()}>
                {busy ? "Starting…" : "Start drive"}
              </button>
            ) : (
              <button type="button" className={styles.inkBtn} disabled={busy} onClick={() => void finish()}>
                {busy ? "Finishing…" : "Finish drive"}
              </button>
            )}
          </div>
        </StickyFooter>
      ) : (
        <div className={`h-container ${styles.footerStatic}`}>
          <p className={`${styles.sub} ${styles.center}`} role="status">
            {d.state === "finished"
              ? finishedWords(d.finishedAt, d.dogs.filter((g) => driveDogLine(g).done).length, d.dogs.length)
              : startedWords(d.startedAt)}
          </p>
        </div>
      )}

      <DogSheet
        drive={d}
        dog={dog}
        onClose={() => setDog(null)}
        onSaved={(g) => {
          onDog(g);
          setDog(g);
        }}
      />
    </NgoFrame>
  );
}

function DogSheet({
  drive,
  dog,
  onClose,
  onSaved,
}: {
  drive: DriveDetail;
  dog: DriveDog | null;
  onClose: () => void;
  onSaved: (d: DriveDog) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState<DriveTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (t: DriveTask) => {
    if (!dog) return;
    const done = dog.done.includes(t) ? dog.done.filter((x) => x !== t) : [...dog.done, t];
    setBusy(t);
    setError(null);
    try {
      const saved = await ngoApi.checkOffDog(drive.id, dog.id, done);
      onSaved(saved ?? { ...dog, done });
    } catch (err) {
      setError(errorWords(err, "Could not save that. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const vet = drive.leadVet ? shortName(drive.leadVet.name) : null;
  const collar = dog ? collarActions(dog) : null;

  return (
    <Sheet open={!!dog} onClose={onClose} title={dog?.name ?? "This dog"} closeLabel="Done">
      {dog && (
        <>
          <ul className={styles.list}>
            {dog.tasks.map((t) => {
              const on = dog.done.includes(t);
              if (t === "collar" && collar) {
                return (
                  <li key={t} className={styles.row}>
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{TASK_WORD[t]}</span>
                      <span className={styles.rowSub}>
                        Not tied on yet.{" "}
                        <Link href={collar.activate} className={styles.chev}>
                          Scan it once it&apos;s on
                        </Link>
                      </span>
                    </span>
                    <Link href={collar.print} className={styles.pillBlue}>
                      Print collar
                    </Link>
                  </li>
                );
              }
              if (t === "vaccinate") {
                return (
                  <li key={t} className={styles.row}>
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{TASK_WORD[t]}</span>
                      <span className={styles.rowSub}>
                        {on ? "✓ Vet signed" : drive.viewerIsLeadVet ? "Sign it as you give it" : `${vet ?? "The lead vet"} signs this one`}
                      </span>
                    </span>
                    {!on && drive.viewerIsLeadVet && (
                      <Link href={vetSignHref(dog.slug, drive.id)} className={styles.pillBlue}>
                        Sign
                      </Link>
                    )}
                  </li>
                );
              }
              return (
                <li key={t}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-pressed={on}
                    disabled={busy !== null}
                    onClick={() => void toggle(t)}
                  >
                    <span className={styles.rowTitle}>{TASK_WORD[t]}</span>
                    <span className={`${styles.check} ${on ? styles.checkOn : ""}`} aria-hidden="true">
                      {on ? "✓" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <p className={styles.note}>{driveDogLine(dog).text}</p>
        </>
      )}
    </Sheet>
  );
}
