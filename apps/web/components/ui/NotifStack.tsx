"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./NotifStack.module.css";

/**
 * Lock-screen notifications (iOS 16+): glass cards with an app icon, bold
 * title, two-line body and a relative time.
 *
 * `layout="stack"` (default) is the collapsed Notification Center group:
 * three layered cards that fan out into a list on hover, keyboard focus, or
 * tap (tap because a phone has no hover). The fan-out is driven by a real
 * <button aria-expanded> laid over the stack, so it is reachable and
 * announced; the cards themselves stay plain list items.
 *
 * `layout="list"` renders them separately (Sidehoe's privacy `.trio .notif`).
 *
 * `tone="dark"` is for the black privacy band: #1c1c1e cards, muted grey
 * body. Card height is fixed (two body lines) so the fan-out can be a pure
 * transform instead of a layout animation.
 */

export interface Notif {
  id?: string;
  /** App name shown small above the title ("HETJA"). */
  app?: string;
  /** Icon glyph (emoji / SVG). Defaults to a paw on the accent tile. */
  icon?: ReactNode;
  /** Icon tile background (CSS colour/gradient). */
  iconBg?: string;
  title: ReactNode;
  body: ReactNode;
  /** "now", "2m ago", "09:41". */
  time?: string;
}

export interface NotifStackProps {
  items: Notif[];
  tone?: "light" | "dark";
  layout?: "stack" | "list";
  /** Accessible name for the group. */
  "aria-label"?: string;
  className?: string;
}

export function NotifStack({
  items,
  tone = "light",
  layout = "stack",
  "aria-label": ariaLabel = "Notifications",
  className,
}: NotifStackProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const stacked = layout === "stack" && items.length > 1;

  const list = (
    <ul
      id={listId}
      className={styles.list}
      aria-label={ariaLabel}
      style={{ "--n": items.length } as React.CSSProperties}
    >
      {items.map((n, i) => (
        <li
          key={n.id ?? i}
          className={styles.card}
          style={{ "--i": i, zIndex: items.length - i } as React.CSSProperties}
          // Only the top card is readable while collapsed; the rest are peeks.
          aria-hidden={stacked && !open && i > 0 ? "true" : undefined}
        >
          <NotifCard n={n} />
        </li>
      ))}
    </ul>
  );

  if (!stacked) {
    return (
      <div className={`${styles.root} ${styles[tone]} ${styles.flat} ${className ?? ""}`}>{list}</div>
    );
  }

  return (
    <div
      className={`${styles.root} ${styles[tone]} ${styles.stack} ${className ?? ""}`}
      data-open={open ? "" : undefined}
    >
      {list}
      <button
        type="button"
        className={styles.expander}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="h-sr-only">
          {open ? "Collapse notifications" : `Show all ${items.length} notifications`}
        </span>
      </button>
    </div>
  );
}

function NotifCard({ n }: { n: Notif }): React.JSX.Element {
  return (
    <>
      <span className={styles.icon} style={n.iconBg ? { background: n.iconBg } : undefined} aria-hidden="true">
        {n.icon ?? <Paw />}
      </span>
      <span className={styles.text}>
        <span className={styles.head}>
          <b className={styles.title}>{n.title}</b>
          {n.time ? <time className={styles.time}>{n.time}</time> : null}
        </span>
        <span className={styles.body}>{n.body}</span>
      </span>
    </>
  );
}

function Paw(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <ellipse cx="6" cy="10" rx="2.2" ry="2.8" />
      <ellipse cx="10" cy="6" rx="2.2" ry="2.8" />
      <ellipse cx="14" cy="6" rx="2.2" ry="2.8" />
      <ellipse cx="18" cy="10" rx="2.2" ry="2.8" />
      <path d="M12 11c-3 0-6 4.5-6 7 0 1.7 1.3 2.5 3 2.5 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.7 0 3-.8 3-2.5 0-2.5-3-7-6-7Z" />
    </svg>
  );
}
