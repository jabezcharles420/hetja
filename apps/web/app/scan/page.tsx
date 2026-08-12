import type { Metadata } from "next";
import ScanEntry from "@/components/ScanEntry";
import styles from "./scan.module.css";

export const metadata: Metadata = {
  title: "Scan a collar — Hetja",
  description:
    "Point your camera at a collar or type the 9-character code to meet the dog behind it.",
};

function CameraArt(): React.JSX.Element {
  return (
    <svg
      className={styles.cameraArt}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="A phone camera ready to scan a collar"
    >
      <g stroke="var(--h-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="16" y="6" width="32" height="52" rx="9" />
        <path d="M27 13h10" />
        <path d="M25 45h14" />
        <circle cx="32" cy="27" r="9" />
        <path d="M32 34l6 6" />
      </g>
      <circle cx="32" cy="27" r="3" fill="var(--h-ink)" />
      <circle cx="43" cy="12" r="2.5" fill="var(--h-ink)" />
    </svg>
  );
}

export default function ScanPage(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <section className={`${styles.hero} ${styles.fadeUp}`} aria-label="How to scan a collar">
        <div className={styles.cameraCircle}>
          <CameraArt />
        </div>
        <h1 className={styles.title}>Meet the dog behind the collar.</h1>
        <p className={styles.sub}>
          Point your camera at the QR on a dog&rsquo;s collar — or type the
          9-character code below. It works even with no signal.
        </p>
      </section>

      <section className={styles.entry} aria-label="Enter a collar code">
        <div className={styles.entryInner}>
          <ScanEntry
            id="scan-collar-code"
            label="9-character collar code"
            hint="No QR reader? Type the code printed on the collar."
            placeholder="e.g. abc234567"
            buttonLabel="View profile"
          />
        </div>
      </section>
    </div>
  );
}
