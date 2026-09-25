import type { Metadata } from "next";
import { Button, StickyFooter } from "@/components/ds";
import styles from "./not-found.module.css";

/* V1 Not found (design v6, "Every dog by name"). No chrome: the page draws
 * its own way home. */

export const metadata: Metadata = {
  title: "Not found · Hetja",
  robots: { index: false },
};

export default function NotFound(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <div className={`h-container ${styles.body}`}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>This lane doesn&apos;t go anywhere.</h1>
        <p className={styles.lead}>The dogs know every shortcut in Mumbai. This page isn&apos;t one of them.</p>
        <Button variant="link" chevron href="/" className={styles.home}>
          Go to the home page
        </Button>
      </div>
      <StickyFooter background="none" className={styles.footer}>
        <Button href="/scan" fullWidth>
          Scan a collar
        </Button>
      </StickyFooter>
    </div>
  );
}
