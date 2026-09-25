"use client";

import { useEffect, useId, useState } from "react";
import { Segmented, Sheet } from "@/components/ds";
import { ngoApi, type NgoAmbulance, type NgoBeds } from "./ngo-api";
import { errorWords } from "./NgoGate";
import styles from "./ngo.module.css";

/**
 * The Ambulance and Shelter beds update sheets (designed, not in the
 * board), opened from N2's tiles. What they save is what the map and the
 * SOS pages show about the NGO.
 */

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className={styles.stepper}>
      <span id={id} className={styles.rowTitle}>
        {label}
      </span>
      <div className={styles.stepperBtns} role="group" aria-labelledby={id}>
        <button
          type="button"
          className={styles.stepperBtn}
          aria-label={`${label}: one fewer`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <output className={styles.stepperNum} aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className={styles.stepperBtn}
          aria-label={`${label}: one more`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function AmbulanceSheet({
  open,
  onClose,
  value,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  value: NgoAmbulance | null;
  onSaved: (a: NgoAmbulance) => void;
}): React.JSX.Element {
  const hoursId = useId();
  const [status, setStatus] = useState<"in" | "out">(value?.status ?? "in");
  const [count, setCount] = useState(value?.count ?? 1);
  const [hours, setHours] = useState(value?.hours ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(value?.status ?? "in");
    setCount(value?.count ?? 1);
    setHours(value?.hours ?? "");
    setError(null);
  }, [open, value]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await ngoApi.updateAmbulance({ status, count, hours: hours.trim() || null });
      onSaved({ ...(value ?? { count, status, hours: null }), ...saved });
      onClose();
    } catch (err) {
      setError(errorWords(err, "Could not save that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ambulance"
      footer={
        <div className={styles.footer}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button type="button" className={styles.inkBtn} onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className={styles.sheetField}>
        <span className={styles.label}>Right now</span>
        <Segmented
          label="Ambulance right now"
          value={status}
          onChange={setStatus}
          options={[
            { value: "in", label: "In, ready to go" },
            { value: "out", label: "Out on a case" },
          ]}
        />
      </div>
      <Stepper label="Ambulances you run" value={count} min={0} max={20} onChange={setCount} />
      <div className={styles.sheetField}>
        <label className={styles.label} htmlFor={hoursId}>
          Hours
        </label>
        <input
          id={hoursId}
          className={styles.input}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="8am to 10pm"
          maxLength={60}
        />
      </div>
      <p className={styles.note}>People raising an SOS in your wards see whether it is in, and these hours.</p>
    </Sheet>
  );
}

export function BedsSheet({
  open,
  onClose,
  value,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  value: NgoBeds | null;
  onSaved: (b: NgoBeds) => void;
}): React.JSX.Element {
  const [free, setFree] = useState(value?.free ?? 0);
  const [total, setTotal] = useState(value?.total ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFree(value?.free ?? 0);
    setTotal(value?.total ?? 0);
    setError(null);
  }, [open, value]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await ngoApi.updateBeds({ free, total });
      onSaved(saved ?? { free, total });
      onClose();
    } catch (err) {
      setError(errorWords(err, "Could not save that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Shelter beds"
      footer={
        <div className={styles.footer}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button type="button" className={styles.inkBtn} onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <Stepper label="Free now" value={free} min={0} max={total} onChange={setFree} />
      <Stepper
        label="Beds in all"
        value={total}
        min={0}
        max={500}
        onChange={(t) => {
          setTotal(t);
          if (free > t) setFree(t);
        }}
      />
      <p className={styles.note}>
        {free} of {total} free. Vets and responders nearby see this when they need somewhere for a dog to recover.
      </p>
    </Sheet>
  );
}
