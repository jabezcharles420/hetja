import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./care.module.css";

/**
 * The 52px header of a focused care screen (design v5 N3, N4, N9, F6): a
 * back link on the left ("‹ Me", "‹ Rani") and an optional slot on the right
 * ("+ Register", the "Vet account" pill).
 *
 * `/d/<slug>` belongs to apps/scan, not this Next app, so it gets a plain
 * anchor rather than a client-side <Link>.
 */
export function CareTop({
  back,
  href,
  trailing,
}: {
  back: string;
  href: string;
  trailing?: ReactNode;
}): React.JSX.Element {
  const label = `‹ ${back}`;
  return (
    <div className={styles.top}>
      {href.startsWith("/d/") ? (
        <a href={href} className={styles.topLink}>
          {label}
        </a>
      ) : (
        <Link href={href} className={styles.topLink}>
          {label}
        </Link>
      )}
      {trailing}
    </div>
  );
}
