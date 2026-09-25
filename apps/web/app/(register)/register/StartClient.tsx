"use client";

/**
 * R1 Start (design v5, "Hetja Register and Print"). Route protection is a UX
 * boundary, not a security boundary (see RequireCapability): the API is the
 * boundary. The gate keeps the registrator-surface election working for an
 * account that has not enabled registration yet.
 */

import Link from "next/link";
import { Button, StickyFooter } from "@/components/ds";
import RequireCapability from "@/components/RequireCapability";
import s from "./register.module.css";
import styles from "./start.module.css";

export const START_STEPS = [
  { title: "A clear face photo", sub: "Taken now, in daylight if you can" },
  { title: "The ward they live in", sub: "Never a street or building" },
  { title: "A printer or print shop", sub: "One A4 page, black and white" },
] as const;

function StartInner(): React.JSX.Element {
  return (
    <div className={s.page}>
      <div className={s.top}>
        <Link href="/me" className={s.topLink}>
          ‹ Me
        </Link>
      </div>
      <div className={[s.body, styles.body].join(" ")}>
        <h1 className={s.titleXL}>Register a dog</h1>
        <p className={s.lead}>
          Know a street dog well? Give them a code so anyone can scan it and help. About two minutes.
        </p>
        <ol className={styles.card}>
          {START_STEPS.map((step, i) => (
            <li key={step.title} className={styles.row}>
              <span className={styles.num} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{step.title}</span>
                <span className={styles.rowSub}>{step.sub}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className={s.note}>New dogs show as Unverified until a vet or a second feeder confirms them.</p>
      </div>
      <StickyFooter background="mist">
        <Button href="/register/new" fullWidth>
          Start with a photo
        </Button>
      </StickyFooter>
    </div>
  );
}

export default function StartClient(): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <StartInner />
    </RequireCapability>
  );
}
