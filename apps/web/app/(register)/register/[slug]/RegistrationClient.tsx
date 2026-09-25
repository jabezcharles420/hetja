"use client";

/**
 * /register/[slug] (design v6): one registration, four screens.
 *
 *   P1 Confirm the collar   pending (or expired): a countdown pill and a
 *                           three-step tracker; one primary action opens the
 *                           full-screen scanner, "Type the code instead"
 *                           covers a dirty tag (paste-a-URL and "confirm
 *                           without paste" are gone).
 *   P2 Wrong tag            the scanner's sheet names both dogs and shows both
 *                           codes (POST /registrations/:slug/tag-check).
 *   P3 Collar is live       after the activation scan.
 *   P4 A live registration  manage the dog: page, reprint, edit, feeders, N9.
 *
 * Route protection is a UX boundary, not a security boundary (see
 * RequireCapability); the API is the boundary.
 *
 * Activation is unchanged underneath (HOW-IT-WORKS.md §10): the scanned code
 * must be this registration's, geolocation is asked for only after the tag
 * checks out (never on page load), and it is POST /scans type "retag" with a
 * fresh clientUuid. No location, no activation scan: an ungeotagged scan
 * would not activate, and the person would be told it had.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, CollarCodeInput, DogAvatar, StatusPill, StickyFooter } from "@/components/ds";
import { extractCollarFromScan } from "@/components/QrScanner";
import {
  api,
  ApiError,
  type RegistrationDetail,
  type RegistrationV6Fields,
  type Ward,
} from "@/lib/api";
import { readPrinted } from "@/lib/collar-sheet";
import { dayMonth, nameOr, possessive, prettyCode, sinceLabel } from "@/lib/dog-copy";
import { captureGeo } from "@/lib/offline-queue";
import { uuid } from "@/lib/idb";
import { clearPendingPhoto, readPendingPhoto } from "@/lib/registration-photo";
import RequireCapability from "@/components/RequireCapability";
import s from "../register.module.css";
import styles from "./registration.module.css";

type Detail = RegistrationDetail & RegistrationV6Fields;

export const LOCATION_NEEDED =
  "Hetja needs your location to confirm the collar is in the field. Allow location and try again.";

export interface WrongTag {
  expected: { slug: string; name: string | null };
  scanned: { slug: string; name: string | null } | null;
}

function daysLeftOf(d: Pick<Detail, "daysLeft" | "expiresAt">): number | null {
  if (typeof d.daysLeft === "number") return d.daysLeft;
  if (!d.expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / 86_400_000));
}

function wardLine(wardId: string, wards: Ward[] | null): string {
  const w = wards?.find((x) => x.id === wardId);
  return w ? `${w.code} ward · ${w.name}` : `${wardId} ward`;
}

function dogPage(slug: string): string {
  return `/d/${slug}`;
}

/* ---- the scanner (full screen, dark) with the P2 sheet -------------------- */

type Detector = { detect: (i: CanvasImageSource) => Promise<{ format: string; rawValue: string }[]> };

