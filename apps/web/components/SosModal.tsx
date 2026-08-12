"use client";

import { useState } from "react";
import { api, ApiError, type SosReportResult, type SosSeverity } from "@/lib/api";
import PawIllustration from "./PawIllustration";
import styles from "./SosModal.module.css";

export interface SosModalProps {
  open: boolean;
  dogSlug: string;
  onClose: () => void;
}

const SEVERITIES: { value: SosSeverity; label: string; hint: string }[] = [
  {
    value: "minor",
    label: "Minor",
    hint: "Something's off — a limp, a rash, a new cough.",
  },
  {
    value: "serious",
    label: "Serious",
    hint: "Open wound, fever, not eating. Needs attention today.",
  },
  {
    value: "critical",
    label: "Critical",
    hint: "Immediate danger — this fans out to responders now.",
  },
];

export default function SosModal({
  open,
  dogSlug,
  onClose,
}: SosModalProps): React.JSX.Element | null {
  const [severity, setSeverity] = useState<SosSeverity>("serious");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<SosReportResult | null>(null);

  if (!open) return null;

  const reset = () => {
    setSeverity("serious");
    setNote("");
    setStatus(null);
    setConfirmed(null);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setStatus("Sending SOS…");
    try {
      const result = await api.createReport({
        dogSlug,
        severity,
        note: note.trim() || undefined,
      });
      if (result.created) {
        setConfirmed(result);
      } else {
        setStatus(
          "An open SOS case already exists for this dog — a neighbour is already on it.",
        );
      }
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "SOS failed — please call a trusted vet.");
    } finally {
      setBusy(false);
    }
  };

  if (confirmed) {
    return (
      <div className={styles.backdrop} role="presentation" onMouseDown={close}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label="SOS confirmed"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className={styles.confirmBadge}>
            <PawIllustration size={30} className={styles.confirmPaw} />
          </div>
          <h2 className={styles.title}>SOS sent</h2>
          <p className={styles.confirmBody}>
            Case <strong>{confirmed.caseId.slice(0, 8)}</strong> is open. Help is on the way —
            you can leave your phone aside now.
          </p>
          <button type="button" className={styles.send} onClick={close}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const active = SEVERITIES.find((s) => s.value === severity);

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={close}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Report SOS"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className={styles.kicker}>Neighbour needs help</span>
        <h2 className={styles.title}>Someone needs help, right now.</h2>
        <p className={styles.sub}>Take a breath. Tell us exactly what you saw.</p>

        <fieldset className={styles.segmentGroup}>
          <legend className={styles.srOnly}>How serious is it?</legend>
          <div className={styles.segments}>
            {SEVERITIES.map((s) => (
              <label
                key={s.value}
                className={`${styles.segment} ${severity === s.value ? styles.selected : ""}`}
              >
                <input
                  type="radio"
                  name="severity"
                  value={s.value}
                  checked={severity === s.value}
                  onChange={() => setSeverity(s.value)}
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          <p className={styles.segmentHint} aria-live="polite">
            {active?.hint}
          </p>
        </fieldset>

        <textarea
          className={styles.note}
          aria-label="SOS note"
          placeholder="What's happening? Where exactly? (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />

        {status && (
          <p className={styles.status} role="status">
            {status}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={close}>
            Close
          </button>
          <button type="button" className={styles.send} disabled={busy} onClick={() => void submit()}>
            {busy ? "Sending…" : "Send SOS"}
          </button>
        </div>
      </div>
    </div>
  );
}
