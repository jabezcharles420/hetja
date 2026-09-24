import type { AvatarPalette } from "./DogAvatar";
import styles from "./Badge.module.css";

/**
 * Streak badge (Me screen): a 44 pastel circle with a short mark ("1st",
 * "7", "M") and a 12px label under it. A locked badge is an outline ring in
 * secondary grey, and its visible line is the progress ("7 days to go"); the
 * badge name stays available to screen readers.
 */

export interface BadgeProps {
  /** Text inside the circle, e.g. "1st", "7", "30". */
  mark: string;
  /** Badge name, e.g. "A full week". */
  label: string;
  palette?: AvatarPalette;
  locked?: boolean;
  /** Shown instead of the name while locked, e.g. "7 days to go". */
  remaining?: string;
  className?: string;
}

export function Badge({
  mark,
  label,
  palette = "apricot",
  locked = false,
  remaining,
  className,
}: BadgeProps): React.JSX.Element {
  const visible = locked && remaining ? remaining : label;
  return (
    <div className={[styles.badge, locked ? styles.locked : "", className ?? ""].filter(Boolean).join(" ")}>
      <span className={[styles.mark, locked ? "" : styles[palette]].filter(Boolean).join(" ")} aria-hidden="true">
        {mark}
      </span>
      <span className={styles.label}>
        {locked && remaining && <span className="h-sr-only">{label}, locked. </span>}
        {visible}
      </span>
    </div>
  );
}
