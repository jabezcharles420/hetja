"use client";

/**
 * Route protection is a UX boundary, not a security boundary — see
 * RequireCapability header. The API is the boundary.
 *
 * Activation reuses three existing helpers rather than reinventing them:
 * 1. extractCollarFromScan(rawValue) from components/QrScanner.tsx — if the
 *    decoded slug ≠ the expected slug, say so and refuse to activate. This is
 *    the best use of that export in the repo: it verifies the physical object
 *    before trusting it.
 * 2. captureGeo(8000) from lib/offline-queue.ts — on the user's tap, never on
 *    mount. An unprompted permission dialog teaches people to hit Deny.
 * 3. POST /api/v1/scans with type:"retag", the geo, a fresh clientUuid.
 *
 * If geolocation is unavailable, do NOT post an ungeotagged scan and report
 * success — it will not activate and the user would be told it did. Say
 * "Hetja needs your location to confirm the collar is in the field" and offer
 * retry (HOW-IT-WORKS.md §10).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { RegistrationDetail } from "@/lib/api";
import { extractCollarFromScan } from "@/components/QrScanner";
import { captureGeo } from "@/lib/offline-queue";
import { uuid } from "@/lib/idb";
import RequireCapability from "@/components/RequireCapability";
import PageHeader from "@/components/PageHeader";
import contentStyles from "@/components/Content.module.css";

function ActivateInner({ slug }: { slug: string }): React.JSX.Element {
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Activation state
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [rawScan, setRawScan] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRegistration(slug);
      setDetail(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load registration.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const doActivate = async (rawValue?: string) => {
    setScanError(null);

    // If a raw QR value was supplied, verify it is THIS collar.
    if (rawValue) {
      const parsed = extractCollarFromScan(rawValue);
      if (!parsed) {
        setScanError("That QR isn’t a Hetja collar code.");
        return;
      }
      if (parsed.slug !== slug) {
        setScanError(`That QR is for ${parsed.slug}, not ${slug}. Scan the tag you just printed.`);
        return;
      }
    }

    // Geolocation on tap, never on mount.
    setActivating(true);
    const geo = await captureGeo(8000);
    if (!geo) {
      setScanError("Hetja needs your location to confirm the collar is in the field. Allow location and try again.");
      setActivating(false);
      return;
    }

    try {
      await api.createScan(
        {
          clientUuid: uuid(),
          dogSlug: slug,
          type: "retag",
          geo,
          capturedAt: new Date().toISOString(),
        },
        {},
      );
      setActivated(true);
      void load();
    } catch (err) {
      setScanError(err instanceof ApiError ? err.message : "Could not activate. Try again.");
    } finally {
      setActivating(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader kicker="Register" title="Registration" />
        <section className={`${contentStyles.section} h-container`}>
          <p style={{ color: "var(--h-ink-muted)" }}>Loading…</p>
        </section>
      </>
    );
  }

  if (error || !detail) {
    return (
      <>
        <PageHeader kicker="Register" title="Registration" />
        <section className={`${contentStyles.section} h-container`}>
          <p role="alert" style={{ color: "var(--h-accent)" }}>
            {error ?? "Not found."}
          </p>
          <p style={{ marginTop: "var(--h-s4)" }}>
            <Link href="/register" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
              ← Back to registrations
            </Link>
          </p>
        </section>
      </>
    );
  }

  const isPending = detail.status === "pending_activation";
  const isActive = detail.status === "active";

  return (
    <>
      <PageHeader
        kicker="Register"
        title={detail.slug}
        intro={isPending ? "Print the sheet, attach the collar, then confirm it’s on the dog." : `Status: ${detail.status} — Ward ${detail.wardId}`}
      />

      <section className={`${contentStyles.section} h-container`}>
        <div style={{ display: "grid", gap: "var(--h-s5)", maxWidth: 680 }}>
          <div className={contentStyles.card}>
            <p style={{ fontSize: "var(--h-t-sm)", color: "var(--h-ink-muted)" }}>
              Ward <strong style={{ color: "var(--h-ink)" }}>{detail.wardId}</strong> · Status{" "}
              <strong style={{ color: "var(--h-ink)" }}>{detail.status}</strong>
            </p>
            {detail.registeredAt && (
              <p style={{ fontSize: "var(--h-t-sm)", color: "var(--h-ink-muted)", marginTop: 4 }}>
                Registered {new Date(detail.registeredAt).toLocaleDateString()}
                {detail.expiresAt ? ` · expires ${new Date(detail.expiresAt).toLocaleDateString()}` : ""}
              </p>
            )}
            <div style={{ marginTop: "var(--h-s4)", display: "flex", gap: "var(--h-s3)", flexWrap: "wrap" }}>
              <Link className="h-btn h-btn-primary" href={`/register/${slug}/print`}>
                Print sheet
              </Link>
              <Link className="h-btn h-btn-ghost" href="/register">
                Back to list
              </Link>
            </div>
          </div>

          <div className={contentStyles.card}>
            <h2 style={{ fontSize: "var(--h-t-lg)", margin: "0 0 var(--h-s3)" }}>What to do next</h2>
            <ol style={{ margin: 0, paddingLeft: "var(--h-s5)", display: "grid", gap: "var(--h-s3)", lineHeight: 1.6 }}>
              <li>Open the print sheet and laser-etch the QR onto TPU (Shore 95A). Never a paper label — it waterlogs.</li>
              <li>Fit with two-finger clearance and a breakaway. Budget ~1 replacement/year; the slug stays the same, so reprinting keeps every tag in the field working.</li>
              <li>Attach, then tap “I’ve attached it” below — Hetja will ask for your location to confirm the collar is in the field.</li>
            </ol>
          </div>

          {activated && (
            <p role="status" style={{ background: "var(--h-base)", border: "1px solid var(--h-rule)", padding: "var(--h-s3)", color: "var(--h-safe)", fontWeight: 600 }}>
              Activated — the collar is live. It may take a moment to appear as active.
            </p>
          )}

          {!activated && isPending && (
            <div className={contentStyles.card}>
              <h3 style={{ fontSize: "var(--h-t-lg)", margin: "0 0 var(--h-s3)" }}>Confirm attachment</h3>
              <p style={{ color: "var(--h-ink-muted)", fontSize: "var(--h-t-sm)", marginBottom: "var(--h-s4)" }}>
                Scan the tag you just printed, or type the code. Hetja verifies the slug matches before activating.
              </p>

              <div
                style={{
                  border: "var(--h-hairline) solid var(--h-rule)",
                  padding: "var(--h-s4)",
                  display: "grid",
                  gap: "var(--h-s3)",
                }}
              >
                <label
                  style={{ display: "flex", flexDirection: "column", gap: "var(--h-s2)" }}
                  htmlFor="activate-scan-input"
                >
                  <span style={{ fontSize: "var(--h-t-sm)", fontWeight: 500 }}>Scanned QR or code</span>
                  <input
                    id="activate-scan-input"
                    value={rawScan}
                    onChange={(e) => setRawScan(e.target.value)}
                    placeholder={detail.collarUrl ?? detail.slug}
                    style={{
                      minHeight: "var(--h-target)",
                      border: "1px solid var(--h-rule)",
                      padding: "0 var(--h-s3)",
                      fontSize: "var(--h-t-md)",
                    }}
                    aria-describedby={scanError ? "activate-scan-error" : undefined}
                  />
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--h-s3)" }}>
                  <button
                    type="button"
                    className="h-btn h-btn-primary"
                    onClick={() => void doActivate(rawScan || undefined)}
                    disabled={activating}
                  >
                    {activating ? "Confirming…" : "I’ve attached it"}
                  </button>
                  <button
                    type="button"
                    className="h-btn h-btn-ghost"
                    onClick={() => void doActivate()}
                    disabled={activating}
                  >
                    Confirm without paste (geotagged scan only)
                  </button>
                </div>
                <p style={{ fontSize: "var(--h-t-sm)", color: "var(--h-ink-muted)" }}>
                  Tip: you can scan the printed QR with your phone’s camera, copy the URL from the preview, and paste it above. The slug is
                  verified before activating.
                </p>
                {/* Inline live scanner: uses BarcodeDetector + extractCollarFromScan, geotagged activation */}
                <ActivationScanner slug={slug} onDetected={(raw) => void doActivate(raw)} disabled={activating} />
              </div>

              {scanError && (
                <p id="activate-scan-error" role="alert" style={{ color: "var(--h-accent)", marginTop: "var(--h-s3)", fontWeight: 600 }}>
                  {scanError}
                </p>
              )}
              <p style={{ color: "var(--h-ink-muted)", fontSize: "var(--h-t-sm)", marginTop: "var(--h-s3)" }}>
                Location is captured on tap, never on page load — an unprompted permission dialog teaches people to hit Deny.
              </p>
            </div>
          )}

          {isActive && !activated && (
            <p style={{ color: "var(--h-ink-muted)" }}>This registration is already active.</p>
          )}
        </div>
      </section>
    </>
  );
}

