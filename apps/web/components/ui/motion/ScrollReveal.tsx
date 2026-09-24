"use client";

import {
  Children,
  createElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { prefersReducedMotion, supportsScrollTimeline } from "./env";
import styles from "./ScrollReveal.module.css";

/**
 * <ScrollReveal> is the Apple scroll load-in: content rises, un-blurs and fades
 * in as it enters the viewport.
 *
 * Two engines, one look:
 *   1. CSS scroll-driven (`animation-timeline: view()`, Chrome 115+, Safari 26+).
 *      Pure CSS, runs off the main thread, scrubs with the scroll (scroll back
 *      up and it reverses, like apple.com). No JS involved.
 *   2. IntersectionObserver fallback (older Firefox/Safari). After mount, and
 *      only for elements still below the fold, the element is "armed" (hidden)
 *      and plays a one-shot transition when it scrolls in.
 *
 * Server render, no-JS, jsdom and reduced motion all get the content plainly
 * visible: nothing is ever hidden by markup, only by a class added after
 * mount or by a CSS rule gated on `prefers-reduced-motion: no-preference`.
 */

export type RevealEffect = "rise" | "clip" | "scale" | "fade";
type RevealTag = "div" | "section" | "article" | "li" | "span" | "header" | "figure" | "p" | "h2" | "h3";

export interface ScrollRevealProps {
  children?: ReactNode;
  /** rise (translate + blur, default), clip (wipe up with clip-path), scale (0.92 to 1), fade. */
  effect?: RevealEffect;
  /** Stagger slot. Each step offsets the scroll range (CSS) or the delay (fallback). */
  index?: number;
  as?: RevealTag;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

export function ScrollReveal({
  children,
  effect = "rise",
  index = 0,
  as = "div",
  className,
  style,
  id,
}: ScrollRevealProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "armed" | "shown">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el || supportsScrollTimeline()) return; // CSS engine handles it
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return; // already on screen: never blink
    setState("armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls = [styles.reveal, styles[effect], className].filter(Boolean).join(" ");
  return createElement(
    as,
    {
      ref,
      id,
      className: cls,
      "data-reveal": state === "idle" ? undefined : state,
      style: { ...style, "--i": index } as CSSProperties,
    },
    children,
  );
}

export interface StaggerProps {
  children?: ReactNode;
  effect?: RevealEffect;
  /** Wrapper element for the group. Default div. */
  as?: "div" | "ul" | "ol" | "section";
  /** Element wrapping each child. Default div (li when `as` is ul/ol). */
  itemAs?: RevealTag;
  className?: string;
  itemClassName?: string;
  style?: CSSProperties;
}

/**
 * <Stagger> wraps each child in a <ScrollReveal> with an increasing index, so
 * a row of tiles lights up left to right instead of all at once.
 */
export function Stagger({
  children,
  effect = "rise",
  as = "div",
  itemAs,
  className,
  itemClassName,
  style,
}: StaggerProps): React.JSX.Element {
  const tag: RevealTag = itemAs ?? (as === "ul" || as === "ol" ? "li" : "div");
  let i = 0;
  const items = Children.map(children, (child) => {
    if (child === null || child === undefined || typeof child === "boolean") return child;
    const key = isValidElement(child) && child.key !== null ? child.key : i;
    return (
      <ScrollReveal key={key} as={tag} effect={effect} index={i++} className={itemClassName}>
        {child}
      </ScrollReveal>
    );
  });
  return createElement(as, { className, style }, items);
}
