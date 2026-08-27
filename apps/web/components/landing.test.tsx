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

// Helpers: the landing page fetches GET /api/v1/stats/impact server-side
// with next: { revalidate: 60 }. In tests we stub global fetch.
function stubFetchOk(data: { dogsTracked: number; feedsLogged: number; livesTouched: number }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data }),
    } as Response),
  );
}

function stubFetchFailure() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
}

describe("landing page", () => {
  it("renders the hero with kicker, headline and sub copy", async () => {
    stubFetchFailure();
    render(await LandingPage());
    expect(screen.getByText("Mumbai\u2019s street heroes")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Every street has a hero." })).toBeTruthy();
    expect(screen.getByText(/built by and for/)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("links the hero CTAs to scan and login", async () => {
    stubFetchFailure();
    render(await LandingPage());
    const scan = screen.getByRole("link", { name: "Scan a collar" });
    expect(scan.getAttribute("href")).toBe("/scan");
    const feeders = screen.getAllByRole("link", { name: "Become a feeder" });
    expect(feeders.length).toBe(2);
    for (const feeder of feeders) {
      expect(feeder.getAttribute("href")).toBe("/login");
    }
    vi.unstubAllGlobals();
  });

  it("shows the stats strip with honest placeholders when the API is unreachable", async () => {
    stubFetchFailure();
    render(await LandingPage());
    expect(screen.getAllByText("—").length).toBe(3);
    expect(screen.getByText("dogs tracked")).toBeTruthy();
    expect(screen.getByText("feeds logged")).toBeTruthy();
    expect(screen.getByText("lives touched")).toBeTruthy();
    // Keep existing h-stat-value styling even on fallback.
    expect(document.querySelectorAll(".h-stat-value").length).toBe(3);
    vi.unstubAllGlobals();
  });

  it("shows live impact numbers when the API succeeds", async () => {
    stubFetchOk({ dogsTracked: 42, feedsLogged: 128, livesTouched: 37 });
    render(await LandingPage());
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("128")).toBeTruthy();
    expect(screen.getByText("37")).toBeTruthy();
    expect(screen.getByText("dogs tracked")).toBeTruthy();
    expect(screen.getByText("feeds logged")).toBeTruthy();
    expect(screen.getByText("lives touched")).toBeTruthy();
    // Styling preserved
    const values = document.querySelectorAll(".h-stat-value");
    expect(values.length).toBe(3);
    expect(values[0].textContent).toBe("42");
    expect(values[1].textContent).toBe("128");
    expect(values[2].textContent).toBe("37");
    vi.unstubAllGlobals();
  });

  it("falls back to placeholders when the API returns non-ok envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, error: { message: "db hiccup" } }),
      } as unknown as Response),
    );
    render(await LandingPage());
    expect(screen.getAllByText("—").length).toBe(3);
    vi.unstubAllGlobals();
  });

  it("fetches impact stats with ISR revalidate 60", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { dogsTracked: 1, feedsLogged: 2, livesTouched: 3 } }),
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);
    render(await LandingPage());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/stats/impact");
    const opts = fetchSpy.mock.calls[0][1] as { next?: { revalidate?: number } };
    expect(opts?.next?.revalidate).toBe(60);
    vi.unstubAllGlobals();
  });

  it("renders the three how-it-works steps", async () => {
    stubFetchFailure();
    render(await LandingPage());
    expect(screen.getByText("Scan")).toBeTruthy();
    expect(screen.getByText("See")).toBeTruthy();
    expect(screen.getByText("Act")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("navigates to a dog profile when a valid collar code is submitted", async () => {
    stubFetchFailure();
    push.mockClear();
    render(await LandingPage());
    const input = screen.getByLabelText("Collar code");
    fireEvent.change(input, { target: { value: "ABC234567" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(push).toHaveBeenCalledWith("/dog/abc234567");
    vi.unstubAllGlobals();
  });

  it("rejects an invalid collar code without navigating", async () => {
    stubFetchFailure();
    push.mockClear();
    render(await LandingPage());
    const input = screen.getByLabelText("Collar code");
    fireEvent.change(input, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(/That code looks incomplete/)).toBeTruthy();
    vi.unstubAllGlobals();
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
