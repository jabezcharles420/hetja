import type { ReactNode } from "react";
import styles from "./StickyFooter.module.css";

/**
 * Bottom-pinned action area for app screens (hard rule 3: the main button
 * lives in the bottom third). Holds the one button plus its caption, e.g.
 * "This dog needs help" + "Alerts his feeders and a vet nearby." (caption
 * below) or "Shares K/W ward with feeders. Never your exact spot." + "Send
 * SOS" (caption above). Pads for the home indicator with the safe-area inset.
 */

export interface StickyFooterProps {
  /** The action(s): usually one full-width Button. */
  children: ReactNode;
  /** The caption line (13, secondary, centred). */
  caption?: ReactNode;
  captionPosition?: "above" | "below";
  /** white (profile), mist (Log feed / Register), fade (Me: mist gradient, no line). */
  background?: "white" | "mist" | "fade" | "none";
  /** The 1px #e8e8ed divider (box-shadow). Defaults on for white, off otherwise. */
  divider?: boolean;
  /** sticky (default) pins inside the scrolling page; static is for demos. */
  position?: "sticky" | "static";
  className?: string;
}

export function StickyFooter({
  children,
  caption,
  captionPosition = "below",
  background = "white",
  divider,
  position = "sticky",
  className,
}: StickyFooterProps): React.JSX.Element {
  const line = divider ?? background === "white";
  const cap = caption ? <p className={styles.caption}>{caption}</p> : null;
  return (
    <div
      className={[
        styles.footer,
        styles[background],
        line ? styles.divider : "",
        position === "sticky" ? styles.sticky : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {captionPosition === "above" && cap}
      {children}
      {captionPosition === "below" && cap}
    </div>
  );
}
