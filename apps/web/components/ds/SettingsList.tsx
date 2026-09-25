import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./SettingsList.module.css";

/**
 * Grouped rows on a mist page (N6 Settings, the Me hub): a white radius-20
 * card, 56px rows at 17px, a secondary value and a "›" on rows that open
 * something. Rows divide themselves; no line after the last.
 */

export function SettingsGroup({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Accessible name when the group has no visible heading. */
  label?: string;
}): React.JSX.Element {
  return (
    <ul className={[styles.group, className ?? ""].filter(Boolean).join(" ")} aria-label={label}>
      {children}
    </ul>
  );
}

export interface SettingsRowProps {
  label: ReactNode;
  /** Trailing value ("Priya S.", "SOS only"). */
  value?: ReactNode;
  /** Show the "›". Defaults on for href / onClick rows. */
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  /** danger = the red "Delete my account" row. */
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Replaces the trailing value (e.g. a Switch); the row is then static. */
  control?: ReactNode;
  sub?: ReactNode;
  /** Id for the label text, so a control can point aria-labelledby at it. */
  labelId?: string;
  subId?: string;
}

export function SettingsRow({
  label,
  value,
  chevron,
  href,
  onClick,
  tone = "default",
  disabled,
  control,
  sub,
  labelId,
  subId,
}: SettingsRowProps): React.JSX.Element {
  const interactive = !control && (href !== undefined || onClick !== undefined);
  const showChevron = chevron ?? interactive;
  const cls = [styles.row, tone === "danger" ? styles.danger : "", interactive ? styles.hit : ""]
    .filter(Boolean)
    .join(" ");
  const inner = (
    <>
      <span className={styles.text}>
        <span className={styles.label} id={labelId}>
          {label}
        </span>
        {sub ? (
          <span className={styles.sub} id={subId}>
            {sub}
          </span>
        ) : null}
      </span>
      {control ?? (
        <span className={styles.value}>
          {value}
          {showChevron ? (
            <span className={value ? styles.chev : styles.chevAlone} aria-hidden="true">
              {value ? " ›" : "›"}
            </span>
          ) : null}
        </span>
      )}
    </>
  );
  return (
    <li className={styles.item}>
      {control ? (
        <div className={cls}>{inner}</div>
      ) : href !== undefined ? (
        <Link href={href} className={cls}>
          {inner}
        </Link>
      ) : onClick ? (
        <button type="button" className={cls} onClick={onClick} disabled={disabled}>
          {inner}
        </button>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}
