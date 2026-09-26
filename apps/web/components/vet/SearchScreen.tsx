"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DogAvatar } from "@/components/ds";
import { api, ApiError, type DogCard } from "@/lib/api";
import { wardCode } from "@/lib/feeder-prefs";
import { knownCount, normaliseCode, prettyCode } from "@/lib/scan-code";
import { dogName } from "@/lib/streak";
import { vetApi } from "./vet-api";
import { useOnMount, useSignedIn, VetTop } from "./VetParts";
import styles from "./vet.module.css";

/**
 * "Or search by name or ID" from V2's Scan a collar card (designed). An ID
 * (the collar code, whole or in part) goes to GET /dogs/lookup; a name goes
 * to GET /vet/dogs?q=, which matches the dogs in the vet's own wards, where
 * a vet works. Each result opens V2b.
 */

export function looksLikeCode(q: string): boolean {
  const t = q.trim();
  return /\d/.test(t) && !/\s{2,}/.test(t) && knownCount(normaliseCode(t)) >= 4;
}

export default function SearchScreen(): React.JSX.Element {
  const { signedIn } = useSignedIn("/vet/search");
  const [q, setQ] = useState("");
  const [wards, setWards] = useState<string[]>([]);
  const [results, setResults] = useState<DogCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useOnMount(() => {
    if (!signedIn()) return;
    vetApi
      .getMyVet()
      .then((v) => setWards(v?.wards ?? []))
      .catch(() => setWards([]));
  });

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        let out: DogCard[] = [];
        if (looksLikeCode(term)) {
          const r = await api.lookupDogs(normaliseCode(term).padEnd(9, "?"));
          out = [r.exact, ...r.matches].filter((d): d is DogCard => !!d);
        } else {
          out = (await vetApi.searchDogs(term)).map((d) => ({ ...d, markings: [], lastSeenAt: null }));
        }
        if (n === seq.current) setResults(out.slice(0, 30));
      } catch (err) {
        if (n === seq.current) setError(err instanceof ApiError && err.status === 400 ? "Type a bit more of the code." : "Hetja could not be reached. Try again.");
      } finally {
        if (n === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, wards]);

  return (
    <div className={`${styles.page} ${styles.mist}`}>
      <VetTop back="Vet" href="/vet" />
      <div className={`${styles.body} ${styles.listBody}`}>
        <h1 className={styles.title}>Find a dog</h1>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Name or collar ID</span>
          <input
            className={`${styles.input} ${styles.inputWhite}`}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rani, or RNI 482 PQ7"
            autoComplete="off"
            autoCapitalize="none"
            enterKeyHint="search"
          />
          <span className={styles.hint}>Names are matched in your wards{wards.length ? ` (${wards.map(wardCode).join(", ")})` : ""}. An ID works anywhere in Mumbai.</span>
        </label>
        {busy && (
          <p className={styles.status} role="status">
            Looking.
          </p>
        )}
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
        {results && !busy && results.length === 0 && (
          <p className={styles.empty} role="status">
            No dog found. Check the spelling, or scan the collar.
          </p>
        )}
        {results && results.length > 0 && (
          <ul className={styles.list}>
            {results.map((d) => {
              const name = dogName(d.name);
              return (
                <li key={d.slug}>
                  <Link href={`/vet/dogs/${encodeURIComponent(d.slug)}`} className={styles.row}>
                    <DogAvatar id={d.slug} name={name} photoUrl={d.photoUrl} size={44} />
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{name}</span>
                      <span className={styles.rowSub}>
                        {prettyCode(d.slug)} · {d.wardCode || wardCode(d.wardId)} ward
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
