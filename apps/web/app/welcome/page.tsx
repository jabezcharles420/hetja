"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, StickyFooter } from "@/components/ds";
import { Switch } from "@/components/ds/Switch";
import { QuietHoursSheet, WardChips } from "@/components/FeederPrefs";
import { api, ApiError, getAccessToken, type FeederMe, type QuietHours } from "@/lib/api";
import { cleanName, DEFAULT_QUIET_HOURS, formatQuietHours, MAX_NAME } from "@/lib/feeder-prefs";
import { safeNext } from "@/lib/login";
import styles from "./welcome.module.css";

/**
 * N1 Become a feeder (design v5), shown once after the first sign-in, while
 * GET /feeders/me says `onboarded: false`. The name others see, the wards to
 * be alerted about, SOS alerts and quiet hours, then "Start feeding" saves it
 * all in one PATCH with `onboarded: true`.
 */

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; me: FeederMe };

export default function WelcomePage(): React.JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [name, setName] = useState("");
  const [wards, setWards] = useState<string[]>([]);
  const [sos, setSos] = useState(true);
  const [quiet, setQuiet] = useState<QuietHours | null>(DEFAULT_QUIET_HOURS);
  const [quietOpen, setQuietOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const id = useId();

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      router.replace(`/login?next=${encodeURIComponent("/welcome")}`);
      return;
    }
    setState({ kind: "loading" });
    try {
      const me = await api.getFeederMe();
      // The mock prefills the public form ("Priya S."); saving it keeps that form.
      setName(me.publicName || me.displayName || "");
      setWards(Array.isArray(me.wards) ? me.wards : []);
      // The mock shows SOS alerts on: this screen is where a new feeder
      // decides, with the switch in plain view.
      setSos(me.onboarded ? me.sosOptIn : true);
      setQuiet(me.quietHours === undefined ? DEFAULT_QUIET_HOURS : me.quietHours);
      setState({ kind: "ready", me });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/welcome")}`);
        return;
      }
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Could not load your profile.",
      });
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async () => {
    const displayName = cleanName(name);
    if (!displayName) {
      setStatus(`Type the name others will see, up to ${MAX_NAME} letters.`);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await api.patchFeederMe({ displayName, wards, sosOptIn: sos, quietHours: quiet, onboarded: true });
      router.push(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state.kind !== "ready") {
    return (
      <div className={styles.page}>
        <div className={styles.body}>
          {state.kind === "error" ? (
            <>
              <h1 className={styles.title}>Welcome.</h1>
              <p className={styles.error} role="alert">
                {state.message}
              </p>
              <div>
                <Button variant="quiet" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            </>
          ) : (
            <p className={styles.lead} role="status">
              Loading…
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
        noValidate
      >
        <div className={styles.body}>
          <h1 className={styles.title}>Welcome. Where do you feed?</h1>
          <p className={styles.lead}>We only alert you about dogs in these wards.</p>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name shown to others</span>
            <input
              className={styles.fieldInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME}
              autoComplete="name"
              aria-describedby={status ? `${id}-status` : undefined}
            />
          </label>

          <WardChips selected={wards} onChange={setWards} homeWard={state.me.homeWard} />

          <div className={styles.card}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <span id={`${id}-sos`} className={styles.rowTitle}>
                  SOS alerts
                </span>
                <span id={`${id}-sos-d`} className={styles.rowSub}>
                  Hurt dogs in your wards
                </span>
              </div>
              <Switch checked={sos} onChange={setSos} labelledBy={`${id}-sos`} describedBy={`${id}-sos-d`} />
            </div>
            <button
              type="button"
              className={`${styles.row} ${styles.rowButton}`}
              onClick={() => setQuietOpen(true)}
              aria-haspopup="dialog"
            >
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>Quiet hours</span>
                <span className={styles.rowSub}>SOS still comes through</span>
              </span>
              <span className={styles.rowValue}>{formatQuietHours(quiet)} ›</span>
            </button>
          </div>

          {status && (
            <p id={`${id}-status`} className={styles.error} role="alert">
              {status}
            </p>
          )}
        </div>

        <StickyFooter background="none" className={styles.footer}>
          <Button type="submit" fullWidth disabled={busy} aria-busy={busy || undefined}>
            Start feeding
          </Button>
        </StickyFooter>
      </form>

      <QuietHoursSheet
        open={quietOpen}
        onClose={() => setQuietOpen(false)}
        value={quiet}
        onSave={(q) => {
          setQuiet(q);
          setQuietOpen(false);
        }}
      />
    </div>
  );
}
