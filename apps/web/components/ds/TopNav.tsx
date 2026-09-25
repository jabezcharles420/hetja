import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import styles from "./TopNav.module.css";

/**
 * Top nav. Mobile (52, the v5 audit's "Header does nothing"): logo + "Sign in". Desktop (52, >=1024px or
 * layout="desktop"): logo + the five section links at 13px with 28px gaps,
 * then Sign in. `tone="memorial"` is the muted, unfrosted /hetja variant.
 * `right` replaces the right-hand side (e.g. a Scan nav pill).
 */

export interface NavLink {
  href: string;
  label: string;
}

export const DEFAULT_NAV_LINKS: NavLink[] = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/how-it-works#feeders", label: "Feeders" },
  { href: "/how-it-works#vets", label: "Vets" },
  { href: "/privacy", label: "Privacy" },
  { href: "/faq", label: "FAQ" },
];

export interface TopNavProps {
  homeHref?: string;
  links?: NavLink[];
  signInHref?: string;
  signInLabel?: string;
  /** Hide "Sign in" (e.g. when signed in, or on the login page itself). */
  showSignIn?: boolean;
  /** Replaces the right-hand content on mobile and desktop. */
  right?: ReactNode;
  /** responsive (default) switches at 1024px; mobile/desktop pin one layout. */
  layout?: "responsive" | "mobile" | "desktop";
  /** aurora = 60% white (on aurora), solid = 72% (on white / mist). */
  surface?: "aurora" | "solid";
  tone?: "default" | "memorial";
  /** Stick to the top of the viewport (default true). */
  sticky?: boolean;
  /** The page has scrolled under the nav: solid white and a 1px hairline
   * (v5 audit: never a blurred smear). */
  scrolled?: boolean;
  /** Replaces the logo on the left, e.g. a back link on /hetja. */
  leading?: ReactNode;
  className?: string;
}

export function TopNav({
  homeHref = "/",
  links = DEFAULT_NAV_LINKS,
  signInHref = "/login",
  signInLabel = "Sign in",
  showSignIn = true,
  right,
  layout = "responsive",
  surface = "aurora",
  tone = "default",
  sticky = true,
  scrolled = false,
  leading,
  className,
}: TopNavProps): React.JSX.Element {
  const memorial = tone === "memorial";
  const cls = [
    styles.nav,
    styles[layout],
    surface === "solid" ? styles.solid : "",
    memorial ? styles.memorial : "",
    sticky ? styles.sticky : "",
    scrolled ? styles.scrolled : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={cls} data-scrolled={scrolled || undefined}>
      <div className={styles.inner}>
        {leading ?? <Logo href={homeHref} size={memorial ? 26 : 30} tone={memorial ? "memorial" : "ink"} />}
        {right ?? (
          <nav className={styles.right} aria-label="Main">
            {!memorial && (
              <ul className={styles.links}>
                {links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={styles.link}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {showSignIn && !memorial && (
              <Link href={signInHref} className={styles.signIn}>
                {signInLabel}
              </Link>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
