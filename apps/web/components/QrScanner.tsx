"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, CollarCodeInput } from "@/components/ds";
import { api, ApiError } from "@/lib/api";
import { parseCollarCode } from "@/lib/collar";
import styles from "./QrScanner.module.css";

/**
 * Screen 02, Scan (design v4). Full-screen dark camera with a 250px bracket
 * frame, and a white bottom sheet for typing the code when there is no camera
 * or the QR is muddy.
 *
 * The camera opens by itself ("It opens by itself. No button needed."). The
 * native BarcodeDetector is used where it exists; elsewhere the small
 * `barcode-detector` polyfill is imported lazily, so it only ever loads here.
 *
 * Every code, scanned or typed, is checked against GET /dogs/:slug before we
 * leave the page, so a wrong code gets the inline "No dog with that code"
 * instead of a dead profile. The profile (/d/<slug>) is a different app
 * served by Caddy, so that hop is a full navigation (window.location.assign),
 * not a client-side route change. With `?intent=feed` (from Me) a scan goes
 * to /feed?dog=<scanned slug> instead.
 */

declare global {
  // TS 7's lib.dom already ships `BarcodeDetector`, `DetectedBarcode` and
  // `BarcodeDetectorOptions`; only the instance shape shared by the native API
  // and the polyfill is declared here.
  interface BarcodeDetectorInstance {
    detect(image: CanvasImageSource): Promise<DetectedBarcode[]>;
  }
}

export interface ScannedCollar {
  slug: string;
  sig: string | null;
}

/**
 * Extracts a collar slug (and an optional `?s=` signature) from decoded QR
 * text. A real collar QR encodes a full URL (`https://hetja.in/d/<slug>?s=<sig>`),
 * but a bare `/d/<slug>` path or a bare 9-character code resolve too. Returns
 * null for anything that is not a valid collar code, so callers can tell "not
 * a Hetja collar" apart from a real decode.
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

export const NO_DOG_MESSAGE = "No dog with that code. Check the letters and try again.";
export const NOT_A_COLLAR_MESSAGE = "That QR isn't a Hetja collar. Try the one on the collar tag.";

/** Where a resolved collar goes. /d/ is the profile app, so it is a full URL. */
export function destinationFor(collar: ScannedCollar, intent: string | null): string {
  if (intent === "feed") return `/feed?dog=${encodeURIComponent(collar.slug)}`;
  const qs = collar.sig ? `?s=${encodeURIComponent(collar.sig)}` : "";
  return `/d/${collar.slug}${qs}`;
}

type CameraState = "checking" | "starting" | "scanning" | "off";

interface TorchCapable {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
  applyConstraints: (c: MediaTrackConstraints) => Promise<void>;
}

