"use client";

import { useCallback, useEffect, useState } from "react";
import { DogAvatar, Segmented, StatusPill } from "@/components/ds";
import { ngoApi, type WardDogs } from "./ngo-api";
import { dogsLine, wardCodeOf } from "./ngo-copy";
import { ActiveNgo, errorWords, LoadError, Loading, NgoFrame } from "./NgoGate";
import styles from "./ngo.module.css";

/**
 * Dogs in your wards (designed; N2's "412 · 38 unsterilised ›"). Every dog
 * on Hetja in the NGO's wards, or only the ones not yet sterilised: the
 * list a drive is planned from. Ward level only, as everywhere public.
 * A dog opens its collar page (/d/<slug>, the scan app).
 */

type Filter = "all" | "unsterilised";

export default function WardDogsScreen(): React.JSX.Element {
  return (
    <ActiveNgo next="/ngo/dogs" frame={{ href: "/ngo", label: "NGO" }}>
      {() => <Dogs />}
    </ActiveNgo>
  );
}

function Dogs(): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>("all");
  const [data, setData] = useState<WardDogs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchIt = useCallback(() => {
    setError(null);
    setData(null);
    ngoApi.getWardDogs(filter).then(setData, (err: unknown) => setError(errorWords(err)));
  }, [filter]);
  useEffect(() => fetchIt(), [fetchIt]);

  return (
    <NgoFrame back={{ href: "/ngo", label: "NGO" }}>
      <div className={`h-container ${styles.body} ${styles.tight}`}>
        <div className={styles.head}>
          <h1 className={styles.title}>Dogs in your wards</h1>
          {data && <p className={styles.sub}>{dogsLine(data)}</p>}
        </div>
        <Segmented<Filter>
          label="Which dogs"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unsterilised", label: "Not sterilised" },
          ]}
        />
        {!data ? (
          error ? (
            <LoadError message={error} onRetry={fetchIt} />
          ) : (
            <Loading />
          )
        ) : data.dogs.length === 0 ? (
          <p className={`${styles.card} ${styles.cardSub}`}>
            {filter === "all" ? "No dogs on Hetja in your wards yet." : "Every dog here is sterilised."}
          </p>
        ) : (
          <ul className={styles.list}>
            {data.dogs.map((d) => (
              <li key={d.slug}>
                <a href={`/d/${encodeURIComponent(d.slug)}`} className={`${styles.row} ${styles.dogRow}`}>
                  <DogAvatar id={d.slug} name={d.name ?? "?"} size={36} />
                  <span className={`${styles.rowText} ${styles.grow}`}>
                    <span className={`${styles.rowTitle} ${styles.rowTitleBold}`}>{d.name ?? "No name yet"}</span>
                    <span className={styles.rowSub}>{wardCodeOf(d.wardId)} ward</span>
                  </span>
                  {d.sterilised === "yes" ? (
                    <StatusPill variant="ok" icon="check" size="small">
                      Sterilised
                    </StatusPill>
                  ) : (
                    <StatusPill variant={d.sterilised === "no" ? "warn" : "neutral"} icon="clock" size="small">
                      {d.sterilised === "no" ? "Not sterilised" : "Unknown"}
                    </StatusPill>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NgoFrame>
  );
}
