import type { CSSProperties, ReactNode } from "react";
import styles from "./Marquee.module.css";

/**
 * <Marquee>: endless horizontal strip (Magic UI "marquee"), CSS only.
 *
 * The children are rendered twice in a row and the track slides left by
 * exactly one copy's width (+ gap), so the loop seam is invisible. The second
 * copy is aria-hidden: assistive tech reads the list once. Edges fade out
 * with mask-image instead of an overlay, so it works on any background.
 *
 * Pauses on hover/focus (WCAG 2.2.2: moving content must be pausable). Under
 * reduced motion there is no animation at all: the duplicate is dropped and
 * the items wrap onto as many centred lines as they need.
 *
 * Server component: zero client JS.
 */

export interface MarqueeProps {
  children: ReactNode;
  /** Scroll right-to-left (default) or left-to-right. */
  reverse?: boolean;
  /** Seconds per full loop. Lower = faster. Default 40. */
  speed?: number;
  /** Gap between items (and between the two copies), px. Default 12. */
  gap?: number;
  pauseOnHover?: boolean;
  /** Accessible name for the strip (rendered as a list region). */
  label?: string;
  className?: string;
}

export function Marquee({
  children,
  reverse = false,
  speed = 40,
  gap = 12,
  pauseOnHover = true,
  label,
  className,
}: MarqueeProps): React.JSX.Element {
  const style = { "--mq-duration": `${speed}s`, "--mq-gap": `${gap}px` } as CSSProperties;
  const cls = [styles.marquee, reverse ? styles.reverse : "", pauseOnHover ? styles.pausable : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={style} role={label ? "region" : undefined} aria-label={label} data-marquee="">
      <div className={styles.track}>
        <div className={styles.group}>{children}</div>
        <div className={`${styles.group} ${styles.copy}`} aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
