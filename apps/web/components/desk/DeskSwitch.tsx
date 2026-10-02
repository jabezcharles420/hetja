import styles from "./DeskSwitch.module.css";

/**
 * A page's phone layout and its desktop layout (design v9), side by side in
 * the markup: the phone one below 1024px, the desktop one from 1024px. CSS
 * decides, so the server renders the right one with no flash, and the
 * hidden one is display: none (out of the accessibility tree).
 */
export function DeskSwitch({ desk, children }: { desk: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <div className={styles.phone} data-layout="phone">{children}</div>
      <div className={styles.desk} data-layout="desk">{desk}</div>
    </>
  );
}
