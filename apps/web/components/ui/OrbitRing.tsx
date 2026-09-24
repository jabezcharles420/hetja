"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CAST, type CastDog } from "@/lib/dogmoji";
import { Dogmoji } from "./Dogmoji";
import { PHONE_H, PHONE_W } from "./PhoneFrame";
import styles from "./OrbitRing.module.css";

/**
 * <OrbitRing>: Sidehoe's orbiting roster, with dogs. Dogmoji heads and
 * their tag pills ("Fed 2h ago", red "Rabies due Fri") circle an ellipse
 * around the phone: the front half passes UNDER the phone's chat (y offset)
 * and in front of the bezel (z-index), heads shrink and fade as they go
 * behind, and the whole ring leans with the pointer.
 *
 * Ported from side.html's fitStage() + orbit(), unchanged in its numbers:
 * 60 s per revolution, 0.7 s delay then a 1.8 s quartic grow-in, 0.05
 * pointer easing. Positions are written straight to element styles inside
 * one rAF loop; React renders the heads once and never again.
 *
 * Desktop only (≥900px, where there is room beside the copy). Below that the
 * ring is display:none, the loop idles, and a static <Facepile> shows the
 * same dogs. The loop also stops when the stage is off-screen or the tab is
 * hidden, and never runs under reduced motion (one static frame instead).
 *
 * The heads are decorative (aria-hidden). Parents must clip horizontal
 * overflow (`overflow: clip`): the ring is wider than the phone by design.
 */

export interface OrbitRingProps {
  /** The phone (usually a <PhoneFrame> without scaleToFit). */
  children: ReactNode;
  /** Who orbits. Default: the whole cast. */
  dogs?: readonly CastDog[];
  /** Render the mobile facepile under the phone (<900px). Default true. */
  facepile?: boolean;
  className?: string;
}

const DESKTOP = "(min-width: 900px)";
const EXTRA = 130; // room under the phone for the front of the orbit
const NAV_H = 52;

export function OrbitRing({ children, dogs = CAST, facepile = true, className }: OrbitRingProps): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const headRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tagRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const stage = stageRef.current;
    const inner = innerRef.current;
    if (!stage || !inner) return;

    const mq = window.matchMedia?.(DESKTOP);
    const isDesktop = () => mq?.matches ?? true;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let orbitRx = 300;
    const orbitRy = 265;

    const fit = () => {
      const desktop = isDesktop();
      let k = Math.min(1, (stage.clientWidth - 8) / PHONE_W);
      const extra = desktop ? EXTRA : 0;
      if (desktop) k = Math.min(k, Math.max(0.6, (window.innerHeight - NAV_H - 64) / (PHONE_H + extra)));
      k = Math.max(0.3, k);
      inner.style.transform = `scale(${k})`;
      stage.style.height = `${(PHONE_H + extra) * k}px`;
      orbitRx = Math.min(345, stage.clientWidth / k / 2 - 30);
    };

    let mx = 0;
    let my = 0;
    let px = 0;
    let py = 0;
    const onPointer = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
    };

    const t0 = performance.now();
    const ease = (x: number) => 1 - Math.pow(1 - x, 4);
    const n = headRefs.current.length;

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const grow = reduced ? 1 : ease(Math.min(1, Math.max(0, (t - 0.7) / 1.8)));
      px += (mx - px) * 0.05;
      py += (my - py) * 0.05;
      const base = reduced ? 0.5 : t * ((Math.PI * 2) / 60) + (1 - grow) * -1.6 + px * 0.5;
      for (let i = 0; i < n; i++) {
        const el = headRefs.current[i];
        if (!el) continue;
        const a = base + i * ((Math.PI * 2) / n);
        const depth = Math.sin(a); // -1 behind the phone, +1 in front
        const x = Math.cos(a) * orbitRx * grow;
        const y = (115 + depth * orbitRy * (1 + py * 0.2)) * grow;
        const s = (0.62 + (0.5 * (depth + 1)) / 2) * (0.3 + 0.7 * grow);
        el.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
        el.style.zIndex = depth > 0 ? "200" : "50";
        el.style.opacity = String(grow * (0.55 + 0.45 * Math.min(1, depth + 1)));
        const tag = tagRefs.current[i];
        if (tag) tag.style.opacity = String(Math.max(0, Math.min(1, (depth + 0.15) * 3)));
      }
    };

    // Loop only while: desktop, on-screen, tab visible, motion allowed.
    let raf = 0;
    let onScreen = true;
    const tick = (now: number) => {
      frame(now);
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      const run = isDesktop() && onScreen && !document.hidden;
      if (reduced) {
        cancelAnimationFrame(raf);
        raf = 0;
        if (isDesktop()) frame(performance.now());
        return;
      }
      if (run && !raf) raf = requestAnimationFrame(tick);
      if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onResize = () => {
      fit();
      sync();
    };

    fit();
    sync();

    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        sync();
      });
      io.observe(stage);
    }
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(stage);
    }
    window.addEventListener("resize", onResize);
    mq?.addEventListener?.("change", onResize);
    document.addEventListener("visibilitychange", sync);
    if (!reduced) window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      mq?.removeEventListener?.("change", onResize);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [dogs.length]);

  return (
    <div className={[styles.orbit, className ?? ""].filter(Boolean).join(" ")}>
      <div ref={stageRef} className={styles.stage}>
        <div ref={innerRef} className={styles.inner}>
          <div className={styles.ring} aria-hidden="true" data-orbit-ring="">
            {dogs.map((d, i) => (
              <div
                key={d.key}
                className={styles.head}
                ref={(el) => {
                  headRefs.current[i] = el;
                }}
              >
                <Dogmoji dog={d} size={112} priority className={styles.face} />
                <span
                  className={[styles.tag, d.late ? styles.late : ""].filter(Boolean).join(" ")}
                  ref={(el) => {
                    tagRefs.current[i] = el;
                  }}
                >
                  {d.tag}
                </span>
              </div>
            ))}
          </div>
          {children}
        </div>
      </div>
      {facepile ? <Facepile dogs={dogs} className={styles.mobileOnly} /> : null}
    </div>
  );
}

export interface FacepileProps {
  dogs?: readonly CastDog[];
  /** Avatar diameter. Default 44 (Sidehoe). */
  size?: number;
  /** Show at most this many, then "+N". */
  max?: number;
  className?: string;
}

/** Overlapping row of Dogmoji (Sidehoe .facepile). Decorative. */
export function Facepile({ dogs = CAST, size = 44, max = 10, className }: FacepileProps): React.JSX.Element {
  const shown = dogs.slice(0, max);
  const rest = dogs.length - shown.length;
  return (
    <div
      className={[styles.facepile, className ?? ""].filter(Boolean).join(" ")}
      style={{ ["--fp" as string]: `${size}px` }}
      aria-hidden="true"
      data-facepile=""
    >
      {shown.map((d) => (
        <Dogmoji key={d.key} dog={d} size={size} accessory={false} className={styles.pileFace} />
      ))}
      {rest > 0 ? <span className={styles.more}>+{rest}</span> : null}
    </div>
  );
}
