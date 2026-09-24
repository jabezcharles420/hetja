"use client";

import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { Button } from "@/components/ds";
import styles from "./InstallBanner.module.css";

/**
 * Install card: a small white card that sits just above the TabBar on
 * marketing pages (ChromeShell only mounts it there), once the app is
 * installable and the visitor has been back at least twice. Dismissible, and
 * stays dismissed. Hidden at >=1024px, where there is no TabBar to sit on.
 */
export function InstallBanner(): React.JSX.Element | null {
  const { canInstall, promptInstall, dismiss } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <aside className={styles.banner} role="region" aria-label="Install Hetja">
      <p className={styles.text}>Add Hetja to your home screen and feed dogs even offline.</p>
      <Button variant="tinted" className={styles.install} onClick={() => void promptInstall()}>
        Install
      </Button>
      <button
        type="button"
        className={styles.dismiss}
        onClick={dismiss}
        aria-label="Dismiss install prompt"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </aside>
  );
}
