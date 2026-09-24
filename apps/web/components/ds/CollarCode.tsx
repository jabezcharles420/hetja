"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Label } from "./Label";
import { collarGroups, sayCollarCode } from "./collar";
import styles from "./CollarCode.module.css";

/**
 * Collar code, display mode: a mist card with the "Collar code" label, the
 * code in three mono groups (separate spans, so the gap is layout, not a
 * space a screen reader would read out), an optional "Say it" line for
 * reading it over the phone, and a quiet Copy button.
 *
 * Client component only for the clipboard; the markup is complete on the
 * server, so the profile page stays readable with JS off.
 */

export interface CollarCodeProps {
  /** Stored form, lowercase, e.g. "ddr017xk2". */
  code: string;
  /** Label above the code. */
  label?: string;
  /** Show the "Say it: D D R · zero one seven · X K two" helper. */
  sayIt?: boolean;
  /** Prefix for the say-it line. */
  sayItPrefix?: string;
  /** Show the Copy button (default true). */
  copy?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  /** default = profile (mono 30, 14 gap); large = design-system showcase (38, 18 gap). */
  size?: "default" | "large";
  className?: string;
}

export function CollarCode({
  code,
  label = "Collar code",
  sayIt = false,
  sayItPrefix = "Say it:",
  copy = true,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  size = "default",
  className,
}: CollarCodeProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groups = collarGroups(code);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code.toLowerCase());
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context, permissions). The code is
      // on screen in large type, so failing quietly is the right fallback.
    }
  }

  return (
    <div
      className={[styles.card, size === "large" ? styles.large : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.body}>
        <Label>{label}</Label>
        <div className={styles.code}>
          {groups.map((g, i) => (
            <span key={i} data-testid="collar-group">
              {g}
            </span>
          ))}
        </div>
        {sayIt && (
          <div className={styles.say} data-testid="collar-say">
            {sayItPrefix} {sayCollarCode(code)}
          </div>
        )}
      </div>
      {copy && (
        <Button variant="quiet" className={styles.copy} onClick={onCopy} aria-live="polite">
          {copied ? copiedLabel : copyLabel}
        </Button>
      )}
    </div>
  );
}
