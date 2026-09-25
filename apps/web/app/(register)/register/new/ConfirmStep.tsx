"use client";

/**
 * R5 "Check and confirm" (step 4 of 4): the summary, and the two promises the
 * registrator makes before a code exists. Both boxes must be ticked.
 */

import { dogCopy, markingsPhrase, sexLabel, type DogSex } from "@/lib/dog-copy";
import type { Tri } from "./AboutStep";
import s from "../register.module.css";
import styles from "./flow.module.css";

export function triLabel(t: Tri): string {
  return t === "yes" ? "Yes" : t === "no" ? "No" : "Not sure";
}

function PromiseRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={[s.row, styles.promise].join(" ")}>
      <input
        type="checkbox"
        className={s.visuallyHidden}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={[s.tick, checked ? s.tickOn : ""].filter(Boolean).join(" ")} aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className={styles.promiseText}>{children}</span>
    </label>
  );
}

export default function ConfirmStep({
  photoUrl,
  name,
  sex,
  markings,
  wardCode,
  addedBy,
  vaccinated,
  sterilised,
  weekly,
  setWeekly,
  noPost,
  setNoPost,
}: {
  photoUrl: string | null;
  name: string;
  sex: DogSex | null;
  markings: string[];
  wardCode: string;
  addedBy: string | null;
  vaccinated: Tri;
  sterilised: Tri;
  weekly: boolean;
  setWeekly: (v: boolean) => void;
  noPost: boolean;
  setNoPost: (v: boolean) => void;
}): React.JSX.Element {
  const sub = [sexLabel(sex), markings.length ? markingsPhrase(markings) : null].filter(Boolean).join(" · ");
  return (
    <>
      <h1 className={s.title}>Check and confirm</h1>
      <div className={styles.summary}>
        <div className={styles.summaryHead}>
          <span className={styles.summaryPhoto}>
            {photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="The dog's face photo" />
            )}
          </span>
          <span className={styles.summaryText}>
            <span className={styles.summaryName}>{name.trim() || "No name"}</span>
            <span className={styles.summarySub}>{sub}</span>
          </span>
        </div>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Ward</dt>
            <dd>{wardCode}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Added by</dt>
            <dd>{addedBy ?? "You"}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Vaccinated</dt>
            <dd>{triLabel(vaccinated)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Sterilised</dt>
            <dd>{triLabel(sterilised)}</dd>
          </div>
        </dl>
      </div>
      <div className={s.card}>
        <PromiseRow checked={weekly} onChange={setWeekly}>
          {dogCopy.seeWeekly(sex)}
        </PromiseRow>
        <PromiseRow checked={noPost} onChange={setNoPost}>
          {dogCopy.noPosting(sex)}
        </PromiseRow>
      </div>
      <p className={s.fine}>Your phone and email are never shown. The profile shows your first name and initial.</p>
    </>
  );
}
