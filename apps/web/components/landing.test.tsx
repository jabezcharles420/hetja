// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

afterEach(cleanup);

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children }: { href: string; children: ReactNode }) =>
      el("a", { href }, children),
  };
});

import LandingPage from "@/app/page";
import Logo from "./Logo";

describe("landing page", () => {
  it("renders the hero with kicker, headline and sub copy", () => {
    render(createElement(LandingPage));
    expect(screen.getByText("Mumbai\u2019s street heroes")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Every street has a hero." })).toBeTruthy();
    expect(screen.getByText(/built by and for/)).toBeTruthy();
  });

  it("links the hero CTAs to scan and login", () => {
    render(createElement(LandingPage));
    const scan = screen.getByRole("link", { name: "Scan a collar" });
    expect(scan.getAttribute("href")).toBe("/scan");
    const feeders = screen.getAllByRole("link", { name: "Become a feeder" });
    expect(feeders.length).toBe(2);
    for (const feeder of feeders) {
      expect(feeder.getAttribute("href")).toBe("/login");
    }
  });

  it("shows the stats strip with honest placeholders", () => {
    render(createElement(LandingPage));
    expect(screen.getAllByText("—").length).toBe(3);
    expect(screen.getByText("dogs tracked")).toBeTruthy();
    expect(screen.getByText("feeds logged")).toBeTruthy();
    expect(screen.getByText("lives touched")).toBeTruthy();
  });

  it("renders the three how-it-works steps", () => {
    render(createElement(LandingPage));
    expect(screen.getByText("Scan")).toBeTruthy();
    expect(screen.getByText("See")).toBeTruthy();
    expect(screen.getByText("Act")).toBeTruthy();
  });

  it("navigates to a dog profile when a valid collar code is submitted", () => {
    push.mockClear();
    render(createElement(LandingPage));
    const input = screen.getByLabelText("Collar code");
    fireEvent.change(input, { target: { value: "ABC234567" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(push).toHaveBeenCalledWith("/dog/abc234567");
  });

  it("rejects an invalid collar code without navigating", () => {
    push.mockClear();
    render(createElement(LandingPage));
    const input = screen.getByLabelText("Collar code");
    fireEvent.change(input, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(/That code looks incomplete/)).toBeTruthy();
  });
});

describe("Logo", () => {
  it("renders the wordmark and a paw mark", () => {
    render(createElement(Logo, { href: "/" }));
    expect(screen.getByText("Hetja")).toBeTruthy();
    expect(document.querySelector(".h-logo-mark")).not.toBeNull();
    const link = screen.getByRole("link", { name: "Hetja" });
    expect(link.getAttribute("href")).toBe("/");
  });
});
