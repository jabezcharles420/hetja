"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader, Sheet, StickyFooter } from "@/components/ds";
import { ngoApi, type DispatchCandidate, type NgoDispatch } from "./ngo-api";
import { candidateSub, candidateTitle, caseSub, dispatchNote, sendLabel, shortName } from "./ngo-copy";
import { ActiveNgo, errorWords, isCoordinator, LoadError, Loading } from "./NgoGate";
import { TeamMap } from "./TeamMap";
import styles from "./ngo.module.css";

/**
 * N3 Send someone to an SOS (design v7). The coordinator picks who goes:
 * vets and volunteers who are free (busy ones are shown, and cannot be
 * picked), and the ambulance goes along when it is in. Sending pages that
 * person; they get the v6 case page (/sos/[caseId]) and, once they accept,
 * they are the case's responder (the API acks it as them). Routing after
 * that is the API's: if nobody accepts in 15 minutes the case opens to
 * every vet nearby.
 */

/** Pick the first free vet, else the first free volunteer. */
export function defaultPick(cands: DispatchCandidate[]): string | null {
  const free = cands.filter((c) => !c.busy && c.kind !== "ambulance");
  return (free.find((c) => c.kind === "vet") ?? free[0])?.id ?? null;
}

/** People first (vets, then volunteers, nearest first), the ambulance last. */
export function orderCandidates(cands: DispatchCandidate[]): DispatchCandidate[] {
  const rank = (c: DispatchCandidate) => (c.kind === "vet" ? 0 : c.kind === "volunteer" ? 1 : 2);
  return [...cands].sort(
    (a, b) =>
      rank(a) - rank(b) || Number(a.busy) - Number(b.busy) || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity),
  );
}

export default function DispatchScreen({ caseId }: { caseId: string }): React.JSX.Element {
  return (
    <div className={styles.page}>
      <AppHeader back={{ href: "/ngo", label: "NGO", history: true }} />
      <ActiveNgo next={`/ngo/sos/${caseId}`}>
        {(_ngo, role) =>
          isCoordinator(role) ? (
            <Dispatch caseId={caseId} />
          ) : (
            <div className={`h-container ${styles.body}`}>
              <p className={styles.lead}>Coordinators send someone to a case. You can still take it yourself.</p>
              <Link href={`/sos/${encodeURIComponent(caseId)}`} className={styles.inkBtn}>
                See the case
              </Link>
            </div>
          )
        }
      </ActiveNgo>
    </div>
  );
}

type Done = { kind: "sent"; who: string } | { kind: "declined" } | null;

