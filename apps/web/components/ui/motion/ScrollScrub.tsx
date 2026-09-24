"use client";

import {
  createElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { prefersReducedMotion } from "./env";

/**
 * Scroll progress as a number from 0 to 1, for anything CSS scroll timelines
 * cannot express (or as the fallback where they are unsupported).
 *
 * Modes:
 *   "view"    0 when the element's top touches the viewport bottom, 1 when its
 *             bottom leaves the viewport top (CSS `view()` "cover" range).
 *   "contain" for tall sticky sections: 0 when the top reaches the viewport
 *             top, 1 when the bottom reaches the viewport bottom (CSS
 *             "contain" range). Falls back to "view" when the element is not
 *             taller than the viewport.
 *
 * Cost: one passive scroll + resize listener per element, attached only while
 * the element is on screen (IntersectionObserver), with work coalesced into
 * one requestAnimationFrame per frame. Reading layout (getBoundingClientRect)
 * happens once per frame and nothing writes layout, so there is no thrash.
 */

export type ScrollProgressMode = "view" | "contain";

export function computeProgress(rect: { top: number; height: number }, vh: number, mode: ScrollProgressMode): number {
  let p: number;
  if (mode === "contain" && rect.height > vh) {
    p = -rect.top / (rect.height - vh);
  } else {
    const span = vh + rect.height;
    p = span > 0 ? (vh - rect.top) / span : 1;
  }
  if (!Number.isFinite(p)) return 1;
  return Math.min(1, Math.max(0, p));
}

/**
 * Low-level subscription: calls `cb(progress)` at most once per frame while
 * `el` is visible. Returns the unsubscribe function.
 */
export function observeScrollProgress(
  el: Element,
  cb: (p: number) => void,
  mode: ScrollProgressMode = "view",
): () => void {
  if (typeof window === "undefined") return () => {};
  let frame = 0;
  let listening = false;

  const measure = (): void => {
    frame = 0;
    cb(computeProgress(el.getBoundingClientRect(), window.innerHeight || 1, mode));
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const listen = (on: boolean): void => {
    if (on === listening) return;
    listening = on;
    if (on) {
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule, { passive: true });
      schedule();
    } else {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    }
  };

  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (!visible) measure(); // settle at 0 or 1 on the way out
      listen(visible);
    });
    io.observe(el);
  } else {
    listen(true);
  }
  measure();

  return () => {
    io?.disconnect();
    listen(false);
    if (frame) cancelAnimationFrame(frame);
  };
}

export interface ScrollProgressOptions {
  mode?: ScrollProgressMode;
  /** Stop tracking (progress freezes). */
  disabled?: boolean;
}

/**
 * React state version. Re-renders on every frame of scroll while visible, so
 * use it for cheap trees (a label, a counter). For styling prefer
 * <ScrollScrub> / useScrollProgressVar, which never re-render.
 * Returns 0 on the server and before the first measurement.
 */
export function useScrollProgress(ref: RefObject<Element | null>, options: ScrollProgressOptions = {}): number {
  const { mode = "view", disabled = false } = options;
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    return observeScrollProgress(el, setP, mode);
  }, [ref, mode, disabled]);
  return p;
}

/**
 * Binds progress to a CSS custom property on the element itself (default
 * `--p`), with no React re-renders. Under reduced motion the property is set
 * to 1 once (the final state) and not tracked. Returns nothing; read the
 * variable in CSS: `transform: scale(calc(1.1 - var(--p, 1) * 0.1))`.
 */
export function useScrollProgressVar(
  ref: RefObject<HTMLElement | null>,
  options: ScrollProgressOptions & { name?: string } = {},
): void {
  const { mode = "view", disabled = false, name = "--p" } = options;
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    if (prefersReducedMotion()) {
      el.style.setProperty(name, "1");
      return;
    }
    const off = observeScrollProgress(el, (p) => el.style.setProperty(name, p.toFixed(4)), mode);
    return () => {
      off();
      el.style.removeProperty(name);
    };
  }, [ref, mode, disabled, name]);
}

type ScrubTag = "div" | "section" | "figure" | "span" | "header";

export interface ScrollScrubProps {
  children?: ReactNode;
  mode?: ScrollProgressMode;
  /** Custom property name. Default `--p`. */
  name?: string;
  as?: ScrubTag;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

/**
 * <ScrollScrub> renders an element whose `--p` (0 to 1) follows scroll, so
 * any descendant CSS can drive transform/opacity/clip-path from it. Server and
 * no-JS render: `--p` is unset, so write `var(--p, 1)` to default to the
 * final state.
 */
export function ScrollScrub({
  children,
  mode = "view",
  name = "--p",
  as = "div",
  className,
  style,
  id,
}: ScrollScrubProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useScrollProgressVar(ref, { mode, name });
  return createElement(as, { ref, className, style, id }, children);
}
