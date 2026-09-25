"use client";

import { usePathname } from "next/navigation";
import { Footer, TabBar, TopNav } from "@/components/ds";
import { AppHeader } from "@/components/ds/AppHeader";
import { useScrolled } from "@/components/ds/useScrolled";
import { InstallBanner } from "./InstallBanner";
import styles from "./ChromeShell.module.css";

/**
 * Global chrome, per route. Decided here and nowhere else (design v5
 * CONTRACT.md, "Routes and who owns them"; v5 audit, "Pages vs app tabs").
 *
 *   tab roots  /, /scan, /map, /alerts, /me: the five-tab TabBar. Home also
 *              has the 52px TopNav (logo + Sign in), and at desktop width the
 *              desktop nav and the Footer instead of the tab bar. /map draws
 *              the same TabBar itself, inside its sheet, so the shell draws
 *              nothing there.
 *   reading    /about, /how-it-works, /faq, /privacy, /contact: website
 *              pages. TopNav + Footer, never the tab bar.
 *   /hetja     the memorial: a calm 52px header with a back link, no tab bar,
 *              no footer.
 *   focused    every other app screen (/login, /welcome, /settings,
 *              /scan/code, /scan/find, /register/**, /me/dogs/**, /vet/**,
 *              /sos/**, /feed, /d/**, /dog/**, /design): no chrome at all.
 *              Each draws its own 52px header with a back or Cancel
 *              (components/ds AppHeader).
 *   anything else (404s, error pages): TopNav + Footer, so nobody is stranded.
 *
 * On Home and the reading pages the nav floats over the page's own first
 * section (the aurora runs behind it, as in the mocks). The shell sets
 * --page-top to the nav height there, and the pages pad their first section
 * by it. Everywhere else --page-top is 0. --tab-clear is the height of the
 * fixed tab bar when one is shown, 0 otherwise: a page pads its bottom by it.
 */

export type NavTone = "light" | "dark" | "memorial";

export type ChromeKind = "tab" | "reading" | "memorial" | "focused" | "fallback";

export interface Chrome {
  kind: ChromeKind;
  nav: NavTone | null;
  /** aurora = 60% frost over an aurora; solid = 72% frost over white. */
  navSurface: "aurora" | "solid";
  /** Nav overlays the page's first section (page pads by --page-top). */
  overlay: boolean;
  /** always = every width; desktop = at >=1024px only; null = none. */
  footer: "always" | "desktop" | null;
  /** mobile = hidden at >=1024px; always = every width; null = none. */
  tabBar: "mobile" | "always" | null;
  install: boolean;
}

/** The five tab roots (owner decision: Home, Scan, Map, Alerts, Me). */
export const TAB_ROOTS = ["/", "/scan", "/map", "/alerts", "/me"] as const;

/** Website pages: the only routes, with Home at desktop, that get the Footer. */
export const READING_ROUTES = ["/about", "/how-it-works", "/faq", "/privacy", "/contact"] as const;

/** Home plus the reading pages: the routes whose nav floats over an aurora. */
export const MARKETING_ROUTES = ["/", ...READING_ROUTES] as const;

/**
 * Focused screens, by prefix. Listed so the intent is explicit; anything
 * under an app prefix is focused, and a sub-route of a tab root (/me/dogs,
 * /scan/code) is focused too.
 */
export const FOCUSED_ROUTES = [
  "/login",
  "/welcome",
  "/settings",
  "/feed",
  "/register",
  "/vet",
  "/sos",
  "/d",
  "/dog",
  "/design",
] as const;

const NONE: Chrome = {
  kind: "focused",
  nav: null,
  navSurface: "aurora",
  overlay: false,
  footer: null,
  tabBar: null,
  install: false,
};

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(base + "/");
}

export function chromeFor(pathname: string | null | undefined): Chrome {
  const path = (pathname ?? "/").replace(/\/+$/, "") || "/";

  if (path === "/") {
    return {
      kind: "tab",
      nav: "light",
      navSurface: "aurora",
      overlay: true,
      footer: "desktop",
      tabBar: "mobile",
      install: true,
    };
  }
  if ((READING_ROUTES as readonly string[]).includes(path)) {
    return {
      kind: "reading",
      nav: path === "/privacy" ? "dark" : "light",
      navSurface: path === "/how-it-works" ? "solid" : "aurora",
      overlay: true,
      footer: "always",
      tabBar: null,
      install: true,
    };
  }
  if (under(path, "/hetja")) {
    return { ...NONE, kind: "memorial", nav: "memorial" };
  }
  // The map draws the shared TabBar inside its own sheet.
  if (under(path, "/map")) {
    return { ...NONE, kind: "tab" };
  }
  if (path === "/scan" || path === "/alerts" || path === "/me") {
    return { ...NONE, kind: "tab", tabBar: "always" };
  }
  if (
    under(path, "/scan") ||
    under(path, "/alerts") ||
    under(path, "/me") ||
    FOCUSED_ROUTES.some((base) => under(path, base))
  ) {
    return NONE;
  }
  return { ...NONE, kind: "fallback", nav: "light", navSurface: "solid", footer: "always" };
}

export function ChromeShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const chrome = chromeFor(usePathname());
  const scrolled = useScrolled();
  const navCls = [
    styles.nav,
    chrome.overlay ? styles.navOverlay : "",
    chrome.nav === "dark" ? styles.navDark : "",
  ]
    .filter(Boolean)
    .join(" ");
  const mobileOnly = chrome.tabBar === "mobile" ? styles.mobileOnly : "";

  return (
    <div
      className={[
        styles.shell,
        chrome.overlay ? styles.overlay : "",
        chrome.tabBar ? styles.withTabs : "",
        chrome.tabBar === "mobile" ? styles.withTabsMobile : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-chrome={chrome.kind}
    >
      {chrome.nav === "memorial" ? (
        <AppHeader tone="memorial" back={{ href: "/", label: "Back", history: true }} />
      ) : chrome.nav ? (
        <TopNav surface={chrome.navSurface} scrolled={scrolled} className={navCls || undefined} />
      ) : null}
      <main>{children}</main>
      {chrome.footer && (
        <Footer className={chrome.footer === "desktop" ? styles.desktopOnly : undefined} />
      )}
      {chrome.tabBar && <div className={[styles.tabSpacer, mobileOnly].filter(Boolean).join(" ")} aria-hidden="true" />}
      {chrome.install && <InstallBanner />}
      {chrome.tabBar && <TabBar className={mobileOnly || undefined} />}
    </div>
  );
}
