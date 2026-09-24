import type { ReactNode } from "react";
import styles from "./Progress.module.css";

/**
 * Trust progress (Me screen): "Trusted feeder · Level 2" on the left,
 * "Level 3 at 50" on the right, and an 8px ink bar on #e8e8ed.
 */

export interface ProgressProps {
  /** Left line, e.g. "Trusted feeder · Level 2". */
  label: ReactNode;
  /** Right line, e.g. "Level 3 at 50". */
  target?: ReactNode;
  /** 0 to 1. */
  value: number;
  /** Accessible description of the value, e.g. "42 of 50 feeds". */
  valueText?: string;
  className?: string;
}

export function Progress({
  label,
  target,
  value,
  valueText,
  className,
}: ProgressProps): React.JSX.Element {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={[styles.card, className ?? ""].filter(Boolean).join(" ")}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {target && <span className={styles.target}>{target}</span>}
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={valueText}
      >
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
