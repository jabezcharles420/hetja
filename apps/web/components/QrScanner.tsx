"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, CollarCodeInput } from "@/components/ds";
import { ChoiceRows } from "@/components/scan/ScanParts";
import { api, ApiError } from "@/lib/api";
import { parseCollarCode } from "@/lib/collar";
import { destinationFor, normaliseCode, withIntent, type ScannedCollar } from "@/lib/scan-code";
import styles from "./QrScanner.module.css";

/**
 * The Scan tab (design v4 screen 02, design v5 F1 and the audit's "Scan" rows).
 *
 * The camera opens by itself ("It opens by itself. No button needed."); the
 * white sheet under it is the typed fallback ("No camera, or the QR is
 * muddy?"). After 6 seconds of the camera running without a read, and while
 * nobody is typing, the sheet becomes F1: "Can't read this QR." with Type the
 * code (F2 boxes, /scan/code?part=1), Find by ward and photo (F3, /scan/find) and the red
 * "Dog is hurt · Send SOS anyway" (/scan/find?sos=1: nearest vets and NGOs
 * first, then the finder, because an SOS with no dog pages nobody; see the
 * adapted list in docs/design/v5-handoff/CONTRACT.md). The frame turns
 * --h-attention at the same moment. With no camera, or the camera refused,
 * the F1 choices are the sheet from the start.
 *
 * The camera keeps reading behind F1: a QR that comes clean a second later
 * still opens the dog.
 *
 * The native BarcodeDetector is used where it exists; elsewhere the small
 * `barcode-detector` polyfill is imported lazily, so it only ever loads here.
 * A scanned collar is checked against GET /dogs/:slug before we leave, and a
 * typed code that is not a dog (or not all there) goes to /scan/code, where
 * F2 narrows a partial code and V3 handles a miss. /d/<slug> is a different
 * app behind Caddy, so that hop is a full navigation.
 *
 * This is a tab root: ChromeShell draws the TabBar, so the screen is the
 * viewport less the tab bar and the home-indicator inset. No footer.
 */

declare global {
  // TS 7's lib.dom already ships `BarcodeDetector`, `DetectedBarcode` and
  // `BarcodeDetectorOptions`; only the instance shape shared by the native API
  // and the polyfill is declared here.
  interface BarcodeDetectorInstance {
    detect(image: CanvasImageSource): Promise<DetectedBarcode[]>;
  }
}

export type { ScannedCollar } from "@/lib/scan-code";
export { destinationFor } from "@/lib/scan-code";

/** F1 comes up after this long with the camera running and nothing read. */
export const FAIL_AFTER_MS = 6000;

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

/** checking/starting: opening; scanning: live; off: no camera; denied: refused. */
type CameraState = "checking" | "starting" | "scanning" | "off" | "denied";

interface TorchCapable {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
  applyConstraints: (c: MediaTrackConstraints) => Promise<void>;
}

function intentNow(): string | null {
  return new URLSearchParams(window.location.search).get("intent");
}

