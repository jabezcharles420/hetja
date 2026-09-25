"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ds";
import { api, ApiError } from "@/lib/api";
import { pauseOptions, pauseSentence } from "@/lib/sos-pause";
import styles from "./PauseAlertsSheet.module.css";

/**
 * L1 Turning SOS alerts off (design v6): one tap on the switch used to
 * silently remove a responder. Most people want a pause, not an exit, so the
 * switch opens this sheet. A pause stores a resume time (sosPausedUntil);
 * Me then shows "Alerts paused until 8 am · Resume".
 */

export interface PauseAlertsSheetProps {
  open: boolean;
  onClose: () => void;
  /** After a save: the new sosOptIn and sosPausedUntil. */
  onDone: (next: { sosOptIn: boolean; sosPausedUntil: string | null }) => void;
  /** The feeder's dogs, first names, for "If Rani or Kalu is hurt". */
  dogNames?: string[];
  /** Ward codes, for "the vets in K/W". */
  wardCodes?: string[];
}

type Choice = "tomorrow" | "week" | "off";

export function PauseAlertsSheet({ open, onClose, onDone, dogNames = [], wardCodes = [] }: PauseAlertsSheetProps): React.JSX.Element | null {
  const [choice, setChoice] = useState<Choice>("tomorrow");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setChoice("tomorrow");
    setError(null);
    setNow(new Date());
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const opts = pauseOptions(now);

  const save = async () => {
    setBusy(true);
    setError(null);
    const next =
      choice === "off"
        ? { sosOptIn: false, sosPausedUntil: null }
        : { sosOptIn: true, sosPausedUntil: (choice === "tomorrow" ? opts.tomorrow : opts.week).at.toISOString() };
    try {
      await api.patchFeederMe(next);
      onDone(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change your alerts. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const rows: Array<{ key: Choice; label: string; hint?: string }> = [
    { key: "tomorrow", label: "Pause until tomorrow", hint: opts.tomorrow.label },
    { key: "week", label: "Pause for a week", hint: opts.week.label },
    { key: "off", label: "Turn off" },
  ];

  return (
    <div className={styles.root}>
      <div className={styles.scrim} aria-hidden="true" onClick={onClose} />
      <div ref={panel} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <span className={styles.grab} aria-hidden="true" />
        <div className={styles.text}>
          <h2 id={titleId} className={styles.title}>
            Need a break from alerts?
          </h2>
          <p className={styles.sub}>{pauseSentence(dogNames, wardCodes)}</p>
        </div>
        <div className={styles.options} role="radiogroup" aria-label="How long">
          {rows.map((r) => {
            const on = r.key === choice;
            return (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={on}
                className={[styles.option, on ? styles.on : ""].filter(Boolean).join(" ")}
                onClick={() => setChoice(r.key)}
              >
                <span className={styles.radio} aria-hidden="true">
                  {on ? (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8.5l3 3 7-7" />
                    </svg>
                  ) : null}
                </span>
                <span className={styles.optLabel}>{r.label}</span>
                {r.hint ? <span className={styles.optHint}>{r.hint}</span> : null}
              </button>
            );
          })}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button fullWidth onClick={() => void save()} disabled={busy} aria-busy={busy || undefined}>
            {choice === "off" ? "Turn off alerts" : "Pause alerts"}
          </Button>
          <Button variant="link" fullWidth onClick={onClose}>
            Keep them on
          </Button>
        </div>
      </div>
    </div>
  );
}
