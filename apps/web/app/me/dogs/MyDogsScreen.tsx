"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DogAvatar, StatusPill } from "@/components/ds";
import { CareTop } from "@/components/care/CareTop";
import care from "@/components/care/care.module.css";
import { api, ApiError, getAccessToken, type MyDogV5 } from "@/lib/api";
import { refreshCareNumbers, rememberDogNames } from "@/lib/care-cache";
import { myDogRow, myDogsSummary, NEEDS_YOU } from "@/lib/care-copy";
import { dogName } from "@/lib/streak";
import styles from "./my-dogs.module.css";

/**
 * N4 My dogs (design v5): every dog the caller registered or fed in the last
 * 60 days, what needs doing first. The row's pill comes from the API's
 * `attention` (lib/care-copy.ts myDogRow). "Needs you" counts SOS, tag and
 * missing; a vaccine due or a new dog is shown but does not count.
 *
 * A dog someone else registered and nobody has verified yet can be confirmed
 * here by a second feeder (POST /dogs/:slug/confirm), in its own small
 * section under the list so the list itself stays one tap per dog.
 */

type Load =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; dogs: MyDogV5[] };

type Filter = "needs" | "all";

/** Needs-you first (SOS, then tag, then missing), otherwise the server's order. */
export function sortMyDogs(dogs: MyDogV5[]): MyDogV5[] {
  const rank = (d: MyDogV5) => {
    const k = d.attention?.kind;
    const i = k ? NEEDS_YOU.indexOf(k) : -1;
    return i === -1 ? NEEDS_YOU.length : i;
  };
  return dogs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
    .map((x) => x.d);
}

/** Dogs this caller can confirm as a second feeder. */
export function confirmable(dogs: MyDogV5[]): MyDogV5[] {
  return dogs.filter((d) => d.verified === false && d.registeredByMe === false);
}

