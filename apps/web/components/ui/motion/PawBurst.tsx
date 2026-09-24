"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "./env";
import styles from "./PawBurst.module.css";

/**
 * <PawBurst> is a small celebration: 3D paw prints, bones, hearts and
 * sparkles pop out of the centre of its parent and fall away. For "Feed
 * logged!" and streak milestones only. This is the ONE effect allowed on the
 * /dog and /scan critical path, because it answers the user's action and ends
 * on its own in about a second.
 *
 * DOM particles, no canvas: each is an <img> animated with transform and
 * opacity only, and every burst removes itself when done. Reduced motion: no
 * particles, just a checkmark that appears and fades.
 *
 * Usage: put it inside a `position: relative` parent (the button or card)
 * and bump `fire` (a counter) each time. `fire={0}` renders nothing.
 * The particles are aria-hidden; pass `announce` to have the outcome read
 * out ("Feed logged for Bruno") through a polite live region.
 */

const STICKERS = ["paw-prints", "bone", "red-heart", "sparkles"] as const;

interface Particle {
  src: string;
  style: CSSProperties;
}

interface BurstRun {
  id: number;
  reduced: boolean;
  particles: Particle[];
}

export interface PawBurstProps {
  /** Increment to fire a burst. */
  fire: number;
  /** Particles per burst. Default 14. */
  count?: number;
  /** Typical travel distance in px. Default 110. */
  spread?: number;
  /** Text for screen readers when a burst fires. */
  announce?: string;
  className?: string;
}

const LIFETIME_MS = 1300;

function makeParticles(count: number, spread: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    // Even angular spacing with jitter, biased upward like a real pop.
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const dist = spread * (0.6 + Math.random() * 0.6);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist * 0.8 - spread * 0.35;
    const name = STICKERS[i % STICKERS.length];
    return {
      src: `/dogmoji/${name}-128.webp`,
      style: {
        "--dx": `${dx.toFixed(1)}px`,
        "--dy": `${dy.toFixed(1)}px`,
        "--rot": `${Math.round((Math.random() - 0.5) * 120)}deg`,
        "--s": (0.7 + Math.random() * 0.5).toFixed(2),
        "--delay": `${Math.round(Math.random() * 60)}ms`,
      } as CSSProperties,
    };
  });
}

export function PawBurst({ fire, count = 14, spread = 110, announce, className }: PawBurstProps): React.JSX.Element {
  const [runs, setRuns] = useState<BurstRun[]>([]);
  const [message, setMessage] = useState("");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!fire) return;
    const reduced = prefersReducedMotion();
    const run: BurstRun = { id: fire, reduced, particles: reduced ? [] : makeParticles(count, spread) };
    setRuns((r) => [...r.slice(-2), run]); // at most three overlapping bursts
    if (announce) setMessage(announce);
    const t = window.setTimeout(() => setRuns((r) => r.filter((x) => x.id !== run.id)), LIFETIME_MS);
    timers.current.push(t);
  }, [fire, count, spread, announce]);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <span className={[styles.root, className].filter(Boolean).join(" ")}>
      {runs.map((run) =>
        run.reduced ? (
          <span key={run.id} aria-hidden="true" className={styles.check} data-burst-check="">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M7 14.5l4.5 4.5L21 9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span key={run.id} aria-hidden="true" className={styles.burst} data-burst="">
            {run.particles.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- tiny decorative sticker, animated by transform
              <img key={i} src={p.src} alt="" width={28} height={28} className={styles.particle} style={p.style} draggable={false} />
            ))}
          </span>
        ),
      )}
      <span className={styles.sr} aria-live="polite">
        {message}
      </span>
    </span>
  );
}
