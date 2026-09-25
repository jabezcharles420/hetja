"use client";

import styles from "./Switch.module.css";

/**
 * iOS-style 51x31 switch (N1 "SOS alerts"). Green when on; the label next to
 * it carries the meaning. role="switch" with a 44px touch target.
 */

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Id of the element naming the switch. */
  labelledBy?: string;
  describedBy?: string;
  /** Accessible name when there is no visible label to point at. */
  label?: string;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  disabled,
  labelledBy,
  describedBy,
  label,
  className,
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : label}
      disabled={disabled}
      className={[styles.switch, checked ? styles.on : "", className ?? ""].filter(Boolean).join(" ")}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}
