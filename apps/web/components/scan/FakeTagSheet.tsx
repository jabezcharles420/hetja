"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ds";
import styles from "./CodeScreen.module.css";

/** "Tag looks fake" (v5 N8, kept on V3's no-match state): there is no report API for a code that is no dog, so this explains what to do. */
export default function FakeTagSheet({ findHref, onClose }: { findHref: string; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        ref={ref}
        className={styles.fakeSheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fake-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="fake-title" className={styles.fakeTitle}>
          If the tag looks fake
        </h2>
        <p className={styles.fakeText}>
          A Hetja tag has a QR, the 9-character code printed under it, and the dog&apos;s name. A code that finds no
          dog was misread, or the tag is not ours.
        </p>
        <p className={styles.fakeText}>
          Don&apos;t log a feed on it, and don&apos;t pay anyone because of it. If the dog is on Hetja, find them by
          ward and photo, then report the tag from their page so their feeders can reprint it.
        </p>
        <Button href={findHref} fullWidth shadow={false}>
          Find by ward and photo
        </Button>
        <Button variant="link" fullWidth onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
