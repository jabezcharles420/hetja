import type { ReactNode } from "react";
import styles from "./WardMap.module.css";

/**
 * Apple Maps-style ward card: a static, hand-drawn SVG, not a map.
 *
 * Why not real tiles: Hetja only ever shows location coarsened to ward level
 * (INVARIANT: no dog's exact spot is published), and a street-accurate map
 * with a pin would imply precision we deliberately don't have. So this is
 * an illustration in Apple Maps' palette (sea, park, arterial, railway),
 * with Maps' red balloon pin and a callout, and it says "illustrative" in
 * its accessible name. No tile provider means no attribution and no bytes.
 *
 * The callout is HTML over the SVG (crisp text at any scale), positioned by
 * the same percentage as the pin.
 */

export interface WardMapProps {
  ward?: string;
  /** Dogs in the ward; drives the callout. */
  count?: number;
  /** Replace the callout text entirely. */
  label?: string;
  /** Pin position as % of the card (0–100). */
  pin?: { x: number; y: number };
  /** Optional row under the map (Maps' place card). */
  footer?: ReactNode;
  /** Override the accessible name. */
  "aria-label"?: string;
  className?: string;
}

export function WardMap({
  ward = "Dadar West",
  count = 14,
  label,
  pin = { x: 60, y: 50 },
  footer,
  "aria-label": ariaLabel,
  className,
}: WardMapProps): React.JSX.Element {
  const text = label ?? `${ward} · ${count} ${count === 1 ? "dog" : "dogs"}`;
  return (
    <figure className={`${styles.card} ${className ?? ""}`}>
      <div
        className={styles.map}
        role="img"
        aria-label={ariaLabel ?? `Illustrative map of ${ward}: ${count} ${count === 1 ? "dog" : "dogs"}. Ward-level only, not exact locations.`}
      >
        <svg className={styles.svg} viewBox="0 0 340 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect className={styles.land} width="340" height="220" />
          {/* City blocks */}
          <g className={styles.block}>
            <rect x="120" y="18" width="46" height="34" rx="4" />
            <rect x="176" y="18" width="58" height="34" rx="4" />
            <rect x="248" y="14" width="80" height="40" rx="4" />
            <rect x="248" y="72" width="36" height="46" rx="4" />
            <rect x="292" y="72" width="44" height="46" rx="4" />
            <rect x="120" y="150" width="54" height="30" rx="4" />
            <rect x="186" y="160" width="46" height="44" rx="4" />
            <rect x="248" y="140" width="84" height="30" rx="4" />
            <rect x="248" y="182" width="84" height="30" rx="4" />
          </g>
          {/* Shivaji Park-style green */}
          <path className={styles.park} d="M130 72c18-10 58-8 76 4 12 8 12 44 0 54-20 14-62 12-78 0-12-10-14-48 2-58Z" />
          {/* Arabian Sea coast */}
          <path
            className={styles.water}
            d="M0 0h74c-10 22-4 40 6 58 12 22 10 44-2 66-10 20-12 44-2 64 4 10 8 22 8 32H0Z"
          />
          {/* Roads: casing then fill */}
          <g className={styles.casing}>
            <path d="M100 0v220M240 0v220M100 62h240M100 138h240M170 138v82" />
          </g>
          <g className={styles.road}>
            <path d="M100 0v220M240 0v220M100 62h240M100 138h240M170 138v82" />
          </g>
          <g className={styles.arterialCasing}>
            <path d="M84 220C120 170 150 150 210 130s110-30 130-40" />
          </g>
          <g className={styles.arterial}>
            <path d="M84 220C120 170 150 150 210 130s110-30 130-40" />
          </g>
          {/* Western Railway */}
          <path className={styles.rail} d="M292 0c-4 60-6 140 0 220" />
          <path className={styles.railTicks} d="M292 0c-4 60-6 140 0 220" />
          <text className={styles.waterLabel} x="14" y="120">
            Arabian Sea
          </text>
        </svg>

        <span className={styles.pin} style={{ left: `${pin.x}%`, top: `${pin.y}%` }} aria-hidden="true">
          <span className={styles.callout}>{text}</span>
          <svg className={styles.balloon} viewBox="0 0 30 40" width="30" height="40">
            <path d="M15 1C7.3 1 1 7.1 1 14.7 1 25 15 39 15 39s14-14 14-24.3C29 7.1 22.7 1 15 1Z" />
            <circle cx="15" cy="14.5" r="5.5" />
          </svg>
          <span className={styles.shadow} />
        </span>
      </div>
      {footer ? <figcaption className={styles.footer}>{footer}</figcaption> : null}
    </figure>
  );
}
