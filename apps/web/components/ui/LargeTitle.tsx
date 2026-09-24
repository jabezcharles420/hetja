"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./LargeTitle.module.css";

/**
 * iOS large-title navigation (UINavigationBar prefersLargeTitles).
 *
 * The 34px bold title sits in the page; once it scrolls under the bar, a
 * compact 17px semibold copy fades in, centred, in a sticky glass bar, the
 * exact hand-off Mail and Settings do. The bar sits just below the site's
 * own sticky header (`offset`, default the 52px nav height) so the two
 * stack rather than fight.
 *
 * The large <h1> is the only heading; the compact copy is aria-hidden, so
 * screen readers hear the title once. Detection is an IntersectionObserver
 * on the large title with a negative top margin equal to the bars' height;
 * where IO is missing (jsdom, very old browsers) the compact bar simply
 * never appears, which is the correct resting state at the top of a page.
 *
 * Pass the page body as `children`: a sticky element only sticks inside its
 * parent, so the compact bar stays pinned exactly as long as that content.
 */

export interface LargeTitleProps {
  title: string;
  subtitle?: ReactNode;
  /** Trailing controls (buttons/links) shown in both states. */
  actions?: ReactNode;
  /** Height of whatever is already sticky above (px). Default 52. */
  offset?: number;
  /** Heading level for the large title. Default 1. */
  level?: 1 | 2;
  className?: string;
  /** Page content the compact bar should stay pinned over. */
  children?: ReactNode;
}

const BAR_H = 44;

export function LargeTitle({
  title,
  subtitle,
  actions,
  offset = 52,
  level = 1,
  className,
  children,
}: LargeTitleProps): React.JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Compact only when the title has gone off the TOP (not the bottom).
        setCompact(!entry.isIntersecting && entry.boundingClientRect.top < offset + BAR_H);
      },
      { rootMargin: `-${offset + BAR_H}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [offset]);

  const Heading = level === 1 ? "h1" : "h2";

  return (
    <div className={`${styles.root} ${className ?? ""}`} style={{ "--offset": `${offset}px` } as React.CSSProperties}>
      <div className={styles.bar} data-compact={compact ? "" : undefined}>
        <span className={styles.compactTitle} aria-hidden="true">
          {title}
        </span>
      </div>
      <div className={styles.large}>
        <div className={styles.row}>
          <Heading ref={titleRef} className={styles.title}>
            {title}
          </Heading>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
