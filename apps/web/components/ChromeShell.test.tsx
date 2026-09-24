// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ path: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
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

import { ChromeShell, chromeFor, MARKETING_ROUTES } from "./ChromeShell";

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
  it.each(MARKETING_ROUTES.map((r) => [r]))(
    "%s: TopNav + Footer + mobile TabBar + install card, nav over the page",
    (route) => {
      const c = chromeFor(route);
      expect(c.nav).not.toBeNull();
      expect(c.footer).toBe(true);
      expect(c.tabBar).toBe("mobile");
      expect(c.install).toBe(true);
      expect(c.overlay).toBe(true);
    },
  );

  it("privacy gets the dark nav, how it works the solid one", () => {
    expect(chromeFor("/privacy").nav).toBe("dark");
    expect(chromeFor("/how-it-works").navSurface).toBe("solid");
    expect(chromeFor("/about").nav).toBe("light");
    expect(chromeFor("/about").navSurface).toBe("aurora");
  });

  it("ignores a trailing slash", () => {
    expect(chromeFor("/faq/")).toEqual(chromeFor("/faq"));
  });

  it("/hetja: the memorial nav only, no footer, no tab bar", () => {
    expect(chromeFor("/hetja")).toMatchObject({
      nav: "memorial",
      footer: false,
      tabBar: null,
      install: false,
    });
  });

  it("/me: the tab bar only, at every width", () => {
    expect(chromeFor("/me")).toMatchObject({ nav: null, footer: false, tabBar: "always" });
  });

  it.each([
    ["/scan"],
    ["/feed"],
    ["/login"],
    ["/register"],
    ["/register/new"],
    ["/register/ab3de4fgh/print"],
    ["/d/ddr017xk2"],
    ["/d/ddr017xk2/sos"],
    ["/dog/ddr017xk2"],
    ["/map"],
    ["/map/k-w"],
    ["/design"],
  ])("%s: no chrome at all", (route) => {
    expect(chromeFor(route)).toMatchObject({
      nav: null,
      footer: false,
      tabBar: null,
      install: false,
    });
  });

  it("does not treat look-alike prefixes as focused flows", () => {
    expect(chromeFor("/designs").nav).toBe("light");
    expect(chromeFor("/mapping").footer).toBe(true);
  });

  it("unknown routes keep a way home: TopNav + Footer", () => {
    expect(chromeFor("/nowhere")).toMatchObject({ nav: "light", footer: true, tabBar: null });
  });
});

describe("ChromeShell", () => {
  it("home: TopNav, footer, tab bar, install card and the page", () => {
    renderAt("/");
    expect(topNav()).not.toBeNull();
    expect(footer()).not.toBeNull();
    expect(tabBar()).not.toBeNull();
    expect(installCard()).not.toBeNull();
    expect(screen.getByText("page body")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
  });

  it("/hetja: the memorial nav, without Sign in, footer or tab bar", () => {
    renderAt("/hetja");
    expect(screen.getByRole("link", { name: "Hetja home" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(footer()).toBeNull();
    expect(tabBar()).toBeNull();
    expect(installCard()).toBeNull();
  });

  it("/me: only the tab bar", () => {
    renderAt("/me");
    expect(topNav()).toBeNull();
    expect(screen.queryByRole("link", { name: "Hetja home" })).toBeNull();
    expect(footer()).toBeNull();
    expect(tabBar()).not.toBeNull();
    expect(screen.getByRole("link", { name: "Me" }).getAttribute("aria-current")).toBe("page");
  });

  it.each([["/scan"], ["/login"], ["/register/new"], ["/d/ddr017xk2"], ["/map"]])(
    "%s: renders the page and nothing else",
    (route) => {
      renderAt(route);
      expect(screen.getByText("page body")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Hetja home" })).toBeNull();
      expect(footer()).toBeNull();
      expect(tabBar()).toBeNull();
      expect(installCard()).toBeNull();
    },
  );

  it("wraps the page in a single <main>", () => {
    renderAt("/about");
    expect(document.querySelectorAll("main").length).toBe(1);
    expect(screen.getByRole("main").textContent).toBe("page body");
  });
});