export default function QrScanner(): React.JSX.Element {
  const router = useRouter();
  // Held in a ref so the camera callbacks (and the mount effect that opens
  // the camera) never re-run because a router object changed identity.
  const routerRef = useRef(router);
  routerRef.current = router;

  const [camera, setCamera] = useState<CameraState>("checking");
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectingRef = useRef(false);
  const resolvingRef = useRef(false);
  /** The camera was running when the tab was hidden, so reopen it on return. */
  const pausedRef = useRef(false);
  /** False once unmounted: the lazy import and getUserMedia can outlive us. */
  const aliveRef = useRef(true);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const focusInput = useCallback(() => {
    sheetRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  const stopCamera = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        // Some DOM environments do not implement srcObject.
      }
    }
    detectorRef.current = null;
    detectingRef.current = false;
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  const go = useCallback(
    (collar: ScannedCollar) => {
      // Read at the moment of leaving rather than via useSearchParams, so the
      // page needs no Suspense boundary and server-renders the whole screen.
      const intent = new URLSearchParams(window.location.search).get("intent");
      const dest = destinationFor(collar, intent);
      if (intent === "feed") routerRef.current.push(dest);
      else window.location.assign(dest);
    },
    [],
  );

  /**
   * Checks the code exists, then leaves. Only a 404 stops us: on a network
   * failure the profile app (which works from cache) is the better place to
   * be than an error here.
   */
  const resolve = useCallback(
    async (collar: ScannedCollar): Promise<boolean> => {
      if (resolvingRef.current) return false;
      resolvingRef.current = true;
      setBusy(true);
      try {
        await api.getDog(collar.slug, collar.sig);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setError(NO_DOG_MESSAGE);
          setCode(collar.slug);
          resolvingRef.current = false;
          setBusy(false);
          return false;
        }
      }
      go(collar);
      return true;
    },
    [go],
  );

  const tick = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || detectingRef.current || resolvingRef.current) return;
    detectingRef.current = true;
    try {
      const hits = await detector.detect(video);
      const hit = hits.find((b) => b.format === "qr_code" && b.rawValue);
      if (hit) {
        const collar = extractCollarFromScan(hit.rawValue);
        if (!collar) {
          setMismatch(NOT_A_COLLAR_MESSAGE);
        } else {
          setMismatch(null);
          const left = await resolve(collar);
          if (left) stopCamera();
        }
      }
    } catch {
      // A mid-frame decode failure is routine; the next tick tries again.
    } finally {
      detectingRef.current = false;
    }
  }, [resolve, stopCamera]);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCamera("off");
      return;
    }
    setCamera("starting");
    try {
      if (typeof window.BarcodeDetector === "undefined") {
        const { BarcodeDetector: Polyfill } = await import("barcode-detector");
        // Never publish the polyfill for a component that has unmounted, and
        // never over a detector someone installed meanwhile (the import pulls
        // ~13 KB of WASM and can outlive this page on a slow phone).
        if (aliveRef.current && typeof window.BarcodeDetector === "undefined") {
          (window as unknown as {
            BarcodeDetector?: new (o?: BarcodeDetectorOptions) => BarcodeDetectorInstance;
          }).BarcodeDetector = Polyfill as never;
        }
      }
      if (!aliveRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!aliveRef.current) {
        // Unmounted while the permission prompt was up: never leave the
        // camera light on for a page that is gone.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        try {
          video.srcObject = stream;
        } catch {
          // Some DOM environments do not implement srcObject.
        }
        try {
          await video.play();
        } catch {
          // Autoplay can be blocked; detection still runs on the live frame.
        }
      }
      const track = stream.getVideoTracks?.()[0] as unknown as TorchCapable | undefined;
      try {
        setTorchSupported(Boolean(track?.getCapabilities?.().torch));
      } catch {
        setTorchSupported(false);
      }
      detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
      setCamera("scanning");
      // Decode straight away, then every 350ms: most collars are already in
      // frame by the time the camera opens.
      void tick();
      intervalRef.current = setInterval(() => void tick(), 350);
    } catch {
      // Denied, no camera, busy, or no decoder: the typed code is the way in.
      stopCamera();
      setCamera("off");
    }
  }, [stopCamera, tick]);

  // Open the camera on arrival; stop it when the tab is hidden (a live
  // stream drains the battery and keeps the camera light on) and reopen it
  // when the feeder comes back.
  useEffect(() => {
    aliveRef.current = true;
    void startCamera();
    const onVisibility = () => {
      if (document.hidden) {
        if (streamRef.current) {
          stopCamera();
          pausedRef.current = true;
          setCamera("checking");
        }
      } else if (pausedRef.current && !resolvingRef.current) {
        pausedRef.current = false;
        void startCamera();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      aliveRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // No camera: hide the frame and put the cursor where the feeder can use it.
  useEffect(() => {
    if (camera === "off") focusInput();
  }, [camera, focusInput]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0] as unknown as TorchCapable | undefined;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseCollarCode(code);
    if (!parsed.ok) {
      setError(code.length < 9 ? "That code is 9 characters. Check the collar and try again." : NO_DOG_MESSAGE);
      focusInput();
      return;
    }
    setError(null);
    void resolve({ slug: parsed.slug, sig: null });
  };

  const off = camera === "off";

  return (
    <div className={styles.screen}>
      <div className={styles.top}>
        <Link href="/" className={styles.back} aria-label="Home">
          ‹ Home
        </Link>
        {torchSupported && (
          <button
            type="button"
            className={[styles.torch, torchOn ? styles.torchOn : ""].filter(Boolean).join(" ")}
            aria-pressed={torchOn}
            onClick={() => void toggleTorch()}
          >
            Torch
          </button>
        )}
      </div>

      <div className={styles.camera} data-camera={camera}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className={[styles.video, camera === "scanning" ? styles.live : ""].filter(Boolean).join(" ")}
          muted
          playsInline
          aria-hidden="true"
        />
        {!off && (
          <div className={styles.frame} aria-hidden="true" data-testid="scan-frame">
            <span className={styles.tl} />
            <span className={styles.tr} />
            <span className={styles.bl} />
            <span className={styles.br} />
          </div>
        )}
        {off ? (
          <>
            <h1 className={styles.title}>No camera here.</h1>
            <p className={styles.sub}>Type the code printed under the QR.</p>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Point at the QR on the collar.</h1>
            <p className={styles.sub}>It opens by itself. No button needed.</p>
          </>
        )}
        {mismatch && (
          <p className={styles.mismatch} role="alert">
            {mismatch}
          </p>
        )}
      </div>

      <div className={styles.sheet} ref={sheetRef}>
        <form className={styles.form} onSubmit={submit} noValidate>
          <label className={styles.prompt} htmlFor="scan-collar-code">
            No camera, or the QR is muddy?
          </label>
          <CollarCodeInput
            id="scan-collar-code"
            value={code}
            onChange={(next) => {
              setCode(next);
              if (error) setError(null);
            }}
            error={error ?? undefined}
          />
          <Button type="submit" fullWidth shadow={false} disabled={busy}>
            View profile
          </Button>
        </form>
      </div>
    </div>
  );
}
