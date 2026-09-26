"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DogAvatar } from "@/components/ds";
import { api, ApiError } from "@/lib/api";
import { saveTabRole } from "@/lib/tab-role";
import { dogName } from "@/lib/streak";
import { dueLine, maySign, noSignLine, regLine, requestSub, requestTitle, sosLabel, sosSub } from "./vet-copy";
import { vetApi, type VetHome as Home, type VetSos } from "./vet-api";
import { ScanGlyph, useOnMount, useSignedIn } from "./VetParts";
import styles from "./vet.module.css";

/**
 * V2 "Vet" (design v7), the Vet tab. A tab root: the shell draws the role
 * tab bar (Home, Map, Vet, Me), and Scan lives here as "Scan a collar".
 *
 *   ✓ Verified · MSVC 5190     the pill opens the vet profile
 *   SOS near you               I'll take it (takes the case, opens it) / Can't
 *   Scan a collar              the scanner, which opens V2b for a vet;
 *                              "Or search by name or ID" is its own link
 *   Feeders asking you to sign each row opens V3, filled in from the request
 *   Due soon in your wards     See list
 *
 * Below the board's sections (older real content kept, restyled): My
 * signatures and Vet profile. A suspended vet sees "Paused" and no SOS.
 */

function pronoun(sex: VetSos["sex"]): "him" | "her" | "the dog" {
  return sex === "male" ? "him" : sex === "female" ? "her" : "the dog";
}

