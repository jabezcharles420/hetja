"use client";

import { useEffect, useId, useState } from "react";
import { wardDisplay } from "@hetja/contracts";
import { Button } from "@/components/ds";
import { Segmented } from "@/components/ds/Segmented";
import { Sheet } from "@/components/ds/Sheet";
import { Switch } from "@/components/ds/Switch";
import type { AlertsMode, QuietHours } from "@/lib/api";
import {
  ALL_WARDS,
  DEFAULT_QUIET_HOURS,
  MAX_WARDS,
  suggestedWards,
  toggleWard,
  wardChipLabel,
} from "@/lib/feeder-prefs";
import styles from "./FeederPrefs.module.css";

/**
 * The feeder's own settings controls, shared by N1 (/welcome) and N6
 * (/settings): ward chips with the "+ More wards" picker of all 24 BMC
 * wards, the quiet hours editor and the alerts mode editor.
 */

export function WardChips({
  selected,
  onChange,
  homeWard,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  homeWard?: string | null;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Chips stay put once shown, so a chip does not vanish when unselected.
  const [shown, setShown] = useState<string[]>(() => suggestedWards(selected, homeWard));
  useEffect(() => {
    setShown((prev) => {
      const add = selected.filter((w) => !prev.includes(w));
      return add.length ? [...prev, ...add] : prev;
    });
  }, [selected]);
  useEffect(() => {
    setShown((prev) => (prev.length ? prev : suggestedWards(selected, homeWard)));
    // homeWard arrives with the profile; selected is read once here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeWard]);

  const full = selected.length >= MAX_WARDS;

  return (
    <>
      <div className={styles.chips} role="group" aria-label="Your wards">
        {shown.map((id) => {
          const on = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={[styles.chip, on ? styles.chipOn : ""].filter(Boolean).join(" ")}
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => onChange(toggleWard(selected, id))}
            >
              {wardChipLabel(id)}
            </button>
          );
        })}
        <button type="button" className={styles.chip} onClick={() => setOpen(true)} aria-haspopup="dialog">
          + More wards
        </button>
      </div>
      <WardPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        selected={selected}
        onChange={onChange}
      />
    </>
  );
}

export function WardPickerSheet({
  open,
  onClose,
  selected,
  onChange,
  error,
}: {
  open: boolean;
  /** "Done": the caller saves on close when it needs to. */
  onClose: () => void;
  selected: string[];
  onChange: (next: string[]) => void;
  error?: string | null;
}): React.JSX.Element {
  const full = selected.length >= MAX_WARDS;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your wards"
      closeLabel="Done"
      footer={
        <>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <p className={styles.note} role="status">
            {full ? `That's ${MAX_WARDS}, the most you can pick.` : `Pick up to ${MAX_WARDS}.`}
          </p>
        </>
      }
    >
      <ul className={styles.wardList}>
        {ALL_WARDS.map((id) => {
          const on = selected.includes(id);
          const d = wardDisplay(id);
          return (
            <li key={id}>
              <button
                type="button"
                className={styles.wardRow}
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => onChange(toggleWard(selected, id))}
              >
                <span className={styles.wardCode}>{d.code}</span>
                <span className={styles.wardName}>{d.name}</span>
                <span className={[styles.tick, on ? styles.tickOn : ""].filter(Boolean).join(" ")} aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

export function QuietHoursSheet({
  open,
  onClose,
  value,
  onSave,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  value: QuietHours | null;
  onSave: (next: QuietHours | null) => void;
  busy?: boolean;
  error?: string | null;
}): React.JSX.Element {
  const [on, setOn] = useState(value !== null);
  const [start, setStart] = useState((value ?? DEFAULT_QUIET_HOURS).start);
  const [end, setEnd] = useState((value ?? DEFAULT_QUIET_HOURS).end);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    setOn(value !== null);
    setStart((value ?? DEFAULT_QUIET_HOURS).start);
    setEnd((value ?? DEFAULT_QUIET_HOURS).end);
  }, [open, value]);
  const valid = !on || (start !== end && /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Quiet hours"
      footer={
        <Button fullWidth disabled={!valid || busy} aria-busy={busy || undefined} onClick={() => onSave(on ? { start, end } : null)}>
          Save
        </Button>
      }
    >
      <div className={styles.card}>
        <div className={styles.switchRow}>
          <div className={styles.switchText}>
            <span id={`${id}-l`} className={styles.rowTitle}>
              Quiet hours
            </span>
            <span id={`${id}-d`} className={styles.rowSub}>
              SOS still comes through
            </span>
          </div>
          <Switch checked={on} onChange={setOn} labelledBy={`${id}-l`} describedBy={`${id}-d`} />
        </div>
        {on && (
          <>
            <label className={styles.timeRow}>
              <span className={styles.rowTitle}>From</span>
              <input type="time" className={styles.time} value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className={styles.timeRow}>
              <span className={styles.rowTitle}>To</span>
              <input type="time" className={styles.time} value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {!valid && <p className={styles.error}>Start and end need to be different times.</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

export function AlertsSheet({
  open,
  onClose,
  mode,
  sosOn,
  sosSub = "Hurt dogs in your wards",
  onSosToggle,
  quietHours,
  onSave,
  onEditQuiet,
  trustNote,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  mode: AlertsMode;
  /** SOS paging is on and not paused. */
  sosOn: boolean;
  sosSub?: string;
  /**
   * The SOS switch never flips silently: off opens L1 (pause), on opens N13
   * (the alerts ask). The caller owns both.
   */
  onSosToggle: (next: boolean) => void;
  quietHours: string;
  onSave: (next: { alertsMode: AlertsMode }) => void;
  onEditQuiet: () => void;
  trustNote?: string | null;
  busy?: boolean;
  error?: string | null;
}): React.JSX.Element {
  const [m, setM] = useState<AlertsMode>(mode);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    setM(mode);
  }, [open, mode]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Alerts"
      footer={
        <Button fullWidth disabled={busy} aria-busy={busy || undefined} onClick={() => onSave({ alertsMode: m })}>
          Save
        </Button>
      }
    >
      <Segmented<AlertsMode>
        label="Which alerts"
        value={m}
        onChange={setM}
        options={[
          { value: "sos_only", label: "SOS only" },
          { value: "all", label: "All" },
        ]}
      />
      <p className={styles.note}>
        {m === "all"
          ? "SOS, tags, vet visits and feeds for the dogs you look after."
          : "Only hurt dogs in your wards. Everything else waits in Alerts."}
      </p>
      <div className={styles.card}>
        <div className={styles.switchRow}>
          <div className={styles.switchText}>
            <span id={`${id}-l`} className={styles.rowTitle}>
              SOS alerts
            </span>
            <span id={`${id}-d`} className={styles.rowSub}>
              {sosSub}
            </span>
          </div>
          <Switch checked={sosOn} onChange={onSosToggle} labelledBy={`${id}-l`} describedBy={`${id}-d`} />
        </div>
        <button type="button" className={styles.linkRow} onClick={onEditQuiet}>
          <span className={styles.switchText}>
            <span className={styles.rowTitle}>Quiet hours</span>
            <span className={styles.rowSub}>SOS still comes through</span>
          </span>
          <span className={styles.rowValue}>{quietHours} ›</span>
        </button>
      </div>
      {trustNote && <p className={styles.note}>{trustNote}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
