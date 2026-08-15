"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCollarCode } from "@/lib/collar";
import ScanEntry, { type ScanEntryProps } from "./ScanEntry";
import styles from "./QrScanner.module.css";

/**
 * The Barcode Detection API has no types in this project's TypeScript DOM
 * lib (it is a WICG proposal shipped by Chromium and Safari 17+, not yet in
 * the DOM standard TS ships types for). Declared narrowly to just what this
 * file uses.
 */
declare global {
  // TS 7's lib.dom already ships the native `BarcodeDetector`,
  // `DetectedBarcode` and `BarcodeDetectorOptions` types, so only the
  // instance abstraction used across the native API and the polyfill is
  // declared here.
  interface BarcodeDetectorInstance {
    detect(image: CanvasImageSource): Promise<DetectedBarcode[]>;
  }
}

type Phase =
  | "unsupported"
  | "idle"
  | "starting"
  | "scanning"
  | "denied"
  | "no-camera"
  | "busy"
  | "error";

export interface ScannedCollar {
  slug: string;
  sig: string | null;
}

/**
 * Extracts a collar slug (and an optional `?s=` signature) from decoded QR
 * text. A real collar QR encodes a full URL —
 * `https://hetja.in/d/<slug>?s=<sig>` — but this also accepts a bare
 * `/d/<slug>` path or a bare 9-character code, so a differently-shaped QR
 * (or a pasted value) still resolves. Returns null for anything that isn't
 * a valid collar code, so callers can tell "not a Hetja collar" apart from
 * a real decode.
 */
export function extractCollarFromScan(rawValue: string): ScannedCollar | null {
  const trimmed = rawValue.trim();
  let pathname = trimmed;
  let search = "";

  try {
    const url = new URL(trimmed);
    pathname = url.pathname;
    search = url.search;
  } catch {
    const qIndex = trimmed.indexOf("?");
    if (qIndex !== -1) {
      pathname = trimmed.slice(0, qIndex);
      search = trimmed.slice(qIndex);
    }
  }

  const segments = pathname.split("/").filter(Boolean);
  const candidate = segments.length > 0 ? segments[segments.length - 1] : pathname;
  const parsed = parseCollarCode(candidate ?? "");
  if (!parsed.ok) return null;

  const sig = new URLSearchParams(search).get("s");
  return { slug: parsed.slug, sig };
}

function messageFor(phase: Phase): string | null {
  switch (phase) {
    case "unsupported":
      return "In-page scanning isn’t available in this browser. Point your phone’s own camera app at the QR on the collar, or type the code below.";
    case "denied":
      return "Camera access was denied. Turn it on in your browser’s site settings, or type the code below.";
    case "no-camera":
      return "No camera was found on this device. Type the code below instead.";
    case "busy":
      return "The camera is busy or unavailable right now. Type the code below instead.";
    case "error":
      return "Couldn’t start the camera. Type the code below instead.";
    default:
      return null;
  }
}

export interface QrScannerProps {
  /** Forwarded to the always-available manual entry fallback. */
  entry?: ScanEntryProps;
}

/**
 * In-page QR scanner for the /scan flow, using the native `BarcodeDetector`
 * API — zero dependencies. Camera access is never requested on mount: it
 * only starts behind the explicit "Use camera" button below, because an
 * unprompted permission dialog is the one people reflexively deny.
 *
 * Falls through to the existing `ScanEntry` manual entry whenever the API
 * is unsupported, permission is denied, no camera exists, or the camera is
 * busy — each gets its own copy, and the manual path is always present so
 * scanning failure is never a dead end.
 */
