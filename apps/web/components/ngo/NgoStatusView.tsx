"use client";

import Link from "next/link";
import type { Ngo } from "./ngo-api";
import { dayMonth, phoneWords, wardsLine } from "./ngo-copy";
import styles from "./ngo.module.css";

/**
 * Application status (designed, not in the board): waiting, approved,
 * paused, removed. Shown after "Send for checking", from Me's "Bring your
 * NGO to Hetja · Waiting" row, and on the NGO tab while it is not active.
 * The waiting copy repeats N1's promise, word for word.
 */

function day(iso: string | null | undefined): string | null {
  return iso ? dayMonth(iso) : null;
}

export function NgoStatusView({ ngo, justSent = false }: { ngo: Ngo; justSent?: boolean }): React.JSX.Element {
  if (ngo.status === "active") {
    return (
      <section className={styles.stack10} aria-labelledby="ngo-status-title">
        <span className={`${styles.statusIcon} ${styles.statusOk}`} aria-hidden="true">
          ✓
        </span>
        <h1 id="ngo-status-title" className={styles.title}>
          {ngo.name} is on Hetja
        </h1>
        <p className={styles.lead}>
          Your NGO tab is on. SOS cases in {wardsLine(ngo.wards) || "your wards"} come to you after the feeders nearby.
        </p>
        <Link href="/ngo" className={styles.inkBtn}>
          Open the NGO tab
        </Link>
      </section>
    );
  }

  if (ngo.status === "paused" || ngo.status === "removed") {
    const paused = ngo.status === "paused";
    return (
      <section className={styles.stack10} aria-labelledby="ngo-status-title">
        <span className={`${styles.statusIcon} ${styles.statusPaused}`} aria-hidden="true">
          {paused ? "II" : "×"}
        </span>
        <h1 id="ngo-status-title" className={styles.title}>
          {paused ? `${ngo.name} is paused` : `${ngo.name} is no longer on Hetja`}
        </h1>
        <p className={styles.lead}>
          {paused
            ? "New SOS cases in your wards go to vets nearby for now. Your team, drives and dogs are kept."
            : "Your NGO tab is off. Vets who came through you keep their verification."}
        </p>
        {ngo.reason && <p className={styles.sub}>From Hetja: {ngo.reason}</p>}
        <p className={styles.note}>
          Think this is a mistake?{" "}
          <Link href="/contact" className={styles.chev}>
            Write to us
          </Link>
          .
        </p>
      </section>
    );
  }

  // waiting
  const sent = day(ngo.submittedAt);
  return (
    <section className={styles.stack10} aria-labelledby="ngo-status-title">
      <span className={`${styles.statusIcon} ${styles.statusWait}`} aria-hidden="true">
        ◷
      </span>
      <h1 id="ngo-status-title" className={styles.title}>
        {justSent ? "Sent for checking" : `We're checking ${ngo.name}`}
      </h1>
      <p className={styles.lead}>We check your registration and call you before switching it on.</p>
      <ol className={styles.steps} aria-label="What happens next">
        <li className={styles.step}>
          <span className={`${styles.stepDot} ${styles.stepDone}`} aria-hidden="true">
            ✓
          </span>
          <span>
            Sent for checking{sent ? ` · ${sent}` : ""}
            <br />
            <span className={styles.muted}>{ngo.name} · {wardsLine(ngo.wards)}</span>
          </span>
        </li>
        <li className={styles.step}>
          <span className={`${styles.stepDot} ${styles.stepNow}`} aria-hidden="true">
            2
          </span>
          <span>An admin checks your registration</span>
        </li>
        <li className={styles.step}>
          <span className={styles.stepDot} aria-hidden="true">
            3
          </span>
          <span>
            We call you on {phoneWords(ngo.publicPhone)}
          </span>
        </li>
        <li className={styles.step}>
          <span className={styles.stepDot} aria-hidden="true">
            4
          </span>
          <span>Your NGO tab switches on for you and anyone you add</span>
        </li>
      </ol>
      <p className={styles.note}>
        Your registration certificate is seen only by Hetja&apos;s admins, and deleted 30 days after we decide.
      </p>
    </section>
  );
}
