"use client";

/**
 * Screen 10, New dog (design v4). Route protection is a UX boundary, not a
 * security boundary (see RequireCapability); the API is the boundary.
 *
 * Name, ward (from GET /wards, shown "K/W · Andheri West"), and two
 * self-reported toggles. The toggles are stored as the registrator's word
 * only (vaccinatedReported / sterilisedReported, migration 0025): the public
 * profile shows Vaccinated / Sterilised from vet records alone, which is what
 * the caption promises. Warms the device token on mount so the proof-of-work
 * overlaps typing instead of the tap.
 */

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, StickyFooter } from "@/components/ds";
import { api, ApiError, type Ward } from "@/lib/api";
import { deviceTokenFailureMessage, getDeviceToken, readCachedDeviceToken } from "@/lib/device";
import { blobToBase64, stripDataPrefix } from "@/lib/offline-queue";
import { prepareFeedPhoto } from "@/lib/photo";
import { savePendingPhoto } from "@/lib/registration-photo";
import RequireCapability from "@/components/RequireCapability";
import styles from "./new.module.css";

/** 429 REGISTRATION_WEEKLY_CAP: six registrations in seven days (API T9). */
export const REGISTRATION_WEEKLY_CAP_MESSAGE =
  "You've registered 6 dogs this week. The limit keeps fake dogs off the map. Try again in a few days.";

export function wardLabel(w: Pick<Ward, "code" | "name">): string {
  return `${w.code} · ${w.name}`;
}

function PhotoIcon(): React.JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className={styles.row}>
      <span className={styles.toggleLabel} id={id}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        className={[styles.switch, checked ? styles.switchOn : ""].filter(Boolean).join(" ")}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} />
      </button>
    </div>
  );
}

function NewFormInner(): React.JSX.Element {
  const router = useRouter();

  const [wards, setWards] = useState<Ward[]>([]);
  const [wardId, setWardId] = useState("");
  const [name, setName] = useState("");
  const [vaccinated, setVaccinated] = useState(false);
  const [sterilised, setSterilised] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!readCachedDeviceToken()) void getDeviceToken();
    let cancelled = false;
    (async () => {
      try {
        const [list, me] = await Promise.all([
          api.getWards(),
          api.getFeederMe().catch(() => null),
        ]);
        if (cancelled) return;
        setWards(list.wards);
        // Default to the feeder's own ward when we know it; otherwise make
        // them choose rather than silently filing the dog under ward A.
        if (me?.homeWard && list.wards.some((w) => w.id === me.homeWard)) setWardId(me.homeWard);
      } catch {
        if (!cancelled) setError("Could not load the ward list. Check your connection.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const pickPhoto = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(f);
    setPreview(f && typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null);
  };

  const ward = wards.find((w) => w.id === wardId) ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!wardId) {
      setError("Pick the ward the dog lives in.");
      return;
    }
    setBusy(true);
    try {
      // The x-device-token gate (INVARIANT 6). Permanent failures are said
      // now; transient ones fall through to the API's own 401.
      let deviceToken: string | undefined;
      const outcome = await getDeviceToken();
      if (outcome.ok) deviceToken = outcome.token;
      else if (outcome.reason === "insecure-context" || outcome.reason === "no-web-crypto") {
        setError(deviceTokenFailureMessage(outcome.reason));
        return;
      }

      const res = await api.createRegistration(
        {
          wardId,
          ...(name.trim() ? { name: name.trim() } : {}),
          vaccinatedReported: vaccinated,
          sterilisedReported: sterilised,
        },
        deviceToken,
      );

      if (photo) {
        try {
          const prepared = await prepareFeedPhoto(photo);
          savePendingPhoto(res.slug, stripDataPrefix(await blobToBase64(prepared.blob)));
        } catch {
          // The dog is registered; a photo can be added on the first feed.
        }
      }
      router.push(`/register/${res.slug}/ready`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "REGISTRATION_BUDGET_EXCEEDED" || err.code === "DEVICE_REGISTRATION_BUDGET_EXCEEDED") {
          setError("Two dogs are already waiting for their collars. Attach one to free a slot.");
        } else if (err.code === "REGISTRATION_WEEKLY_CAP") {
          setError(REGISTRATION_WEEKLY_CAP_MESSAGE);
        } else if (err.code === "REGISTRATION_DISABLED") {
          setError("Registration is switched off for this account.");
        } else if (err.code === "UNAUTHENTICATED_DEVICE") {
          setError("Could not confirm this device. Check your connection and try again.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Could not save the dog. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.page} onSubmit={(e) => void submit(e)} noValidate>
      <div className={styles.top}>
        <Link href="/register" className={styles.cancel}>
          Cancel
        </Link>
      </div>

      <div className={styles.body}>
        <h1 className={styles.title}>New dog</h1>

        <div className={styles.photoRow}>
          <label className={styles.photo} data-filled={preview ? "true" : undefined}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className={styles.fileInput}
              aria-describedby="reg-photo-help"
              onChange={(e) => {
                pickPhoto(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="The dog's face photo" className={styles.photoImg} />
            ) : (
              <span className={styles.photoEmpty}>
                <PhotoIcon />
                <span className={styles.photoCap}>Photo</span>
              </span>
            )}
          </label>
          <p className={styles.helper} id="reg-photo-help">
            A clear face photo. Strangers use it to check they found the right dog.
          </p>
        </div>

        <div className={styles.group}>
          <label className={styles.row} htmlFor="reg-name">
            <span className={styles.fieldText}>
              <span className={styles.fieldLabel}>Name</span>
              <input
                id="reg-name"
                className={styles.textInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoCapitalize="words"
                autoComplete="off"
              />
            </span>
          </label>

          <label className={[styles.row, styles.wardRow].join(" ")} htmlFor="reg-ward">
            <span className={styles.fieldText}>
              <span className={styles.fieldLabel}>Ward</span>
              <span className={[styles.fieldValue, ward ? "" : styles.placeholder].filter(Boolean).join(" ")}>
                {ward ? wardLabel(ward) : "Choose a ward"}
              </span>
            </span>
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
            {/* The native picker, invisible over the row: the phone's own wheel. */}
            <select
              id="reg-ward"
              className={styles.select}
              value={wardId}
              onChange={(e) => setWardId(e.target.value)}
            >
              <option value="" disabled>
                Choose a ward
              </option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {wardLabel(w)}
                </option>
              ))}
            </select>
          </label>

          <Toggle label="Vaccinated" checked={vaccinated} onChange={setVaccinated} />
          <Toggle label="Sterilised" checked={sterilised} onChange={setSterilised} />
        </div>

        <p className={styles.caption}>Only the ward is ever shown. Vets can confirm medical status later.</p>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <StickyFooter background="mist" className={styles.footer}>
        <Button type="submit" fullWidth disabled={busy} aria-busy={busy || undefined}>
          Save &amp; print collar
        </Button>
      </StickyFooter>
    </form>
  );
}

export default function NewRegistrationForm(): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <NewFormInner />
    </RequireCapability>
  );
}
