"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ngoApi, type NgoAmbulance, type NgoBeds, type NgoHome, type NgoSosCase, type SentToMe } from "./ngo-api";
import {
  bedsLine,
  caseStatus,
  caseSub,
  caseTitle,
  dogsLine,
  ngoKicker,
  nextDriveLine,
  phoneWords,
  sosLabel,
  teamLine,
  waitWords,
  wardCodeOf,
} from "./ngo-copy";
import { canUsePortal, errorWords, isCoordinator, LoadError, Loading, SignedOut, useMyNgo } from "./NgoGate";
import { NgoStatusView } from "./NgoStatusView";
import { AmbulanceSheet, BedsSheet } from "./UpdateSheets";
import styles from "./ngo.module.css";

/**
 * N2 NGO tab (design v7): the tab root for NGO members (Home, Map, NGO,
 * Me; the shell draws the bar). SOS in the NGO's wards first, each with
 * "Send someone" (N3) or who is on the way; then the ambulance and the
 * shelter beds, each with its update sheet; then Team, Drives and Dogs in
 * your wards. Scan moved inside this tab (owner decision), so "Scan a
 * collar" sits here, in V2's card.
 *
 * A member the coordinator sent to a case sees it first, under "Sent to
 * you": "I'll go" accepts the dispatch (the API takes the case as them)
 * and opens the v6 case page, where they are the responder.
 */

export default function NgoHomeScreen(): React.JSX.Element {
  const { load, reload } = useMyNgo();
  const ngo = load.kind === "ready" ? load.mine.ngo : null;
  const active = canUsePortal(ngo);

  return (
    <div className={`${styles.page} ${styles.mist} ${styles.tabPage}`}>
      {active && ngo ? (
        <Home />
      ) : (
        <div className={`h-container ${styles.body} ${styles.bodyTop}`}>
          {load.kind === "loading" && <Loading />}
          {load.kind === "signedOut" && (
            <>
              <h1 className={styles.title}>NGO</h1>
              <SignedOut next="/ngo" />
            </>
          )}
          {load.kind === "error" && <LoadError message={load.message} onRetry={reload} />}
          {load.kind === "ready" && !ngo && (
            <>
              <h1 className={styles.title}>NGO</h1>
              <p className={styles.lead}>You are not part of an NGO on Hetja yet.</p>
              <Link className={styles.inkBtn} href="/ngo/register">
                Bring your NGO to Hetja
              </Link>
            </>
          )}
          {load.kind === "ready" && ngo && !active && <NgoStatusView ngo={ngo} />}
        </div>
      )}
    </div>
  );
}

function SosCard({ c, canSend, now }: { c: NgoSosCase; canSend: boolean; now: number }): React.JSX.Element {
  const title = caseTitle(c);
  if (c.state === "unassigned") {
    return (
      <li className={`${styles.card} ${styles.sosCard}`}>
        <div className={styles.cardTop}>
          <h3 className={styles.cardTitle}>
            <Link href={`/sos/${encodeURIComponent(c.caseId)}`} className={styles.cardTitleLink}>
              {title}
            </Link>
          </h3>
          <span className={`${styles.cardTag} ${styles.danger}`}>{waitWords(c.openedAt, now)}</span>
        </div>
        <p className={styles.cardSub}>{caseSub(c)}</p>
        {canSend ? (
          <Link href={`/ngo/sos/${encodeURIComponent(c.caseId)}`} className={styles.sosBtn}>
            Send someone
          </Link>
        ) : (
          <Link href={`/sos/${encodeURIComponent(c.caseId)}`} className={styles.sosBtn}>
            See the case
          </Link>
        )}
      </li>
    );
  }
  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <h3 className={styles.cardTitle}>
          <Link href={`/sos/${encodeURIComponent(c.caseId)}`} className={styles.cardTitleLink}>
            {title}
          </Link>
        </h3>
        <span className={`${styles.cardTag} ${c.state === "sent" ? styles.warn : styles.ok}`}>
          {caseStatus(c)}
        </span>
      </div>
      <p className={styles.cardSub}>{caseSub(c)}</p>
    </li>
  );
}

