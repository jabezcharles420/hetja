import type { ReactNode } from "react";
import styles from "./Bento.module.css";

/**
 * Bento grid (Sidehoe `.bento` / Aceternity bento-grid) as components over
 * the global primitives: <Bento> is `.h-bento` (12 columns, 20px gap) and
 * <Tile> is `.h-tile` + `.h-span-N`, so the responsive collapse
 * (≤960px: 5–8 → 12, 4 → 6; ≤640px: all → 12) lives in globals.css once.
 *
 * Tile anatomy: optional eyebrow, a real heading, muted body text, then a
 * `visual` pinned to the bottom (margin-top: auto): the Apple tile rhythm of
 * "claim, one line of proof, the thing itself". `dark` is the black tile
 * variant; `lift` adds a hover rise for tiles that are links.
 */

export interface BentoProps {
  className?: string;
  children: ReactNode;
}

export function Bento({ className, children }: BentoProps): React.JSX.Element {
  return <div className={`h-bento ${className ?? ""}`}>{children}</div>;
}

export type TileSpan = 4 | 5 | 6 | 7 | 8 | 12;

export interface TileProps {
  span?: TileSpan;
  title?: ReactNode;
  text?: ReactNode;
  eyebrow?: ReactNode;
  visual?: ReactNode;
  dark?: boolean;
  /** Grey tile (for use on a white section). */
  gray?: boolean;
  /** Hover lift; use when the tile is (or contains) a primary link. */
  lift?: boolean;
  /** Heading level for `title`. Default 3. */
  level?: 2 | 3 | 4;
  className?: string;
  children?: ReactNode;
}

export function Tile({
  span = 6,
  title,
  text,
  eyebrow,
  visual,
  dark,
  gray,
  lift,
  level = 3,
  className,
  children,
}: TileProps): React.JSX.Element {
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  const cls = [
    "h-tile",
    `h-span-${span}`,
    dark && styles.dark,
    gray && styles.gray,
    lift && styles.lift,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={cls}>
      {title || text || eyebrow ? (
        <div>
          {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
          {title ? <Heading className="h-title-tile">{title}</Heading> : null}
          {text ? <p className="h-tile-text">{text}</p> : null}
        </div>
      ) : null}
      {children}
      {visual ? <div className="h-tile-visual">{visual}</div> : null}
    </article>
  );
}
