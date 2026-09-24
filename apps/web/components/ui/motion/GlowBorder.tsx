"use client";

import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./GlowBorder.module.css";

/**
 * <GlowBorder> is the Apple Intelligence / Siri glowing edge: an
 * orange-pink-purple-blue conic gradient that travels around any card, button
 * or phone, with a soft bloom behind it.
 *
 * Built compositor-friendly: the gradient is painted ONCE on an oversized
 * square that ROTATES (transform), clipped to a ring by a mask. No per-frame
 * repaint, unlike animating a conic-gradient angle with @property.
 *
 * WCAG 2.2.2: by default it spins for a few seconds when it scrolls into view
 * (under 5 s) and keeps spinning only while hovered or focused, so it never
 * loops unattended. `loop` opts into continuous rotation (use it only near a
 * page-level pause control, never on /dog or /scan). It pauses offscreen.
 * Reduced motion: a static gradient edge.
 *
 * The ring and bloom are aria-hidden decoration; `children` keep their semantics.
 */

export interface GlowBorderProps {
  children: ReactNode;
  /** Corner radius of the wrapped element. Default the pill radius. */
  radius?: string;
  /** Ring width in px. Default 2. */
  width?: number;
  /** Bloom behind the ring. Default "soft". */
  glow?: "none" | "soft" | "strong";
  /** One full turn, in seconds. Default 4. */
  speed?: number;
  /** Rotate forever (see WCAG note). Default false. */
  loop?: boolean;
  /** Show the ring at all. Default true (toggle for "listening" states). */
  active?: boolean;
  as?: "div" | "span";
  className?: string;
  style?: CSSProperties;
}

export function GlowBorder({
  children,
  radius = "var(--h-radius-pill)",
  width = 2,
  glow = "soft",
  speed = 4,
  loop = false,
  active = true,
  as = "div",
  className,
  style,
}: GlowBorderProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const vars = {
    ...style,
    "--glow-r": radius,
    "--glow-w": `${width}px`,
    "--glow-speed": `${speed}s`,
  } as CSSProperties;

  return createElement(
    as,
    {
      ref,
      className: [styles.root, className].filter(Boolean).join(" "),
      style: vars,
      "data-active": active ? "" : undefined,
      "data-spin": onScreen && active ? (loop ? "loop" : "once") : undefined,
      "data-glow": glow,
    },
    glow !== "none" ? (
      <span key="bloom" aria-hidden="true" className={styles.bloom}>
        <span className={styles.spin} />
      </span>
    ) : null,
    <span key="ring" aria-hidden="true" className={styles.ring}>
      <span className={styles.spin} />
    </span>,
    <span key="content" className={styles.content}>
      {children}
    </span>,
  );
}