function ActivationScanner({
  slug,
  onDetected,
  disabled,
}: {
  slug: string;
  onDetected: (raw: string) => void;
  disabled: boolean;
}): React.JSX.Element {
  const [phase, setPhase] = useState<"idle" | "scanning" | "unsupported" | "denied" | "error">("idle");
  const [mismatch, setMismatch] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const start = async () => {
    setMismatch(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      return;
    }
    if (typeof window !== "undefined" && typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === "undefined") {
      try {
        const { BarcodeDetector: Poly } = await import("barcode-detector");
        (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = Poly as never;
      } catch {
        setPhase("unsupported");
        return;
      }
    }
    setPhase("scanning");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
        const Detector = (window as unknown as { BarcodeDetector: new (o: unknown) => { detect: (i: unknown) => Promise<{ format: string; rawValue: string }[]> } }).BarcodeDetector;
        const detector = new Detector({ formats: ["qr_code"] });
        let stopped = false;
        stopRef.current = () => {
          stopped = true;
          stream.getTracks().forEach((t) => t.stop());
          setPhase("idle");
        };
        const tick = async () => {
          if (stopped) return;
          try {
            const hits = await detector.detect(video as unknown as CanvasImageSource);
            const hit = hits.find((h) => h.format === "qr_code" && h.rawValue);
            if (hit) {
              const parsed = extractCollarFromScan(hit.rawValue);
              if (!parsed) {
                setMismatch("That QR isn’t a Hetja collar code.");
              } else if (parsed.slug !== slug) {
                setMismatch(`That QR is for ${parsed.slug}, not ${slug}. Scan the tag you printed.`);
              } else {
                stream.getTracks().forEach((t) => t.stop());
                setPhase("idle");
                onDetected(hit.rawValue);
                return;
              }
            }
          } catch {
            /* next tick */
          }
          if (!stopped) setTimeout(() => void tick(), 350);
        };
        void tick();
      }
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError") setPhase("denied");
      else setPhase("error");
    }
  };

  const cancel = () => {
    if (stopRef.current) stopRef.current();
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    setPhase("idle");
    setMismatch(null);
  };

  if (phase === "unsupported") return <p role="status" style={{ fontSize: "var(--h-t-sm)", color: "var(--h-ink-muted)" }}>In-page scanning isn’t available in this browser.</p>;
  if (phase === "scanning") {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} muted playsInline style={{ width: "100%", maxWidth: 360, border: "1px solid var(--h-rule)" }} aria-label="Camera preview" />
        <p role="status" style={{ fontSize: "var(--h-t-sm)" }}>Point the camera at the QR on the collar.</p>
        {mismatch && <p role="alert" style={{ color: "var(--h-accent)", fontWeight: 600 }}>{mismatch}</p>}
        <button type="button" className="h-btn h-btn-ghost" onClick={cancel} disabled={disabled}>Cancel</button>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <button type="button" className="h-btn h-btn-ghost" onClick={() => void start()} disabled={disabled}>Use camera to scan the tag</button>
      {phase === "denied" && <p role="alert" style={{ color: "var(--h-accent)" }}>Camera access was denied.</p>}
      {phase === "error" && <p role="alert" style={{ color: "var(--h-accent)" }}>Couldn’t start the camera.</p>}
      {mismatch && <p role="alert" style={{ color: "var(--h-accent)" }}>{mismatch}</p>}
    </div>
  );
}

export default function ActivateClient({ slug }: { slug: string }): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <ActivateInner slug={slug} />
    </RequireCapability>
  );
}
