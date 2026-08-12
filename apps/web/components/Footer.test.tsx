// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children }: { href: string; children: ReactNode }) =>
      el("a", { href }, children),
  };
});

import Footer from "./Footer";

describe("Footer", () => {
  it("links to the info pages", () => {
    render(createElement(Footer));
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe("/about");
    expect(screen.getByRole("link", { name: "How it works" }).getAttribute("href")).toBe("/how-it-works");
    expect(screen.getByRole("link", { name: "FAQ" }).getAttribute("href")).toBe("/faq");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
  });

  it("keeps the product links", () => {
    render(createElement(Footer));
    expect(screen.getByRole("link", { name: "Scan a collar" }).getAttribute("href")).toBe("/scan");
    expect(screen.getByRole("link", { name: "Become a feeder" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "My streak" }).getAttribute("href")).toBe("/me");
  });

  it("shows the tagline", () => {
    render(createElement(Footer));
    expect(screen.getByText("Built by and for Mumbai")).toBeTruthy();
  });
});
