"use client";

import { useEffect, useMemo, useRef } from "react";
import styles from "./NumberTicker.module.css";

/**
 * <NumberTicker>: impact stats count up from 0 when scrolled into view
 * (Magic UI "number-ticker").
 *
 * The first render (server HTML, no-JS, tests, screen readers that read the
 * page before it scrolls) is the FINAL formatted value, and the element's
 * text is exactly that string (no wrapper spans), so `.h-stat-value` callers
 * and `textContent === "42"` assertions keep working. The count-up rewrites
 * the nodeValue of React's own text node from a rAF loop (no re-renders, and
 * React's reference to the node stays valid), then lands on the same string.
 *
 * Skipped under reduced motion and where IntersectionObserver is missing.
 */

export interface NumberTickerProps {
  value: number;
  /** Pass "h-stat-value" / "h-bignum" for the big-number type. */
  className?: string;
  /** Intl locale. Default "en-IN" (1,00,000 grouping, as Mumbai reads it). */
  locale?: string;
  /** Fraction digits. Default 0. */
  decimals?: number;
  /** Text glued to the number: prefix "₹", suffix "+". */
  prefix?: string;
  suffix?: string;
  /** Count-up duration in ms. Default 1400. */
  duration?: number;
  /** Delay after entering view, in ms. */
  delay?: number;
}

export function NumberTicker({
  value,
  className,
  locale = "en-IN",
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1400,
  delay = 0,
}: NumberTickerProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    [locale, decimals],
  );
  const finalText = `${prefix}${fmt.format(value)}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || !Number.isFinite(value) || value === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // Write into React's text node rather than replacing it via textContent.
    const set = (text: string) => {
      const node = el.firstChild;
      if (node && node.nodeType === Node.TEXT_NODE) node.nodeValue = text;
      else el.textContent = text;
    };
    let raf = 0;
    let timer = 0;
    const run = () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 4); // quartic out: fast, then settles
        set(p < 1 ? `${prefix}${fmt.format(value * eased)}${suffix}` : finalText);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      set(`${prefix}${fmt.format(0)}${suffix}`);
      raf = requestAnimationFrame(step);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          timer = window.setTimeout(run, delay);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      // No text reset here: passive cleanups run AFTER React has committed a
      // new value, so writing the old finalText would clobber it. A re-run
      // effect re-observes and always lands on its own finalText.
    };
  }, [value, fmt, prefix, suffix, duration, delay, finalText]);

  return (
    <span ref={ref} className={[styles.ticker, className ?? ""].filter(Boolean).join(" ")}>
      {finalText}
    </span>
  );
}
