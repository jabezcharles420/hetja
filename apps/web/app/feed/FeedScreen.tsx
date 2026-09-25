"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DogAvatar, StatusIcon, StickyFooter, collarGroups } from "@/components/ds";
import {
  api,
  ApiError,
  bestEffortDeviceToken,
  getAccessToken,
  type DogProfile,
  type FeedOutcomeValue,
} from "@/lib/api";
import { parseCollarCode } from "@/lib/collar";
import { blobToBase64, captureGeo, enqueueFeed, stripDataPrefix } from "@/lib/offline-queue";
import { prepareFeedPhoto } from "@/lib/photo";
import { dogName, kolkataDay, safeStreak, streakAfterFeed, streakCaption } from "@/lib/streak";
import styles from "./feed.module.css";

/**
 * Screen 06, Log a feed (design v4). Reached from Me's "Scan to log X's
 * feed" via /scan?intent=feed, which lands here as /feed?dog=<slug>.
 *
 * The photo is optional now; "How did it go?" is optional too. "Looks unwell"
 * shows a quiet pointer to the dog's SOS and never raises one by itself
 * (INVARIANT 14: the API stores 'unwell' as a flag for a human).
 *
 * The feed goes through the offline queue (enqueueFeed), so it survives no
 * signal: the record is persisted first and flushed when there is a network.
 */

export const OUTCOMES: { value: FeedOutcomeValue; label: string }[] = [
  { value: "ate_all", label: "Ate it all" },
  { value: "ate_some", label: "Ate a little" },
  { value: "didnt_eat", label: "Didn't eat" },
  { value: "unwell", label: "Looks unwell" },
];

/** The success toast. The dog's sex is not on the public profile, so the
 * mock's "in his own way" becomes the neutral "in their own way". */
export function loggedToast(name: string): string {
  return `Logged. ${name} is thrilled, in their own way.`;
}

export const QUEUED_TOAST = "Saved on this phone. It sends when you're back online.";

/** 429 RATE_LIMITED / 503 PHOTO_BUSY: the queue keeps it and retries after retry-after. */
export const BUSY_TOAST = "Saved on this phone. It sends when the server is less busy.";

/** photoAccepted:false: the feed counted, the photo did not stay. Quiet, not an error. */
export const PHOTO_NOT_KEPT = "Feed logged. The photo wasn't kept this time.";

/** geoAccepted:false: a location outside Mumbai was dropped. Nothing to worry about. */
export const GEO_IGNORED = "Location outside Mumbai was ignored.";

/** The quiet line under the toast, or null. */
export function feedNote(result: { photoAccepted?: boolean; geoAccepted?: boolean } | undefined): string | null {
  if (!result) return null;
  const lines: string[] = [];
  if (result.photoAccepted === false) lines.push(PHOTO_NOT_KEPT);
  if (result.geoAccepted === false) lines.push(GEO_IGNORED);
  return lines.length ? lines.join(" ") : null;
}

type Load =
  | { kind: "loading" }
  | { kind: "no-dog" }
  | { kind: "not-found" }
  | { kind: "error"; message: string }
  | { kind: "ready"; dog: DogProfile };

