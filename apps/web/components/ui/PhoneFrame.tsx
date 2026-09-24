"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./PhoneFrame.module.css";

/**
 * <PhoneFrame>: the iPhone the product performs inside (Sidehoe `.phone` /
 * `.screen` / `.island` / `.status`; Magic UI "iphone" for proportions).
 *
 * The bezel is a fixed 340×700 CSS box (not an image) so the screen content
 * is real, selectable, accessible DOM. `scaleToFit` shrinks the whole device
 * with a transform when its parent is narrower than the phone, measured with a
 * ResizeObserver, and reserves the scaled height so nothing below jumps.
 *
 * Dynamic Island: pass `live` and the island springs open into a Live
 * Activity ("Feeding Bruno · 02:14"), its timer counting up once a second,
 * and the status-bar items fade out underneath it (iOS expanded behaviour).
 * The spring is a width/height transition on a 28px-tall pill, the one place
 * this kit animates layout, because a scaled transform would squash the text.
 *
 * The status bar and island are decorative (aria-hidden); `children` is the
 * screen and keeps its own semantics.
 */

export interface LiveActivity {
  /** Leading glyph: an <Icon>, a <Dogmoji size={20}>, or an emoji. */
  icon?: ReactNode;
  /** "Feeding Bruno". */
  label: string;
  /**
   * Seconds already elapsed when shown. A number counts up (mm:ss);
   * a string is shown verbatim ("Due Fri"). Omit for no trailing text.
   */
  timer?: number | string;
  /** Accent colour: "ok" (green, an active timer) or "late" (red, SOS). */
  tone?: "ok" | "late";
}

export interface PhoneFrameProps {
  children?: ReactNode;
  /** Shrink to fit the parent's width (never grows past 1×). */
  scaleToFit?: boolean;
  /** Status-bar clock. */
  time?: string;
  /** Expands the Dynamic Island into a Live Activity. */
  live?: LiveActivity;
  /** Screen background; default white. */
  screenClassName?: string;
  className?: string;
  /** Accessible name for the device region (e.g. "Hetja app preview"). */
  label?: string;
}

export const PHONE_W = 340;
export const PHONE_H = 700;

function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function DynamicIsland({ live }: { live?: LiveActivity }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(typeof live?.timer === "number" ? live.timer : 0);

  // Open a beat after mount so the spring is seen (instant under reduced motion).
  const hasLive = Boolean(live);
  useEffect(() => {
    if (!hasLive) {
      setOpen(false);
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) {
      setOpen(true);
      return;
    }
    const id = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(id);
  }, [hasLive]);

  const counting = typeof live?.timer === "number";
  const startAt = counting ? (live!.timer as number) : 0;
  useEffect(() => {
    if (!counting) return;
    setElapsed(startAt);
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(startAt + (Date.now() - t0) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [counting, startAt]);

  const trailing = live?.timer === undefined ? null : counting ? mmss(elapsed) : String(live.timer);

  return (
    <div
      className={styles.island}
      data-open={open && live ? "" : undefined}
      data-tone={live?.tone ?? "ok"}
      aria-hidden="true"
    >
      {live ? (
        <span className={styles.live}>
          {live.icon ? <span className={styles.liveIcon}>{live.icon}</span> : null}
          <span className={styles.liveLabel}>{live.label}</span>
          {trailing ? <span className={styles.liveTimer}>{trailing}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Signal · Wi-Fi · battery, from Sidehoe's status bar (66×12). */
function StatusGlyphs(): React.JSX.Element {
  return (
    <svg viewBox="0 0 66 12" fill="currentColor" aria-hidden="true" className={styles.glyphs}>
      <rect x="0" y="7" width="3" height="5" rx=".8" />
      <rect x="5" y="5" width="3" height="7" rx=".8" />
      <rect x="10" y="2.5" width="3" height="9.5" rx=".8" />
      <rect x="15" y="0" width="3" height="12" rx=".8" />
      <path d="M31 2.3c2.3 0 4.4.9 6 2.4l1-1.1C36.1 1.8 33.7.8 31 .8s-5.1 1-7 2.8l1 1.1c1.6-1.5 3.7-2.4 6-2.4zm0 3.5c1.4 0 2.6.5 3.6 1.4l1-1.1c-1.2-1.1-2.8-1.8-4.6-1.8s-3.4.7-4.6 1.8l1 1.1c1-.9 2.2-1.4 3.6-1.4zm0 3.4c-.7 0-1.3.3-1.7.7L31 11.8l1.7-1.9c-.4-.4-1-.7-1.7-.7z" />
      <rect x="43.5" y=".5" width="19" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".4" />
      <rect x="45" y="2" width="16" height="8" rx="2" />
      <rect x="63.5" y="4" width="1.5" height="4" rx=".7" opacity=".45" />
    </svg>
  );
}

export function PhoneFrame({
  children,
  scaleToFit = false,
  time = "9:41",
  live,
  screenClassName,
  className,
  label,
}: PhoneFrameProps): React.JSX.Element {
  const outerRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);

  useEffect(() => {
    if (!scaleToFit) return;
    const el = outerRef.current;
    if (!el) return;
    const fit = () => setK(Math.min(1, Math.max(0.4, (el.clientWidth - 8) / PHONE_W)));
    fit();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", fit);
      return () => window.removeEventListener("resize", fit);
    }
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scaleToFit]);

  const phone = (
    <div
      className={[styles.phone, scaleToFit ? "" : className ?? ""].filter(Boolean).join(" ")}
      style={scaleToFit && k !== 1 ? ({ transform: `scale(${k})` } as CSSProperties) : undefined}
      role={label ? "group" : undefined}
      aria-label={label}
      data-phone=""
    >
      <div className={[styles.screen, screenClassName ?? ""].filter(Boolean).join(" ")}>
        <DynamicIsland live={live} />
        <div className={styles.status} aria-hidden="true">
          <span>{time}</span>
          <StatusGlyphs />
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );

  if (!scaleToFit) return phone;

  return (
    <div ref={outerRef} className={[styles.fit, className ?? ""].filter(Boolean).join(" ")}>
      <div className={styles.sizer} style={{ width: PHONE_W * k, height: PHONE_H * k }}>
        {phone}
      </div>
    </div>
  );
}
