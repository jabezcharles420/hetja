"use client";

import Link from "next/link";
import { Button, DogAvatar, StatusIcon, StickyFooter } from "@/components/ds";
import { pronouns, type DogSex } from "@/lib/care-copy";
import styles from "./feed.module.css";

/**
 * V10 "Rani has eaten." (design v6): a logged feed is a moment, not a toast
 * that sends you back to Me. Feeders feed several dogs on one walk, so the
 * loud button goes straight back to the scanner. Also closes a V11 round.
 */

export interface FedDog {
  slug: string;
  name: string;
  photoUrl?: string | null;
  sex?: DogSex | null;
}

/** "Rani", "Rani and Kalu", "Rani, Kalu and Moti", "Rani, Kalu and 3 more". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export function eatenTitle(dogs: FedDog[]): string {
  const names = joinNames(dogs.map((d) => d.name));
  return dogs.length === 1 ? `${names} has eaten.` : `${names} have eaten.`;
}

export function eatenLead(dogs: FedDog[]): string {
  if (dogs.length === 1) {
    const p = pronouns(dogs[0]!.sex);
    const s = p.subject === "they" ? "They're" : `${p.subject.charAt(0).toUpperCase()}${p.subject.slice(1)}'s`;
    return `${s} thrilled, in ${p.possessive} own way. Anyone who scans ${p.possessive} collar now sees "Fed a few minutes ago".`;
  }
  return `They're thrilled, in their own way. Anyone who scans their collars now sees "Fed a few minutes ago".`;
}

/**
 * The line under the streak: the next badge in the API catalog (week_streak
 * at 7 days, month_streak at 28; lib/streak.ts badgeSlots). The mock's
 * "Fortnight badge" does not exist, so it is not promised.
 */
export function nextBadgeLine(streakDays: number): string {
  const more = (n: number) => (n === 1 ? "One more" : `${n} more`);
  if (streakDays < 7) return `${more(7 - streakDays)} for the full week badge`;
  if (streakDays < 28) return `${more(28 - streakDays)} for the 28 days badge`;
  return "Every day for four weeks and counting";
}

export function FeedDone({
  dogs,
  streakDays,
  note,
}: {
  dogs: FedDog[];
  streakDays: number | null;
  /** A quiet second line (photo not kept, a feed in the round refused). */
  note?: string | null;
}): React.JSX.Element {
  const first = dogs[0];
  return (
    <div className={styles.page}>
      <div className={styles.doneBody}>
        {first && (
          <div className={styles.doneAvatar}>
            <DogAvatar id={first.slug} name={first.name} photoUrl={first.photoUrl ?? null} size={120} className={styles.doneFace} />
            <span className={styles.doneBadge} aria-hidden="true">
              <StatusIcon name="check" size={20} strokeWidth={2.6} />
            </span>
          </div>
        )}
        <h1 className={styles.doneTitle} aria-live="polite">
          {eatenTitle(dogs)}
        </h1>
        <p className={styles.doneLead}>{eatenLead(dogs)}</p>
        {note && (
          <p className={styles.toastNote} data-testid="feed-note">
            {note}
          </p>
        )}
        {streakDays !== null && streakDays > 0 && (
          <div className={styles.streakCard}>
            <span className={styles.streakNum}>{streakDays}</span>
            <span className={styles.streakText}>
              <span className={styles.streakLabel}>day streak</span>
              <span className={styles.streakSub}>{nextBadgeLine(streakDays)}</span>
            </span>
          </div>
        )}
      </div>
      <StickyFooter background="mist" className={styles.footer}>
        <Button href="/scan?intent=feed" fullWidth>
          Scan the next dog
        </Button>
        <Link href="/me" className={styles.doneLink}>
          Done for now
        </Link>
      </StickyFooter>
    </div>
  );
}