export default function QrScanner({ entry }: QrScannerProps): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("unsupported");
  const [mismatch, setMismatch] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectingRef = useRef(false);

  // Feature-detect after mount only. Checking eagerly during render would
  // read `window` during SSR (throwing) or disagree with the server-rendered
  // markup on first client paint (a hydration mismatch); the effect runs
  // once hydration is done.
  useEffect(() => {
    const hasCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    let cancelled = false;
    (async () => {
      let hasDetector = typeof window !== "undefined" && typeof window.BarcodeDetector !== "undefined";
      if (!hasDetector) {
        // Enhancement stack Phase 0 #3 (Sec-ant/barcode-detector): lazy-load
        // the ~3 KB JS + ~13 KB WASM polyfill behind a dynamic import so iOS
        // Safari / Firefox get QR scanning without paying for it up front.
        try {
          const { BarcodeDetector: Polyfill } = await import("barcode-detector");
          if (typeof window !== "undefined") {
            (window as unknown as {
              BarcodeDetector?: new (options?: BarcodeDetectorOptions) => BarcodeDetectorInstance;
            }).BarcodeDetector = Polyfill as never;
          }
          hasDetector = true;
        } catch {
          hasDetector = false;
        }
      }
      if (!cancelled) setPhase(hasDetector && hasCamera ? "idle" : "unsupported");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        // Some test/DOM environments don't implement srcObject at all.
      }
    }
    detectorRef.current = null;
    detectingRef.current = false;
  }, []);

  // Stop the camera the moment the tab is hidden — a live MediaStream left
  // running drains battery and keeps the camera light on. Also stop on
  // unmount.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopCamera();
        setPhase((p) => (p === "scanning" || p === "starting" ? "idle" : p));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopCamera();
    };
  }, [stopCamera]);

  const tick = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || detectingRef.current) return;
    detectingRef.current = true;
    try {
      const barcodes = await detector.detect(video);
      const hit = barcodes.find((b) => b.format === "qr_code" && b.rawValue);
      if (hit) {
        const collar = extractCollarFromScan(hit.rawValue);
        if (collar) {
          stopCamera();
          setPhase("idle");
          setMismatch(null);
          const qs = collar.sig ? `?s=${encodeURIComponent(collar.sig)}` : "";
          router.push(`/dog/${collar.slug}${qs}`);
        } else {
          setMismatch("That QR isn’t a Hetja collar code. Keep the camera steady and try again.");
        }
      }
    } catch {
      // A mid-frame decode failure is routine; the next tick tries again.
    } finally {
      detectingRef.current = false;
    }
  }, [router, stopCamera]);

  const startCamera = useCallback(async () => {
    setMismatch(null);
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        try {
          video.srcObject = stream;
        } catch {
          // Some test/DOM environments don't implement srcObject at all.
        }
        try {
          await video.play();
        } catch {
          // Autoplay can be blocked; detection still runs on the live frame.
        }
      }
      if (typeof window.BarcodeDetector === "undefined") {
        stopCamera();
        setPhase("unsupported");
        return;
      }
      detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
      setPhase("scanning");
      // Try to decode straight away, then every 350ms.
      //
      // This used to be `setInterval` alone, so the FIRST decode attempt could
      // not happen until a full interval after the camera was ready — a flat
      // 350ms of live preview pointed at a collar with nothing being read. Most
      // scans are of a QR already centred in frame by the time the camera
      // opens, so that delay was pure latency on the common path.
      //
      // It also made the test for this the only timing-sensitive one in the
      // suite: it had to outwait a 350ms timer inside Testing Library's default
      // 1000ms waitFor budget, on a runner executing every package's suite in
      // parallel. That went red intermittently — the same commit passed one CI
      // job and failed two others, which is what blocked the deploy pipeline at
      // its Gate.
      //
      // `tick` is safe to call before the first frame: it returns early unless
      // both the video element and the detector exist, guards re-entrancy with
      // detectingRef, and treats a mid-frame decode failure as routine.
      void tick();
      intervalRef.current = setInterval(() => {
        void tick();
      }, 350);
    } catch (err) {
      stopCamera();
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError") setPhase("denied");
      else if (name === "NotFoundError") setPhase("no-camera");
      else if (name === "NotReadableError") setPhase("busy");
      else setPhase("error");
    }
  }, [stopCamera, tick]);

  const cancel = useCallback(() => {
    stopCamera();
    setMismatch(null);
    setPhase("idle");
  }, [stopCamera]);

  const notice = messageFor(phase);
  const showPreview = phase === "starting" || phase === "scanning";

  return (
    <div className={styles.wrap}>
      {phase !== "unsupported" && (
        <div className={styles.camera}>
          {showPreview ? (
            <div className={styles.preview}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className={styles.video} muted playsInline aria-label="Camera preview" />
              <p className={styles.status} role="status">
                {phase === "starting" ? "Starting camera…" : "Point the camera at the QR on the collar."}
              </p>
              {mismatch && (
                <p className={styles.mismatch} role="alert">
                  {mismatch}
                </p>
              )}
              <button type="button" className={styles.cancel} onClick={cancel}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button type="button" className={styles.useCamera} onClick={() => void startCamera()}>
                Use camera
              </button>
              {notice && (
                <p className={styles.notice} role="alert">
                  {notice}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {phase === "unsupported" && notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <div className={styles.entry}>
        <ScanEntry {...entry} />
      </div>
    </div>
  );
}