function SentCard({ s, onGone }: { s: SentToMe; onGone: (id: string) => void }): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const where = s.wardId ? `${wardCodeOf(s.wardId)} ward` : null;

  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await ngoApi.acceptSent(s.dispatchId);
      router.push(`/sos/${encodeURIComponent(s.caseId)}`);
    } catch (err) {
      setProblem(errorWords(err, "Could not take it. Try again."));
      setBusy(false);
    }
  };
  const cant = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await ngoApi.declineSent(s.dispatchId);
      onGone(s.dispatchId);
    } catch (err) {
      setProblem(errorWords(err, "Could not say that. Try again."));
      setBusy(false);
    }
  };

  return (
    <li className={`${styles.card} ${styles.sosCard}`}>
      <div className={styles.cardTop}>
        <h3 className={styles.cardTitle}>{s.dogName ? `${s.dogName} needs help` : "A dog needs help"}</h3>
        <span className={`${styles.cardTag} ${styles.danger}`}>{waitWords(s.openedAt)}</span>
      </div>
      <p className={styles.cardSub}>
        {[where, s.withAmbulance ? "you and the ambulance" : "you were sent"].filter(Boolean).join(" · ")}
      </p>
      {problem && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      <button type="button" className={styles.sosBtn} onClick={() => void go()} disabled={busy}>
        I&apos;ll go
      </button>
      <button type="button" className={`${styles.linkBtn} ${styles.linkTight}`} onClick={() => void cant()} disabled={busy}>
        Can&apos;t
      </button>
    </li>
  );
}

