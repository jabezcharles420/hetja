"use client";

import { createElement, useEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion, supportsScrollTimeline } from "./env";
import { observeScrollProgress } from "./ScrollScrub";
import styles from "./HighlightText.module.css";

/**
 * <HighlightText> is Apple's scroll-lit manifesto paragraph: every word starts
 * dim and lights up, one after another, as the paragraph moves up the screen.
 *
 * Accessibility: the sentence is rendered ONCE as real text for assistive
 * tech (visually hidden) and the per-word spans are a decorative copy with
 * aria-hidden, so a screen reader reads the paragraph normally instead of
 * word by word, and find-in-page still matches the real text.
 *
 * Engines: CSS `animation-timeline` on a named view timeline where supported
 * (each word animates opacity on the compositor); otherwise one rAF-throttled
 * scroll listener writes `--p` on the paragraph and each word derives its own
 * opacity from `--p` in CSS. Server render, no-JS and reduced motion: every
 * word fully lit.
 *
 * The dim state is opacity 0.3 on the ink colour, which lands near
 * --h-ink-faint on white and on the dark band alike (opacity animates on the
 * compositor, colour would not).
 */

export interface HighlightTextProps {
  /** The paragraph. Plain text only (it is split on whitespace). */
  text: string;
  /** Words to emphasise with bold weight when lit, matched case-insensitively without punctuation. */
  emphasis?: string[];
  as?: "p" | "h2" | "h3" | "blockquote" | "div";
  className?: string;
  style?: CSSProperties;
  id?: string;
}

const clean = (w: string): string => w.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase();

export function HighlightText({
  text,
  emphasis = [],
  as = "p",
  className,
  style,
  id,
}: HighlightTextProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [js, setJs] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || supportsScrollTimeline() || prefersReducedMotion()) return;
    if (typeof IntersectionObserver === "undefined") return;
    setJs(true);
    const off = observeScrollProgress(el, (p) => el.style.setProperty("--p", p.toFixed(4)), "view");
    return () => {
      off();
      el.style.removeProperty("--p");
    };
  }, []);

  const words = text.split(/\s+/).filter(Boolean);
  const emph = new Set(emphasis.map(clean));
  const n = words.length;

  return createElement(
    as,
    {
      ref,
      id,
      className: [styles.root, className].filter(Boolean).join(" "),
      "data-js": js ? "" : undefined,
      style: { ...style, "--n": n } as CSSProperties,
    },
    <span className={styles.sr}>{text}</span>,
    <span aria-hidden="true" className={styles.words}>
      {words.map((w, i) => (
        <span
          key={i}
          className={emph.has(clean(w)) ? `${styles.word} ${styles.em}` : styles.word}
          style={{ "--i": i } as CSSProperties}
        >
          {w}
          {i < n - 1 ? " " : ""}
        </span>
      ))}
    </span>,
  );
}
