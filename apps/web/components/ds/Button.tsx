import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

/**
 * The one button. Variants map 1:1 to the handoff's Buttons card: `primary`
 * (blue, the one loud action), `sos` (red, SOS only, with the white "!"
 * circle), `quiet`, `tinted` (the "Call" button), `link` and `navPill`.
 *
 * `href` renders a link (Next <Link> for internal paths, a plain <a> for
 * tel:, mailto: and absolute URLs) so a navigation is never a <button>.
 */

export type ButtonVariant = "primary" | "sos" | "quiet" | "tinted" | "link" | "navPill";

interface CommonProps {
  variant?: ButtonVariant;
  /** `hero` = the 58px home-hero primary; `lg` = 48px quiet/tinted. */
  size?: "default" | "hero" | "lg";
  fullWidth?: boolean;
  /** Appends " ›" (used on text links such as "Or type a collar code ›"). */
  chevron?: boolean;
  /** sos only: the white "!" circle (default true; the mock's "Send SOS" has none). */
  bang?: boolean;
  /** primary only: the blue shadow (default true; off inside the scan sheet). */
  shadow?: boolean;
  className?: string;
  children: ReactNode;
}

export type ButtonProps = CommonProps &
  (
    | ({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>)
    | ({ href: string } & AnchorHTMLAttributes<HTMLAnchorElement>)
  );

function isExternal(href: string): boolean {
  return /^(https?:|tel:|mailto:|sms:|\/\/)/i.test(href);
}

export function Button(props: ButtonProps): React.JSX.Element {
  const {
    variant = "primary",
    size = "default",
    fullWidth = false,
    chevron = false,
    bang = true,
    shadow = true,
    className,
    children,
    ...rest
  } = props;

  const cls = [
    styles.btn,
    styles[variant],
    size !== "default" ? styles[size] : "",
    fullWidth ? styles.full : "",
    shadow ? "" : styles.flat,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = (
    <>
      {variant === "sos" && bang && (
        <span className={styles.bang} aria-hidden="true" data-testid="sos-bang">
          !
        </span>
      )}
      {children}
      {chevron && <span aria-hidden="true">{" ›"}</span>}
    </>
  );

  if (rest.href !== undefined) {
    const { href, ...anchor } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string;
    };
    if (isExternal(href)) {
      return (
        <a href={href} className={cls} {...anchor}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} {...anchor}>
        {inner}
      </Link>
    );
  }

  const { type = "button", ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} className={cls} {...button}>
      {inner}
    </button>
  );
}
