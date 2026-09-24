import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./ListRow.module.css";

/**
 * List row: leading (avatar), title 17/600, optional sub 15 secondary, and a
 * trailing pill or button. Rows divide themselves with a 1px divider, never
 * after the last one, so drop them straight into a card or a <ul>.
 * Wrap a group in <ListGroup> for the mist / white rounded container.
 */

export interface ListRowProps {
  title: ReactNode;
  /** Sub line, e.g. "K/W ward · Andheri West" or "Vet · K/W ward · open till 9 pm". */
  sub?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Makes the text area a link (trailing stays separately clickable). */
  href?: string;
  /** default 72 min-height (showcase / lists with subs), compact 60 (Me), tall 76 (SOS contacts). */
  density?: "default" | "compact" | "tall";
  as?: "div" | "li";
  className?: string;
}

export function ListRow({
  title,
  sub,
  leading,
  trailing,
  href,
  density = "default",
  as: Tag = "div",
  className,
}: ListRowProps): React.JSX.Element {
  const text = (
    <>
      <div className={styles.title}>{title}</div>
      {sub && <div className={styles.sub}>{sub}</div>}
    </>
  );
  return (
    <Tag
      className={[styles.row, styles[density], className ?? ""].filter(Boolean).join(" ")}
      data-testid="list-row"
    >
      {leading && <div className={styles.leading}>{leading}</div>}
      {href ? (
        <Link href={href} className={styles.text}>
          {text}
        </Link>
      ) : (
        <div className={styles.text}>{text}</div>
      )}
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </Tag>
  );
}

export interface ListGroupProps {
  children: ReactNode;
  /** mist = inside a white card (showcase); white = on a mist page (Me). */
  tone?: "mist" | "white" | "none";
  as?: "div" | "ul";
  className?: string;
}

export function ListGroup({
  children,
  tone = "white",
  as: Tag = "div",
  className,
}: ListGroupProps): React.JSX.Element {
  return (
    <Tag className={[styles.group, styles[`g_${tone}`], className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
}
