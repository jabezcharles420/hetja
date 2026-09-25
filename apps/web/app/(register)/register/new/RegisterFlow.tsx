"use client";

/**
 * Register a dog, design v5 R2 to R5: one client flow, steps 1 to 4.
 * Route protection is a UX boundary, not a security boundary (see
 * RequireCapability); the API is the boundary.
 *
 *   1 R2 Photo           camera with the face oval (PhotoStep)
 *   2 R3 Duplicate check the ward, and the dogs already in it (DuplicateStep)
 *   3 R4 About the dog   name, sex, markings, self-reported health (AboutStep)
 *   4 R5 Confirm         summary and the two promises (ConfirmStep)
 *
 * The photo is compressed and EXIF-stripped in the browser (lib/photo.ts)
 * before anything leaves the phone, and goes up with POST /registrations as
 * `photoBase64`. Its ward-coarsened EXIF position, if it has one, picks the
 * ward without a location prompt; otherwise the phone's location is asked for
 * on arriving at step 2 (the person has just taken the photo), then the
 * feeder's home ward. The ward is only ever a suggestion: "Change" is one tap.
 *
 * Warms the device token on mount so the proof-of-work overlaps the photo
 * instead of the final tap (INVARIANT 6: x-device-token on registrations).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BMC_WARD_CENTROIDS, isInMumbai } from "@hetja/contracts";
import { Button, StickyFooter } from "@/components/ds";
import { api, ApiError, type CreateRegistrationInput, type FeederMe, type Ward } from "@/lib/api";
import { deviceTokenFailureMessage, getDeviceToken, readCachedDeviceToken } from "@/lib/device";
import { rememberDogSex, type DogSex } from "@/lib/dog-copy";
import { blobToBase64, captureGeo, stripDataPrefix } from "@/lib/offline-queue";
import { prepareFeedPhoto } from "@/lib/photo";
import { savePendingPhoto } from "@/lib/registration-photo";
import RequireCapability from "@/components/RequireCapability";
import PhotoStep from "./PhotoStep";
import DuplicateStep from "./DuplicateStep";
import AboutStep, { type Tri } from "./AboutStep";
import ConfirmStep from "./ConfirmStep";
import s from "../register.module.css";
import styles from "./flow.module.css";

export { wardLabel } from "./DuplicateStep";

/** 429 REGISTRATION_WEEKLY_CAP: six registrations in seven days (API T9). */
export const REGISTRATION_WEEKLY_CAP_MESSAGE =
  "You've registered 6 dogs this week. The limit keeps fake dogs off the map. Try again in a few days.";

/** The BMC ward whose centre is nearest a point inside Mumbai, else null. */
export function nearestWard(lat: number, lng: number): string | null {
  if (!isInMumbai(lat, lng)) return null;
  const k = Math.cos((lat * Math.PI) / 180);
  let best: string | null = null;
  let bestD = Infinity;
  for (const [id, c] of Object.entries(BMC_WARD_CENTROIDS)) {
    const d = (c.lat - lat) ** 2 + ((c.lng - lng) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

function triToBool(t: Tri): boolean | undefined {
  return t === "yes" ? true : t === "no" ? false : undefined;
}

type Photo = { base64: string; url: string | null; geo?: { lat: number; lng: number } };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "REGISTRATION_BUDGET_EXCEEDED" || err.code === "DEVICE_REGISTRATION_BUDGET_EXCEEDED") {
      return "Two dogs are already waiting for their collars. Attach one to free a slot.";
    }
    if (err.code === "REGISTRATION_WEEKLY_CAP") return REGISTRATION_WEEKLY_CAP_MESSAGE;
    if (err.code === "REGISTRATION_DISABLED") return "Registration is switched off for this account.";
    if (err.code === "UNAUTHENTICATED_DEVICE") return "Could not confirm this device. Check your connection and try again.";
    return err.message;
  }
  return "Could not save the dog. Try again.";
}

/** A photo the server would not take should not cost the registration. */
function isPhotoRejection(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 413 || /PHOTO/i.test(err.code ?? ""));
}

