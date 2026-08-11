import { mapStreak, type StreakData } from "@/lib/streak";
import styles from "./StreakBadge.module.css";

export interface StreakBadgeProps {
  data: StreakData;
}

export default function StreakBadge({ data }: StreakBadgeProps): React.JSX.Element {
  const view = mapStreak(data);

  return (
    <div className={styles.badge}>
      <div className={`${styles.flame} ${styles[`level-${view.streakLevel}`]}`} aria-hidden="true">
        🔥
      </div>
      <div className={styles.meta}>
        <p className={styles.streak}>
          <strong>{view.streakDays}</strong> day{view.streakDays === 1 ? "" : "s"}
        </p>
        <p className={styles.label}>{view.streakLabel}</p>
        {view.nextMilestone && <p className={styles.next}>{view.nextMilestone}</p>}
      </div>
      {view.badges.length > 0 && (
        <ul className={styles.badges}>
          {view.badges.map((b) => (
            <li key={b.key} className={styles.badgePill}>
              {b.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
