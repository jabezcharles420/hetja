import type { ReactNode } from "react";
import styles from "./Widget.module.css";

/**
 * iOS home-screen widgets (WidgetKit families systemSmall / Medium / Large).
 *
 * Sizes are the iPhone 15/16 points (158², 338×158, 338×354) with the 22pt
 * continuous-corner radius and 16pt content margin, scaled down fluidly on
 * narrow containers via aspect-ratio (a widget never reflows; it shrinks).
 * `caption` is the grey app label that sits under a widget on the home
 * screen ("Hetja").
 *
 * A widget is a glanceable summary, so it is a named group (role="group"),
 * never a link or button by itself; wrap it in one if it should navigate.
 *
 * Presets below (`StreakWidget`, `NearbyWidget`, `DueWidget`) are the three
 * Hetja uses; they are plain compositions of <Widget> and can be copied.
 */

export type WidgetSize = "small" | "medium" | "large";

export interface WidgetProps {
  size?: WidgetSize;
  tone?: "light" | "dark";
  /** Custom background (CSS colour/gradient). Keep text contrast in mind. */
  background?: string;
  /** Accessible name for the group, e.g. "Feeding streak widget". */
  "aria-label": string;
  /** Home-screen label under the widget. */
  caption?: string;
  className?: string;
  children: ReactNode;
}

export function Widget({
  size = "small",
  tone = "light",
  background,
  "aria-label": ariaLabel,
  caption,
  className,
  children,
}: WidgetProps): React.JSX.Element {
  const box = (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`${styles.widget} ${styles[size]} ${styles[tone]} ${caption ? "" : className ?? ""}`}
      style={background ? { background } : undefined}
    >
      {children}
    </div>
  );
  if (!caption) return box;
  return (
    <div className={`${styles.slot} ${styles[`slot_${size}`]} ${className ?? ""}`}>
      {box}
      <span className={styles.caption} aria-hidden="true">
        {caption}
      </span>
    </div>
  );
}

/* --- Presets ------------------------------------------------------------- */

export interface StreakWidgetProps {
  days: number;
  /** Line under the number. */
  note?: string;
  caption?: string;
  className?: string;
}

/** Small: 🔥 12 days. */
export function StreakWidget({
  days,
  note = "Fed a dog every day",
  caption,
  className,
}: StreakWidgetProps): React.JSX.Element {
  return (
    <Widget size="small" aria-label={`Feeding streak: ${days} days. ${note}`} caption={caption} className={className}>
      <div className={styles.streak} aria-hidden="true">
        <span className={styles.eyebrow}>
          <span className={styles.flame}>🔥</span> Streak
        </span>
        <span className={styles.streakNum}>
          {days}
          <small>{days === 1 ? "day" : "days"}</small>
        </span>
        <span className={styles.note}>{note}</span>
      </div>
    </Widget>
  );
}

export interface NearbyDog {
  name: string;
  /** Avatar glyph (emoji or a small <Dogmoji>). */
  avatar?: ReactNode;
  /** Avatar gradient when `avatar` is an emoji. */
  bg?: string;
  status: string;
  tone?: "ok" | "warn" | "late";
}

export interface NearbyWidgetProps {
  ward: string;
  dogs: NearbyDog[];
  caption?: string;
  className?: string;
}

/** Medium: "3 dogs near you" + the three most recent, sorted by last fed. */
export function NearbyWidget({ ward, dogs, caption, className }: NearbyWidgetProps): React.JSX.Element {
  const shown = dogs.slice(0, 3);
  const summary = `${dogs.length} ${dogs.length === 1 ? "dog" : "dogs"} near you in ${ward}: ${shown
    .map((d) => `${d.name}, ${d.status}`)
    .join("; ")}.`;
  return (
    <Widget size="medium" aria-label={summary} caption={caption} className={className}>
      <div className={styles.nearby} aria-hidden="true">
        <div className={styles.nearbyLead}>
          <span className={styles.eyebrow}>
            <PinGlyph /> {ward}
          </span>
          <span className={styles.nearbyNum}>{dogs.length}</span>
          <span className={styles.note}>{dogs.length === 1 ? "dog" : "dogs"} near you</span>
        </div>
        <ul className={styles.nearbyList}>
          {shown.map((d) => (
            <li key={d.name}>
              <span className="h-avatar" style={{ "--s": "30px", "--bg": d.bg } as React.CSSProperties}>
                {d.avatar ?? "🐶"}
              </span>
              <span className={styles.dogName}>{d.name}</span>
              <span className={`h-status h-status-${d.tone ?? "ok"} ${styles.dogStatus}`}>{d.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </Widget>
  );
}

export interface DueWidgetProps {
  dog: string;
  what: string;
  when: string;
  caption?: string;
  className?: string;
}

/** Small: next medical item due (from the append-only ledger). */
export function DueWidget({ dog, what, when, caption, className }: DueWidgetProps): React.JSX.Element {
  return (
    <Widget size="small" aria-label={`${dog}: ${what} due ${when}`} caption={caption} className={className}>
      <div className={styles.due} aria-hidden="true">
        <span className={styles.dueIcon}>💉</span>
        <span className={styles.dueWhen}>Due {when}</span>
        <span className={styles.dueWhat}>{what}</span>
        <span className={styles.note}>{dog}</span>
      </div>
    </Widget>
  );
}

function PinGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 16" width="9" height="12" fill="currentColor">
      <path d="M6 0a6 6 0 0 0-6 6c0 4.2 6 10 6 10s6-5.8 6-10a6 6 0 0 0-6-6Zm0 8.2A2.2 2.2 0 1 1 6 3.8a2.2 2.2 0 0 1 0 4.4Z" />
    </svg>
  );
}
