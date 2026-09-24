import Link from "next/link";
import styles from "./Logo.module.css";

/**
 * The Hetja mark: an ink circle with a white paw of 5 ellipses, plus the
 * wordmark. The ellipses are the mock's absolutely positioned spans
 * (30px circle: pad 12x10 at 9,14; toes 5x6 at 5,8 / 10,4 / 16,4 / 21,8)
 * converted to SVG so the mark scales cleanly to 40px on the design page.
 */

export interface LogoMarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 30, className }: LogoMarkProps): React.JSX.Element {
  return (
    <svg
      className={[styles.mark, className ?? ""].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 30 30"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="15" cy="15" r="15" fill="currentColor" />
      <g fill="var(--h-white)">
        <ellipse cx="15" cy="19" rx="6" ry="5" />
        <ellipse cx="7.5" cy="11" rx="2.5" ry="3" />
        <ellipse cx="12.5" cy="7" rx="2.5" ry="3" />
        <ellipse cx="18.5" cy="7" rx="2.5" ry="3" />
        <ellipse cx="23.5" cy="11" rx="2.5" ry="3" />
      </g>
    </svg>
  );
}

export interface LogoProps {
  href?: string;
  /** Mark diameter; the wordmark scales with it (30 -> 21px, 40 -> 24px). */
  size?: 26 | 30 | 40;
  tone?: "ink" | "memorial";
  className?: string;
}

const WORD: Record<NonNullable<LogoProps["size"]>, { font: number; gap: number; weight: number }> = {
  26: { font: 19, gap: 9, weight: 600 },
  30: { font: 21, gap: 9, weight: 700 },
  40: { font: 24, gap: 12, weight: 700 },
};

export function Logo({ href, size = 30, tone = "ink", className }: LogoProps): React.JSX.Element {
  const w = WORD[size];
  const cls = [styles.logo, tone === "memorial" ? styles.memorial : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const style = { gap: w.gap, fontSize: w.font, fontWeight: w.weight };
  const inner = (
    <>
      <LogoMark size={size} />
      <span>Hetja</span>
    </>
  );
  return href ? (
    <Link href={href} className={cls} style={style} aria-label="Hetja home">
      {inner}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {inner}
    </div>
  );
}
