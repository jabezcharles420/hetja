"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { enqueueFeed, blobToBase64, stripDataPrefix, captureGeo } from "@/lib/offline-queue";
import { bestEffortDeviceToken } from "@/lib/api";
import { prepareFeedPhoto } from "@/lib/photo";
import styles from "./FeedButton.module.css";

export interface FeedButtonProps {
  dogSlug: string;
}

type FeedStatus = { kind: "busy" | "success" | "queued" | "error"; text: string } | null;

/**
 * "Log a feed" — deliberately a plain text link, not a button. Feeders are
 * repeat users who already know to look for it; a stranger scanning a
 * collar for the first time must not have to choose between this and the
 * one primary action (§3.3).
 */
export default function FeedButton({ dogSlug }: FeedButtonProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FeedStatus>(null);
  const [offline, setOffline] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const submitFeed = useCallback(
    async (file: File) => {
      setBusy(true);
      setStatus({ kind: "busy", text: "Logging feed…" });
      try {
        // Photo pipeline: auto-orient + compress to ~800 KB via compressorjs
        // (WebP where supported, else JPEG), strip all EXIF/GPS, and coarsen
        // any photo GPS to ward level before it leaves the browser.
        const { blob, geo: photoGeo } = await prepareFeedPhoto(file);
        const dataUrl = await blobToBase64(blob);

        // PRECEDENCE: the consented device fix wins; ward-coarsened photo EXIF
        // GPS is only the fallback.
        //
        // This used to be `photoGeo ?? await captureGeo()`, which had it exactly
        // backwards, and the consequence was a safety bug rather than a privacy
        // one. What we send here becomes `dogs.last_seen_geo` via `applyLww` in
        // the scan route, and `routes/sos.ts` reads that column at FULL
        // precision to centre the 2 km `ST_DWithin` responder fan-out (its own
        // comment: "Coarsening here would silently widen the 2km responder
        // radius"). Preferring a ≤2-decimal (~1.1 km) photo point over an
        // available precise fix therefore stored a location up to ~1 km wrong,
        // centred the SOS circle up to ~1.5 km from the dog, dropped the nearest
        // responders and paged people a kilometre the wrong way — and under LWW
        // (INVARIANT 4) that coarse point also overwrote an earlier precise one.
        //
        // This is not a change to what gets PUBLISHED. INVARIANT 2 is enforced
        // on the read path, unconditionally: `routes/dogs.ts` runs every
        // `last_seen_geo` it returns through `coarsenToWard`, so an anonymous
        // caller still only ever sees ward level.
        //
        // Photo EXIF stays coarsened even as the fallback, deliberately: it is a
        // silent, unconsented channel and the capture may have happened
        // somewhere other than where the feeder is standing, so ward level is an
        // honest statement of what it is worth. The precise channel is the one
        // the feeder was actually asked for.
        //
        // COST: captureGeo() is now called on every feed rather than only when
        // the photo has no GPS, so a feeder who denies or ignores the permission
        // prompt waits out its 8 s timeout before the photo EXIF fallback is
        // used. captureGeo passes `maximumAge: 60_000`, so a repeat feeder with
        // the permission already granted normally resolves immediately. An 8 s
        // wait on a denied prompt is worth a correctly-centred SOS radius.
        const consentedGeo = await captureGeo();
        const geo = consentedGeo ?? photoGeo;
        // Mint the device token HERE, at capture time, not during a later
        // flush. POST /api/v1/scans needs a Bearer OR this token, and the
        // replay path cannot know whether the feeder will still be signed in
        // when connectivity returns — an anonymous queued feed without one
        // was 401'd on every flush forever, re-uploading its photo bytes each
        // time. bestEffortDeviceToken never throws and resolves undefined on
        // failure (offline capture with nothing cached): such a record still
        // queues, and if a session can't vouch for it at flush time either,
        // offline-queue drops it through recordDroppedFeed so the feeder is
        // told rather than left retrying.
        const deviceToken = await bestEffortDeviceToken();
        const { offline: wentOffline } = await enqueueFeed({
          dogSlug,
          photo: stripDataPrefix(dataUrl),
          geo,
          deviceToken,
        });
        if (wentOffline) {
          setStatus({
            kind: "queued",
            text: "Feed saved offline — it will upload when you're back online.",
          });
        } else {
          setStatus({ kind: "success", text: "Feed logged ♥" });
        }
      } catch {
        setStatus({ kind: "error", text: "Could not log feed — try again." });
      } finally {
        setBusy(false);
      }
    },
    [dogSlug],
  );

  const pickPhoto = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        disabled={busy}
        onClick={pickPhoto}
      >
        {busy ? "Logging…" : "Log a feed"}
        {offline && (
          <span className={styles.offlineBadge} aria-label="Offline — feeds will queue locally">
            (offline)
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (file) void submitFeed(file);
        }}
      />
      {status && (
        <p className={styles.status} role="status">
          {status.text}
        </p>
      )}
    </>
  );
}
