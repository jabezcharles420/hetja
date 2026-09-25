"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsGroup, SettingsRow, Sheet, Switch } from "@/components/ds";
import { WardPickerSheet } from "@/components/FeederPrefs";
import { ApiError } from "@/lib/api";
import { wardsSummary } from "@/lib/feeder-prefs";
import { PasskeyError, passkeyMessage, setUpPasskey, unlockWord } from "./passkey";
import { governmentLabel, hoursLabel } from "./vet-copy";
import { vetApi, type VetProfile, type VetProfilePatch } from "./vet-api";
import { useOnMount, useSignedIn, VetMessage, VetTop } from "./VetParts";
import styles from "./vet.module.css";

/**
 * Two designed screens (design v7, "Screens to design"):
 *
 *   Vet profile  the vet's own card: name, registration, clinic, and
 *                "Government vet · free" when they are one (owner decision);
 *                rows for wards, SOS calls and hours, the public phone
 *                (public by design: vets exist to be called) and signing.
 *   Passkey      set up signing on this phone (the same step V3 offers
 *                inline, on its own page).
 */

type Editor = "clinic" | "wards" | "hours" | "phone" | null;

export function VetProfileScreen(): React.JSX.Element {
  const router = useRouter();
  const ids = useId();
  const { toLogin, signedIn } = useSignedIn("/vet/profile");
  const [vet, setVet] = useState<VetProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState({ clinic: "", phone: "", from: "09:00", to: "21:00" });
  const [wards, setWards] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVet = useCallback(async () => {
    setFailed(false);
    try {
      const v = await vetApi.getMyVet();
      if (!v || (v.status !== "verified" && v.status !== "suspended")) {
        router.replace("/vet/apply");
        return;
      }
      setVet(v);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setFailed(true);
    }
  }, [router, toLogin]);

  useOnMount(() => {
    if (signedIn()) void fetchVet();
  });

  if (failed) {
    return (
      <VetMessage back="Vet" href="/vet" title="Hetja could not be reached." lead="Check your connection and try again.">
        <button type="button" className={`${styles.textLink} ${styles.more}`} onClick={() => void fetchVet()}>
          Try again
        </button>
      </VetMessage>
    );
  }
  if (!vet) return <VetMessage back="Vet" href="/vet" lead="Loading." role="status" />;

  const save = async (patch: VetProfilePatch) => {
    setBusy(true);
    setError(null);
    try {
      const next = await vetApi.patchMyVet(patch, vet.hasPasskey ? 1 : 0);
      setVet(next ? { ...next, hasPasskey: vet.hasPasskey, canSign: vet.canSign, canAcceptSos: vet.canAcceptSos } : { ...vet, ...patch } as VetProfile);
      setEditor(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setError(err instanceof ApiError && err.status === 400 ? "That wasn't accepted. Check it and try again." : "Hetja could not be reached. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const open = (e: Editor) => {
    setError(null);
    setDraft({ clinic: vet.clinic ?? "", phone: vet.publicPhone ?? "", from: vet.sosHours?.from ?? "09:00", to: vet.sosHours?.to ?? "21:00" });
    setWards(vet.wards);
    setEditor(e);
  };

  const gov = governmentLabel(vet.isGovernment);

  return (
    <div className={`${styles.page} ${styles.mist}`}>
      <VetTop back="Vet" href="/vet" />
      <div className={styles.body}>
        <h1 className={styles.title}>Vet profile</h1>
        <div className={styles.profileHead}>
          <p className={styles.profileName}>{vet.name}</p>
          <p className={styles.profileMeta}>{[vet.regLabel, vet.clinic].filter(Boolean).join(" · ")}</p>
          {gov ? (
            <span className={styles.gov}>{gov}</span>
          ) : (
            <span className={`${styles.verified} ${styles.pillStart} ${vet.status === "suspended" ? styles.paused : ""}`}>
              {vet.status === "suspended" ? "Paused" : `✓ Verified · ${vet.regLabel}`}
            </span>
          )}
        </div>

        <div className={styles.groupGap}>
          <SettingsGroup label="Where and when">
            <SettingsRow label="Clinic" value={vet.clinic ?? "None"} onClick={() => open("clinic")} />
            <SettingsRow label="Wards" value={wardsSummary(vet.wards)} onClick={() => open("wards")} />
            <SettingsRow
              label="Takes SOS calls"
              labelId={`${ids}-sos`}
              control={
                <Switch
                  checked={vet.sosAvailable}
                  onChange={(next) => void save({ sosAvailable: next })}
                  labelledBy={`${ids}-sos`}
                  disabled={busy || vet.status === "suspended"}
                />
              }
            />
            {vet.sosAvailable && <SettingsRow label="SOS hours" value={hoursLabel(vet.sosHours) || "Any time"} onClick={() => open("hours")} />}
            <SettingsRow label="Public phone" value={vet.publicPhone ?? "None"} onClick={() => open("phone")} />
          </SettingsGroup>
        </div>
        <p className={styles.hint}>Your phone and clinic are public, like the care directory&rsquo;s: people who need a vet call you from SOS pages and the map. Nothing else about you is shown.</p>

        <div className={styles.groupGap}>
          <SettingsGroup label="Signing">
            <SettingsRow
              label="Signing passkey"
              value={vet.hasPasskey ? "Set up" : "Not yet"}
              href="/vet/passkey"
            />
            <SettingsRow label="My signatures" href="/vet/signatures" />
          </SettingsGroup>
        </div>
        {error && !editor && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
      </div>

      <Sheet
        open={editor === "clinic" || editor === "phone" || editor === "hours"}
        onClose={() => setEditor(null)}
        title={editor === "clinic" ? "Clinic" : editor === "phone" ? "Public phone" : "SOS hours"}
        footer={
          <>
            {error && (
              <p className={styles.footAlert} role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className={styles.dark}
              disabled={busy || (editor === "phone" && draft.phone.replace(/\D/g, "").length < 10)}
              onClick={() =>
                void save(
                  editor === "clinic"
                    ? { clinic: draft.clinic.trim() || null }
                    : editor === "phone"
                      ? { publicPhone: draft.phone.trim() }
                      : { sosHours: { from: draft.from, to: draft.to } },
                )
              }
            >
              Save
            </button>
          </>
        }
      >
        {editor === "clinic" && (
          <input className={styles.input} value={draft.clinic} onChange={(e) => setDraft({ ...draft, clinic: e.target.value })} maxLength={80} aria-label="Clinic" />
        )}
        {editor === "phone" && (
          <>
            <input
              className={styles.input}
              type="tel"
              inputMode="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              maxLength={20}
              aria-label="Public phone"
            />
            <p className={styles.hint}>Shown on SOS pages and the map, so people can call you.</p>
          </>
        )}
        {editor === "hours" && (
          <div className={styles.hours}>
            <input className={styles.input} type="time" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label="From" />
            <span className={styles.hoursTo}>to</span>
            <input className={styles.input} type="time" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="To" />
          </div>
        )}
      </Sheet>

      <WardPickerSheet
        open={editor === "wards"}
        onClose={() => {
          const same = wards.length === vet.wards.length && wards.every((w) => vet.wards.includes(w));
          if (same || wards.length === 0) setEditor(null);
          else void save({ wards });
        }}
        selected={wards}
        onChange={setWards}
        error={error}
      />
    </div>
  );
}

export function PasskeyScreen(): React.JSX.Element {
  const { toLogin, signedIn } = useSignedIn("/vet/passkey");
  const [has, setHas] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const word = unlockWord();

  useOnMount(() => {
    if (!signedIn()) return;
    vetApi
      .getMyVet()
      .then((v) => setHas(!!v?.hasPasskey))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) toLogin();
        else setHas(false);
      });
  });

  const setUp = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setUpPasskey();
      setDone(true);
      setHas(true);
    } catch (err) {
      setError(err instanceof PasskeyError ? (err.reason === "cancelled" ? "Setup was cancelled. Nothing changed." : passkeyMessage(err)) : "Setup didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <VetTop back="Vet profile" href="/vet/profile" />
      <div className={styles.body}>
        <h1 className={styles.title}>{done ? "Done." : "Sign with your phone"}</h1>
        <p className={styles.lead}>
          {done
            ? `You can sign records on this phone with ${word}.`
            : `Your signature is a passkey: ${word === "Face ID" ? "Face ID" : "your fingerprint, face or screen lock"}. It never leaves this phone. Hetja keeps only its public half, so anyone can check that a record was signed by you and not changed since.`}
        </p>
        {!done && has && (
          <p className={styles.status} role="status">
            Your account already has a passkey. Set one up here too if you sign from this phone.
          </p>
        )}
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepDot} aria-hidden="true">
              1
            </span>
            <span>Tap the button. Your phone asks for {word}.</span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepDot} aria-hidden="true">
              2
            </span>
            <span>Each time you sign a record, it asks again. That tap is your signature.</span>
          </li>
        </ol>
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
      </div>
      {!done && (
        <div className={styles.footer}>
          <button type="button" className={styles.dark} onClick={() => void setUp()} disabled={busy || has === null} aria-busy={busy || undefined}>
            Set up {word}
          </button>
        </div>
      )}
    </div>
  );
}
