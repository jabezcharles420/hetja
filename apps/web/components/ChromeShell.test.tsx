// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ path: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      el("a", { href, ...rest }, children),
  };
});

const install = vi.hoisted(() => ({
  canInstall: true,
  promptInstall: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/lib/useInstallPrompt", () => ({
  useInstallPrompt: () => install,
}));

import { ChromeShell, chromeFor, READING_ROUTES, TAB_ROOTS } from "./ChromeShell";

afterEach(() => {
  cleanup();
  nav.path = "/";
});

function renderAt(path: string): void {
  nav.path = path;
  render(
    <ChromeShell>
      <p>page body</p>
    </ChromeShell>,
  );
}

const tabBar = () => screen.queryByRole("navigation", { name: "Primary" });
const footer = () => screen.queryByRole("navigation", { name: "Footer" });
const installCard = () => screen.queryByRole("region", { name: "Install Hetja" });
const invite = () => screen.queryByTestId("desktop-invite");

describe("chromeFor (route matrix)", () => {
  it("the tab roots are the owner's four (v6)", () => {
    expect([...TAB_ROOTS]).toEqual(["/", "/map", "/scan", "/me"]);
  });

  it("/: TopNav over the aurora and the tab bar; D1 on a desktop; no footer, no install card", () => {
    expect(chromeFor("/")).toMatchObject({
      kind: "tab",
      nav: "light",
      overlay: true,
      footer: false,
      tabBar: true,
      install: false,
      desktop: "invite",
    });
  });

  it.each(READING_ROUTES.map((r) => [r]))("%s: a website page, TopNav + Footer, the phone layout at 480px", (route) => {
    expect(chromeFor(route)).toMatchObject({ kind: "reading", footer: true, tabBar: false, overlay: true, desktop: "frame" });
    expect(chromeFor(route).nav).not.toBeNull();
  });

  it("privacy gets the dark nav, how it works the solid one", () => {
    expect(chromeFor("/privacy").nav).toBe("dark");
    expect(chromeFor("/how-it-works").navSurface).toBe("solid");
    expect(chromeFor("/about").nav).toBe("light");
    expect(chromeFor("/about").navSurface).toBe("aurora");
  });

  it("ignores a trailing slash", () => {
    expect(chromeFor("/faq/")).toEqual(chromeFor("/faq"));
    expect(chromeFor("/me/")).toEqual(chromeFor("/me"));
  });

  it.each([["/scan"], ["/me"]])("%s: tab root, the tab bar, no nav, no footer, D1 on a desktop", (route) => {
    expect(chromeFor(route)).toMatchObject({ kind: "tab", nav: null, footer: false, tabBar: true, desktop: "invite" });
  });

  it("/map: a tab root that draws the shared TabBar in its own sheet", () => {
    expect(chromeFor("/map")).toMatchObject({ kind: "tab", nav: null, footer: false, tabBar: false, desktop: "invite" });
  });

  it.each([["/vet"], ["/ngo"]])("%s: a v7 role tab root with the tab bar", (route) => {
    expect(chromeFor(route)).toMatchObject({ kind: "tab", tabBar: true, footer: false, desktop: "invite" });
  });

  it.each([["/vet/apply"], ["/vet/ab3de4fgh"], ["/ngo/register"], ["/ngo/team"]])("%s: focused", (route) => {
    expect(chromeFor(route)).toMatchObject({ kind: "focused", tabBar: false });
  });

  it("/alerts left the tab bar (v6): a focused screen reached from Me", () => {
    expect(chromeFor("/alerts")).toMatchObject({ kind: "focused", tabBar: false });
  });

  it("/hetja: the memorial header, no footer, no tab bar, framed at 480px", () => {
    expect(chromeFor("/hetja")).toMatchObject({
      kind: "memorial",
      nav: "memorial",
      footer: false,
      tabBar: false,
      desktop: "frame",
    });
  });

  it.each([
    ["/login"],
    ["/welcome"],
    ["/settings"],
    ["/alerts"],
    ["/feed"],
    ["/scan/code"],
    ["/scan/find"],
    ["/register"],
    ["/register/new"],
    ["/register/ab3de4fgh/ready"],
    ["/me/dogs"],
    ["/me/dogs/ab3de4fgh"],
    ["/me/dogs/ab3de4fgh/status"],
    ["/me/dogs/ab3de4fgh/tag"],
    ["/vet/ab3de4fgh"],
    ["/d/ddr017xk2"],
    ["/dog/ddr017xk2"],
  ])("%s: focused, no chrome at all, D1 on a desktop", (route) => {
    expect(chromeFor(route)).toMatchObject({
      kind: "focused",
      nav: null,
      footer: false,
      tabBar: false,
      install: false,
      desktop: "invite",
    });
  });

  it("the SOS responder page is never blocked by D1: framed at 480px", () => {
    expect(chromeFor("/sos/3f1c2a9e-8d7b-4c6a-9e5f-1a2b3c4d5e6f")).toMatchObject({ kind: "focused", tabBar: false, desktop: "frame" });
  });

  it.each([["/register/ab3de4fgh/print"], ["/register/batch"], ["/vet/ab3de4fgh/certificate"], ["/design"]])(
    "%s: printed or dev-only, left as it is on a desktop",
    (route) => {
      expect(chromeFor(route)).toMatchObject({ tabBar: false, desktop: "none" });
    },
  );

  it("does not treat look-alike prefixes as app routes", () => {
    expect(chromeFor("/designs").kind).toBe("fallback");
    expect(chromeFor("/mapping").kind).toBe("fallback");
    expect(chromeFor("/sosa").kind).toBe("fallback");
    expect(chromeFor("/medley").kind).toBe("fallback");
    expect(chromeFor("/scanner").kind).toBe("fallback");
  });

  it("unknown routes: no chrome (V1 draws its own way home), framed on a desktop", () => {
    expect(chromeFor("/nowhere")).toMatchObject({ kind: "fallback", nav: null, footer: false, tabBar: false, desktop: "frame" });
  });
});

