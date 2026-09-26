"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { readTabRole, TAB_ROLE_EVENT, type TabRole } from "@/lib/tab-role";
import styles from "./TabBar.module.css";

/**
 * Bottom tab bar (design v5 audit, "Tab bar active state"): four tabs, Home,
 * Map, Scan, Me (v6 owner decision, 2026-09-25; Alerts moved off the bar to a
 * row on Me). Every tab is a filled
 * icon over an always-visible label; the active tab paints both in blue and
 * carries aria-current="page". 83px tall with the home-indicator area
 * (--h-tab-clear). Only the four tab roots render it (ChromeShell); focused
 * screens draw their own 52px header with a back or Cancel instead.
 */

export type TabKey = "home" | "scan" | "map" | "alerts" | "me" | "vet" | "ngo";

export interface TabItem {
  key: TabKey;
  href: string;
  label: string;
}

export const DEFAULT_TABS: TabItem[] = [
  { key: "home", href: "/", label: "Home" },
  { key: "map", href: "/map", label: "Map" },
  { key: "scan", href: "/scan", label: "Scan" },
  { key: "me", href: "/me", label: "Me" },
];

/** v7 role tab bars: Scan moves inside the Vet or NGO tab. */
export const VET_TABS: TabItem[] = [
  { key: "home", href: "/", label: "Home" },
  { key: "map", href: "/map", label: "Map" },
  { key: "vet", href: "/vet", label: "Vet" },
  { key: "me", href: "/me", label: "Me" },
];

export const NGO_TABS: TabItem[] = [
  { key: "home", href: "/", label: "Home" },
  { key: "map", href: "/map", label: "Map" },
  { key: "ngo", href: "/ngo", label: "NGO" },
  { key: "me", href: "/me", label: "Me" },
];

export function tabsForRole(role: TabRole): TabItem[] {
  return role === "ngo" ? NGO_TABS : role === "vet" ? VET_TABS : DEFAULT_TABS;
}

/** The tab role kept on this phone (lib/tab-role), read after hydration. */
export function useTabRole(): TabRole {
  const [role, setRole] = useState<TabRole>(null);
  useEffect(() => {
    const read = () => setRole(readTabRole());
    read();
    window.addEventListener(TAB_ROLE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(TAB_ROLE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return role;
}

export interface TabBarProps {
  /** Active tab. Omit to derive it from the current path. */
  active?: TabKey | null;
  /** Omit for the feeder's own tabs (four, or the vet / NGO set by role). */
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

/** Filled 24px glyphs, painted with currentColor. */
export function TabIcon({ name }: { name: TabKey }): React.JSX.Element {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    focusable: false as const,
    "data-icon": name,
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M11.36 2.7a1 1 0 0 1 1.28 0l8 6.6c.23.19.36.47.36.77V20a1.5 1.5 0 0 1-1.5 1.5H15v-6.25a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0-.75.75v6.25H4.5A1.5 1.5 0 0 1 3 20v-9.93c0-.3.13-.58.36-.77l8-6.6z"
          />
        </svg>
      );
    case "scan":
      return (
        <svg {...common}>
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.5 8.5V6A2.5 2.5 0 0 1 6 3.5h2.5M15.5 3.5H18A2.5 2.5 0 0 1 20.5 6v2.5M20.5 15.5V18a2.5 2.5 0 0 1-2.5 2.5h-2.5M8.5 20.5H6A2.5 2.5 0 0 1 3.5 18v-2.5"
          />
          <rect x="7.5" y="7.5" width="9" height="9" rx="2" fill="currentColor" />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M12 1.75a7.75 7.75 0 0 0-7.75 7.75c0 5.53 6.62 12.02 6.9 12.3a1.2 1.2 0 0 0 1.7 0c.28-.28 6.9-6.77 6.9-12.3A7.75 7.75 0 0 0 12 1.75zm0 10.5a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5z"
          />
        </svg>
      );
    case "alerts":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 2.25a6.25 6.25 0 0 0-6.25 6.25v3.7l-1.6 3.2A1.1 1.1 0 0 0 5.13 17h13.74a1.1 1.1 0 0 0 .98-1.6l-1.6-3.2V8.5A6.25 6.25 0 0 0 12 2.25zM9.2 18.5a2.9 2.9 0 0 0 5.6 0H9.2z"
          />
        </svg>
      );
    case "vet":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M9.5 3.5A1.5 1.5 0 0 1 11 2h2a1.5 1.5 0 0 1 1.5 1.5v6h6A1.5 1.5 0 0 1 22 11v2a1.5 1.5 0 0 1-1.5 1.5h-6v6A1.5 1.5 0 0 1 13 22h-2a1.5 1.5 0 0 1-1.5-1.5v-6h-6A1.5 1.5 0 0 1 2 13v-2a1.5 1.5 0 0 1 1.5-1.5h6v-6z"
          />
        </svg>
      );
    case "ngo":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 21.2l-1.3-1.2C5.9 15.7 2.75 12.8 2.75 9.2A4.95 4.95 0 0 1 7.7 4.25c1.66 0 3.26.78 4.3 2 1.04-1.22 2.64-2 4.3-2a4.95 4.95 0 0 1 4.95 4.95c0 3.6-3.15 6.5-7.95 10.8L12 21.2z"
          />
        </svg>
      );
    case "me":
      return (
        <svg {...common}>
          <circle cx="12" cy="7.75" r="4.5" fill="currentColor" />
          <path
            fill="currentColor"
            d="M3.5 20.1c0-3.9 3.8-6.6 8.5-6.6s8.5 2.7 8.5 6.6c0 .5-.4.9-.9.9H4.4a.9.9 0 0 1-.9-.9z"
          />
        </svg>
      );
  }
}

export function TabBar({
  active,
  tabs: tabsProp,
  position = "fixed",
  className,
}: TabBarProps): React.JSX.Element {
  const role = useTabRole();
  const tabs = tabsProp ?? tabsForRole(role);
  const pathname = usePathname() ?? "/";
  const current = active !== undefined ? active : fromPath(pathname, tabs);
  return (
    <nav
      aria-label="Primary"
      className={[styles.bar, position === "fixed" ? styles.fixed : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <ul className={styles.list} style={{ ["--tab-count" as string]: tabs.length }}>
        {tabs.map((t) => {
          const on = t.key === current;
          return (
            <li key={t.key} className={styles.item}>
              <Link
                href={t.href}
                className={[styles.tab, on ? styles.active : ""].filter(Boolean).join(" ")}
                aria-current={on ? "page" : undefined}
              >
                <span className={styles.icon}>
                  <TabIcon name={t.key} />
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
