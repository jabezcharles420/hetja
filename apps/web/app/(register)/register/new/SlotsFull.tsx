"use client";

/**
 * P6 "Two collars waiting" (design v6): the pending-registration limit,
 * checked when /register/new opens instead of after the form is filled. It
 * names the dogs holding the slots (GET /registrations budget.holders) and
 * makes the fix the primary button. The form shows faded underneath, so the
 * person can see what they will fill in once a slot frees.
 */

import Link from "next/link";
import { Button, DogAvatar, StatusPill, StickyFooter } from "@/components/ds";
import type { RegistrationBudgetHolder } from "@/lib/api";
import { dayMonth, nameOr, possessive } from "@/lib/dog-copy";
import s from "../register.module.css";
import styles from "./slots.module.css";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];

export function holderLine(h: RegistrationBudgetHolder): string {
  const days = `${h.daysLeft} ${h.daysLeft === 1 ? "day" : "days"} left`;
  return h.printedAt ? `Printed ${dayMonth(h.printedAt)} · ${days}` : `Not printed · ${days}`;
}

export default function SlotsFull({
  holders,
  pending,
  max,
  wardLabel,
}: {
  holders: RegistrationBudgetHolder[];
  pending: number;
  max: number;
  wardLabel: string | null;
}): React.JSX.Element {
  const printed = holders.find((h) => h.printedAt);
  const first = printed ?? holders[0] ?? null;
  const next = ORDINALS[max] ?? `number ${max + 1}`;
  return (
    <div className={s.page}>
      <div className={[s.body, s.v6Body].join(" ")}>
        <Link href="/register" className={[s.topLink, styles.cancel].join(" ")}>
          Cancel
        </Link>
        <h1 className={s.titleXL}>New dog</h1>
        <div className={styles.card}>
          <StatusPill variant="warn" icon="clock" size="row" className={styles.pill}>
            {pending} of {max} collars waiting
          </StatusPill>
          <h2 className={styles.title}>Put one of these on first.</h2>
          <p className={styles.text}>
            It keeps unused codes off the street. Your {next} dog can start as soon as one is confirmed.
          </p>
          <ul className={styles.list}>
            {holders.map((h) => (
              <li key={h.slug} className={styles.row}>
                <DogAvatar id={h.slug} name={nameOr(h.name)} size={44} />
                <span className={s.linkText}>
                  <span className={styles.name}>{nameOr(h.name)}</span>
                  <span className={s.linkSub}>{holderLine(h)}</span>
                </span>
                <Link
                  href={h.printedAt ? `/register/${h.slug}` : `/register/${h.slug}/print`}
                  className={styles.act}
                  aria-label={`${h.printedAt ? "Confirm" : "Print"} ${nameOr(h.name)}`}
                >
                  {h.printedAt ? "Confirm" : "Print"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.faded} aria-hidden="true">
          <div className={styles.fadedPhoto}>
            <span className={styles.fadedCircle} />
            <span>Photo</span>
          </div>
          <div className={styles.fadedForm}>
            <div className={styles.fadedRow}>Name</div>
            <div className={[styles.fadedRow, styles.fadedValue].join(" ")}>{wardLabel ?? "Ward"}</div>
          </div>
        </div>
      </div>
      {first && (
        <StickyFooter background="mist">
          <Button href={first.printedAt ? `/register/${first.slug}` : `/register/${first.slug}/print`} fullWidth>
            {first.printedAt ? `Confirm ${possessive(first.name)} collar` : `Print ${possessive(first.name)} tag`}
          </Button>
        </StickyFooter>
      )}
    </div>
  );
}
