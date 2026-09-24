import type { ElementType, ReactNode } from "react";
import styles from "./Card.module.css";

/**
 * White card, radius 28, padding 24. No border on aurora or mist; add
 * `bordered` (1px #e8e8ed) only when it sits on white. `desktop` switches to
 * the 32 radius / 40 padding desktop card. `inner` is the mist inner card
 * (radius 20) used inside white cards.
 */

export interface CardProps {
  children: ReactNode;
  as?: ElementType;
  bordered?: boolean;
  desktop?: boolean;
  tone?: "white" | "mist" | "black";
  /** Override the padding, e.g. "28px 24px" for the stat cards. */
  padding?: string;
  className?: string;
  id?: string;
}

export function Card({
  children,
  as: Tag = "div",
  bordered = false,
  desktop = false,
  tone = "white",
  padding,
  className,
  id,
}: CardProps): React.JSX.Element {
  return (
    <Tag
      id={id}
      className={[
        styles.card,
        styles[tone],
        bordered ? styles.bordered : "",
        desktop ? styles.desktop : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={padding ? { padding } : undefined}
    >
      {children}
    </Tag>
  );
}
