"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { hasFinePointer, prefersReducedMotion, supportsScrollTimeline } from "./env";
import { observeScrollProgress } from "./ScrollScrub";
import styles from "./Parallax.module.css";

/**
 * <Parallax> + <ParallaxLayer>: layered depth. Each layer drifts at its own
 * rate as the scene scrolls through the viewport, and (optionally, on a mouse)
 * leans a few pixels toward the pointer. Offsets are small on purpose
 * (`depth` 1 = 48px of scroll travel and 12px of pointer lean), the way Apple
 * separates a device from its backdrop without making anyone seasick.
 *
 * Scroll drift uses the `translate` property (CSS view() timeline, or `--p`
 * from a rAF listener); pointer lean uses `transform`, so the two compose.
 * Server render, no-JS and reduced motion: every layer at rest.
 */

export interface ParallaxProps {
  children: ReactNode;
  /** Lean layers toward a fine pointer. Default false. */
  pointer?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Parallax({ children, pointer = false, className, style }: ParallaxProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [js, setJs] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const offs: Array<() => void> = [];

    if (!supportsScrollTimeline() && typeof IntersectionObserver !== "undefined") {
      setJs(true);
      offs.push(observeScrollProgress(el, (p) => el.style.setProperty("--p", p.toFixed(4)), "view"));
    }

    if (pointer && hasFinePointer()) {
      let frame = 0;
      let x = 0;
      let y = 0;
      const apply = (): void => {
        frame = 0;
        el.style.setProperty("--px", x.toFixed(3));
        el.style.setProperty("--py", y.toFixed(3));
      };
      const move = (e: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        x = ((e.clientX - r.left) / r.width) * 2 - 1;
        y = ((e.clientY - r.top) / r.height) * 2 - 1;
        if (!frame) frame = requestAnimationFrame(apply);
      };
      const leave = (): void => {
        x = 0;
        y = 0;
        if (!frame) frame = requestAnimationFrame(apply);
      };
      el.addEventListener("pointermove", move, { passive: true });
      el.addEventListener("pointerleave", leave);
      offs.push(() => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
        if (frame) cancelAnimationFrame(frame);
      });
    }
    return () => offs.forEach((off) => off());
  }, [pointer]);

  return (
    <div ref={ref} className={[styles.scene, className].filter(Boolean).join(" ")} data-js={js ? "" : undefined} style={style}>
      {children}
    </div>
  );
}

export interface ParallaxLayerProps {
  children?: ReactNode;
  /** Relative depth: 0 is fixed to the page, 1 is the default drift, negative drifts the other way. */
  depth?: number;
  /** Decorative layers (blobs, stickers, glows) are hidden from assistive tech. Default true. */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function ParallaxLayer({
  children,
  depth = 1,
  decorative = true,
  className,
  style,
}: ParallaxLayerProps): React.JSX.Element {
  return (
    <div
      aria-hidden={decorative ? "true" : undefined}
      className={[styles.layer, className].filter(Boolean).join(" ")}
      style={{ ...style, "--depth": depth } as CSSProperties}
    >
      {children}
    </div>
  );
}
