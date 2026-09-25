import Link from "next/link";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/ds/AppHeader";
import type { DogCard } from "@/lib/api";
import { codeLine } from "@/lib/scan-code";
import styles from "./ScanParts.module.css";

/**
 * Pieces shared by the scan fallbacks (F1 sheet, F2, N8, F3): the focused
 * screen's 52px "‹ Scan" header, a dog row (F2 matches, N8 "Did you mean"),
 * and the chevron choice rows.
 *
 * Dog rows are plain <a>, not Next <Link>: /d/<slug> is the profile app
 * behind Caddy, a different app, so the hop is a full navigation.
 */

/** The focused screen's 52px "‹ Scan" header (the shared ds AppHeader). */
export function ScanHeader({ href = "/scan", label = "Scan" }: { href?: string; label?: string }): React.JSX.Element {
  return <AppHeader back={{ href, label }} surface="mist" />;
}

export function Chevron(): React.JSX.Element {
  return (
    <span className={styles.chevron} aria-hidden="true">
      ›
    </span>
  );
}

export function DogPhoto({
  dog,
  className,
}: {
  dog: Pick<DogCard, "slug" | "name" | "photoUrl">;
  className?: string;
}): React.JSX.Element {
  const initial = (dog.name ?? "").trim().charAt(0).toUpperCase();
  return (
    <span className={[styles.photo, className ?? ""].filter(Boolean).join(" ")} aria-hidden="true">
      {dog.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dog.photoUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className={styles.initial}>{initial}</span>
      )}
    </span>
  );
}

/** Photo, name, "RNI 482 PQ7 · K/W", chevron. */
export function DogRow({ dog, href }: { dog: DogCard; href: string }): React.JSX.Element {
  const name = dog.name ?? "No name";
  return (
    <li className={styles.dogRow}>
      <a href={href} className={styles.dogLink}>
        <DogPhoto dog={dog} className={styles.rowPhoto} />
        <span className={styles.dogText}>
          <span className={styles.dogName}>{name}</span>
          <span className={styles.dogCode}>{codeLine(dog.slug, dog.wardCode)}</span>
        </span>
        <Chevron />
      </a>
    </li>
  );
}

export function DogList({ children, label }: { children: ReactNode; label?: string }): React.JSX.Element {
  return (
    <ul className={styles.card} aria-label={label}>
      {children}
    </ul>
  );
}

export interface ChoiceItem {
  title: string;
  sub?: string;
  href?: string;
  onClick?: () => void;
  /** Full navigation instead of a client route (for /d/ and cross-app hops). */
  external?: boolean;
}

/** The mist or white card of chevron rows (F1 sheet, N8). */
export function ChoiceRows({
  items,
  tone = "white",
  size = "sub",
}: {
  items: ChoiceItem[];
  tone?: "white" | "mist";
  /** sub = 60px rows with a sub line (F1); plain = 56px title-only rows (N8). */
  size?: "sub" | "plain";
}): React.JSX.Element {
  return (
    <ul className={[styles.card, tone === "mist" ? styles.mist : ""].filter(Boolean).join(" ")}>
      {items.map((item) => {
        const inner = (
          <>
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>{item.title}</span>
              {item.sub && <span className={styles.choiceSub}>{item.sub}</span>}
            </span>
            <Chevron />
          </>
        );
        const cls = [styles.choice, size === "plain" ? styles.plain : ""].filter(Boolean).join(" ");
        return (
          <li key={item.title} className={styles.choiceItem}>
            {item.href && item.external ? (
              <a href={item.href} className={cls}>
                {inner}
              </a>
            ) : item.href ? (
              <Link href={item.href} className={cls}>
                {inner}
              </Link>
            ) : (
              <button type="button" className={cls} onClick={item.onClick}>
                {inner}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
