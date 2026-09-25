import Link from "next/link";
import styles from "./Footer.module.css";

/**
 * Site footer on mist: 15px ink links stacked one per 44px row (v5 audit),
 * a hairline, the secondary links, then the tagline. Reading pages only
 * (About, How it works, FAQ, Privacy, Contact) and Home at desktop width. At >=1024px (or layout="desktop") it
 * collapses to the desktop mock's single 13px line.
 */

export interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

export const SOURCE_URL = "https://github.com/jabezcharles420/hetja";

export const FOOTER_PRIMARY: FooterLink[] = [
  { href: "/about", label: "About" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy" },
  { href: "/contact", label: "Contact" },
];

export const FOOTER_SECONDARY: FooterLink[] = [
  { href: "/hetja", label: "In memory of Hetja" },
  { href: SOURCE_URL, label: "Source on GitHub", external: true },
  { href: `${SOURCE_URL}/blob/main/LICENSE`, label: "AGPL-3.0", external: true },
];

export interface FooterProps {
  primary?: FooterLink[];
  secondary?: FooterLink[];
  /** Mobile tagline line under the secondary links. */
  tagline?: string;
  /** Desktop one-line footer's closing item. */
  desktopTagline?: string;
  layout?: "responsive" | "mobile" | "desktop";
  /** Reserve room for a fixed TabBar below it. */
  clearTabBar?: boolean;
  className?: string;
}

function FLink({ link, className }: { link: FooterLink; className: string }): React.JSX.Element {
  return link.external ? (
    <a href={link.href} className={className} rel="noopener noreferrer" target="_blank">
      {link.label}
    </a>
  ) : (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

export function Footer({
  primary = FOOTER_PRIMARY,
  secondary = FOOTER_SECONDARY,
  tagline = "Free, open source, built in Mumbai.",
  desktopTagline = "Built in Mumbai",
  layout = "responsive",
  clearTabBar = false,
  className,
}: FooterProps): React.JSX.Element {
  return (
    <footer
      className={[styles.footer, styles[layout], clearTabBar ? styles.clear : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.inner}>
        <nav aria-label="Footer" className={styles.primary}>
          {primary.map((l) => (
            <FLink key={l.href} link={l} className={styles.pLink} />
          ))}
        </nav>
        <div className={styles.secondary}>
          {secondary.map((l) => (
            <FLink key={l.href} link={l} className={styles.sLink} />
          ))}
          <span className={styles.deskTag}>{desktopTagline}</span>
        </div>
        <p className={styles.tagline}>{tagline}</p>
      </div>
    </footer>
  );
}
