"use client";

import { usePathname } from "next/navigation";
import { Footer, TabBar, TopNav } from "@/components/ds";
import { AppHeader } from "@/components/ds/AppHeader";
import { useScrolled } from "@/components/ds/useScrolled";
import { DesktopInvite } from "./DesktopInvite";
import { InstallBanner } from "./InstallBanner";
import styles from "./ChromeShell.module.css";

/**
 * Global chrome, per route. Decided here and nowhere else (design v5
 * CONTRACT.md, "Routes and who owns them", with the v6 owner decisions).
 *
 *   tab roots  /, /map, /scan, /me: the four-tab TabBar (Home, Map, Scan,
 *              Me). Home also has the 52px TopNav (logo + Sign in). /map
 *              draws the same TabBar itself, inside its sheet, so the shell
 *              draws nothing there.
 *   reading    /about, /how-it-works, /faq, /privacy, /contact: website
 *              pages. TopNav + Footer, never the tab bar.
 *   /hetja     the memorial: a calm 52px header with a back link, no tab bar,
 *              no footer.
 *   focused    every other app screen (/login, /welcome, /settings, /alerts,
 *              /scan/code, /scan/find, /register/**, /me/dogs/**, /vet/**,
 *              /sos/**, /feed, /d/**, /dog/**, /design): no chrome at all.
 *              Each draws its own 52px header with a back or Cancel
 *              (components/ds AppHeader).
 *   anything else (404s): no chrome; the V1 not-found page draws its own way
 *              home.
 *
 * Wider than 744px (v6 D1): every app route shows the D1 desktop invitation
 * instead of its phone screen. Reading pages, /hetja, the SOS responder page
 * and 404s open in the phone layout centred at 480px. The print sheets and
 * /design are left alone: printing is a laptop job.
 *
 * No install card on first visits any more (v6 V23): the offer comes after
 * the first logged feed (components/AddToHomeScreen). `install` stays in the
 * shape for a future earned moment.
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
  footer: boolean;
  tabBar: boolean;
  install: boolean;
  /** Wider than 744px: invite = D1, frame = the phone layout at 480px, none = as is. */
  desktop: "invite" | "frame" | "none";
}

/** The four tab roots (v6 owner decision: Home, Map, Scan, Me). */
export const TAB_ROOTS = ["/", "/map", "/scan", "/me"] as const;

/** Website pages: the only routes that get the Footer. */
export const READING_ROUTES = ["/about", "/how-it-works", "/faq", "/privacy", "/contact"] as const;

/** Home plus the reading pages: the routes whose nav floats over an aurora. */
export const MARKETING_ROUTES = ["/", ...READING_ROUTES] as const;

/**
 * Focused screens, by prefix. Listed so the intent is explicit; a sub-route
 * of a tab root (/me/dogs, /scan/code) is focused too.
 */
export const FOCUSED_ROUTES = [
  "/login",
  "/welcome",
  "/settings",
  "/alerts",
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
  footer: false,
  tabBar: false,
  install: false,
  desktop: "invite",
};

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(base + "/");
}

/** Print sheets are laid out for paper and printed from a laptop. */
function isPrintRoute(path: string): boolean {
  return /^\/register\/[^/]+\/print(\/|$)/.test(path) || under(path, "/register/batch");
}

export function chromeFor(pathname: string | null | undefined): Chrome {
  const path = (pathname ?? "/").replace(/\/+$/, "") || "/";

  if (path === "/") {
    return {
      kind: "tab",
      nav: "light",
      navSurface: "aurora",
      overlay: true,
      footer: false,
      tabBar: true,
      install: false,
      desktop: "invite",
    };
  }
  if ((READING_ROUTES as readonly string[]).includes(path)) {
    return {
      kind: "reading",
      nav: path === "/privacy" ? "dark" : "light",
      navSurface: path === "/how-it-works" ? "solid" : "aurora",
      overlay: true,
      footer: true,
      tabBar: false,
      install: false,
      desktop: "frame",
    };
  }
  if (under(path, "/hetja")) {
    return { ...NONE, kind: "memorial", nav: "memorial", desktop: "frame" };
  }
  // The map draws the shared TabBar inside its own sheet.
  if (under(path, "/map")) {
    return { ...NONE, kind: "tab" };
  }
  if (path === "/scan" || path === "/me") {
    return { ...NONE, kind: "tab", tabBar: true };
  }
  if (under(path, "/design") || isPrintRoute(path)) {
    return { ...NONE, desktop: "none" };
  }
  // A push opens the responder page wherever the feeder is: never block it.
  if (under(path, "/sos")) {
    return { ...NONE, desktop: "frame" };
  }
  if (under(path, "/scan") || under(path, "/me") || FOCUSED_ROUTES.some((base) => under(path, base))) {
    return NONE;
  }
  return { ...NONE, kind: "fallback", desktop: "frame" };
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

  return (
    <div
      className={[styles.shell, chrome.overlay ? styles.overlay : "", chrome.tabBar ? styles.withTabs : ""]
        .filter(Boolean)
        .join(" ")}
      data-chrome={chrome.kind}
      data-desktop={chrome.desktop}
    >
      <div className={styles.app}>
        {chrome.nav === "memorial" ? (
          <AppHeader tone="memorial" back={{ href: "/", label: "Back", history: true }} />
        ) : chrome.nav ? (
          <TopNav layout="mobile" surface={chrome.navSurface} scrolled={scrolled} className={navCls || undefined} />
        ) : null}
        <main>{children}</main>
        {chrome.footer && <Footer layout="mobile" />}
        {chrome.tabBar && <div className={styles.tabSpacer} aria-hidden="true" />}
        {chrome.install && <InstallBanner />}
        {chrome.tabBar && <TabBar />}
      </div>
      {chrome.desktop === "invite" && <DesktopInvite className={styles.invite} />}
    </div>
  );
}
