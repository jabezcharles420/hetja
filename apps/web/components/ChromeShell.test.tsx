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

const topNav = () => screen.queryByRole("navigation", { name: "Main" });
const tabBar = () => screen.queryByRole("navigation", { name: "Primary" });
const footer = () => screen.queryByRole("navigation", { name: "Footer" });
const installCard = () => screen.queryByRole("region", { name: "Install Hetja" });

describe("chromeFor (route matrix)", () => {
  it("the tab roots are the owner's five", () => {
    expect([...TAB_ROOTS]).toEqual(["/", "/scan", "/map", "/alerts", "/me"]);
  });

  it("/: TopNav over the aurora, mobile TabBar, the Footer only at desktop width", () => {
    expect(chromeFor("/")).toMatchObject({
      kind: "tab",
      nav: "light",
      overlay: true,
      footer: "desktop",
      tabBar: "mobile",
      install: true,
    });
  });

  it.each(READING_ROUTES.map((r) => [r]))("%s: a website page, TopNav + Footer, never the tab bar", (route) => {
    expect(chromeFor(route)).toMatchObject({
      kind: "reading",
      footer: "always",
      tabBar: null,
      overlay: true,
    });
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

  it.each([["/scan"], ["/alerts"], ["/me"]])("%s: tab root, the tab bar at every width, no nav, no footer", (route) => {
    expect(chromeFor(route)).toMatchObject({ kind: "tab", nav: null, footer: null, tabBar: "always" });
  });

  it("/map: a tab root that draws the shared TabBar in its own sheet", () => {
    expect(chromeFor("/map")).toMatchObject({ kind: "tab", nav: null, footer: null, tabBar: null });
  });

  it("/hetja: the memorial header with a back link, no footer, no tab bar", () => {
    expect(chromeFor("/hetja")).toMatchObject({
      kind: "memorial",
      nav: "memorial",
      footer: null,
      tabBar: null,
      install: false,
    });
  });

  it.each([
    ["/login"],
    ["/welcome"],
    ["/settings"],
    ["/feed"],
    ["/scan/code"],
    ["/scan/find"],
    ["/register"],
    ["/register/new"],
    ["/register/batch"],
    ["/register/ab3de4fgh/ready"],
    ["/register/ab3de4fgh/print"],
    ["/me/dogs"],
    ["/me/dogs/ab3de4fgh/status"],
    ["/me/dogs/ab3de4fgh/tag"],
    ["/vet/ab3de4fgh"],
    ["/d/ddr017xk2"],
    ["/d/ddr017xk2/sos"],
    ["/dog/ddr017xk2"],
    ["/sos"],
    ["/sos/3f1c2a9e-8d7b-4c6a-9e5f-1a2b3c4d5e6f"],
    ["/design"],
  ])("%s: focused, no chrome at all", (route) => {
    expect(chromeFor(route)).toMatchObject({
      kind: "focused",
      nav: null,
      footer: null,
      tabBar: null,
      install: false,
    });
  });

  it("does not treat look-alike prefixes as app routes", () => {
    expect(chromeFor("/designs").nav).toBe("light");
    expect(chromeFor("/mapping").footer).toBe("always");
    expect(chromeFor("/sosa").nav).toBe("light");
    expect(chromeFor("/medley").kind).toBe("fallback");
    expect(chromeFor("/scanner").kind).toBe("fallback");
  });

  it("unknown routes keep a way home: TopNav + Footer", () => {
    expect(chromeFor("/nowhere")).toMatchObject({ kind: "fallback", nav: "light", footer: "always", tabBar: null });
  });
});

describe("ChromeShell", () => {
  it("home: TopNav, footer, the five-tab bar, install card and the page", () => {
    renderAt("/");
    expect(topNav()).not.toBeNull();
    expect(footer()).not.toBeNull();
    expect(tabBar()).not.toBeNull();
    expect(installCard()).not.toBeNull();
    expect(screen.getByText("page body")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    for (const t of ["Scan", "Map", "Alerts", "Me"]) expect(screen.getByRole("link", { name: t })).toBeTruthy();
  });

  it("a reading page: TopNav and Footer, no tab bar", () => {
    renderAt("/about");
    expect(topNav()).not.toBeNull();
    expect(footer()).not.toBeNull();
    expect(tabBar()).toBeNull();
  });

  it("/hetja: a calm back link, no Sign in, footer or tab bar", () => {
    renderAt("/hetja");
    expect(screen.getByRole("link", { name: /Back/ }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(footer()).toBeNull();
    expect(tabBar()).toBeNull();
    expect(installCard()).toBeNull();
  });

  it.each([
    ["/me", "Me"],
    ["/alerts", "Alerts"],
    ["/scan", "Scan"],
  ])("%s: only the tab bar, with its tab active", (route, tab) => {
    renderAt(route);
    expect(topNav()).toBeNull();
    expect(screen.queryByRole("link", { name: "Hetja home" })).toBeNull();
    expect(footer()).toBeNull();
    expect(tabBar()).not.toBeNull();
    expect(screen.getByRole("link", { name: tab }).getAttribute("aria-current")).toBe("page");
  });

  it.each([
    ["/scan/code"],
    ["/login"],
    ["/welcome"],
    ["/settings"],
    ["/register/new"],
    ["/me/dogs"],
    ["/d/ddr017xk2"],
    ["/sos/3f1c2a9e-8d7b-4c6a-9e5f-1a2b3c4d5e6f"],
    ["/map"],
  ])("%s: renders the page and nothing else", (route) => {
    renderAt(route);
    expect(screen.getByText("page body")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Hetja home" })).toBeNull();
    expect(footer()).toBeNull();
    expect(tabBar()).toBeNull();
    expect(installCard()).toBeNull();
  });

  it("wraps the page in a single <main>", () => {
    renderAt("/about");
    expect(document.querySelectorAll("main").length).toBe(1);
    expect(screen.getByRole("main").textContent).toBe("page body");
  });
});
