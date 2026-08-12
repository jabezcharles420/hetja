"use client";

import { useInstallPrompt } from "@/lib/useInstallPrompt";
import styles from "./InstallBanner.module.css";

/**
 * Amber install pill shown on mobile once the app is installable and the user
 * has visited at least twice. Dismissible; stays hidden after dismissal.
 */
export function InstallBanner(): React.JSX.Element | null {
  const { canInstall, promptInstall, dismiss } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <aside className={styles.banner} role="region" aria-label="Install Hetja">
      <p className={styles.text}>
        Add Hetja to your home screen — feed dogs even offline.
      </p>
      <button
        type="button"
        className={styles.install}
        onClick={() => void promptInstall()}
      >
        Install
      </button>
      <button
        type="button"
        className={styles.dismiss}
        onClick={dismiss}
        aria-label="Dismiss install prompt"
      >
        &times;
      </button>
    </aside>
  );
}
