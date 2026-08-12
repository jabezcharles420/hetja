"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { enqueueFeed, blobToBase64, stripDataPrefix, captureGeo } from "@/lib/offline-queue";
import PawIllustration from "./PawIllustration";
import styles from "./FeedButton.module.css";

export interface FeedButtonProps {
  dogSlug: string;
}

type FeedStatus = { kind: "busy" | "success" | "queued" | "error"; text: string } | null;

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
        const dataUrl = await blobToBase64(file);
        const geo = await captureGeo();
        const { offline: wentOffline } = await enqueueFeed({
          dogSlug,
          photo: stripDataPrefix(dataUrl),
          geo,
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
        className={`${styles.button} ${busy ? styles.busy : ""}`}
        disabled={busy}
        onClick={pickPhoto}
      >
        <PawIllustration size={18} className={styles.buttonPaw} />
        <span>{busy ? "Logging…" : "Feed"}</span>
        {offline && (
          <span className={styles.offlineBadge} aria-label="Offline — feeds will queue locally">
            Offline
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
