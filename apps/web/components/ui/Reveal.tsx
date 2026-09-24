"use client";

import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./Reveal.module.css";

/**
 * <Reveal>: rise-in on scroll (Magic UI "blur-fade"; Sidehoe's `rise`:
 * translateY + blur + opacity).
 *
 * Progressive by construction: the server renders the content plainly
 * VISIBLE. Only after mount, and only if the element is still below the fold,
 * does it get the `armed` (hidden) class, and IntersectionObserver lifts it as
 * it scrolls in. So:
 *   - no JS / JS failed          → content is simply there;
 *   - reduced motion or no IO    → never armed (jsdom has no IO: tests see it);
 *   - already on screen at mount → never armed, so above-the-fold content
 *     never blinks out and back (hero copy uses the .h-rise CSS load-in).
 */

type RevealTag = "div" | "section" | "article" | "li" | "span" | "header" | "figure";

export interface RevealProps {
  children: ReactNode;
  /** Delay in ms once in view (stagger siblings by ~80–120ms). */
  delay?: number;
  /** Rise distance in px. Default 24. */
  y?: number;
  /** Element to render. Default div. */
  as?: RevealTag;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

export function Reveal({ children, delay = 0, y = 24, as = "div", className, style, id }: RevealProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return; // already visible

    setArmed(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls = [styles.reveal, armed ? styles.armed : "", shown ? styles.shown : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return createElement(
    as,
    {
      ref,
      id,
      className: cls,
      "data-reveal": shown ? "shown" : armed ? "armed" : "static",
      style: { ...style, "--reveal-delay": `${delay}ms`, "--reveal-y": `${y}px` } as CSSProperties,
    },
    children,
  );
}
