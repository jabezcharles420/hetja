"use client";

/**
 * R3 "Is this dog already registered?" (step 2 of 4). One dog, one code:
 * before any details, the dogs already on Hetja in the same ward
 * (GET /wards/:wardId/dogs, ward level only). "Same dog" opens that dog's
 * profile at /d/<slug>, where the person adds their photo with a feed
 * instead of minting a second code.
 */

import { useEffect, useState } from "react";
import { DogAvatar } from "@/components/ds";
import { api, type DogCard, type Ward } from "@/lib/api";
import { markingsPhrase, sinceLabel } from "@/lib/dog-copy";
import s from "../register.module.css";
import styles from "./flow.module.css";

/** How many similar dogs show before "Show more". */
export const DUPLICATE_PREVIEW = 5;

export function wardLabel(w: Pick<Ward, "code" | "name">): string {
  return `${w.code} · ${w.name}`;
}

export function duplicateLine(d: Pick<DogCard, "markings" | "lastSeenAt">, now = Date.now()): string {
  const since = sinceLabel(d.lastSeenAt, now);
  return [markingsPhrase(d.markings ?? []), since ? `seen ${since}` : null].filter(Boolean).join(" · ");
}

export default function DuplicateStep({
  wards,
  wardId,
  fromLocation,
  locating,
  onWard,
}: {
  wards: Ward[];
  wardId: string;
  fromLocation: boolean;
  locating: boolean;
  onWard: (id: string) => void;
}): React.JSX.Element {
  const [dogs, setDogs] = useState<DogCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const ward = wards.find((w) => w.id === wardId) ?? null;

  useEffect(() => {
    if (!wardId) return;
    let cancelled = false;
    setDogs(null);
    setFailed(false);
    setAll(false);
    api
      .getWardDogs(wardId)
      .then((r) => {
        if (!cancelled) setDogs(r.dogs);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wardId]);

  const code = ward?.code ?? wardId;
  const shown = dogs ? (all ? dogs : dogs.slice(0, DUPLICATE_PREVIEW)) : [];

  return (
    <>
      <label className={styles.wardRow} htmlFor="reg-ward">
        <span className={styles.wardText}>
          <span className={styles.wardLabel}>{fromLocation ? "Ward, from your location" : "Ward"}</span>
          <span className={styles.wardValue} data-empty={ward ? undefined : "true"}>
            {ward ? wardLabel(ward) : locating ? "Finding your ward…" : "Choose a ward"}
          </span>
        </span>
        <span className={styles.change} aria-hidden="true">
          Change
        </span>
        {/* The native picker, invisible over the row: the phone's own wheel. */}
        <select
          id="reg-ward"
          className={styles.select}
          value={wardId}
          onChange={(e) => onWard(e.target.value)}
          aria-label="Ward, change"
        >
          <option value="" disabled>
            Choose a ward
          </option>
          {wards.map((w) => (
            <option key={w.id} value={w.id}>
              {wardLabel(w)}
            </option>
          ))}
        </select>
      </label>

      <h1 className={s.title}>Is this dog already registered?</h1>
      {wardId && (
        <p className={s.text}>Similar dogs in {code}. If one matches, add your photo to them instead.</p>
      )}

      {wardId && dogs === null && !failed && (
        <p className={s.status} role="status">
          Loading…
        </p>
      )}
      {failed && <p className={s.status}>Could not load the dogs in {code}. You can still continue.</p>}
      {dogs && dogs.length === 0 && <p className={s.status}>No dogs are registered in {code} yet.</p>}

      {shown.length > 0 && (
        <ul className={styles.dupList}>
          {shown.map((d) => {
            const name = d.name?.trim() || "No name";
            return (
              <li key={d.slug} className={styles.dupRow}>
                <DogAvatar id={d.slug} name={name} photoUrl={d.photoUrl} size={52} />
                <span className={s.rowText}>
                  <span className={s.rowTitle}>{name}</span>
                  <span className={s.rowSub}>{duplicateLine(d)}</span>
                </span>
                <a className={styles.same} href={`/d/${d.slug}`} aria-label={`Same dog: ${name}`}>
                  Same dog
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {dogs && dogs.length > shown.length && (
        <button type="button" className={s.linkBtn} onClick={() => setAll(true)}>
          Show all {dogs.length}
        </button>
      )}
    </>
  );
}