describe("ChromeShell", () => {
  it("home: TopNav, the four-tab bar, D1 for wide screens, no footer, no install card", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(footer()).toBeNull();
    expect(installCard()).toBeNull();
    expect(invite()).not.toBeNull();
    const bar = tabBar();
    expect(bar).not.toBeNull();
    const tabs = Array.from(bar!.querySelectorAll("a")).map((a) => a.textContent);
    expect(tabs).toEqual(["Home", "Map", "Scan", "Me"]);
    expect(bar!.querySelector('a[aria-current="page"]')?.textContent).toBe("Home");
  });

  it("a reading page: TopNav and Footer, no tab bar, no D1", () => {
    renderAt("/about");
    expect(footer()).not.toBeNull();
    expect(tabBar()).toBeNull();
    expect(invite()).toBeNull();
  });

  it("/hetja: a calm back link, no Sign in, footer or tab bar", () => {
    renderAt("/hetja");
    expect(screen.getByRole("link", { name: /Back/ }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(footer()).toBeNull();
    expect(tabBar()).toBeNull();
  });

  it.each([
    ["/me", "Me"],
    ["/scan", "Scan"],
  ])("%s: only the tab bar, with its tab active", (route, tab) => {
    renderAt(route);
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(footer()).toBeNull();
    expect(tabBar()!.querySelector('a[aria-current="page"]')?.textContent).toBe(tab);
  });

  it.each([
    ["/scan/code"],
    ["/login"],
    ["/welcome"],
    ["/settings"],
    ["/alerts"],
    ["/register/new"],
    ["/me/dogs"],
    ["/sos/3f1c2a9e-8d7b-4c6a-9e5f-1a2b3c4d5e6f"],
    ["/map"],
  ])("%s: renders the page and no chrome", (route) => {
    renderAt(route);
    expect(screen.getByText("page body")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(footer()).toBeNull();
    expect(tabBar()).toBeNull();
  });

  it("wraps the page in a single <main>", () => {
    renderAt("/about");
    expect(document.querySelectorAll("main").length).toBe(1);
    expect(screen.getByRole("main").textContent).toBe("page body");
  });
});
