import { createElement, type CSSProperties, type ReactNode } from "react";
import styles from "./GradientText.module.css";

/**
 * <GradientText> is the Apple Intelligence headline treatment: text filled
 * with the orange-pink-purple-blue gradient (background-clip: text) and a
 * light sweep across it when it first appears.
 *
 * Server component, CSS only. The sweep plays twice (4.9 s in all) and
 * stops, so it is not "moving content" under WCAG 2.2.2; `loop` makes it
 * continuous (landing hero only). Reduced motion: the static gradient.
 * Engines without background-clip: text show plain ink.
 *
 * The stops are the darker Apple Intelligence tones: every stop is at least
 * 4.4:1 on white and on --h-gray. Still, use it for headlines (24px and up)
 * only, since a gradient fill reads worse than flat ink at body sizes.
 */

export interface GradientTextProps {
  children: ReactNode;
  /** "ai" (orange, pink, purple, blue) or "warm" (Hetja aurora pinks into orange). */
  tone?: "ai" | "warm";
  loop?: boolean;
  as?: "span" | "h1" | "h2" | "h3" | "p";
  className?: string;
  style?: CSSProperties;
}

export function GradientText({
  children,
  tone = "ai",
  loop = false,
  as = "span",
  className,
  style,
}: GradientTextProps): React.JSX.Element {
  return createElement(
    as,
    {
      className: [styles.text, styles[tone], loop ? styles.loop : null, className].filter(Boolean).join(" "),
      style,
    },
    children,
  );
}
