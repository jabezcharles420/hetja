"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { AppHeader } from "@/components/ds/AppHeader";
import { SettingsGroup, SettingsRow } from "@/components/ds/SettingsList";
import { Sheet } from "@/components/ds/Sheet";
import { AlertsSheet, QuietHoursSheet, WardPickerSheet } from "@/components/FeederPrefs";
import { AlertsAsk } from "@/components/AlertsAsk";
import { PauseAlertsSheet } from "@/components/PauseAlertsSheet";
import { Switch } from "@/components/ds/Switch";
import { api, ApiError, clearSession, getAccessToken, type FeederMe, type FeederPatch } from "@/lib/api";
import { alertsModeLabel, cleanName, formatQuietHours, MAX_NAME, wardCode, wardsSummary } from "@/lib/feeder-prefs";
import { isPaused, resumeLabel } from "@/lib/sos-pause";
import { firstName } from "@/lib/streak";
import { saveTabRole } from "@/lib/tab-role";
import styles from "./settings.module.css";

/**
 * N6 Settings (design v5), without the Language section (owner decision:
 * no languages until human translations exist). Account rows open a sheet
 * that PATCHes /feeders/me; Your data downloads, signs out or deletes.
 */

/** Trust floor the SOS fan-out applies before paging a feeder (routes/sos.ts). */
const SOS_PAGE_TRUST_FLOOR = 40;

