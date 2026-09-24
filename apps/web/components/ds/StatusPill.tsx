import type { ReactNode } from "react";
import { StatusIcon, type StatusIconName } from "./icons";
import styles from "./StatusPill.module.css";

/**
 * Status pill: icon plus words, always (hard rule 2: colour never carries
 * meaning alone). `icon` is required on purpose so a pill cannot ship as a
 * bare coloured blob.
 */

export type StatusVariant = "ok" | "warn" | "neutral" | "danger";
export type StatusPillSize = "default" | "row" | "small";

export interface StatusPillProps {
  variant: StatusVariant;
  icon: StatusIconName;
  /** The words, e.g. "Vaccinated", "Not fed today", "Last fed 2 hours ago". */
  children: ReactNode;
  /** default 36 (profile), row 30 (list rows), small 26 (phone mockups). */
  size?: StatusPillSize;
  className?: string;
}

const ICON_SIZE: Record<StatusPillSize, number> = { default: 16, row: 14, small: 12 };

export function StatusPill({
  variant,
  icon,
  children,
  size = "default",
  className,
}: StatusPillProps): React.JSX.Element {
  return (
    <span
      className={[styles.pill, styles[variant], styles[size], className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <StatusIcon
        name={icon}
        size={ICON_SIZE[size]}
        strokeWidth={icon === "check" && size === "small" ? 2.4 : undefined}
        className={styles.icon}
      />
      <span>{children}</span>
    </span>
  );
}
