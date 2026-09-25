"use client";

import { usePathname } from "next/navigation";
import { Footer, TabBar, TopNav } from "@/components/ds";
import { InstallBanner } from "./InstallBanner";
import styles from "./ChromeShell.module.css";

/**
 * Global chrome, per route (design v4 handoff: TopNav / TabBar / Footer).
 *
 *   marketing  /, /about, /how-it-works, /faq, /privacy, /contact
 *              TopNav + Footer + TabBar (TabBar mobile only: at >=1024px the
 *              desktop nav links take over) + the install card.
 *   /hetja     the muted memorial TopNav only. The mock (Pages 17) shows no
 *              footer and no tab bar, so none is drawn.
 *   /me        TabBar only.
 *   focused    /scan, /feed, /login, /register/**, /d/**, /dog/**, /sos/**
 *              and /design: no chrome at all. Those screens draw their own
 *              back / cancel. /sos/<caseId> is the responder's case page that
 *              SOS pushes open (worker: url /sos/<caseId>); SOS screens are
 *              focused flows (handoff: hide the TabBar on SOS).
 *   /map       no chrome either: the map draws its own nav, chips, sheet and
 *              tab bar (screen 19).
 *   anything else (404s, error pages): TopNav + Footer, so nobody is stranded.
 *
 * On marketing pages the nav floats over the page's own first section (the
 * aurora has to run behind the frosted bar, as in the mocks). The shell sets
 * --page-top to the nav height there, and the pages pad their first section
 * by it. Everywhere else --page-top is 0.
 */

export type NavTone = "light" | "dark" | "memorial";

export interface Chrome {
  nav: NavTone | null;
  /** aurora = 60% frost over an aurora; solid = 72% frost over white. */
  navSurface: "aurora" | "solid";
  /** Nav overlays the page's first section (page pads by --page-top). */
  overlay: boolean;
  footer: boolean;
  /** mobile = hidden at >=1024px; always = every width; null = none. */
  tabBar: "mobile" | "always" | null;
  install: boolean;
}

export const MARKETING_ROUTES = [
  "/",
  "/about",
  "/how-it-works",
  "/faq",
  "/privacy",
  "/contact",
] as const;

const FOCUSED_ROUTES = ["/scan", "/feed", "/login", "/register", "/d", "/dog", "/sos", "/map", "/design"];

const NONE: Chrome = {
  nav: null,
  navSurface: "aurora",
  overlay: false,
  footer: false,
  tabBar: null,
  install: false,
};

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(base + "/");
}

export function chromeFor(pathname: string | null | undefined): Chrome {
  const path = (pathname ?? "/").replace(/\/+$/, "") || "/";

  if ((MARKETING_ROUTES as readonly string[]).includes(path)) {
    return {
      nav: path === "/privacy" ? "dark" : "light",
      navSurface: path === "/how-it-works" ? "solid" : "aurora",
      overlay: true,
      footer: true,
      tabBar: "mobile",
      install: true,
    };
  }
  if (under(path, "/hetja")) {
    // Overlay so the memorial background runs behind the unfrosted nav.
    return { ...NONE, nav: "memorial", overlay: true };
  }
  if (under(path, "/me")) {
    return { ...NONE, tabBar: "always" };
  }
  if (FOCUSED_ROUTES.some((base) => under(path, base))) {
    return NONE;
  }
  return { ...NONE, nav: "light", navSurface: "solid", footer: true };
}

export function ChromeShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const chrome = chromeFor(usePathname());
  const navCls = [
    styles.nav,
    chrome.overlay ? styles.navOverlay : "",
    chrome.nav === "dark" ? styles.navDark : "",
  ]
    .filter(Boolean)
    .join(" ");
  const tabCls = [
    chrome.tabBar === "mobile" ? styles.mobileOnly : "",
    // 92% white over a black page reads as #ebebeb, which drops the inactive
    // tab labels to 4.25:1. On the black page the bar is solid white.
    chrome.nav === "dark" ? styles.tabSolid : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={[styles.shell, chrome.overlay ? styles.overlay : ""].filter(Boolean).join(" ")}
      data-chrome={chrome.nav ?? (chrome.tabBar ? "tabbar" : "none")}
    >
      {chrome.nav && (
        <TopNav
          tone={chrome.nav === "memorial" ? "memorial" : "default"}
          surface={chrome.navSurface}
          sticky={chrome.nav !== "memorial"}
          className={navCls || undefined}
        />
      )}
      <main>{children}</main>
      {chrome.footer && <Footer />}
      {chrome.tabBar && (
        <div
          className={[styles.tabSpacer, chrome.tabBar === "mobile" ? styles.mobileOnly : ""]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        />
      )}
      {chrome.install && <InstallBanner />}
      {chrome.tabBar && <TabBar className={tabCls || undefined} />}
    </div>
  );
}
