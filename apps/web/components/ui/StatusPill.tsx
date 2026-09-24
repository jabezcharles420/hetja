import type { ReactNode } from "react";
import { ICON_NAMES, Icon, type IconName } from "./Icon";
import styles from "./StatusPill.module.css";

/**
 * <StatusPill>: Sidehoe's roster `.age` pill over the global .h-status
 * classes: "Fed today" (ok, green), "2 days" (warn, amber), "9 days" (late,
 * red), or neutral grey.
 *
 * Tone is never the only signal (WCAG 1.4.1): the text itself must say what
 * the colour means ("Overdue", "9 days"), and an icon can reinforce it.
 * Server component.
 */

export type StatusTone = "ok" | "warn" | "late" | "neutral";

export interface StatusPillProps {
  tone?: StatusTone;
  /** An icon name (rendered filled, 14px) or any node (e.g. a <Sticker>). */
  icon?: IconName | ReactNode;
  children: ReactNode;
  className?: string;
}

function isIconName(v: unknown): v is IconName {
  return typeof v === "string" && (ICON_NAMES as string[]).includes(v);
}

export function StatusPill({ tone = "neutral", icon, children, className }: StatusPillProps): React.JSX.Element {
  const cls = ["h-status", tone !== "neutral" ? `h-status-${tone}` : "", styles.pill, className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} data-tone={tone}>
      {isIconName(icon) ? <Icon name={icon} weight="fill" size={14} className={styles.icon} /> : icon}
      {children}
    </span>
  );
}
