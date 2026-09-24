"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { prefersReducedMotion, supportsScrollTimeline } from "./env";
import { observeScrollProgress } from "./ScrollScrub";
import styles from "./StickyZoom.module.css";

/**
 * <StickyZoom> is the apple.com hero "zoom out": a tall section pins its media
 * to the viewport while you scroll, and the media scales from `from` to `to`
 * while its corners round in (clip-path inset, not border-radius, so it stays
 * off the layout path). Use it once per page, for the product moment.
 *
 * Engines: CSS named view timeline over the section's "contain" range where
 * supported; otherwise a rAF scroll listener writes `--p`. Server render,
 * no-JS and reduced motion: no pinning, media shown at its final size and
 * radius, so nothing is hidden or oversized.
 */

export interface StickyZoomProps {
  /** The media (an image, a <PhoneFrame>, a video poster). */
  children: ReactNode;
  /** Optional copy pinned above the media (a headline, a lede). */
  header?: ReactNode;
  /** Optional copy after the pinned stage. */
  footer?: ReactNode;
  /** Start scale. Default 1.15 (zoom out). Use 1 with to=0.85 for a shrink. */
  from?: number;
  /** End scale. Default 1. */
  to?: number;
  /** End corner radius in px. Default 28 (the tile radius). */
  radius?: number;
  /** Scroll length of the pinned section. Default "200vh". */
  length?: string;
  className?: string;
  /** Accessible label for the section. */
  label?: string;
}

export function StickyZoom({
  children,
  header,
  footer,
  from = 1.15,
  to = 1,
  radius = 28,
  length = "200vh",
  className,
  label,
}: StickyZoomProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [js, setJs] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || supportsScrollTimeline() || prefersReducedMotion()) return;
    if (typeof IntersectionObserver === "undefined") return;
    setJs(true);
    const off = observeScrollProgress(el, (p) => el.style.setProperty("--p", p.toFixed(4)), "contain");
    return () => {
      off();
      el.style.removeProperty("--p");
    };
  }, []);

  const vars = {
    "--from": from,
    "--to": to,
    "--r": `${radius}px`,
    "--len": length,
  } as CSSProperties;

  return (
    <section
      ref={ref}
      aria-label={label}
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-js={js ? "" : undefined}
      style={vars}
    >
      <div className={styles.sticky}>
        {header ? <div className={styles.header}>{header}</div> : null}
        <div className={styles.media}>{children}</div>
      </div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </section>
  );
}
