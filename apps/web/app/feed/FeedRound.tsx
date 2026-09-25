"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, DogAvatar, StatusIcon, StickyFooter } from "@/components/ds";
import { api, ApiError, bestEffortDeviceToken, type MyDogV5, type ScanBatchItem } from "@/lib/api";
import { uuid } from "@/lib/idb";
import { captureGeo, enqueueFeed } from "@/lib/offline-queue";
import { rememberDogNames } from "@/lib/care-cache";
import { dogName } from "@/lib/streak";
import { FeedDone, type FedDog } from "./FeedDone";
import { countFeeds } from "./FeedScreen";
import styles from "./feed.module.css";

/**
 * V11 "Who did you feed?" (design v6): /feed with no dog. The feeder's own
 * dogs, least recently fed first, multi-select, one POST /scans/batch for the
 * round (up to 12, the same rules as single feeds). Photos and outcomes stay
 * on the single-dog screen. With no signal each feed goes into the offline
 * queue instead, so the round is never lost.
 */

export const ROUND_MAX = 12;

/** "Log 2 feeds", "Log 1 feed", "Log feeds". */
export function roundLabel(n: number): string {
  if (n === 0) return "Log feeds";
  return `Log ${n} ${n === 1 ? "feed" : "feeds"}`;
}

/** Least recently fed first; never-fed first of all. Deceased and adopted dogs are not fed. */
export function roundOrder(dogs: MyDogV5[]): MyDogV5[] {
  return dogs
    .filter((d) => !d.status || d.status === "active" || d.status === "lost")
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const ta = a.d.lastFedAt ? Date.parse(a.d.lastFedAt) : -Infinity;
      const tb = b.d.lastFedAt ? Date.parse(b.d.lastFedAt) : -Infinity;
      return ta - tb || a.i - b.i;
    })
    .map((x) => x.d);
}

function offline(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  } catch {
    return false;
  }
}

type Load = { kind: "loading" } | { kind: "none" } | { kind: "ready"; dogs: MyDogV5[] };

export function FeedRound({ onEmpty }: { onEmpty: () => React.JSX.Element }): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ dogs: FedDog[]; streak: number | null; note: string | null; first?: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getMyDogsV5()
      .then(({ dogs }) => {
        if (!live) return;
        const order = roundOrder(dogs);
        setLoad(order.length ? { kind: "ready", dogs: order } : { kind: "none" });
        void rememberDogNames(dogs);
      })
      .catch(() => live && setLoad({ kind: "none" }));
    return () => {
      live = false;
    };
  }, []);

  const toggle = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : p.length >= ROUND_MAX ? p : [...p, slug]));

  const submit = useCallback(async () => {
    if (load.kind !== "ready" || busy || picked.length === 0) return;
    setBusy(true);
    setError(null);
    const bySlug = new Map(load.dogs.map((d) => [d.slug, d]));
    const chosen = picked.map((s) => bySlug.get(s)!).filter(Boolean);
    const fed = (list: MyDogV5[]): FedDog[] =>
      list.map((d) => ({ slug: d.slug, name: dogName(d.name), photoUrl: d.photoUrl ?? null, sex: d.sex ?? null }));
    try {
      const geo = await captureGeo();
      const deviceToken = await bestEffortDeviceToken();
      const queueAll = async () => {
        for (const d of chosen) await enqueueFeed({ dogSlug: d.slug, geo, deviceToken, dogName: d.name });
      };
      if (offline()) {
        await queueAll();
        setDone({ dogs: fed(chosen), streak: null, note: "Saved on this phone. It sends when you're back online." });
        return;
      }
      const capturedAt = new Date().toISOString();
      const feeds: ScanBatchItem[] = chosen.map((d) => ({
        clientUuid: uuid(),
        dogSlug: d.slug,
        capturedAt,
        ...(geo ? { geo } : {}),
      }));
      let res;
      try {
        res = await api.createScanBatch(feeds, { deviceToken });
      } catch (err) {
        if (err instanceof ApiError && (err.status === 0 || err.status === 408 || err.status >= 500)) {
          // The network or the server failed mid-round: keep every feed on the phone.
          await queueAll();
          setDone({ dogs: fed(chosen), streak: null, note: "Saved on this phone. It sends when the signal is back." });
          return;
        }
        throw err;
      }
      const refused = res.results.filter((r) => r.error);
      const ok = chosen.filter((d) => !refused.some((r) => r.dogSlug === d.slug));
      if (ok.length === 0) {
        setError("Hetja couldn't log these feeds. Try again, or log them one at a time.");
        return;
      }
      const note = refused.length
        ? `${refused.map((r) => dogName(bySlug.get(r.dogSlug)?.name)).join(", ")}: not logged. ${refused[0]!.error!.message}`
        : null;
      setDone({ dogs: fed(ok), streak: res.streak?.streakDays ?? null, note, first: countFeeds(ok.length) });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "That's a lot of feeds at once. Try again in a minute."
          : "Could not log the feeds. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, load, picked]);

  if (done) return <FeedDone dogs={done.dogs} streakDays={done.streak} note={done.note} firstFeed={!!done.first} />;
  if (load.kind === "none") return onEmpty();

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <Link href="/me" className={styles.cancel}>
          Cancel
        </Link>
      </div>
      <div className={`${styles.body} ${styles.roundBody}`}>
        <h1 className={styles.title}>Who did you feed?</h1>
        <p className={styles.state}>Tap everyone from tonight&rsquo;s round.</p>
        {load.kind === "loading" ? (
          <p className={styles.state} role="status">
            Loading your dogs.
          </p>
        ) : (
          <>
            <ul className={styles.roundGrid}>
              {load.dogs.map((d) => {
                const name = dogName(d.name);
                const on = picked.includes(d.slug);
                return (
                  <li key={d.slug}>
                    <button
                      type="button"
                      className={styles.roundDog}
                      aria-pressed={on}
                      onClick={() => toggle(d.slug)}
                    >
                      <span className={on ? `${styles.roundFace} ${styles.roundFaceOn}` : styles.roundFace}>
                        <DogAvatar id={d.slug} name={name} photoUrl={d.photoUrl ?? null} size={104} className={styles.roundAvatar} />
                        {on && (
                          <span className={styles.roundTick} aria-hidden="true">
                            <StatusIcon name="check" size={14} strokeWidth={2.6} />
                          </span>
                        )}
                      </span>
                      <span className={on ? styles.roundNameOn : styles.roundName}>{name}</span>
                    </button>
                  </li>
                );
              })}
              <li>
                <Link href="/scan?intent=feed" className={styles.roundDog}>
                  <span className={styles.roundScan} aria-hidden="true">
                    +
                  </span>
                  <span className={styles.roundScanName}>Scan</span>
                </Link>
              </li>
            </ul>
            <p className={styles.sosNote}>Your dogs, most recently fed last. Scan anyone new.</p>
          </>
        )}
      </div>
      <StickyFooter background="mist" className={styles.footer}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button fullWidth onClick={() => void submit()} disabled={busy || picked.length === 0} aria-busy={busy || undefined}>
          {roundLabel(picked.length)}
        </Button>
      </StickyFooter>
    </div>
  );
}
