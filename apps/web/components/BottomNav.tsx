"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./BottomNav.module.css";

const ITEMS = [
  { href: "/", label: "Home" },
  { href: "/scan", label: "Scan" },
  { href: "/me", label: "Me" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

/**
 * Mobile bottom navigation (Home · Scan · Me). Hidden above 768px where the
 * header links take over; the Scan item deep-links to /scan.
 */
export function BottomNav(): React.JSX.Element {
  const pathname = usePathname() ?? "/";

  return (
    <nav className={styles.nav} aria-label="Primary">
      <ul className={styles.list}>
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className={styles.item}>
              <Link
                href={item.href}
                className={`${styles.link}${active ? ` ${styles.active}` : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span className={styles.label}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
