"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { useScrolled } from "./useScrolled";
import styles from "./AppHeader.module.css";

/**
 * The 52px header of a focused screen (design v5 audit, "Header does
 * nothing"): a back link ("‹ Me") or "Cancel" on the left, an optional
 * centred title and an optional trailing action ("+ Register"). Focused
 * screens have no tab bar and no footer; this is their only way out.
 *
 * It sits on the page's own background and turns solid white with a 1px
 * hairline once the page scrolls under it, never a blurred smear.
 */

export interface AppHeaderBack {
  /** Where the link goes. With `history`, used only when there is no history. */
  href: string;
  /** "Me", "Rani", "Scan". Rendered as "‹ Me". */
  label: string;
  /** Go back in history when the previous page was on this site. */
  history?: boolean;
}

export interface AppHeaderProps {
  back?: AppHeaderBack;
  /** "Cancel" (no chevron) instead of a back link. */
  cancel?: { href?: string; onClick?: () => void; label?: string };
  title?: ReactNode;
  trailing?: ReactNode;
  /** memorial = the calm /hetja variant: ink, no blue. */
  tone?: "default" | "memorial";
  /** Background before the page scrolls (the page's own colour by default). */
  surface?: "none" | "mist" | "white";
  sticky?: boolean;
  className?: string;
}

function sameOriginReferrer(): boolean {
  try {
    return !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function AppHeader({
  back,
  cancel,
  title,
  trailing,
  tone = "default",
  surface = "none",
  sticky = true,
  className,
}: AppHeaderProps): React.JSX.Element {
  const router = useRouter();
  const scrolled = useScrolled();

  const onBack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!back?.history) return;
    if (window.history.length > 1 && sameOriginReferrer()) {
      e.preventDefault();
      router.back();
    }
  };

  let leading: ReactNode = null;
  if (back) {
    leading = (
      <Link href={back.href} className={styles.action} onClick={onBack}>
        <span aria-hidden="true">{"‹ "}</span>
        {back.label}
      </Link>
    );
  } else if (cancel) {
    const label = cancel.label ?? "Cancel";
    leading = cancel.href ? (
      <Link href={cancel.href} className={styles.action} onClick={cancel.onClick}>
        {label}
      </Link>
    ) : (
      <button type="button" className={styles.action} onClick={cancel.onClick}>
        {label}
      </button>
    );
  }

  return (
    <header
      className={[
        styles.header,
        styles[`s_${surface}`],
        tone === "memorial" ? styles.memorial : "",
        sticky ? styles.sticky : "",
        scrolled ? styles.scrolled : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-scrolled={scrolled || undefined}
    >
      <div className={styles.inner}>
        <div className={styles.side}>{leading}</div>
        {title ? <div className={styles.title}>{title}</div> : null}
        <div className={`${styles.side} ${styles.end}`}>{trailing}</div>
      </div>
    </header>
  );
}
