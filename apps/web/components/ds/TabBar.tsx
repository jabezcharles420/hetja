"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./TabBar.module.css";

/**
 * Bottom tab bar: Home / Scan / Me. Labels always visible; the active tab is
 * ink with a 22x4 ink bar above it and aria-current="page". Pages hide it on
 * focused flows (Scan, SOS, Log feed, Login, Register) by not rendering it.
 */

export type TabKey = "home" | "scan" | "me";

export interface TabItem {
  key: TabKey;
  href: string;
  label: string;
}

export const DEFAULT_TABS: TabItem[] = [
  { key: "home", href: "/", label: "Home" },
  { key: "scan", href: "/scan", label: "Scan" },
  { key: "me", href: "/me", label: "Me" },
];

export interface TabBarProps {
  /** Active tab. Omit to derive it from the current path. */
  active?: TabKey | null;
  tabs?: TabItem[];
  /** fixed (default) pins to the viewport bottom; static flows in the page. */
  position?: "fixed" | "static";
  className?: string;
}

function fromPath(path: string, tabs: TabItem[]): TabKey | null {
  const match = tabs
    .filter((t) => (t.href === "/" ? path === "/" : path === t.href || path.startsWith(t.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match ? match.key : null;
}

export function TabBar({
  active,
  tabs = DEFAULT_TABS,
  position = "fixed",
  className,
}: TabBarProps): React.JSX.Element {
  const pathname = usePathname() ?? "/";
  const current = active !== undefined ? active : fromPath(pathname, tabs);
  return (
    <nav
      aria-label="Primary"
      className={[styles.bar, position === "fixed" ? styles.fixed : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <ul className={styles.list}>
        {tabs.map((t) => {
          const on = t.key === current;
          return (
            <li key={t.key} className={styles.item}>
              <Link
                href={t.href}
                className={[styles.tab, on ? styles.active : ""].filter(Boolean).join(" ")}
                aria-current={on ? "page" : undefined}
              >
                <span className={styles.indicator} aria-hidden="true" />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