export default function QrScanner(): React.JSX.Element {
  const router = useRouter();
  // Held in a ref so the camera callbacks (and the mount effect that opens
  // the camera) never re-run because a router object changed identity.
  const routerRef = useRef(router);
  routerRef.current = router;

  const [camera, setCamera] = useState<CameraState>("checking");
  const [failed, setFailed] = useState(false);
  const [typing, setTyping] = useState(false);
  const [intent, setIntent] = useState<string | null>(null);
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

  const go = useCallback((collar: ScannedCollar) => {
    // Read at the moment of leaving rather than via useSearchParams, so the
    // page needs no Suspense boundary and server-renders the whole screen.
    const now = intentNow();
    const dest = destinationFor(collar, now);
    if (now === "feed") routerRef.current.push(dest);
    else window.location.assign(dest);
  }, []);

  /**
   * Checks the code exists, then leaves. A 404 sends a typed code to N8
   * (/scan/code, "No dog has this code.") and shows the inline message for a
   * scanned one. On a network failure the profile app (which works from
   * cache) is the better place to be than an error here.
   */
  const resolve = useCallback(
    async (collar: ScannedCollar, typed = false): Promise<boolean> => {
      if (resolvingRef.current) return false;
      resolvingRef.current = true;
      setBusy(true);
      try {
        await api.getDog(collar.slug, collar.sig);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          resolvingRef.current = false;
          setBusy(false);
          if (typed) {
            routerRef.current.push(withIntent(`/scan/code?code=${collar.slug}`, intentNow()));
          } else {
            setMismatch(NO_DOG_MESSAGE);
          }
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
    } catch (err) {
      // Denied, no camera, busy, or no decoder: the fallbacks are the way in.
      stopCamera();
      const name = (err as { name?: string } | null)?.name;
      setCamera(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "off");
    }
  }, [stopCamera, tick]);

  // Open the camera on arrival; stop it when the tab is hidden (a live
  // stream drains the battery and keeps the camera light on) and reopen it
  // when the feeder comes back.
  useEffect(() => {
    aliveRef.current = true;
    setIntent(intentNow());
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

  // F1: six seconds of a live camera with no read, unless someone is typing.
  useEffect(() => {
    if (camera !== "scanning" || failed || typing) return;
    const t = setTimeout(() => {
      if (!resolvingRef.current) setFailed(true);
    }, FAIL_AFTER_MS);
    return () => clearTimeout(t);
  }, [camera, failed, typing]);

  // The home page's "Or type a collar code ›" links to /scan#code: the person
  // chose typing, so the cursor goes straight to the input (and F1 waits).
  useEffect(() => {
    if (window.location.hash === "#code") {
      setTyping(true);
      focusInput();
    }
  }, [focusInput]);

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
    const typed = normaliseCode(code);
    if (typed.length === 0) {
      setError("Type the code printed under the QR.");
      focusInput();
      return;
    }
    const parsed = parseCollarCode(typed);
    if (!parsed.ok) {
      // Part of a code: F2 narrows it down from what they could read.
      router.push(withIntent(`/scan/code?code=${typed}`, intentNow()));
      return;
    }
    setError(null);
    void resolve({ slug: parsed.slug, sig: null }, true);
  };

  const noCamera = camera === "off" || camera === "denied";
  const showChoices = failed || noCamera;

  const choices = [
    {
      title: "Type the code",
      sub: "Printed under the QR. Part of it is fine.",
      // F2's boxes: this row promises "Part of it is fine."
      href: withIntent("/scan/code?part=1", intent),
    },
    { title: "Find by ward and photo", sub: "When the code is gone too", href: withIntent("/scan/find", intent) },
  ];

  const sheetTitle = noCamera
    ? camera === "denied"
      ? "Camera is off for Hetja."
      : "No camera here."
    : "Can't read this QR.";
  const sheetSub = noCamera
    ? camera === "denied"
      ? "Allow it in your browser settings, or try one of these."
      : "Type the code printed under the QR, or try one of these."
    : "Mud and rain do this. Try one of these.";

  return (
    <div className={styles.screen} data-state={showChoices ? "fallback" : "scanning"}>
      <div className={styles.camera} data-camera={camera}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className={[styles.video, camera === "scanning" ? styles.live : ""].filter(Boolean).join(" ")}
          muted
          playsInline
          aria-hidden="true"
        />
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
        {!noCamera &&
          (failed ? (
            <div className={styles.failFrame} aria-hidden="true" data-testid="scan-frame" data-failed="true" />
          ) : (
            <div className={styles.frameWrap}>
              <div className={styles.frame} aria-hidden="true" data-testid="scan-frame">
                <span className={styles.tl} />
                <span className={styles.tr} />
                <span className={styles.bl} />
                <span className={styles.br} />
              </div>
              <h1 className={styles.title}>Point at the QR on the collar.</h1>
              <p className={styles.sub}>It opens by itself. No button needed.</p>
            </div>
          ))}
        {mismatch && (
          <p className={styles.mismatch} role="alert">
            {mismatch}
          </p>
        )}
      </div>

      {showChoices ? (
        <section
          className={[styles.sheet, styles.failSheet].join(" ")}
          aria-labelledby="scan-fallback-title"
          data-testid="scan-fallback"
        >
          <h1 id="scan-fallback-title" className={styles.failTitle}>
            {sheetTitle}
          </h1>
          <p className={styles.failSub}>{sheetSub}</p>
          <ChoiceRows items={choices} tone="mist" />
          <Button variant="sos" bang={false} fullWidth href="/scan/find?sos=1" className={styles.sosBtn}>
            Dog is hurt · Send SOS anyway
          </Button>
        </section>
      ) : (
        <div className={styles.sheet} ref={sheetRef}>
          <form className={styles.form} onSubmit={submit} onFocus={() => setTyping(true)} noValidate>
            <label className={styles.prompt} htmlFor="scan-collar-code">
              No camera, or the QR is muddy?
            </label>
            <CollarCodeInput
              id="scan-collar-code"
              value={code}
              fold
              onChange={(next) => {
                setCode(next);
                setTyping(true);
                if (error) setError(null);
              }}
              error={error ?? undefined}
            />
            <Button type="submit" fullWidth shadow={false} disabled={busy}>
              View profile
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
