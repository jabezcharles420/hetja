"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ScrollStory.module.css";

/**
 * Apple-style scrollytelling: a pinned device on the right whose screen
 * changes as the steps on the left scroll past (Scan → See → Act).
 *
 * Every step's title and text is ordinary DOM text in reading order, so it
 * works with no JS, in jsdom, and for screen readers. The pinned device is
 * a visual echo, and its inactive screens are aria-hidden. The active step
 * is whichever crosses the middle band of the viewport (IntersectionObserver
 * with a ±45% root margin); without IO the first step stays active.
 *
 * ≤899px there is no room to pin, so the sticky column is hidden and each
 * step renders its own visual inline under its text (stacked tiles).
 * Reduced motion: screens swap without the crossfade/scale.
 */

export interface StoryStep {
  id: string;
  title: string;
  text: ReactNode;
  visual: ReactNode;
}

export interface ScrollStoryProps {
  steps: StoryStep[];
  /** Draw a phone bezel around the pinned visual. Default "phone". */
  device?: "phone" | "none";
  /** Heading level for step titles. Default 3. */
  level?: 2 | 3;
  className?: string;
}

export function ScrollStory({
  steps,
  device = "phone",
  level = 3,
  className,
}: ScrollStoryProps): React.JSX.Element {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = stepRefs.current.indexOf(e.target as HTMLElement);
          if (i >= 0) setActive(i);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const el of stepRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, [steps.length]);

  const Heading = level === 2 ? "h2" : "h3";

  return (
    <div className={`${styles.root} ${className ?? ""}`}>
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
            className={styles.step}
            data-active={i === active ? "" : undefined}
          >
            <span className={styles.num} aria-hidden="true">
              {i + 1}
            </span>
            <Heading className={styles.title}>{s.title}</Heading>
            <div className={styles.text}>{s.text}</div>
            {/* Mobile: the visual lives with its step. Hidden ≥900px. */}
            <div className={styles.inlineVisual}>{s.visual}</div>
          </li>
        ))}
      </ol>

      <div className={styles.stageCol} aria-hidden="true">
        <div className={styles.sticky}>
          <div className={device === "phone" ? styles.phone : styles.bare}>
            {device === "phone" ? <span className={styles.island} /> : null}
            <div className={styles.screen}>
              {steps.map((s, i) => (
                <div key={s.id} className={styles.scene} data-active={i === active ? "" : undefined}>
                  {s.visual}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.dots}>
            {steps.map((s, i) => (
              <span key={s.id} data-active={i === active ? "" : undefined} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
