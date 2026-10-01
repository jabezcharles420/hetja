import Link from "next/link";
import { LogoMark } from "@/components/ds";
import styles from "./DeskFooter.module.css";

/**
 * The desktop footer (design v8): the owner's Stitch footer in the design
 * system. The network blurb, two link columns, the dedication. Under the map
 * and on the reading pages from 1024px; phones keep ds Footer.
 */
const NETWORK = [
  { href: "/map", label: "Wards and map" },
  { href: "/join#feeders", label: "Feeder registries" },
  { href: "/how-it-works", label: "Collar verification" },
  { href: "/hetja", label: "Memorial wall" },
];

const LEDGER = [
  { href: "/about", label: "Vaccination chain" },
  { href: "https://github.com/jabezcharles420/hetja", label: "Transparency audit" },
  { href: "/privacy", label: "Privacy and data ethics" },
  { href: "/", label: "Mobile field companion" },
];

const MORE = [
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/credits", label: "The people who helped" },
];

function Col({ title, links }: { title: string; links: { href: string; label: string }[] }): React.JSX.Element {
  return (
    <div className={styles.col}>
      <h2 className={styles.colTitle}>{title}</h2>
      <ul className={styles.links}>
        {links.map((l) => (
          <li key={l.label}>
            {l.href.startsWith("http") ? (
              <a href={l.href} className={styles.link} rel="noopener noreferrer">
                {l.label}
              </a>
            ) : (
              <Link href={l.href} className={styles.link}>
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DeskFooter({ className }: { className?: string }): React.JSX.Element {
  return (
    <footer className={[styles.footer, className ?? ""].filter(Boolean).join(" ")}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.about}>
            <span className={styles.brand}>
              <LogoMark size={28} />
              Hetja network
            </span>
            <p className={styles.blurb}>
              Open civic infrastructure connecting municipal feeder networks, veterinary rapid responders, and street
              canine guardians across Greater Mumbai. Built in honour of Mumbai&rsquo;s unsung community dogs.
            </p>
            <p className={styles.badges}>
              <span className={styles.badge}>
                <span className={styles.dot} aria-hidden="true" />
                Ward level, never street
              </span>
              <span aria-hidden="true">·</span>
              <span>AGPL-3.0 free software</span>
            </p>
          </div>
          <Col title="Network index" links={NETWORK} />
          <Col title="Civic ledger" links={LEDGER} />
          <Col title="More" links={MORE} />
        </div>
        <div className={styles.bottom}>
          <p>Dedicated with reverence to the community dogs of Mumbai and the caretakers who sustain them through every monsoon.</p>
          <p>© 2026 Hetja. Open source under AGPL-3.0.</p>
        </div>
      </div>
    </footer>
  );
}
