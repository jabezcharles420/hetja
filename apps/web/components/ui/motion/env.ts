"use client";

import { useEffect, useState } from "react";

/**
 * Motion environment probes. Every probe is SSR-safe and returns the
 * "do less" answer when it cannot tell (no window, no matchMedia, no CSS.supports),
 * so the server render and jsdom always get the static, fully visible layout.
 */

const REDUCE = "(prefers-reduced-motion: reduce)";
const FINE_HOVER = "(hover: hover) and (pointer: fine)";

function mq(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** True when the user asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  return mq(REDUCE);
}

/** True on a mouse/trackpad device (tilt and magnetic effects are no-ops otherwise). */
export function hasFinePointer(): boolean {
  return mq(FINE_HOVER);
}

/** CSS scroll-driven animations (Chrome 115+, Safari 26+; Firefox is behind a flag in older releases). */
export function supportsScrollTimeline(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  try {
    return CSS.supports("animation-timeline: view()");
  } catch {
    return false;
  }
}

/**
 * Live reduced-motion flag. Starts `false` on the server and first client
 * render (no hydration mismatch), then reflects the media query and follows
 * changes made while the page is open.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(REDUCE);
    setReduced(m.matches);
    const on = (e: MediaQueryListEvent): void => setReduced(e.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
