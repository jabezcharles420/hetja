import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./GroupedList.module.css";

/**
 * iOS "inset grouped" list (Settings.app) and its Sidehoe cousin, the roster
 * card. One component because they are the same anatomy (leading slot, two
 * text lines, trailing slot, hairline that starts AFTER the leading slot) at
 * two densities:
 *
 *   variant="inset"   Settings: 10px radius, 44px rows, 29px icon tiles,
 *                     small uppercase header/footer outside the card.
 *   variant="roster"  Sidehoe `.roster`: 28px radius, card shadow, 52px
 *                     avatars, 17/15 type and the grey "nudge" sub-bubble.
 *
 * The hairline lives on the row's text column, not on the <li>, which is what
 * makes it inset: it can never run under the avatar/icon. Rows become a real
 * <a>/<button> only when they do something, so a static roster stays a plain
 * list for screen readers (and the whole row, not just the chevron, is the
 * 44px target when it is interactive).
 */

export type GroupedListVariant = "inset" | "roster";

export interface GroupedListProps {
  /** Small caps label above the card (inset) or a heading above the roster. */
  header?: ReactNode;
  /** Grey explanatory note under the card. */
  footer?: ReactNode;
  variant?: GroupedListVariant;
  /** Accessible name when there is no visible header. */
  "aria-label"?: string;
  className?: string;
  children: ReactNode;
}

export function GroupedList({
  header,
  footer,
  variant = "inset",
  "aria-label": ariaLabel,
  className,
  children,
}: GroupedListProps): React.JSX.Element {
  // Server-component safe (no hooks/context): variant differences are CSS
  // only, and a string header doubles as the list's accessible name.
  const name = ariaLabel ?? (typeof header === "string" ? header : undefined);
  return (
    <div className={cx(styles.group, styles[variant], className)}>
      {header ? (
        <div className={styles.header} aria-hidden={name ? "true" : undefined}>
          {header}
        </div>
      ) : null}
      <ul className={styles.list} aria-label={name}>
        {children}
      </ul>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}

export interface ListRowProps {
  /** Avatar, <ListIcon>, or any 29–52px element. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Value text, a status pill, a <Toggle> … rendered right-aligned. */
  trailing?: ReactNode;
  /** Makes the whole row a link (internal paths use next/link). */
  href?: string;
  /** Makes the whole row a button. Ignored when `href` is set. */
  onClick?: () => void;
  /** Show the disclosure chevron. Defaults to true for `href` (navigation)
   *  rows only; iOS action rows (onClick, destructive) have none. */
  chevron?: boolean;
  /** Grey sub-bubble under the text (Sidehoe "Hetja: …" nudge). */
  nudge?: ReactNode;
  /** Red title, e.g. "Remove dog". */
  destructive?: boolean;
  className?: string;
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  href,
  onClick,
  chevron,
  nudge,
  destructive,
  className,
}: ListRowProps): React.JSX.Element {
  const showChevron = chevron ?? Boolean(href);

  const body = (
    <>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <span className={styles.content}>
        <span className={styles.text}>
          <span className={cx(styles.title, destructive && styles.destructive)}>{title}</span>
          {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
        </span>
        {trailing || showChevron ? (
          <span className={styles.trailing}>
            {trailing}
            {showChevron ? <Chevron /> : null}
          </span>
        ) : null}
        {nudge ? <span className={styles.nudge}>{nudge}</span> : null}
      </span>
    </>
  );

  let inner: React.JSX.Element;
  if (href) {
    const external = /^[a-z]+:/i.test(href);
    inner = external ? (
      <a className={cx(styles.row, styles.action)} href={href}>
        {body}
      </a>
    ) : (
      <Link className={cx(styles.row, styles.action)} href={href}>
        {body}
      </Link>
    );
  } else if (onClick) {
    inner = (
      <button type="button" className={cx(styles.row, styles.action)} onClick={onClick}>
        {body}
      </button>
    );
  } else {
    inner = <div className={styles.row}>{body}</div>;
  }

  return <li className={cx(styles.item, className)}>{inner}</li>;
}

export interface ListIconProps {
  /** Tile colour: any CSS colour/gradient; defaults to Hetja accent blue. */
  bg?: string;
  children: ReactNode;
}

/** The coloured rounded-square glyph tile of Settings.app (29pt, 7pt radius). */
export function ListIcon({ bg, children }: ListIconProps): React.JSX.Element {
  return (
    <span className={styles.icon} style={bg ? { background: bg } : undefined} aria-hidden="true">
      {children}
    </span>
  );
}

/** iOS disclosure chevron (SF "chevron.forward", 8×13 at 17pt). */
export function Chevron(): React.JSX.Element {
  return (
    <svg className={styles.chevron} viewBox="0 0 8 13" width="8" height="13" aria-hidden="true">
      <path
        d="M1.5 1.5 6.5 6.5 1.5 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
