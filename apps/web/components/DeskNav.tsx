"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/ds";
import { useDeskDialogs } from "@/components/desk/DeskDialogs";
import styles from "./DeskNav.module.css";

/**
 * The desktop header (design v9, the owner's "Hetja Desktop" export): the
 * logo, the five sections, "Look up a collar" and the "Open on phone" pill,
 * both opening the site-wide dialogs (components/desk/DeskDialogs). Sticky,
 * 56px, frosted. "Live map" leads the links: the export has no map page,
 * and the desktop map (design v8) must stay reachable
 * (docs/design/v9-desktop/CONTRACT.md).
 */
export const DESK_LINKS = [
  { href: "/map", label: "Live map" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
  { href: "/join", label: "Vets & feeders" },
  { href: "/privacy", label: "Privacy" },
  { href: "/faq", label: "FAQ" },
];

export function DeskNav({ className, fixed = false }: { className?: string; fixed?: boolean }): React.JSX.Element {
  const path = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const { openLookup, openPhone } = useDeskDialogs();
  return (
    <header className={[styles.bar, fixed ? styles.fixed : "", className ?? ""].filter(Boolean).join(" ")}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="Hetja home">
          <LogoMark size={28} />
          <span>Hetja</span>
        </Link>
        <nav className={styles.links} aria-label="Main">
          {DESK_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={[styles.link, path === l.href ? styles.current : ""].filter(Boolean).join(" ")}
              aria-current={path === l.href ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className={styles.actions}>
          <button type="button" className={styles.lookup} onClick={openLookup}>
            Look up a collar
          </button>
          <button type="button" className={styles.pill} onClick={() => openPhone()}>
            Open on phone
          </button>
        </div>
      </div>
    </header>
  );
}
