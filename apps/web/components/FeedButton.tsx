"use client";

import { useRef, useState } from "react";
import { enqueueFeed, blobToBase64, stripDataPrefix, captureGeo } from "@/lib/offline-queue";
import styles from "./FeedButton.module.css";

export interface FeedButtonProps {
  dogSlug: string;
}

export default function FeedButton({ dogSlug }: FeedButtonProps): React.JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pickPhoto = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        input.remove();
        if (file) void submitFeed(file);
      },
      { once: true },
    );
    input.click();
  };

  const submitFeed = async (file: File) => {
    setBusy(true);
    setStatus("Preparing feed log…");
    try {
      const dataUrl = await blobToBase64(file);
      const geo = await captureGeo();
      const { offline, syncing } = await enqueueFeed({
        dogSlug,
        photo: stripDataPrefix(dataUrl),
        geo,
      });
      setStatus(
        offline
          ? "Feed saved offline — it will upload when you're back online."
          : syncing
            ? "Feed logged — syncing in the background."
            : "Feed logged. Thank you!",
      );
    } catch {
      setStatus("Could not log feed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.button}
        disabled={busy}
        onClick={() => void pickPhoto()}
      >
        {busy ? "Logging…" : "Log a feed"}
      </button>
      {status && <p className={styles.status}>{status}</p>}
      <input ref={inputRef} hidden tabIndex={-1} aria-hidden="true" />
    </div>
  );
}
