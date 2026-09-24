import styles from "./PageHeader.module.css";

/**
 * Reading-page header in the v4 language (Pages 12): a white kicker pill,
 * the 40px page title and a secondary lead. Used by the register screens;
 * the marketing pages build their headers inline over their own aurora.
 */

export interface PageHeaderProps {
  kicker: string;
  title: string;
  intro?: string;
}

export default function PageHeader({ kicker, title, intro }: PageHeaderProps): React.JSX.Element {
  return (
    <header className={styles.header}>
      <div className={`h-container ${styles.inner}`}>
        <span className={styles.kicker}>{kicker}</span>
        <h1 className={styles.title}>{title}</h1>
        {intro ? <p className={styles.intro}>{intro}</p> : null}
      </div>
    </header>
  );
}
