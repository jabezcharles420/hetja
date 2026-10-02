import Link from "next/link";
import { LogoMark } from "@/components/ds";
import styles from "./DeskFooter.module.css";

/**
 * The desktop footer (design v9, the owner's "Hetja Desktop" export): the
 * brand line, eight links in three columns, the ward-level promise and the
 * source. Under every desktop page from 1024px; phones keep ds Footer.
 */
const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
  { href: "/join", label: "Vets & feeders" },
  { href: "/privacy", label: "Privacy & ledger" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/credits", label: "The people who helped" },
  { href: "/hetja", label: "In memory of Hetja" },
];

export function DeskFooter({ className }: { className?: string }): React.JSX.Element {
  return (
    <footer className={[styles.footer, className ?? ""].filter(Boolean).join(" ")}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.about}>
            <span className={styles.brand}>
              <LogoMark size={24} />
              Hetja
            </span>
            <p className={styles.blurb}>
              Open civic infrastructure for Mumbai&apos;s street dogs. Built in honour of one who walked three kilometres in
              the rain.
            </p>
          </div>
          <nav className={styles.links} aria-label="Site links">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={styles.link}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className={styles.bottom}>
          <span className={styles.promise}>
            <span className={styles.dot} aria-hidden="true" />
            Ward level, never street · AGPL-3.0 free software
          </span>
          <span>
            © 2026 Hetja ·{" "}
            <a href="https://github.com/jabezcharles420/hetja" className={styles.source} rel="noopener noreferrer">
              Source on GitHub
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
