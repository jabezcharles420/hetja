// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/scan",
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: (props: {
      href: string;
      children: ReactNode;
      className?: string;
      "aria-current"?: "page";
    }) => el("a", props),
  };
});

import { BottomNav } from "./BottomNav";

describe("BottomNav", () => {
  afterEach(cleanup);

  it("renders Home, Scan and Me with correct deep links", () => {
    render(createElement(BottomNav));
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Scan" }).getAttribute("href")).toBe("/scan");
    expect(screen.getByRole("link", { name: "Me" }).getAttribute("href")).toBe("/me");
  });

  it("marks the active item for the current route", () => {
    render(createElement(BottomNav));
    expect(screen.getByRole("link", { name: "Scan" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).hasAttribute("aria-current")).toBe(false);
    expect(screen.getByRole("link", { name: "Me" }).hasAttribute("aria-current")).toBe(false);
  });
});