type Editor = "name" | "wards" | "alerts" | "quiet" | "delete" | "pause" | "ask" | null;

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; me: FeederMe };

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SettingsPage(): React.JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [wardsDraft, setWardsDraft] = useState<string[]>([]);
  const nameId = useId();
  const showId = useId();

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setState({ kind: "signed-out" });
      return;
    }
    try {
      const me = await api.getFeederMe();
      setState({ kind: "ready", me });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHENTICATED")) {
        setState({ kind: "signed-out" });
      } else {
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "Could not load your settings." });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (e: Editor) => {
    setSheetError(null);
    setNotice(null);
    if (state.kind === "ready") {
      if (e === "name") setNameDraft(state.me.displayName ?? "");
      if (e === "wards") setWardsDraft(state.me.wards ?? []);
    }
    setEditor(e);
  };

  /** PATCH, merge what the server stored (or what was sent) and close. */
  const save = async (patch: FeederPatch, then: Editor = null) => {
    if (state.kind !== "ready") return;
    setBusy(true);
    setSheetError(null);
    try {
      const res = await api.patchFeederMe(patch);
      setState((s) => (s.kind === "ready" ? { kind: "ready", me: { ...s.me, ...patch, ...(res ?? {}) } as FeederMe } : s));
      setEditor(then);
    } catch (err) {
      setSheetError(err instanceof ApiError ? err.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setNotice(null);
    setBusy(true);
    try {
      const data = await api.exportMyData();
      downloadJson(data, `hetja-my-data-${new Date().toISOString().slice(0, 10)}.json`);
      setNotice("Your data is downloading.");
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Could not download your data. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    clearSession();
    saveTabRole(null);
    router.push("/");
  };

  const deleteAccount = async () => {
    setBusy(true);
    setSheetError(null);
    try {
      await api.deleteMyAccount();
      clearSession();
      saveTabRole(null);
      router.push("/");
    } catch (err) {
      setSheetError(err instanceof ApiError ? err.message : "Could not delete your account. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const header = <AppHeader back={{ href: "/me", label: "Me" }} surface="mist" />;

  if (state.kind !== "ready") {
    return (
      <div className={styles.page}>
        {header}
        <div className={`h-container ${styles.body}`}>
          <h1 className={styles.title}>Settings</h1>
          {state.kind === "signed-out" ? (
            <>
              <p className={styles.lead}>Sign in to change your name, wards and alerts.</p>
              <div>
                <Button href="/login?next=%2Fsettings">Sign in</Button>
              </div>
            </>
          ) : state.kind === "error" ? (
            <>
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

  const { me } = state;
  const wards = me.wards ?? [];
  const mode = me.alertsMode ?? "sos_only";
  const quiet = me.quietHours ?? null;
  const paused = me.sosOptIn && isPaused(me.sosPausedUntil);
  const sosOn = me.sosOptIn && !paused;
  const showName = me.showFirstName !== false;
  const trustNote =
    me.trustScore < SOS_PAGE_TRUST_FLOOR
      ? `Only feeders with a trust score of ${SOS_PAGE_TRUST_FLOOR} or more are paged for SOS. Yours is ${me.trustScore}, so keep logging feeds.`
      : null;

  return (
    <div className={styles.page}>
      {header}
      <div className={`h-container ${styles.body}`}>
        <h1 className={styles.title}>Settings</h1>

        <h2 className={styles.label}>Account</h2>
        <SettingsGroup>
          <SettingsRow label="Name shown" value={me.publicName || me.displayName} onClick={() => open("name")} />
          <SettingsRow label="My wards" value={wardsSummary(wards)} onClick={() => open("wards")} />
          <SettingsRow label="Alerts" value={alertsModeLabel(mode)} onClick={() => open("alerts")} />
          <SettingsRow
            label="Show my first name on dogs' pages"
            labelId={`${showId}-l`}
            sub={
              showName
                ? `Shown as ${firstName(me.displayName) ?? "your first name"}. Never your surname.`
                : "You're counted as a feeder, not named."
            }
            subId={`${showId}-d`}
            control={
              <Switch
                checked={showName}
                labelledBy={`${showId}-l`}
                describedBy={`${showId}-d`}
                disabled={busy}
                onChange={(next) => void save({ showFirstName: next })}
              />
            }
          />
        </SettingsGroup>

        <h2 className={styles.label}>Your data</h2>
        <SettingsGroup>
          <SettingsRow label="Download my data" onClick={() => void download()} disabled={busy} />
          <SettingsRow label="Sign out" onClick={signOut} />
          <SettingsRow label="Delete my account" tone="danger" chevron={false} onClick={() => open("delete")} />
        </SettingsGroup>
        {notice && (
          <p className={styles.note} role="status">
            {notice}
          </p>
        )}
        <p className={styles.note}>Deleting keeps the dogs you registered and their feed logs, with your name removed.</p>
      </div>

      <Sheet
        open={editor === "name"}
        onClose={() => setEditor(null)}
        title="Name shown"
        footer={
          <Button
            fullWidth
            disabled={busy || !cleanName(nameDraft)}
            aria-busy={busy || undefined}
            onClick={() => {
              const displayName = cleanName(nameDraft);
              if (displayName) void save({ displayName });
            }}
          >
            Save
          </Button>
        }
      >
        <label className={styles.field} htmlFor={nameId}>
          <span className={styles.fieldLabel}>Name shown to others</span>
          <input
            id={nameId}
            className={styles.fieldInput}
            value={nameDraft}
            maxLength={MAX_NAME}
            autoComplete="name"
            onChange={(e) => setNameDraft(e.target.value)}
          />
        </label>
        <p className={styles.note}>Other feeders see your first name and the first letter of your last.</p>
        {sheetError && (
          <p className={styles.error} role="alert">
            {sheetError}
          </p>
        )}
      </Sheet>

      <WardPickerSheet
        open={editor === "wards"}
        onClose={() => {
          const same = wardsDraft.length === wards.length && wardsDraft.every((w) => wards.includes(w));
          if (same) setEditor(null);
          else void save({ wards: wardsDraft });
        }}
        selected={wardsDraft}
        onChange={setWardsDraft}
        error={sheetError}
      />

      <AlertsSheet
        open={editor === "alerts"}
        onClose={() => setEditor(null)}
        mode={mode}
        sosOn={sosOn}
        sosSub={
          paused && me.sosPausedUntil
            ? `Paused until ${resumeLabel(me.sosPausedUntil)}`
            : sosOn
              ? "Hurt dogs in your wards"
              : "Off"
        }
        onSosToggle={(next) => open(next ? "ask" : "pause")}
        quietHours={formatQuietHours(quiet)}
        onEditQuiet={() => open("quiet")}
        trustNote={trustNote}
        busy={busy}
        error={sheetError}
        onSave={(next) => void save(next)}
      />

      <QuietHoursSheet
        open={editor === "quiet"}
        onClose={() => setEditor("alerts")}
        value={quiet}
        busy={busy}
        error={sheetError}
        onSave={(q) => void save({ quietHours: q }, "alerts")}
      />

      <PauseAlertsSheet
        open={editor === "pause"}
        onClose={() => setEditor("alerts")}
        wardCodes={wards.map(wardCode)}
        onDone={(next) => {
          setState((s) => (s.kind === "ready" ? { kind: "ready", me: { ...s.me, ...next } } : s));
          setEditor("alerts");
        }}
      />

      <AlertsAsk
        open={editor === "ask"}
        me={me}
        onClose={() => setEditor("alerts")}
        onDone={() => {
          setState((s) =>
            s.kind === "ready" ? { kind: "ready", me: { ...s.me, sosOptIn: true, sosPausedUntil: null } } : s,
          );
          setEditor("alerts");
          void load();
        }}
      />

      <Sheet
        open={editor === "delete"}
        onClose={() => setEditor(null)}
        title="Delete your account?"
        footer={
          <button
            type="button"
            className={styles.dangerButton}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void deleteAccount()}
          >
            Delete my account
          </button>
        }
      >
        <p className={styles.sheetText}>
          Deleting keeps the dogs you registered and their feed logs, with your name removed. You are signed out
          everywhere, and it can&apos;t be undone.
        </p>
        {sheetError && (
          <p className={styles.error} role="alert">
            {sheetError}
          </p>
        )}
      </Sheet>
    </div>
  );
}