export default function VetHome(): React.JSX.Element {
  const router = useRouter();
  const { toLogin, signedIn } = useSignedIn("/vet");
  const [load, setLoad] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; home: Home }>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchHome = useCallback(async () => {
    try {
      const home = await vetApi.getHome();
      if (home.vet.status !== "verified" && home.vet.status !== "suspended") {
        router.replace("/vet/apply");
        return;
      }
      setLoad({ kind: "ready", home });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        // Not a vet (any more): the tab bar goes back to Scan.
        saveTabRole(null);
        router.replace("/vet/apply");
        return;
      }
      setLoad({ kind: "error" });
    }
  }, [router, toLogin]);

  useOnMount(() => {
    if (signedIn()) void fetchHome();
  });

  const take = async (c: VetSos) => {
    if (busy) return;
    setBusy(c.caseId);
    setNotice(null);
    try {
      await api.ackSosCase(c.caseId);
      router.push(`/sos/${encodeURIComponent(c.caseId)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      if (err instanceof ApiError && err.status === 409) {
        setNotice("Someone else took this one. Thank you.");
        drop(c.caseId);
      } else setNotice("That didn't go through. Try again, or open the case from Alerts.");
    } finally {
      setBusy(null);
    }
  };

  const drop = (caseId: string) =>
    setLoad((l) => (l.kind === "ready" ? { kind: "ready", home: { ...l.home, sos: l.home.sos.filter((x) => x.caseId !== caseId) } } : l));

  const cant = async (c: VetSos) => {
    if (busy) return;
    setBusy(c.caseId);
    try {
      await api.declineSosCase(c.caseId);
    } catch {
      /* declining is a courtesy to the router: hide it either way */
    }
    drop(c.caseId);
    setBusy(null);
  };

  if (load.kind !== "ready") {
    return (
      <div className={`${styles.page} ${styles.mist}`}>
        <div className={styles.homeBody}>
          <div className={styles.homeHead}>
            <h1 className={styles.homeTitle}>Vet</h1>
          </div>
          {load.kind === "loading" ? (
            <p className={styles.status} role="status">
              Loading.
            </p>
          ) : (
            <>
              <p className={styles.alert} role="alert">
                Hetja could not be reached. Check your connection and try again.
              </p>
              <button type="button" className={styles.textLink} onClick={() => void fetchHome()}>
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const { vet, sos, signRequests, dueSoon } = load.home;
  const suspended = vet.status === "suspended";
  const signable = maySign(vet.status, vet.canSign);

  return (
    <div className={`${styles.page} ${styles.mist}`}>
      <div className={styles.homeBody}>
        <div className={styles.homeHead}>
          <h1 className={styles.homeTitle}>Vet</h1>
          <Link href="/vet/profile" className={[styles.verified, suspended ? styles.paused : ""].filter(Boolean).join(" ")}>
            {suspended ? "Paused" : `✓ Verified · ${regLine(vet)}`}
          </Link>
        </div>

        {suspended && (
          <p className={styles.empty} role="status">
            An admin paused your vet account, so you can&rsquo;t sign or take SOS calls for now. Records you already signed keep their badge.
          </p>
        )}

        {!suspended &&
          sos.map((c) => (
            <section key={c.caseId} className={`${styles.card} ${styles.sosCard}`} aria-labelledby={`sos-${c.caseId}`}>
              <p className={styles.sosLabel}>{sosLabel(c.distanceM)}</p>
              <h2 className={styles.sosTitle} id={`sos-${c.caseId}`}>
                {c.title}
              </h2>
              <p className={styles.sosSub}>{sosSub(c.place, c.withName, pronoun(c.sex))}</p>
              <div className={styles.sosActions}>
                <button type="button" className={styles.take} onClick={() => void take(c)} disabled={busy !== null} aria-busy={busy === c.caseId || undefined}>
                  I&rsquo;ll take it
                </button>
                <button type="button" className={styles.cant} onClick={() => void cant(c)} disabled={busy !== null}>
                  Can&rsquo;t
                </button>
              </div>
            </section>
          ))}
        {notice && (
          <p className={styles.status} role="status">
            {notice}
          </p>
        )}

        <div className={styles.scanCard}>
          <span className={styles.scanIcon}>
            <ScanGlyph />
          </span>
          <span className={styles.scanText}>
            <Link href="/scan?intent=vet" className={styles.scanLink}>
              Scan a collar
            </Link>
            <Link href="/vet/search" className={styles.searchLink}>
              Or search by name or ID
            </Link>
          </span>
        </div>

        <h2 className={styles.sectionLabel}>Feeders asking you to sign · {signRequests.length}</h2>
        {signRequests.length === 0 ? (
          <p className={styles.empty}>Nobody is waiting on you. When a feeder asks you to sign something, it shows here.</p>
        ) : (
          <>
            {!signable && !suspended && (
              <p className={styles.empty} role="status">
                {noSignLine(vet.status)}
              </p>
            )}
            <ul className={styles.list}>
              {signRequests.map((r) => {
                const inner = (
                  <>
                    <DogAvatar id={r.dog.slug} name={dogName(r.dog.name)} photoUrl={r.dog.photoUrl} size={44} />
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{requestTitle(r)}</span>
                      <span className={styles.rowSub}>{requestSub(r)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={r.id}>
                    {signable ? (
                      <Link
                        href={`/vet/dogs/${encodeURIComponent(r.dog.slug)}/sign?request=${encodeURIComponent(r.id)}&kind=${r.kind}`}
                        className={styles.row}
                      >
                        {inner}
                        <span className={styles.chev} aria-hidden="true">
                          ›
                        </span>
                      </Link>
                    ) : (
                      <div className={styles.row}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <h2 className={styles.sectionLabel}>Due soon in your wards</h2>
        <div className={styles.dueCard}>
          <span>{dueLine(dueSoon.count, dueSoon.by)}</span>
          {dueSoon.count > 0 && (
            <Link href="/vet/due" className={styles.dueLink}>
              See list
            </Link>
          )}
        </div>

        <ul className={`${styles.list} ${styles.more}`}>
          <li>
            <Link href="/vet/signatures" className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>My signatures</span>
                <span className={styles.rowSub}>Correct or withdraw a record you signed</span>
              </span>
              <span className={styles.chev} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
          <li>
            <Link href="/vet/profile" className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>Vet profile</span>
                <span className={styles.rowSub}>Wards, SOS hours, phone, clinic</span>
              </span>
              <span className={styles.chev} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
