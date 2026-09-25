"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { DogAvatar } from "@/components/ds";
import { ApiError } from "@/lib/api";
import { wardCode } from "@/lib/feeder-prefs";
import { dogName } from "@/lib/streak";
import { dueLine, longDate, shortDate } from "./vet-copy";
import { lowerTitle, vetApi, type DueSoonDog, type SignedRecord } from "./vet-api";
import { useOnMount, useSignedIn, VetMessage, VetTop } from "./VetParts";
import styles from "./vet.module.css";

/**
 * Two designed screens (design v7, "Screens to design"), in V2's list
 * language: My signatures (every record this vet signed; each opens V5 to
 * correct or withdraw it) and Due soon (the dogs in the vet's wards whose
 * booster falls due, each opening V2b).
 */

function signatureSub(r: SignedRecord): string {
  const signed = r.signedAt ? `Signed ${shortDate(r.signedAt.slice(0, 10))}` : "Signed";
  const state = r.withdrawn ? "Withdrawn" : r.corrected ? "Corrected" : r.flagged ? "Flagged for re-check" : "";
  return [state || signed, r.batch].filter(Boolean).join(" · ");
}

export function SignaturesScreen(): React.JSX.Element {
  const { toLogin, signedIn } = useSignedIn("/vet/signatures");
  const [load, setLoad] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; list: SignedRecord[] }>({ kind: "loading" });

  const fetchList = useCallback(async () => {
    try {
      setLoad({ kind: "ready", list: await vetApi.getSignatures() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setLoad({ kind: "error" });
    }
  }, [toLogin]);

  useOnMount(() => {
    if (signedIn()) void fetchList();
  });

  if (load.kind === "loading") return <VetMessage back="Vet" href="/vet" lead="Loading." role="status" />;
  if (load.kind === "error") {
    return (
      <VetMessage back="Vet" href="/vet" title="Hetja could not be reached." lead="Check your connection and try again.">
        <button type="button" className={`${styles.textLink} ${styles.more}`} onClick={() => void fetchList()}>
          Try again
        </button>
      </VetMessage>
    );
  }

  const list = load.list;
  return (
    <div className={`${styles.page} ${styles.mist}`}>
      <VetTop back="Vet" href="/vet" />
      <div className={`${styles.body} ${styles.listBody}`}>
        <h1 className={styles.title}>My signatures</h1>
        <p className={`${styles.lead} ${styles.leadTight}`}>
          Every record you signed. Signed records can&rsquo;t be edited: open one to correct it or withdraw it.
        </p>
        {list.length === 0 ? (
          <p className={styles.empty}>Nothing signed yet. Records you sign from the Vet tab show here.</p>
        ) : (
          <ul className={styles.list}>
            {list.map((r) => {
              const name = dogName(r.dog.name);
              const inner = (
                <>
                  <DogAvatar id={r.dog.slug} name={name} photoUrl={r.dog.photoUrl} size={44} />
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>
                      {name} · {lowerTitle(r.title)}
                    </span>
                    <span className={styles.rowSub}>{signatureSub(r)}</span>
                  </span>
                </>
              );
              return (
                <li key={r.id}>
                  {r.withdrawn || r.corrected ? (
                    <div className={styles.row}>{inner}</div>
                  ) : (
                    <Link href={`/vet/signatures/${encodeURIComponent(r.id)}`} className={styles.row}>
                      {inner}
                      <span className={styles.chev} aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function DueSoonScreen(): React.JSX.Element {
  const { toLogin, signedIn } = useSignedIn("/vet/due");
  const [load, setLoad] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; by: string | null; dogs: DueSoonDog[] }>({
    kind: "loading",
  });

  const fetchList = useCallback(async () => {
    try {
      const r = await vetApi.getDueSoon();
      setLoad({ kind: "ready", ...r });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setLoad({ kind: "error" });
    }
  }, [toLogin]);

  useOnMount(() => {
    if (signedIn()) void fetchList();
  });

  if (load.kind === "loading") return <VetMessage back="Vet" href="/vet" lead="Loading." role="status" />;
  if (load.kind === "error") {
    return (
      <VetMessage back="Vet" href="/vet" title="Hetja could not be reached." lead="Check your connection and try again.">
        <button type="button" className={`${styles.textLink} ${styles.more}`} onClick={() => void fetchList()}>
          Try again
        </button>
      </VetMessage>
    );
  }

  const { dogs, by } = load;
  const sorted = [...dogs].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return (
    <div className={`${styles.page} ${styles.mist}`}>
      <VetTop back="Vet" href="/vet" />
      <div className={`${styles.body} ${styles.listBody}`}>
        <h1 className={styles.title}>Due soon</h1>
        <p className={`${styles.lead} ${styles.leadTight}`}>
          {dueLine(dogs.length, by)}, in your wards. Their feeders are reminded a week before.
        </p>
        {sorted.length > 0 && (
          <ul className={styles.list}>
            {sorted.map((d) => {
              const name = dogName(d.dog.name);
              return (
                <li key={d.dog.slug}>
                  <Link href={`/vet/dogs/${encodeURIComponent(d.dog.slug)}`} className={styles.row}>
                    <DogAvatar id={d.dog.slug} name={name} photoUrl={d.dog.photoUrl} size={44} />
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>
                        {name}
                        {d.title ? ` · ${lowerTitle(d.title)}` : ""}
                      </span>
                      <span className={styles.rowSub}>
                        {[`Due ${longDate(d.dueOn)}`, d.wardId ? `${wardCode(d.wardId)} ward` : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className={styles.chev} aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
