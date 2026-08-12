import styles from "./PageHeader.module.css";

export interface PageHeaderProps {
  kicker: string;
  title: string;
  intro?: string;
}

export default function PageHeader({
  kicker,
  title,
  intro,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className={styles.header}>
      <div className="h-container">
        <span className={`h-pill h-pill-amber ${styles.kicker}`}>{kicker}</span>
        <h1 className={styles.title}>{title}</h1>
        {intro ? <p className={styles.intro}>{intro}</p> : null}
      </div>
    </header>
  );
}