export default function MyDogsScreen(): React.JSX.Element {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter | null>(null);
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, true>>({});
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const fetchDogs = useCallback(async () => {
    try {
      const { dogs } = await api.getMyDogsV5();
      setLoad({ kind: "ready", dogs });
      void rememberDogNames(dogs);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        routerRef.current.replace(`/login?next=${encodeURIComponent("/me/dogs")}`);
        return;
      }
      setLoad({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    if (!getAccessToken()) {
      routerRef.current.replace(`/login?next=${encodeURIComponent("/me/dogs")}`);
      return;
    }
    void fetchDogs();
    // While online, keep the care numbers for this feeder's wards on the
    // phone, so N7 can offer them with no signal.
    void refreshCareNumbers();
  }, [fetchDogs]);

  const confirm = useCallback(async (d: MyDogV5) => {
    setConfirmBusy(d.slug);
    setConfirmError(null);
    try {
      await api.confirmDog(d.slug);
      setConfirmed((c) => ({ ...c, [d.slug]: true }));
      setLoad((l) =>
        l.kind === "ready"
          ? {
              kind: "ready",
              dogs: l.dogs.map((x) =>
                x.slug === d.slug
                  ? { ...x, verified: true, attention: x.attention?.kind === "new" ? null : x.attention }
                  : x,
              ),
            }
          : l,
      );
    } catch (err) {
      const name = dogName(d.name);
      setConfirmError(
        err instanceof ApiError && err.status === 403
          ? `Only a second feeder of ${name} can confirm, not the one who registered.`
          : err instanceof ApiError && err.status === 409
            ? `${name} is already confirmed.`
            : "Hetja could not be reached. Try again in a minute.",
      );
    } finally {
      setConfirmBusy(null);
    }
  }, []);

  const top = (
    <CareTop
      back="Me"
      href="/me"
      trailing={
        <Link href="/register" className={care.topLink}>
          + Register
        </Link>
      }
    />
  );

  if (load.kind !== "ready") {
    return (
      <div className={care.page}>
        {top}
        <div className={care.body}>
          <h1 className={care.title}>My dogs</h1>
          {load.kind === "loading" ? (
            <p className={care.lead} role="status">
              Loading your dogs.
            </p>
          ) : (
            <>
              <p className={care.lead} role="alert">
                Hetja could not be reached. Check your connection and try again.
              </p>
              <div>
                <Button variant="quiet" onClick={() => void fetchDogs()}>
                  Try again
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const dogs = sortMyDogs(load.dogs);
  const now = Date.now();
  const rows = dogs.map((d) => ({ d, row: myDogRow(d, now) }));
  const needing = rows.filter((r) => r.row.needsYou);
  const active: Filter = filter ?? (needing.length > 0 ? "needs" : "all");
  const shown = active === "needs" ? needing : rows;
  // Just-confirmed dogs stay in the section so the thank-you is seen.
  const toConfirm = load.dogs.filter((d) => confirmed[d.slug] || confirmable([d]).length > 0);

  if (dogs.length === 0) {
    return (
      <div className={care.page}>
        {top}
        <div className={care.body}>
          <div className={styles.head}>
            <h1 className={care.title}>My dogs</h1>
            <p className={styles.summary}>No dogs yet.</p>
          </div>
          <p className={care.lead}>Dogs you register or feed show up here, with what needs doing first.</p>
        </div>
        <div className={styles.footer}>
          <Button href="/register" fullWidth>
            Register a dog
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={care.page}>
      {top}
      <div className={care.body}>
        <div className={styles.head}>
          <h1 className={care.title}>My dogs</h1>
          <p className={styles.summary}>{myDogsSummary(dogs.length, needing.length)}</p>
        </div>

        <div className={styles.chips} role="group" aria-label="Show">
          <button
            type="button"
            className={[styles.chip, active === "needs" ? styles.chipOn : ""].filter(Boolean).join(" ")}
            aria-pressed={active === "needs"}
            onClick={() => setFilter("needs")}
          >
            Needs you · {needing.length}
          </button>
          <button
            type="button"
            className={[styles.chip, active === "all" ? styles.chipOn : ""].filter(Boolean).join(" ")}
            aria-pressed={active === "all"}
            onClick={() => setFilter("all")}
          >
            All · {dogs.length}
          </button>
        </div>

        {shown.length === 0 ? (
          <p className={care.lead}>Nothing needs you today. Every dog here is fed or looked after.</p>
        ) : (
          <ul className={styles.list}>
            {shown.map(({ d, row }) => {
              const name = dogName(d.name);
              const inner = (
                <>
                  <DogAvatar id={d.slug} name={name} photoUrl={d.photoUrl ?? null} size={44} />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{name}</span>
                    <span className={styles.rowSub}>{row.sub}</span>
                  </span>
                  {row.tag && (
                    <StatusPill variant={row.variant} icon={row.icon} size="small">
                      {row.tag}
                    </StatusPill>
                  )}
                </>
              );
              return (
                <li key={d.slug} className={styles.item}>
                  {row.href.startsWith("/d/") ? (
                    <a href={row.href} className={styles.rowLink}>
                      {inner}
                    </a>
                  ) : (
                    <Link href={row.href} className={styles.rowLink}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {toConfirm.length > 0 && (
          <section className={styles.confirm} aria-labelledby="confirm-label">
            <h2 id="confirm-label" className={care.label}>
              Confirm a new dog
            </h2>
            <p className={care.foot}>
              A new dog shows as Unverified until a second feeder or a vet confirms it. Confirm only a dog you have
              fed yourself and whose photo is right.
            </p>
            <ul className={styles.list}>
              {toConfirm.map((d) => {
                const name = dogName(d.name);
                const done = confirmed[d.slug];
                return (
                  <li key={d.slug} className={`${styles.item} ${styles.confirmRow}`}>
                    <DogAvatar id={d.slug} name={name} photoUrl={d.photoUrl ?? null} size={44} />
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>{name}</span>
                      <span className={styles.rowSub}>{done ? "Confirmed. Thank you." : "Unverified"}</span>
                    </span>
                    {!done && (
                      <Button
                        variant="quiet"
                        onClick={() => void confirm(d)}
                        disabled={confirmBusy !== null}
                        aria-busy={confirmBusy === d.slug || undefined}
                        aria-label={`Confirm ${name}`}
                      >
                        Confirm
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            {confirmError && (
              <p className={care.alert} role="alert">
                {confirmError}
              </p>
            )}
          </section>
        )}
      </div>

      <div className={styles.footer}>
        <Link href="/register/batch" className={care.outline}>
          Print a batch sheet
        </Link>
      </div>
    </div>
  );
}