function FlowInner(): React.JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [me, setMe] = useState<FeederMe | null>(null);
  const [wards, setWards] = useState<Ward[]>([]);
  const [wardId, setWardId] = useState("");
  const [fromLocation, setFromLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const located = useRef(false);

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [sex, setSex] = useState<DogSex | null>(null);
  const [markings, setMarkings] = useState<string[]>([]);
  const [vaccinated, setVaccinated] = useState<Tri>("unsure");
  const [sterilised, setSterilised] = useState<Tri>("unsure");
  const [weekly, setWeekly] = useState(false);
  const [noPost, setNoPost] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!readCachedDeviceToken()) void getDeviceToken();
    let cancelled = false;
    (async () => {
      const [list, who] = await Promise.all([
        api.getWards().catch(() => null),
        api.getFeederMe().catch(() => null),
      ]);
      if (cancelled) return;
      if (list) setWards(list.wards);
      setMe(who);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (photo?.url) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  // Step 2: suggest a ward once (photo EXIF, then the phone, then home ward).
  useEffect(() => {
    if (step !== 2 || wardId || located.current) return;
    located.current = true;
    let cancelled = false;
    (async () => {
      const known = (id: string | null) => !!id && (wards.length === 0 || wards.some((w) => w.id === id));
      const fromExif = photo?.geo ? nearestWard(photo.geo.lat, photo.geo.lng) : null;
      if (known(fromExif)) {
        setWardId(fromExif!);
        setFromLocation(true);
        return;
      }
      setLocating(true);
      const geo = await captureGeo(8000);
      if (cancelled) return;
      setLocating(false);
      const fromPhone = geo ? nearestWard(geo.lat, geo.lng) : null;
      if (known(fromPhone)) {
        setWardId(fromPhone!);
        setFromLocation(true);
      } else if (me?.homeWard && known(me.homeWard)) {
        setWardId(me.homeWard);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, wardId, photo, wards, me]);

  const takePhoto = async (file: File) => {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const prepared = await prepareFeedPhoto(file);
      const base64 = stripDataPrefix(await blobToBase64(prepared.blob));
      const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(prepared.blob) : null;
      setPhoto({ base64, url, geo: prepared.geo });
      setStep(2);
    } catch {
      setPhotoError("Could not use that photo. Try another one.");
    } finally {
      setPhotoBusy(false);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      try {
        window.scrollTo(0, 0);
      } catch {
        /* jsdom */
      }
    }
  }, [step]);

  const ward = wards.find((w) => w.id === wardId) ?? null;

  const submit = async () => {
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

      const vacc = triToBool(vaccinated);
      const ster = triToBool(sterilised);
      const input: CreateRegistrationInput = {
        wardId,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(sex ? { sex } : {}),
        ...(vacc !== undefined ? { vaccinatedReported: vacc } : {}),
        ...(ster !== undefined ? { sterilisedReported: ster } : {}),
        ...(markings.length ? { markings } : {}),
        ...(photo ? { photoBase64: photo.base64 } : {}),
      };

      let res;
      try {
        res = await api.createRegistration(input, deviceToken);
      } catch (err) {
        if (!photo || !isPhotoRejection(err)) throw err;
        // Register without it and send it with the activation scan instead
        // (lib/registration-photo.ts), rather than lose the dog.
        const { photoBase64: _dropped, ...rest } = input;
        void _dropped;
        res = await api.createRegistration(rest, deviceToken);
        savePendingPhoto(res.slug, photo.base64);
      }
      rememberDogSex(res.slug, sex);
      router.push(`/register/${res.slug}/ready`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === 1) {
    return <PhotoStep busy={photoBusy} error={photoError} onPhoto={(f) => void takePhoto(f)} />;
  }

  const back = () => {
    setError(null);
    setStep((n) => (n > 1 ? ((n - 1) as 1 | 2 | 3) : n));
  };

  return (
    <div className={s.page}>
      <div className={s.top}>
        <button type="button" className={s.topLink} onClick={back}>
          ‹ Back
        </button>
        <span className={s.stepCount}>{step} of 4</span>
      </div>
      <div
        className={s.bar}
        role="progressbar"
        aria-label="Registration progress"
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={step}
        aria-valuetext={`Step ${step} of 4`}
      >
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={[s.seg, i <= step ? s.segOn : ""].filter(Boolean).join(" ")} />
        ))}
      </div>

      <div className={[s.body, step === 3 ? styles.aboutBody : ""].filter(Boolean).join(" ")}>
        {step === 2 && (
          <DuplicateStep
            wards={wards}
            wardId={wardId}
            fromLocation={fromLocation}
            locating={locating}
            onWard={(id) => {
              setWardId(id);
              setFromLocation(false);
            }}
          />
        )}
        {step === 3 && (
          <AboutStep
            name={name}
            setName={setName}
            sex={sex}
            setSex={setSex}
            markings={markings}
            setMarkings={setMarkings}
            vaccinated={vaccinated}
            setVaccinated={setVaccinated}
            sterilised={sterilised}
            setSterilised={setSterilised}
          />
        )}
        {step === 4 && (
          <ConfirmStep
            photoUrl={photo?.url ?? null}
            name={name}
            sex={sex}
            markings={markings}
            wardCode={ward?.code ?? wardId}
            addedBy={me?.publicName ?? me?.displayName ?? null}
            vaccinated={vaccinated}
            sterilised={sterilised}
            weekly={weekly}
            setWeekly={setWeekly}
            noPost={noPost}
            setNoPost={setNoPost}
          />
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <StickyFooter background="mist">
        {step === 2 && (
          <Button fullWidth disabled={!wardId} onClick={() => setStep(3)}>
            None of these, continue
          </Button>
        )}
        {step === 3 && (
          <Button fullWidth onClick={() => setStep(4)}>
            Continue
          </Button>
        )}
        {step === 4 && (
          <Button
            fullWidth
            disabled={busy || !weekly || !noPost}
            aria-busy={busy || undefined}
            onClick={() => void submit()}
          >
            {name.trim() ? `Register ${name.trim()}` : "Register this dog"}
          </Button>
        )}
      </StickyFooter>
    </div>
  );
}

export default function RegisterFlow(): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <FlowInner />
    </RequireCapability>
  );
}