function Scanner({
  expectedName,
  wrong,
  error,
  busy,
  onCode,
  onAgain,
  onCancel,
  onType,
  reprintHref,
  printedOn,
}: {
  expectedName: string;
  wrong: WrongTag | null;
  error: string | null;
  busy: boolean;
  onCode: (raw: string) => void;
  onAgain: () => void;
  onCancel: () => void;
  onType: () => void;
  reprintHref: string;
  printedOn: string | null;
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cam, setCam] = useState<"starting" | "live" | "unavailable">("starting");
  const paused = !!wrong || !!error || busy;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCam("unavailable");
        return;
      }
      try {
        const w = window as unknown as { BarcodeDetector?: new (o: unknown) => Detector };
        if (typeof w.BarcodeDetector === "undefined") {
          const { BarcodeDetector: Poly } = await import("barcode-detector");
          w.BarcodeDetector = Poly as never;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setCam("live");
        const detector = new w.BarcodeDetector!({ formats: ["qr_code"] });
        const tick = async () => {
          if (stopped) return;
          if (!pausedRef.current) {
            try {
              const hits = await detector.detect(v);
              const hit = hits.find((h) => h.format === "qr_code" && h.rawValue);
              if (hit && !pausedRef.current) onCodeRef.current(hit.rawValue);
            } catch {
              /* next frame */
            }
          }
          setTimeout(() => void tick(), 300);
        };
        void tick();
      } catch {
        if (!stopped) setCam("unavailable");
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const exp = wrong?.expected;
  return (
    <div className={styles.scanPage} role="dialog" aria-modal="true" aria-label={`Checking ${expectedName}`}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} className={styles.scanVideo} muted playsInline aria-hidden="true" data-live={cam === "live" ? "true" : undefined} />
      <div className={styles.scanTop}>
        <button type="button" className={styles.scanCancel} onClick={onCancel}>
          Cancel
        </button>
        <span className={styles.scanWhat}>Checking {expectedName}</span>
      </div>
      <div className={styles.frameWrap}>
        <div className={styles.frame} data-dim={wrong ? "true" : undefined} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        {cam === "unavailable" && !wrong && (
          <p className={styles.scanNote} role="status">
            The camera isn&apos;t available here.{" "}
            <button type="button" className={styles.scanNoteLink} onClick={onType}>
              Type the code instead
            </button>
          </p>
        )}
        {busy && (
          <p className={styles.scanNote} role="status">
            Switching {expectedName}&apos;s page on…
          </p>
        )}
      </div>

      {(wrong || error) && (
        <div className={styles.sheet}>
          {wrong && exp ? (
            <>
              <div className={styles.sheetHead}>
                <span className={styles.warnIcon} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="7" fill="currentColor" />
                    <path d="M8 4.5v4.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                    <circle cx="8" cy="11.3" r="1" fill="#fff" />
                  </svg>
                </span>
                <h2 className={styles.sheetTitle}>
                  {wrong.scanned?.name ? `That's ${possessive(wrong.scanned.name)} tag.` : "That's another dog's tag."}
                </h2>
              </div>
              <p className={styles.sheetText}>
                You&apos;re confirming {nameOr(exp.name)}.
                {printedOn ? ` Find the tag printed on ${printedOn}.` : ""}
              </p>
              <div className={styles.codes}>
                {wrong.scanned && (
                  <div className={styles.codeRow}>
                    <DogAvatar id={wrong.scanned.slug} name={nameOr(wrong.scanned.name)} size={36} />
                    <span className={styles.codeText}>
                      <span className={styles.codeLabel}>Scanned</span>
                      <span className={styles.codeValue}>{prettyCode(wrong.scanned.slug)}</span>
                    </span>
                    <span className={styles.codeName}>{wrong.scanned.name ?? ""}</span>
                  </div>
                )}
                <div className={styles.codeRow}>
                  <DogAvatar id={exp.slug} name={nameOr(exp.name)} size={36} />
                  <span className={styles.codeText}>
                    <span className={styles.codeLabel}>Looking for</span>
                    <span className={[styles.codeValue, styles.codeStrong].join(" ")}>{prettyCode(exp.slug)}</span>
                  </span>
                  <span className={[styles.codeName, styles.codeStrong].join(" ")}>{exp.name ?? ""}</span>
                </div>
              </div>
            </>
          ) : (
            <p className={styles.sheetText} role="alert">
              {error}
            </p>
          )}
          <div className={styles.sheetActions}>
            <Button fullWidth onClick={onAgain}>
              Scan again
            </Button>
            {wrong ? (
              <Link href={reprintHref} className={s.linkBtn}>
                {possessive(exp?.name)} tag is lost? Reprint it
              </Link>
            ) : (
              <button type="button" className={s.linkBtn} onClick={onType}>
                Type the code instead
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- P1 --------------------------------------------------------------- */

function Step({
  n,
  state,
  title,
  children,
}: {
  n: number;
  state: "done" | "current" | "next";
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className={styles.step}>
      <span className={[styles.stepMark, styles[state]].join(" ")} aria-hidden="true">
        {state === "done" ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        ) : (
          n
        )}
      </span>
      <span className={styles.stepText}>
        <span className={[styles.stepTitle, state === "done" ? styles.stepDone : ""].filter(Boolean).join(" ")}>
          {title}
          {state === "done" && <span className={s.visuallyHidden}> (done)</span>}
        </span>
        <span className={styles.stepSub}>{children}</span>
      </span>
    </li>
  );
}

/* ---- the screen ---------------------------------------------------------- */

function RegistrationInner({ slug }: { slug: string }): React.JSX.Element {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [wards, setWards] = useState<Ward[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedLocal, setPrintedLocal] = useState<number | null>(null);
  const [mode, setMode] = useState<"idle" | "scan" | "type">("idle");
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState<WrongTag | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const handling = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      let d: Detail;
      try {
        d = await api.getRegistrationV6(slug);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404 || err.status === 403)) throw err;
        d = await api.getRegistration(slug);
      }
      setDetail(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this registration.");
    }
  }, [slug]);

  useEffect(() => {
    setPrintedLocal(readPrinted()[slug] ?? null);
    void load();
    api
      .getWards()
      .then((r) => setWards(r.wards))
      .catch(() => setWards(null));
  }, [load, slug]);

  const name = detail?.name ?? null;

  const activate = async (raw: string) => {
    if (handling.current || !detail) return;
    handling.current = true;
    setScanError(null);
    try {
      const parsed = extractCollarFromScan(raw);
      if (!parsed) {
        setScanError("That QR isn't a Hetja collar code.");
        return;
      }
      if (parsed.slug !== slug) {
        let result: WrongTag = { expected: { slug, name }, scanned: { slug: parsed.slug, name: null } };
        try {
          const check = await api.checkRegistrationTag(slug, parsed.slug);
          if (check.match === false) result = { expected: check.expected, scanned: check.scanned ?? result.scanned };
        } catch {
          /* the codes alone still say it */
        }
        setWrong(result);
        setMode("scan");
        return;
      }
      setBusy(true);
      // Location only now: the tag is the right one and the person is at the dog.
      const geo = await captureGeo(8000);
      if (!geo) {
        setScanError(LOCATION_NEEDED);
        setMode("scan");
        return;
      }
      const photoBase64 = readPendingPhoto(slug) ?? undefined;
      await api.createScan(
        {
          clientUuid: uuid(),
          dogSlug: slug,
          type: "retag",
          geo,
          capturedAt: new Date().toISOString(),
          ...(photoBase64 ? { photoBase64 } : {}),
        },
        {},
      );
      clearPendingPhoto(slug);
      setLive(true);
      setMode("idle");
    } catch (err) {
      setScanError(err instanceof ApiError ? err.message : "Could not switch the page on. Try again.");
      setMode("scan");
    } finally {
      setBusy(false);
      handling.current = false;
    }
  };

  const invite = async () => {
    setNote(null);
    const url = `${window.location.origin}${dogPage(slug)}`;
    const text = `Help feed ${nameOr(name)}? Scan the collar or open this page on Hetja.`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `${nameOr(name)} on Hetja`, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setNote("Link copied. Send it to someone who feeds this dog too.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setNote(`Send them this link: ${url}`);
    }
  };

  if (!detail) {
    return (
      <div className={s.page}>
        <div className={s.top}>
          <Link href="/register" className={s.topLink}>
            ‹ Registrations
          </Link>
        </div>
        <div className={s.body}>
          {error ? (
            <p className={s.error} role="alert">
              {error}
            </p>
          ) : (
            <p className={s.status} role="status">
              Loading…
            </p>
          )}
        </div>
      </div>
    );
  }

  const ward = wardLine(detail.wardId, wards);
  const printedAt = detail.printedAt ?? (printedLocal ? new Date(printedLocal).toISOString() : null);
  const printedOn = dayMonth(printedAt);

  /* P3 */
  if (live) {
    return (
      <div className={[s.page, s.aurora].join(" ")}>
        <div className={[s.body, styles.liveBody].join(" ")}>
          <span className={styles.bigTick} aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8.5l3 3 7-7" />
            </svg>
          </span>
          <h1 className={s.hero}>{nameOr(name)} is live.</h1>
          <p className={s.heroLead}>
            Anyone who scans the collar now sees {possessive(name)} page. You&apos;re listed as a feeder.
          </p>
          <div className={styles.liveCard}>
            <div className={styles.liveHead}>
              <DogAvatar id={slug} name={nameOr(name)} size={56} />
              <span className={s.linkText}>
                <span className={styles.liveName}>{nameOr(name)}</span>
                <span className={s.dogSub}>{ward}</span>
              </span>
              <StatusPill variant="ok" icon="check" size="row">
                Live
              </StatusPill>
            </div>
            <div className={styles.liveCode} aria-label={`Collar code ${prettyCode(slug)}`}>
              {prettyCode(slug)
                .split(" ")
                .map((g) => (
                  <span key={g}>{g}</span>
                ))}
            </div>
          </div>
          <ul className={s.group}>
            <li>
              <Link href={`/me/dogs/${slug}/story`} className={[s.linkRow, s.linkRowTall].join(" ")}>
                <span className={s.linkText}>
                  <span className={s.linkTitle}>Write {possessive(name)} story</span>
                  <span className={s.linkSub}>Strangers read it when they scan</span>
                </span>
                <span className={s.chev} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
            <li>
              <Link href={`/feed?dog=${slug}`} className={[s.linkRow, s.linkRowTall].join(" ")}>
                <span className={s.linkText}>
                  <span className={s.linkTitle}>Log today&apos;s feed</span>
                  <span className={s.linkSub}>Starts {possessive(name)} record</span>
                </span>
                <span className={s.chev} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          </ul>
        </div>
        <StickyFooter background="none" className={s.footerTight}>
          <Button href={dogPage(slug)} fullWidth>
            Open {possessive(name)} page
          </Button>
          <Link href="/register/new" className={s.linkBtn}>
            Register another dog
          </Link>
        </StickyFooter>
      </div>
    );
  }

  const pending = detail.status === "pending_activation" || detail.status === "expired";

  /* P4 */
  if (!pending) {
    const others = (detail.feederNames ?? []).filter(Boolean);
    const feeders = others.length === 0 ? "Just you" : `You and ${others.join(", ")}`;
    const liveSince = dayMonth(detail.liveSince ?? detail.registeredAt);
    const seen = sinceLabel(detail.lastScanAt);
    return (
      <div className={s.page}>
        <div className={[s.body, s.v6Body].join(" ")}>
          <Link href="/register" className={[s.topLink, styles.back].join(" ")}>
            ‹ Registrations
          </Link>
          <div className={s.dogHead}>
            <DogAvatar id={slug} name={nameOr(name)} size={64} />
            <span className={s.dogHeadText}>
              <h1 className={s.dogName}>{nameOr(name)}</h1>
              <span className={s.dogCode}>{prettyCode(slug)}</span>
            </span>
          </div>
          <div className={s.pills}>
            {detail.status === "active" && liveSince && (
              <StatusPill variant="ok" icon="check" size="row">
                Live since {liveSince}
              </StatusPill>
            )}
            {seen && (
              <StatusPill variant="neutral" icon="clock" size="row">
                Scanned {seen}
              </StatusPill>
            )}
          </div>
          <ul className={s.group}>
            <li>
              <a href={dogPage(slug)} className={s.linkRow}>
                <span className={s.linkTitle}>View {possessive(name)} page</span>
                <span className={s.chev} aria-hidden="true">
                  ›
                </span>
              </a>
            </li>
            <li>
              <Link href={`/register/${slug}/print`} className={[s.linkRow, s.linkRowTall].join(" ")}>
                <span className={s.linkText}>
                  <span className={s.linkTitle}>Reprint the tag</span>
                  <span className={s.linkSub}>Same code. Old tags keep working.</span>
                </span>
                <span className={s.chev} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
            <li>
              <Link href={`/me/dogs/${slug}/story`} className={s.linkRow}>
                <span className={s.linkTitle}>Edit photo, name or story</span>
                <span className={s.chev} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
            <li className={[s.linkRow, s.linkRowTall].join(" ")}>
              <span className={s.linkText}>
                <span className={s.linkTitle}>Feeders</span>
                <span className={s.linkSub}>{feeders}</span>
              </span>
              <button type="button" className={[s.inlineLink, styles.invite].join(" ")} onClick={() => void invite()}>
                Invite
              </button>
            </li>
          </ul>
          {note && (
            <p className={s.status} role="status">
              {note}
            </p>
          )}
          <ul className={s.group}>
            <li>
              <Link href={`/me/dogs/${slug}/status`} className={[s.linkRow, s.linkRowTall].join(" ")}>
                <span className={s.linkText}>
                  <span className={s.linkTitle}>{nameOr(name)} hasn&apos;t been seen</span>
                  <span className={s.linkSub}>Missing, moved on, or passed away</span>
                </span>
                <span className={s.chev} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          </ul>
        </div>
        <StickyFooter background="mist">
          <Button href={`/feed?dog=${slug}`} fullWidth>
            Log a feed for {nameOr(name)}
          </Button>
        </StickyFooter>
      </div>
    );
  }

  /* P1 */
  const days = daysLeftOf(detail);
  const printed = !!printedAt;
  return (
    <>
      <div className={s.page}>
        <div className={[s.body, s.v6Body].join(" ")}>
          <Link href="/register" className={[s.topLink, styles.back].join(" ")}>
            ‹ Registrations
          </Link>
          <div className={s.dogHead}>
            <DogAvatar id={slug} name={nameOr(name)} size={64} />
            <span className={s.dogHeadText}>
              <h1 className={s.dogName}>{nameOr(name)}</h1>
              <span className={s.dogSub}>{ward}</span>
            </span>
          </div>
          <div className={s.pills}>
            <StatusPill variant="warn" icon="clock" size="row">
              {detail.status === "expired"
                ? "Code expired · scanning still switches it on"
                : days === null
                  ? "Waiting for collar"
                  : `Waiting for collar · ${days} ${days === 1 ? "day" : "days"} left`}
            </StatusPill>
          </div>
          <ol className={styles.tracker}>
            <Step n={1} state={printed ? "done" : "current"} title="Print the tag">
              {printed ? (
                <>
                  Printed {printedOn} ·{" "}
                  <Link href={`/register/${slug}/print`} className={s.inlineLink}>
                    Reprint
                  </Link>
                </>
              ) : (
                <>
                  Not printed yet ·{" "}
                  <Link href={`/register/${slug}/print`} className={s.inlineLink}>
                    Print
                  </Link>
                </>
              )}
            </Step>
            <Step n={2} state={printed ? "current" : "next"} title="Fit the collar">
              Two fingers under. Use a breakaway buckle so it can&apos;t catch.
            </Step>
            <Step n={3} state="next" title="Scan it to switch the page on">
              Hetja checks it&apos;s {possessive(name)} tag, then asks for your location once.
            </Step>
          </ol>
          <div className={styles.locNote}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4C5.2 13 3 10.8 3 7.8v-4z" />
            </svg>
            <span>Location proves the collar is out in the ward, not in a drawer. Only the ward is kept.</span>
          </div>

          {mode === "type" && (
            <div className={styles.typeCard}>
              <CollarCodeInput
                label="Code on the tag"
                value={typed}
                onChange={setTyped}
                onComplete={(c) => void activate(c)}
                autoFocus
                error={scanError ?? undefined}
              />
              <Button fullWidth disabled={typed.length !== 9 || busy} aria-busy={busy || undefined} onClick={() => void activate(typed)}>
                Check this code
              </Button>
            </div>
          )}
        </div>
        <StickyFooter background="mist" className={s.footerTight}>
          <Button
            fullWidth
            onClick={() => {
              setWrong(null);
              setScanError(null);
              setMode("scan");
            }}
          >
            Scan {possessive(name)} collar
          </Button>
          {mode !== "type" && (
            <button
              type="button"
              className={s.linkBtn}
              onClick={() => {
                setScanError(null);
                setTyped("");
                setMode("type");
              }}
            >
              Type the code instead
            </button>
          )}
        </StickyFooter>
      </div>
      {(mode === "scan" || (mode === "type" && wrong)) && (
        <Scanner
          expectedName={nameOr(name)}
          wrong={wrong}
          error={mode === "scan" ? scanError : null}
          busy={busy}
          onCode={(raw) => void activate(raw)}
          onAgain={() => {
            setWrong(null);
            setScanError(null);
            setMode("scan");
          }}
          onCancel={() => {
            setWrong(null);
            setScanError(null);
            setMode("idle");
          }}
          onType={() => {
            setWrong(null);
            setScanError(null);
            setTyped("");
                setMode("type");
          }}
          reprintHref={`/register/${slug}/print`}
          printedOn={printedOn}
        />
      )}
    </>
  );
}

export default function RegistrationClient({ slug }: { slug: string }): React.JSX.Element {
  return (
    <RequireCapability capability="register">
      <RegistrationInner slug={slug} />
    </RequireCapability>
  );
}
