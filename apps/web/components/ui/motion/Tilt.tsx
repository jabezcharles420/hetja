"use client";

import { createElement, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { hasFinePointer, prefersReducedMotion } from "./env";
import styles from "./Tilt.module.css";

/**
 * Pointer effects for a mouse or trackpad. Both are complete no-ops on touch
 * and coarse pointers (no listeners attached) and under reduced motion.
 */

function useFinePointerEffect(
  ref: React.RefObject<HTMLElement | null>,
  onMove: (el: HTMLElement, nx: number, ny: number, e: PointerEvent) => void,
  onLeave: (el: HTMLElement) => void,
): void {
  const move = useRef(onMove);
  const leave = useRef(onLeave);
  move.current = onMove;
  leave.current = onLeave;
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasFinePointer() || prefersReducedMotion()) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const tick = (): void => {
      frame = 0;
      if (!last) return;
      const r = el.getBoundingClientRect();
      const nx = ((last.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((last.clientY - r.top) / r.height) * 2 - 1;
      move.current(el, nx, ny, last);
    };
    const pm = (e: PointerEvent): void => {
      last = e;
      el.dataset.active = "";
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const pl = (): void => {
      last = null;
      delete el.dataset.active;
      leave.current(el);
    };
    el.addEventListener("pointermove", pm, { passive: true });
    el.addEventListener("pointerleave", pl);
    return () => {
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerleave", pl);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}

export interface TiltProps {
  children: ReactNode;
  /** Maximum tilt in degrees. Default 8. */
  max?: number;
  /** Glossy sheen that follows the pointer (Wallet pass). Default true. */
  sheen?: boolean;
  /** Radius of the sheen clip; match the card. Default the card radius. */
  radius?: string;
  as?: "div" | "span" | "article";
  className?: string;
  style?: CSSProperties;
}

/**
 * <Tilt> leans a card toward the pointer in 3D with a light sheen across it,
 * like a Wallet pass in the hand. Springs back when the pointer leaves.
 */
export function Tilt({
  children,
  max = 8,
  sheen = true,
  radius = "var(--h-radius-card)",
  as = "div",
  className,
  style,
}: TiltProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useFinePointerEffect(
    ref,
    (el, nx, ny) => {
      el.style.setProperty("--rx", `${(-ny * max).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(nx * max).toFixed(2)}deg`);
      el.style.setProperty("--sx", `${((nx + 1) * 50).toFixed(1)}%`);
      el.style.setProperty("--sy", `${((ny + 1) * 50).toFixed(1)}%`);
    },
    (el) => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    },
  );
  return createElement(
    as,
    {
      ref,
      className: [styles.tilt, className].filter(Boolean).join(" "),
      style: { ...style, "--tilt-r": radius } as CSSProperties,
    },
    children,
    sheen ? (
      <span key="sheen" aria-hidden="true" className={styles.sheen}>
        <span className={styles.sheenSpot} />
      </span>
    ) : null,
  );
}

export interface MagneticProps {
  children: ReactNode;
  /** Fraction of the pointer offset the child follows. Default 0.25. */
  strength?: number;
  /** Cap on travel in px. Default 10. */
  maxShift?: number;
  className?: string;
}

/**
 * <Magnetic> makes a CTA drift a few pixels toward the cursor while hovered
 * and spring back (--h-spring) on leave. Wrap a button or link; the wrapper is
 * an inline-block span with no semantics.
 */
export function Magnetic({ children, strength = 0.25, maxShift = 10, className }: MagneticProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useFinePointerEffect(
    ref,
    (el, _nx, _ny, e) => {
      const r = el.getBoundingClientRect();
      const clamp = (v: number): number => Math.max(-maxShift, Math.min(maxShift, v));
      const dx = clamp((e.clientX - (r.left + r.width / 2)) * strength);
      const dy = clamp((e.clientY - (r.top + r.height / 2)) * strength);
      el.style.setProperty("--mx", `${dx.toFixed(1)}px`);
      el.style.setProperty("--my", `${dy.toFixed(1)}px`);
    },
    (el) => {
      el.style.setProperty("--mx", "0px");
      el.style.setProperty("--my", "0px");
    },
  );
  return (
    <span ref={ref} className={[styles.magnetic, className].filter(Boolean).join(" ")}>
      <span className={styles.magneticInner}>{children}</span>
    </span>
  );
}
