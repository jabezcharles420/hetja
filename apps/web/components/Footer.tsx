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

export default function Footer(): React.JSX.Element {
  return (
    <footer className="h-footer">
      <div className="h-container h-footer-inner">
        <Logo href="/" small />
        <p className="h-footer-muted">
          Every street has a hero — the feeders, vets, and neighbours who show
          up for Mumbai&rsquo;s stray dogs.
        </p>
        <nav className="h-footer-links" aria-label="Footer">
          {NAV_LINKS.map((link, i) => (
            <Fragment key={link.href}>
              {i > 0 ? <span className="h-footer-dot">·</span> : null}
              <Link href={link.href}>{link.label}</Link>
            </Fragment>
          ))}
        </nav>
        <p className="h-footer-tagline">Built by and for Mumbai</p>
      </div>
    </footer>
  );
}