function PhotoIcon(): React.JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function FeedScreen(): React.JSX.Element {
  const router = useRouter();
  // A ref so the load effect runs once, whatever the router's identity does.
  const routerRef = useRef(router);
  routerRef.current = router;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [slug, setSlug] = useState<string>("");
  const [outcome, setOutcome] = useState<FeedOutcomeValue | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [streakDays, setStreakDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("dog") ?? "";
    const parsed = parseCollarCode(raw);

    // Signed out: sign in first, then come straight back here.
    if (!getAccessToken()) {
      const back = `/feed${raw ? `?dog=${encodeURIComponent(raw)}` : ""}`;
      routerRef.current.replace(`/login?next=${encodeURIComponent(back)}`);
      return;
    }
    if (!parsed.ok) {
      setLoad({ kind: "no-dog" });
      return;
    }
    setSlug(parsed.slug);

    let cancelled = false;
    (async () => {
      try {
        const dog = await api.getDog(parsed.slug);
        if (!cancelled) setLoad({ kind: "ready", dog });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setLoad({ kind: "not-found" });
        else
          setLoad({
            kind: "error",
            message: err instanceof ApiError ? err.message : "Could not load this dog.",
          });
      }
    })();
    (async () => {
      try {
        const s = safeStreak(await api.getStreak());
        if (!cancelled) setStreakDays(streakAfterFeed(s.streakDays, s.lastFeedDate, kolkataDay(new Date())));
      } catch {
        // No caption rather than a wrong one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const pickFile = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f && typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null);
  };

  const submit = useCallback(async () => {
    if (load.kind !== "ready" || busy || done) return;
    setBusy(true);
    setError(null);
    try {
      let photo: string | undefined;
      let photoGeo: { lat: number; lng: number } | undefined;
      if (file) {
        // Orient, compress, strip EXIF, and coarsen any photo GPS to ward
        // level before anything leaves the browser.
        const prepared = await prepareFeedPhoto(file);
        photo = stripDataPrefix(await blobToBase64(prepared.blob));
        photoGeo = prepared.geo;
      }
      // The consented device fix wins over photo EXIF: it becomes the dog's
      // last_seen_geo, which centres the SOS responder radius (see
      // lib/photo.ts). Ward-coarsened EXIF is only the fallback.
      const geo = (await captureGeo()) ?? photoGeo;
      // Minted at CAPTURE time and stored with the queued record, so a flush
      // days later presents a credential from when the feed happened.
      const deviceToken = await bestEffortDeviceToken();
      const res = await enqueueFeed({
        dogSlug: load.dog.slug,
        photo,
        geo,
        deviceToken,
        ...(outcome ? { outcome } : {}),
      });
      if (res.dropped) {
        // Refused for good (recordDroppedFeed has it). Say so; do not pretend.
        setError("Hetja couldn't log this feed. Try again.");
        return;
      }
      setDone(true);
      const quiet = feedNote(res.result);
      setToast(
        res.offline
          ? QUEUED_TOAST
          : res.throttled
            ? BUSY_TOAST
            : res.pending
              ? QUEUED_TOAST
              : loggedToast(dogName(load.dog.name)),
      );
      setNote(quiet);
      // A second line to read: give it a second longer before leaving.
      leaveTimer.current = setTimeout(() => routerRef.current.push("/me"), quiet ? 3400 : 2200);
    } catch {
      setError("Could not log the feed. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, done, file, load, outcome]);

  const changeHref = `/scan?intent=feed${slug ? `&dog=${encodeURIComponent(slug)}` : ""}`;

  if (load.kind !== "ready") {
    const msg =
      load.kind === "loading"
        ? null
        : load.kind === "no-dog"
          ? "Scan the collar of the dog you fed."
          : load.kind === "not-found"
            ? "No dog with that code. Check the letters and try again."
            : load.message;
    return (
      <div className={styles.page}>
        <div className={styles.top}>
          <Link href="/me" className={styles.cancel}>
            Cancel
          </Link>
        </div>
        <div className={styles.body}>
          <h1 className={styles.title}>Log a feed</h1>
          {msg && (
            <p className={styles.state} role={load.kind === "no-dog" ? undefined : "alert"}>
              {msg}
            </p>
          )}
        </div>
        {load.kind !== "loading" && (
          <StickyFooter background="mist" className={styles.footer}>
            <Button href={changeHref} fullWidth>
              Scan a collar
            </Button>
          </StickyFooter>
        )}
      </div>
    );
  }

  const dog = load.dog;
  const name = dogName(dog.name);

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <Link href="/me" className={styles.cancel}>
          Cancel
        </Link>
      </div>

      <div className={styles.body}>
        <h1 className={styles.title}>Log a feed</h1>

        <div className={styles.dogCard}>
          <DogAvatar id={dog.slug} name={name} photoUrl={dog.photoUrl ?? null} size={56} />
          <div className={styles.dogText}>
            <div className={styles.dogName}>{name}</div>
            <div className={styles.dogCode} aria-label={`Collar code ${dog.slug.split("").join(" ")}`}>
              {collarGroups(dog.slug).join(" ")}
            </div>
          </div>
          <Link href={changeHref} className={styles.change}>
            Change
          </Link>
        </div>

        <label className={styles.photo} data-filled={preview ? "true" : undefined}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.fileInput}
            onChange={(e) => {
              pickFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={`Your photo of ${name}`} className={styles.photoImg} />
          ) : (
            <span className={styles.photoEmpty}>
              <PhotoIcon />
              <span className={styles.photoCap}>Add a photo (optional)</span>
            </span>
          )}
        </label>
        {file && (
          <button type="button" className={styles.removePhoto} onClick={() => pickFile(null)}>
            Remove photo
          </button>
        )}

        <div className={styles.outcome}>
          <div className={styles.outcomeLabel} id="feed-outcome-label">
            How did it go? (optional)
          </div>
          <div className={styles.chips} role="group" aria-labelledby="feed-outcome-label">
            {OUTCOMES.map((o) => {
              const on = outcome === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  className={[styles.chip, on ? styles.chipOn : ""].filter(Boolean).join(" ")}
                  aria-pressed={on}
                  onClick={() => setOutcome(on ? null : o.value)}
                >
                  {on && <StatusIcon name="check" size={14} strokeWidth={2.4} />}
                  {o.label}
                </button>
              );
            })}
          </div>
          {outcome === "unwell" && (
            <p className={styles.unwell} data-testid="unwell-hint">
              If {name} needs a vet, raise an SOS from the profile. It alerts the feeders and a vet nearby.{" "}
              <a href={`/d/${dog.slug}`} className={styles.unwellLink}>
                Open {name}&rsquo;s profile ›
              </a>
            </p>
          )}
        </div>
      </div>

      <StickyFooter
        background="mist"
        className={styles.footer}
        caption={streakDays !== null ? streakCaption(streakDays) : undefined}
        captionPosition="above"
      >
        {toast && (
          <p className={styles.toast} role="status">
            {toast}
            {note && (
              <span className={styles.toastNote} data-testid="feed-note">
                {note}
              </span>
            )}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button fullWidth onClick={() => void submit()} disabled={busy || done} aria-busy={busy || undefined}>
          Log feed
        </Button>
      </StickyFooter>
    </div>
  );
}
