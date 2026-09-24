import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./PrivacyBand.module.css";

/**
 * The black privacy band: label, headline (48 mobile / 96 desktop), support
 * text and a blue link. Used once per marketing page, for the privacy promise.
 * Defaults are the exact home-page copy from the mock.
 */

export interface PrivacyBandProps {
  label?: string;
  headline?: ReactNode;
  support?: ReactNode;
  linkLabel?: string;
  linkHref?: string;
  /** responsive (default) switches at 1024px. */
  layout?: "responsive" | "mobile" | "desktop";
  /** id for the headline (aria-labelledby); change it if a page has two bands. */
  id?: string;
  className?: string;
}

export function PrivacyBand({
  label = "Privacy",
  headline = "Ward, not street.",
  support = "Hetja never shows where a dog sleeps. Collar codes are random, so nobody can list every dog in the city. A register of strays can protect them or target them. We built it for the first one.",
  linkLabel = "Read the privacy page",
  linkHref = "/privacy",
  layout = "responsive",
  id = "privacy-band",
  className,
}: PrivacyBandProps): React.JSX.Element {
  return (
    <section
      className={[styles.band, styles[layout], className ?? ""].filter(Boolean).join(" ")}
      aria-labelledby={id}
    >
      <div className={styles.label}>{label}</div>
      <h2 id={id} className={styles.headline}>
        {headline}
      </h2>
      <p className={styles.support}>{support}</p>
      {linkLabel && (
        <Link href={linkHref} className={styles.link}>
          {linkLabel}
          <span aria-hidden="true">{" ›"}</span>
        </Link>
      )}
    </section>
  );
}
