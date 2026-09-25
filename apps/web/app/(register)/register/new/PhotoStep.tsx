"use client";

/**
 * R2 Photo (step 1 of 4). A live camera with the dashed face oval, a shutter
 * and Gallery. getUserMedia is asked for when this screen opens: the person
 * has just tapped "Start with a photo", so the prompt answers the tap.
 * Without a camera (no getUserMedia, permission denied, an insecure origin)
 * the shutter opens the phone's own camera through a file input instead.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./flow.module.css";

type Cam = "starting" | "live" | "unavailable";

export default function PhotoStep({
  busy,
  error,
  onPhoto,
}: {
  busy: boolean;
  error?: string | null;
  onPhoto: (file: File) => void;
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const galleryInput = useRef<HTMLInputElement | null>(null);
  const [cam, setCam] = useState<Cam>("starting");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCam("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        setCam("live");
      } catch {
        if (!cancelled) setCam("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const snap = () => {
    const v = videoRef.current;
    if (cam !== "live" || !v || !v.videoWidth) {
      cameraInput.current?.click();
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      cameraInput.current?.click();
      return;
    }
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onPhoto(new File([blob], "face.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };

  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onPhoto(f);
  };

  return (
    <div className={styles.camPage}>
      <div className={styles.camTop}>
        <Link href="/register" className={styles.camCancel}>
          Cancel
        </Link>
        <span className={styles.camCount}>1 of 4</span>
      </div>
      <div className={styles.viewfinder}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className={styles.video}
          muted
          playsInline
          aria-label="Camera view"
          data-live={cam === "live" ? "true" : undefined}
        />
        <div className={styles.oval} aria-hidden="true" />
        {error ? (
          <p className={styles.hint} role="alert">
            {error}
          </p>
        ) : (
          <p className={styles.hint}>Face in the oval. Crouch to their eye level.</p>
        )}
      </div>
      <div className={styles.camBar}>
        <button
          type="button"
          className={styles.gallery}
          onClick={() => galleryInput.current?.click()}
          disabled={busy}
        >
          Gallery
        </button>
        <button
          type="button"
          className={styles.shutter}
          onClick={snap}
          disabled={busy}
          aria-busy={busy || undefined}
          aria-label="Take the photo"
        >
          <span className={styles.shutterDot} />
        </button>
        <span />
      </div>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.fileInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={picked}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        className={styles.fileInput}
        tabIndex={-1}
        aria-label="Choose a photo from the gallery"
        onChange={picked}
      />
    </div>
  );
}
