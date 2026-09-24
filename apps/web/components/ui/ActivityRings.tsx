"use client";

import { useEffect, useId, useRef, useState } from "react";
import { prefersReducedMotion } from "./Sheet";
import styles from "./ActivityRings.module.css";

/**
 * Apple Fitness-style concentric rings: feeds today / ward coverage / streak.
 *
 * Geometry is the Watch face's: rings touch with a small gap, round caps,
 * a dim track of the same hue, and a gradient along each stroke. Past 100%
 * the ring keeps going round and the end cap casts a small shadow back onto
 * the ring beneath it. That shadow is what makes Apple's overlap legible,
 * so it is drawn explicitly as a filtered cap circle.
 *
 * Motion: the SSR/no-JS markup already shows the final values. On mount, if
 * IntersectionObserver exists and motion is allowed, rings reset to empty and
 * sweep to their value the first time they scroll into view. jsdom has no IO,
 * so tests see the final state.
 *
 * Accessibility: one role="img" with a sentence summary ("Feeds 3 of 4,
 * Coverage 60 of 100 percent, Streak 12 of 30 days"); the SVG is hidden.
 */

export interface Ring {
  value: number;
  goal: number;
  /** Solid colour, or [start, end] gradient. */
  color: string | [string, string];
  label: string;
  /** Unit for the spoken summary ("days", "percent"). */
  unit?: string;
}

export interface ActivityRingsProps {
  rings: Ring[];
  /** Outer diameter in px. */
  size?: number;
  /** Stroke width; defaults to ~11% of size (Apple's proportion). */
  thickness?: number;
  /** Show a legend of label + value beside the rings. */
  legend?: boolean;
  /** Override the generated aria-label. */
  "aria-label"?: string;
  className?: string;
}

type Phase = "static" | "armed" | "run";

export function ActivityRings({
  rings,
  size = 160,
  thickness,
  legend = false,
  "aria-label": ariaLabel,
  className,
}: ActivityRingsProps): React.JSX.Element {
  const uid = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return;
    // Only animate rings that start below the fold: ones already on screen
    // at hydration would visibly empty and refill.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;
    setPhase("armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // Two frames so the empty state paints before the sweep starts.
          requestAnimationFrame(() => requestAnimationFrame(() => setPhase("run")));
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const sw = thickness ?? Math.round(size * 0.11);
  const gap = Math.max(2, Math.round(sw * 0.12));
  const c = size / 2;

  const summary =
    ariaLabel ??
    rings.map((r) => `${r.label} ${fmt(r.value)} of ${fmt(r.goal)}${r.unit ? ` ${r.unit}` : ""}`).join(", ");

  return (
    <div ref={ref} className={`${styles.root} ${className ?? ""}`} role="img" aria-label={summary}>
      <svg
        className={styles.svg}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        data-phase={phase}
      >
        <defs>
          {rings.map((ring, i) => {
            const [a, b] = Array.isArray(ring.color) ? ring.color : [ring.color, ring.color];
            return (
              // Bottom → top, so the 12 o'clock seam (where laps and the shadowed
              // cap meet) is exactly the end colour.
              <linearGradient key={i} id={`${uid}-g${i}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor={a} />
                <stop offset="1" stopColor={b} />
              </linearGradient>
            );
          })}
          <filter id={`${uid}-cap`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation={sw * 0.12} floodColor="#000" floodOpacity="0.45" />
          </filter>
        </defs>
        {rings.map((ring, i) => {
          const r = c - sw / 2 - i * (sw + gap);
          if (r <= sw / 2) return null;
          const circ = 2 * Math.PI * r;
          const p = ring.goal > 0 ? Math.max(0, ring.value / ring.goal) : 0;
          const shown = Math.min(p, 1);
          const offset = circ * (1 - shown);
          const end = Array.isArray(ring.color) ? ring.color[1] : ring.color;
          // End-cap position (0° = 12 o'clock, clockwise).
          const ang = 2 * Math.PI * (p % 1 === 0 && p > 0 ? 1 : p % 1) - Math.PI / 2;
          const cx = c + r * Math.cos(ang);
          const cy = c + r * Math.sin(ang);
          const trackColor = Array.isArray(ring.color) ? ring.color[0] : ring.color;
          return (
            <g key={i}>
              <circle cx={c} cy={c} r={r} fill="none" stroke={trackColor} strokeOpacity="0.2" strokeWidth={sw} />
              <circle
                className={styles.arc}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={`url(#${uid}-g${i})`}
                strokeWidth={sw}
                strokeLinecap="round"
                strokeDasharray={circ}
                style={
                  {
                    "--circ": `${circ}px`,
                    "--offset": `${offset}px`,
                    "--delay": `${i * 120}ms`,
                  } as React.CSSProperties
                }
                transform={`rotate(-90 ${c} ${c})`}
              />
              {p > 1 ? (
                // Second lap: the overlap past 100%.
                <circle
                    className={styles.lap}
                    cx={c}
                    cy={c}
                    r={r}
                    fill="none"
                    stroke={end}
                    strokeWidth={sw}
                    strokeLinecap="round"
                    strokeDasharray={`${circ * Math.min(p - 1, 0.999)} ${circ}`}
                    transform={`rotate(-90 ${c} ${c})`}
                  />
              ) : null}
              {p >= 1 ? (
                <circle
                  className={styles.cap}
                  cx={cx}
                  cy={cy}
                  r={sw / 2}
                  fill={end}
                  filter={`url(#${uid}-cap)`}
                  style={{ "--delay": `${i * 120}ms` } as React.CSSProperties}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      {legend ? (
        <dl className={styles.legend} aria-hidden="true">
          {rings.map((ring, i) => (
            <div key={i} className={styles.legendRow}>
              <dt>
                <i style={{ background: Array.isArray(ring.color) ? ring.color[1] : ring.color }} />
                {ring.label}
              </dt>
              <dd>
                {fmt(ring.value)}
                <span>
                  /{fmt(ring.goal)}
                  {ring.unit ? ` ${ring.unit}` : ""}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
