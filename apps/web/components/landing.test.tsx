// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      el("a", { href, ...rest }, children),
  };
});

import LandingPage from "@/app/page";
import { formatCount, getImpactStats } from "@/app/_home/impact";

// The home page fetches GET /api/v1/stats/impact server-side with
// next: { revalidate: 60 }. Tests stub global fetch.
function stubFetchOk(data: { dogsTracked: number; feedsLogged: number; livesTouched: number }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data }) } as Response),
  );
}

function stubFetchFailure() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

describe("home page (Pages 01 + Landing 18)", () => {
  it("renders the hero: badge, headline and the two-tone lead", async () => {
    stubFetchFailure();
    render(await LandingPage());
    expect(screen.getByText("for Mumbai's street dogs")).toBeTruthy();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent?.replace(/\s+/g, " ").trim()).toBe("Every street has a hero.");
    const ink = screen.getByText(
      "See who they are, if they've eaten, and whether they've had their shots.",
    );
    expect(ink.tagName).toBe("SPAN");
    expect(text()).toContain(
      "Scan the QR on a dog's collar. See who they are, if they've eaten, and whether they've had their shots. Then carry on with your day, slightly more attached.",
    );
  });

  it("links Scan a collar and the type-a-code link to /scan, and Become a feeder to /login", async () => {
    stubFetchFailure();
    render(await LandingPage());
    expect(screen.getByRole("link", { name: "Scan a collar" }).getAttribute("href")).toBe("/scan");
    expect(screen.getByRole("link", { name: /Or type a collar code/ }).getAttribute("href")).toBe(
      "/scan#code",
    );
    expect(screen.getByRole("link", { name: /Become a feeder/ }).getAttribute("href")).toBe("/login");
  });

  it("shows honest '-' placeholders, never the mock's 412 / 1,086, when the API is unreachable", async () => {
    stubFetchFailure();
    render(await LandingPage());
    expect(screen.getByTestId("stat-dogs").textContent).toBe("-");
    expect(screen.getByTestId("stat-feeds").textContent).toBe("-");
    expect(screen.getByText("dogs with collars")).toBeTruthy();
    expect(screen.getByText("feeds logged")).toBeTruthy();
    expect(text()).not.toContain("412");
    expect(text()).not.toContain("1,086");
  });

  it("shows live counts, Indian-grouped, when the API succeeds", async () => {
    stubFetchOk({ dogsTracked: 412, feedsLogged: 125086, livesTouched: 37 });
    render(await LandingPage());
    expect(screen.getByTestId("stat-dogs").textContent).toBe("412");
    expect(screen.getByTestId("stat-feeds").textContent).toBe("1,25,086");
  });

  it("falls back to placeholders on a non-ok envelope, an HTTP error or a bad payload", async () => {
    for (const res of [
      { ok: true, json: async () => ({ ok: false, error: { message: "db hiccup" } }) },
      { ok: false, json: async () => ({}) },
      { ok: true, json: async () => ({ ok: true, data: { dogsTracked: "12", feedsLogged: 1, livesTouched: 1 } }) },
      { ok: true, json: async () => ({ ok: true, data: { dogsTracked: Infinity, feedsLogged: 1, livesTouched: 1 } }) },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res as unknown as Response));
      render(await LandingPage());
      expect(screen.getByTestId("stat-dogs").textContent).toBe("-");
      expect(screen.getByTestId("stat-feeds").textContent).toBe("-");
      cleanup();
    }
  });

  it("fetches impact stats once, with ISR revalidate 60", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { dogsTracked: 1, feedsLogged: 2, livesTouched: 3 } }),
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);
    render(await LandingPage());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0] as string).toContain("/api/v1/stats/impact");
    const opts = fetchSpy.mock.calls[0][1] as { next?: { revalidate?: number } };
    expect(opts?.next?.revalidate).toBe(60);
  });

  it("ships every line of the home copy (mobile and desktop wording)", async () => {
    stubFetchFailure();
    render(await LandingPage());
    const body = text();
    for (const line of [
      "Hetja",
      "Today in Mumbai",
      "Today in Mumbai.",
      "Bruno was fed 3 times today. He will tell you it was zero.",
      "Three steps. No app to install.",
      "It's a website. It works on the phone you already have.",
      "Scan the collar.",
      "Any phone camera. Or type the 9 letters printed under the QR.",
      "Meet the dog.",
      "Name, ward, shots, and a few lines from the people who feed them. Usually about biscuits.",
      "Help, if they need it.",
      "One red button tells nearby feeders and a vet. You don't need an account for that.",
      "For the people who already show up.",
      "Feeders keep a streak.",
      "Log each feed in two taps. Other feeders on your lane see it, so nobody gets double dinner. In theory.",
      "Two taps per feed. Others on your lane see it, so nobody gets double dinner. In theory.",
      "23",
      "days",
      "Vets write it once.",
      "Medical records can't be edited or deleted. Corrections are added on top, with a name and date.",
      "Medical records can't be edited or deleted. Corrections go on top, with a name and a date.",
      "Anti-rabies vaccine",
      "12 Mar 2026",
      "Dr. A. Mehta · locked",
      "Bruno",
      "K/W ward · Andheri West",
      "Vaccinated",
      "Sterilised",
      "Scared of scooters, not of cats.",
      "Collar code",
      "Bruno turned up in 2019 and decided the lane was his.",
      "This dog needs help",
      "Kaali · guards the chaiwala",
      "Fed 3 times. Claims zero.",
      "Motu · sterilised 2024",
      "Rani · afraid of pigeons",
      "Sheru · 11 years on the job",
      "Ward, not street.",
      "Hetja never shows where a dog sleeps. Collar codes are random, so nobody can list every dog in the city. A register of strays can protect them or target them. We built it for the first one.",
      "Read the privacy page",
    ]) {
      expect(body, line).toContain(line);
    }
    expect(body).toMatch(/DDR\s*017\s*XK2/);
    expect(body).not.toContain("\u2014");
  });

  it("links the privacy band to /privacy", async () => {
    stubFetchFailure();
    render(await LandingPage());
    expect(screen.getByRole("link", { name: /Read the privacy page/ }).getAttribute("href")).toBe(
      "/privacy",
    );
  });
});

describe("impact helpers", () => {
  it("formatCount groups the Indian way and shows '-' for missing values", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1086)).toBe("1,086");
    expect(formatCount(125000)).toBe("1,25,000");
    expect(formatCount(null)).toBe("-");
    expect(formatCount(undefined)).toBe("-");
    expect(formatCount(Number.NaN)).toBe("-");
  });

  it("getImpactStats returns null on a negative count", async () => {
    stubFetchOk({ dogsTracked: -1, feedsLogged: 2, livesTouched: 3 });
    expect(await getImpactStats()).toBeNull();
  });

  it("getImpactStats returns the three counts on success", async () => {
    stubFetchOk({ dogsTracked: 4, feedsLogged: 5, livesTouched: 6 });
    expect(await getImpactStats()).toEqual({ dogsTracked: 4, feedsLogged: 5, livesTouched: 6 });
  });
});
