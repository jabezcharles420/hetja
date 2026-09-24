"use client";

import { useEffect, useRef, useState } from "react";
import type { ElementType, ReactNode } from "react";
import styles from "./SectionFade.module.css";

/**
 * Marketing-only section fade (opacity + 12px rise, 400ms ease-out).
 *
 * Content is visible by default: the server HTML, no-JS visitors and jsdom
 * all see it. Only after mount, and only for sections still below the fold,
 * do we hide and then reveal on intersection. Reduced motion skips it
 * entirely (and --h-dur is 0 there anyway). Never use on app screens.
 */

export interface SectionFadeProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}

export function SectionFade({
  children,
  as: Tag = "div",
  className,
}: SectionFadeProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"static" | "hidden" | "shown">("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Already on screen at mount: leave it alone rather than flash it.
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    setState("hidden");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={[styles.fade, styles[state], className ?? ""].filter(Boolean).join(" ")}
    >
      {children}
    </Tag>
  );
}
