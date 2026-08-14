import { Fragment } from "react";
import Link from "next/link";
import Logo from "./Logo";

const NAV_LINKS = [
  { href: "/about", label: "About" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy" },
  { href: "/scan", label: "Scan a collar" },
  { href: "/login", label: "Become a feeder" },
  { href: "/me", label: "My streak" },
];

const SOURCE_URL = "https://github.com/jabezcharles420/hetja";

export default function Footer({
  clearBottomNav = false,
}: {
  /**
   * Reserve height for the fixed mobile bottom nav. The footer is the last
   * element in the document, so when the nav is present it overlays the footer's
   * final line — `In memory of Hetja`. Set by ChromeShell, which is the only
   * component that knows whether the nav rendered.
   */
  clearBottomNav?: boolean;
} = {}): React.JSX.Element {
  return (
    <footer
      className={`h-footer${clearBottomNav ? " h-footer-clear-nav" : ""}`}
    >
      <div className="h-container h-footer-inner">
        <Logo href="/" small />
        <p className="h-footer-muted">
          Every street has a hero — the feeders, vets, and neighbours who show
          up for Mumbai&rsquo;s stray dogs.
        </p>
        <nav className="h-footer-links" aria-label="Footer">
          {NAV_LINKS.map((link, i) => (
            <Fragment key={link.href}>
              {/* aria-hidden: this is a purely visual separator between links.
                * Without it a screen reader announces "middle dot" between every
                * footer link, which is noise standing between the user and the
                * links themselves. It is also why axe reports a `color-contrast`
                * INCOMPLETE here (#e4e4e4 on #ffffff = 1.27:1) rather than a
                * violation -- SC 1.4.3 does not apply to decorative text, and a
                * separator the assistive layer cannot see needs no contrast
                * ratio. The other decorative glyphs in this codebase
                * (Content.module.css's check marks) were already aria-hidden;
                * this one was missed. */}
              {i > 0 ? (
                <span className="h-footer-dot" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <Link href={link.href}>{link.label}</Link>
            </Fragment>
          ))}
        </nav>
        <p className="h-footer-tagline">Built by and for Mumbai</p>
        <div className="h-footer-legal">
          <Link href="/hetja">In memory of Hetja</Link>
          <span aria-hidden="true">·</span>
          <a href={SOURCE_URL} rel="noopener noreferrer">
            Source
          </a>
          <span aria-hidden="true">·</span>
          <a href={`${SOURCE_URL}/blob/main/LICENSE`} rel="noopener noreferrer">
            AGPL-3.0
          </a>
        </div>
      </div>
    </footer>
  );
}
