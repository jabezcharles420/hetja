"use client";

import { useState } from "react";
import { api, ApiError, type SosSeverity } from "@/lib/api";
import styles from "./SosModal.module.css";

export interface SosModalProps {
  open: boolean;
  dogSlug: string;
  onClose: () => void;
}

const SEVERITIES: { value: SosSeverity; label: string; hint: string }[] = [
  { value: "minor", label: "Minor", hint: "e.g. limping, mild skin issue" },
  { value: "serious", label: "Serious", hint: "e.g. open wound, fever, unable to eat" },
  { value: "critical", label: "Critical", hint: "immediate danger — fans out to responders now" },
];

export default function SosModal({ open, dogSlug, onClose }: SosModalProps): React.JSX.Element | null {
  const [severity, setSeverity] = useState<SosSeverity>("serious");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setStatus("Sending SOS…");
    try {
      const result = await api.createReport({ dogSlug, severity, note: note.trim() || undefined });
      setStatus(
        result.created
          ? `SOS case opened (case ${result.caseId.slice(0, 8)}). Help is on the way.`
          : "An open case already exists for this dog.",
      );
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "SOS failed — please call a trusted vet.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Report SOS" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Report an SOS</h2>
        <p className={styles.dog}>{dogSlug}</p>

        <div className={styles.severities}>
          {SEVERITIES.map((s) => (
            <label key={s.value} className={`${styles.severity} ${severity === s.value ? styles.selected : ""}`}>
              <input
                type="radio"
                name="severity"
                value={s.value}
                checked={severity === s.value}
                onChange={() => setSeverity(s.value)}
              />
              <span className={styles.severityLabel}>{s.label}</span>
              <span className={styles.hint}>{s.hint}</span>
            </label>
          ))}
        </div>

        <textarea
          className={styles.note}
          placeholder="What's happening? (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />

        {status && <p className={styles.status}>{status}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
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