function Home(): React.JSX.Element {
  const [home, setHome] = useState<NgoHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"ambulance" | "beds" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchHome = useCallback(() => {
    setError(null);
    ngoApi.getNgoHome().then(setHome, (err: unknown) => setError(errorWords(err)));
  }, []);

  useEffect(() => {
    fetchHome();
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [fetchHome]);

  if (!home) {
    return (
      <div className={`h-container ${styles.body} ${styles.bodyTop}`}>
        <h1 className={styles.title}>NGO</h1>
        {error ? <LoadError message={error} onRetry={fetchHome} /> : <Loading />}
      </div>
    );
  }

  const { ngo } = home;
  const coordinator = isCoordinator(home.role);
  const amb = ngo.ambulance ?? null;
  const setAmb = (a: NgoAmbulance) => setHome((h) => (h ? { ...h, ngo: { ...h.ngo, ambulance: a } } : h));
  const setBeds = (b: NgoBeds) => setHome((h) => (h ? { ...h, ngo: { ...h.ngo, beds: b } } : h));

  const markBack = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await ngoApi.updateAmbulance({ status: "in" });
      setAmb({ ...(amb ?? { count: 1, hours: null }), ...saved, status: "in", caseId: null, dogName: null });
    } catch (err) {
      setNotice(errorWords(err, "Could not mark it back. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const showAmbulance = !!amb || ngo.offers.includes("ambulance");
  const showBeds = !!ngo.beds || ngo.offers.includes("shelter_beds");

  return (
    <div className={`h-container ${styles.body} ${styles.bodyTop}`}>
      <div className={styles.stack6}>
        <p className={styles.kicker}>{ngoKicker(ngo)}</p>
        <h1 className={styles.title}>NGO</h1>
      </div>

      {home.sentToMe && home.sentToMe.length > 0 && (
        <section className={styles.stack10} aria-labelledby="ngo-sent">
          <h2 id="ngo-sent" className={styles.label}>
            Sent to you · {home.sentToMe.length}
          </h2>
          <ul className={styles.cardList}>
            {home.sentToMe.map((s) => (
              <SentCard
                key={s.dispatchId}
                s={s}
                onGone={(id) =>
                  setHome((h) => (h ? { ...h, sentToMe: (h.sentToMe ?? []).filter((x) => x.dispatchId !== id) } : h))
                }
              />
            ))}
          </ul>
        </section>
      )}

      {ngo.status === "paused" && (
        <div className={`${styles.card} ${styles.pausedCard}`} role="status">
          <p className={styles.cardTitle}>Paused by Hetja</p>
          <p className={styles.cardSub}>
            New SOS cases in your wards go to vets nearby for now.{ngo.reason ? ` From Hetja: ${ngo.reason}` : ""}
          </p>
        </div>
      )}

      <section className={styles.stack10} aria-labelledby="ngo-sos">
        <h2 id="ngo-sos" className={styles.label}>
          {sosLabel(home.sos.length)}
        </h2>
        {home.sos.length === 0 ? (
          <p className={`${styles.card} ${styles.cardSub}`}>No SOS in your wards right now.</p>
        ) : (
          <ul className={styles.cardList}>
            {home.sos.map((c) => (
              <SosCard key={c.caseId} c={c} canSend={coordinator} now={now} />
            ))}
          </ul>
        )}
      </section>

      {(showAmbulance || showBeds) && (
        <div className={styles.tiles}>
          {showAmbulance && (
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Ambulance</span>
              <span className={styles.tileValue}>{amb?.status === "out" ? "Out" : amb ? "In" : "Not set"}</span>
              {amb?.status === "out" ? (
                <button type="button" className={styles.inlineLink} onClick={() => void markBack()} disabled={busy}>
                  Mark back
                </button>
              ) : (
                <button type="button" className={styles.inlineLink} onClick={() => setSheet("ambulance")}>
                  Update
                </button>
              )}
            </div>
          )}
          {showBeds && (
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Shelter beds</span>
              <span className={styles.tileValue}>{bedsLine(ngo.beds)}</span>
              <button type="button" className={styles.inlineLink} onClick={() => setSheet("beds")}>
                Update
              </button>
            </div>
          )}
        </div>
      )}
      {notice && (
        <p className={styles.error} role="alert">
          {notice}
        </p>
      )}

      <ul className={styles.list}>
        <li>
          <Link href="/ngo/team" className={styles.row}>
            <span className={styles.rowTitle}>Team</span>
            <span className={styles.rowValue}>{teamLine(home.team)} ›</span>
          </Link>
        </li>
        <li>
          <Link href={home.nextDrive ? `/ngo/drives/${encodeURIComponent(home.nextDrive.id)}` : "/ngo/drives"} className={styles.row}>
            <span className={styles.rowTitle}>Drives</span>
            <span className={styles.rowValue}>{nextDriveLine(home.nextDrive)} ›</span>
          </Link>
        </li>
        <li>
          <Link href="/ngo/dogs" className={styles.row}>
            <span className={styles.rowTitle}>Dogs in your wards</span>
            <span className={styles.rowValue}>{dogsLine(home.dogs)} ›</span>
          </Link>
        </li>
      </ul>

      <Link href="/scan" className={styles.scanCard}>
        <span className={styles.scanIcon} aria-hidden="true">
          ⌗
        </span>
        <span className={styles.rowText}>
          <span className={`${styles.rowTitle} ${styles.rowTitleBold}`}>Scan a collar</span>
          <span className={styles.rowSub}>Or search by name or ID</span>
        </span>
      </Link>

      <ul className={styles.list}>
        {home.isVet && (
          <li>
            <Link href="/vet" className={styles.row}>
              <span className={styles.rowTitle}>Vet tools</span>
              <span className={styles.rowValue}>Sign records ›</span>
            </Link>
          </li>
        )}
        <li>
          <Link href="/ngo/profile" className={styles.row}>
            <span className={styles.rowTitle}>NGO profile</span>
            <span className={styles.rowValue}>{phoneWords(ngo.publicPhone)} ›</span>
          </Link>
        </li>
      </ul>

      <AmbulanceSheet open={sheet === "ambulance"} onClose={() => setSheet(null)} value={amb} onSaved={setAmb} />
      <BedsSheet open={sheet === "beds"} onClose={() => setSheet(null)} value={ngo.beds ?? null} onSaved={setBeds} />
    </div>
  );
}
