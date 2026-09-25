"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ds";
import { Switch } from "@/components/ds/Switch";
import { WardPickerSheet } from "@/components/FeederPrefs";
import { api, ApiError, getAccessToken, type FeederMe } from "@/lib/api";
import { DEFAULT_QUIET_HOURS, MAX_WARDS, wardCode, wardsSummary } from "@/lib/feeder-prefs";
import { subscribeToPush } from "@/lib/pwa";
import styles from "./AlertsAsk.module.css";

/**
 * N13 Turn on SOS alerts (design v6). Shown before the browser's push prompt,
 * so "Allow" is an informed tap: a preview of the real notification, how
 * often it comes, which wards, and quiet nights.
 *
 * Used from Me (the SOS alerts switch), from the map (M6 "I feed in Malad":
 * pass `wardId` to add that ward) and after N1 (/welcome).
 *
 *   <AlertsAsk open onClose={...} onDone={(on) => ...} wardId="P-North" />
 *
 * "Turn on alerts" PATCHes /feeders/me ({ sosOptIn: true, sosPausedUntil:
 * null, wards, quietHours }) and then asks the browser for push permission.
 * Signed out, it sends the visitor to sign in and come back.
 */

export interface AlertsAskProps {
  open: boolean;
  onClose: () => void;
  /** After a successful save. `true` = alerts are on. */
  onDone?: (enabled: boolean) => void;
  /** Add this ward to the feeder's wards (M6: the ward on screen). */
  wardId?: string;
  /** Shown in the preview when no ward is chosen yet (e.g. "P/N"). */
  wardName?: string;
  /** The profile when the caller already has it; otherwise it is read on open. */
  me?: FeederMe | null;
  /** The dog named in the notification preview. */
  dogName?: string | null;
}

export function AlertsAsk({ open, onClose, onDone, wardId, me, dogName }: AlertsAskProps): React.JSX.Element | null {
  const [profile, setProfile] = useState<FeederMe | null>(me ?? null);
  const [wards, setWards] = useState<string[]>([]);
  const [quiet, setQuiet] = useState(true);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setError(null);
    let alive = true;
    const apply = (p: FeederMe | null) => {
      if (!alive) return;
      setProfile(p);
      const base = Array.isArray(p?.wards) ? p!.wards! : [];
      const withWard = wardId && !base.includes(wardId) && base.length < MAX_WARDS ? [...base, wardId] : base;
      setWards(withWard.length ? withWard : p?.homeWard ? [p.homeWard] : []);
      setQuiet(p?.quietHours !== null);
    };
    if (me !== undefined) apply(me);
    else if (getAccessToken()) api.getFeederMe().then(apply, () => apply(null));
    else apply(null);
    return () => {
      alive = false;
    };
  }, [open, me, wardId]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !picker) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, picker]);

  if (!open) return null;

  const turnOn = async () => {
    if (!getAccessToken()) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patchFeederMe({
        sosOptIn: true,
        sosPausedUntil: null,
        wards,
        quietHours: quiet ? (profile?.quietHours ?? DEFAULT_QUIET_HOURS) : null,
      });
      // Best effort: a refused or unsupported push still leaves the in-app alerts on.
      await subscribeToPush().catch(() => false);
      onDone?.(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not turn alerts on. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const previewWard = wards[0] ? wardCode(wards[0]) : wardId ? wardCode(wardId) : "your ward";

  return (
    <div className={styles.root}>
      <div
        ref={panel}
        className={styles.page}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        tabIndex={-1}
      >
        <div className={styles.body}>
          <h2 id={`${id}-t`} className={styles.title}>
            Know when a dog near you is hurt.
          </h2>
          <p className={styles.lead}>
            Only for your wards, and only when someone raises an SOS. Most weeks, that&apos;s none.
          </p>
          <div className={styles.preview} aria-label="What an SOS alert looks like" role="img">
            <span className={styles.appIcon} aria-hidden="true" />
            <div className={styles.previewText}>
              <div className={styles.previewHead}>
                <span className={styles.previewApp}>Hetja · SOS in {previewWard}</span>
                <span className={styles.previewWhen}>now</span>
              </div>
              <span className={styles.previewBody}>
                {dogName?.trim() || "Rani"} can&apos;t get up, or is bleeding. 1.4 km away. Can you go?
              </span>
            </div>
          </div>
          <div className={styles.card}>
            <button type="button" className={styles.row} onClick={() => setPicker(true)} aria-haspopup="dialog">
              <span className={styles.rowTitle}>Wards</span>
              <span className={styles.rowValue}>{wardsSummary(wards)} ›</span>
            </button>
            <div className={`${styles.row} ${styles.rowTall}`}>
              <span className={styles.rowText}>
                <span id={`${id}-q`} className={styles.rowTitle}>
                  Quiet at night
                </span>
                <span id={`${id}-qd`} className={styles.rowSub}>
                  Only &quot;can&apos;t get up&quot; comes through
                </span>
              </span>
              <Switch checked={quiet} onChange={setQuiet} labelledBy={`${id}-q`} describedBy={`${id}-qd`} />
            </div>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className={styles.foot}>
          <Button fullWidth onClick={() => void turnOn()} disabled={busy} aria-busy={busy || undefined}>
            Turn on alerts
          </Button>
          <Button variant="link" fullWidth onClick={onClose}>
            Not now
          </Button>
        </div>
      </div>
      <WardPickerSheet open={picker} onClose={() => setPicker(false)} selected={wards} onChange={setWards} />
    </div>
  );
}