function Dispatch({ caseId }: { caseId: string }): React.JSX.Element {
  const [d, setD] = useState<NgoDispatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [withAmbulance, setWithAmbulance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [done, setDone] = useState<Done>(null);

  const fetchIt = useCallback(() => {
    setError(null);
    ngoApi.getDispatch(caseId).then(
      (r) => {
        setD(r);
        setPick((p) => p ?? defaultPick(r.candidates));
      },
      (err: unknown) => setError(errorWords(err)),
    );
  }, [caseId]);

  useEffect(() => fetchIt(), [fetchIt]);

  const ordered = useMemo(() => (d ? orderCandidates(d.candidates) : []), [d]);

  if (!d) {
    return (
      <div className={`h-container ${styles.body}`}>
        {error ? <LoadError message={error} onRetry={fetchIt} /> : <Loading />}
      </div>
    );
  }

  const dog = d.dogName ?? "this dog";
  const person = ordered.find((c) => c.id === pick) ?? null;
  const ambulance = ordered.find((c) => c.kind === "ambulance") ?? null;
  const ambulanceFree = !!ambulance && !ambulance.busy;

  if (done) {
    return (
      <div className={`h-container ${styles.body}`}>
        <div className={styles.head}>
          <span className={`${styles.statusIcon} ${done.kind === "sent" ? styles.statusOk : styles.statusPaused}`} aria-hidden="true">
            {done.kind === "sent" ? "✓" : "→"}
          </span>
          <h1 className={styles.title} role="status">
            {done.kind === "sent" ? `${done.who} has been asked` : "Passed on"}
          </h1>
          <p className={styles.lead}>
            {done.kind === "sent"
              ? `When they say yes, they take the case and ${d.reporterName ?? "whoever raised it"} sees who's coming. If nobody accepts in 15 min, the case opens to all vets nearby.`
              : `${d.dogName ?? "The dog"} goes to every vet nearby instead. Feeders nearby are still being asked.`}
          </p>
        </div>
        <Link href="/ngo" className={styles.inkBtn}>
          Back to NGO
        </Link>
      </div>
    );
  }

  const send = async () => {
    if (!person) return;
    setBusy(true);
    setProblem(null);
    try {
      await ngoApi.sendSomeone(caseId, { memberId: person.id, ambulance: withAmbulance && ambulanceFree });
      setDone({ kind: "sent", who: shortName(person.name) });
    } catch (err) {
      setProblem(errorWords(err, "Could not send them. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await ngoApi.declineCase(caseId);
      setConfirmDecline(false);
      setDone({ kind: "declined" });
    } catch (err) {
      setConfirmDecline(false);
      setProblem(errorWords(err, "Could not pass it on. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const covered =
    d.state !== "unassigned"
      ? caseSub({
          caseId: d.caseId,
          dogName: d.dogName,
          locality: d.locality,
          wardId: d.wardId,
          openedAt: d.openedAt ?? "",
          state: d.state,
          assignee: d.assignee ?? null,
          etaMin: d.etaMin ?? null,
        })
      : null;

  return (
    <>
      <TeamMap lat={d.lat} lng={d.lng} dogName={d.dogName} team={ordered} />
      <div className={`h-container ${styles.dispatchBody}`}>
        <h1 className={styles.h2}>Who&apos;s going to {dog}?</h1>
        {covered && <p className={styles.sub}>Already: {covered}</p>}
        {ordered.length === 0 ? (
          <p className={styles.lead}>Nobody on your team has shared where they are. Add people from Team.</p>
        ) : (
          <ul className={`${styles.list} ${styles.listMist}`} aria-label="Who could go">
            {ordered.map((c) => {
              const isAmb = c.kind === "ambulance";
              const on = isAmb ? withAmbulance && !c.busy : pick === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`${styles.row} ${styles.pick} ${on ? styles.picked : ""}`}
                    aria-pressed={on}
                    disabled={c.busy}
                    onClick={() => (isAmb ? setWithAmbulance((v) => !v) : setPick(c.id))}
                  >
                    <span className={styles.rowText}>
                      <span className={`${styles.rowTitle} ${styles.rowTitleBold}`}>{candidateTitle(c)}</span>
                      <span className={styles.rowSub}>{candidateSub(c)}</span>
                    </span>
                    {c.busy ? (
                      <span className={styles.busy}>Busy</span>
                    ) : on ? (
                      <span className={styles.tick} aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className={styles.noteLg}>{dispatchNote(d.reporterName)}</p>
      </div>
      <StickyFooter background="white" divider={false}>
        <div className={styles.footer}>
          {problem && (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          )}
          <button type="button" className={styles.inkBtn} onClick={() => void send()} disabled={!person || busy}>
            {busy ? "Sending…" : sendLabel(person, withAmbulance && ambulanceFree)}
          </button>
          <button type="button" className={styles.linkBtn} onClick={() => setConfirmDecline(true)} disabled={busy}>
            We can&apos;t take this one
          </button>
        </div>
      </StickyFooter>
      <Sheet
        open={confirmDecline}
        onClose={() => setConfirmDecline(false)}
        title={`Pass ${d.dogName ?? "this case"} on?`}
        footer={
          <button type="button" className={styles.inkBtn} onClick={() => void decline()} disabled={busy}>
            {busy ? "Passing on…" : "Pass it on"}
          </button>
        }
      >
        <p className={styles.lead}>
          Nobody from your team goes. The case opens to every vet nearby now, instead of in 15 min.
        </p>
      </Sheet>
    </>
  );
}
