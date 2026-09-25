// @vitest-environment jsdom
/**
 * Me, a tab root (design v4 screen 09, reshaped by the v5 audit): signed out
 * it says what signing in unlocks and has one blue Sign in; signed in it is
 * the name, the streak and links to My dogs, Register a dog, Alerts and
 * Settings. The SOS paging consent moved to Settings > Alerts and to N1
 * (SettingsPage.test.tsx, WelcomePage.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getStreak: vi.fn(),
      getFeederMe: vi.fn(),
      getMyDogs: vi.fn(),
      updateFeederMe: vi.fn(),
    },
  };
});

import MePage from "@/app/me/page";
import { api, ApiError, setAccessToken } from "@/lib/api";

const apiMock = api as unknown as {
  getStreak: ReturnType<typeof vi.fn>;
  getFeederMe: ReturnType<typeof vi.fn>;
  getMyDogs: ReturnType<typeof vi.fn>;
  updateFeederMe: ReturnType<typeof vi.fn>;
};

const STREAK = {
  trustScore: 46,
  streakDays: 23,
  badges: ["first_feed", "week_streak", "monsoon_hero"],
  lastFeedDate: "2026-09-23",
  streakStart: "2026-09-01",
  trustLevel: { name: "Trusted feeder", level: 2, nextThreshold: 50 },
};

function feederMe(overrides: Partial<{ sosOptIn: boolean; trustScore: number; displayName: string }> = {}) {
  return {
    feederId: "f1",
    displayName: "Priya",
    role: "feeder",
    trustScore: 55,
    verificationTier: "provisional",
    homeWard: null,
    canRegister: false,
    registrationBudget: { pending: 0, max: 3 },
    capabilities: [],
    sosOptIn: false,
    ...overrides,
  };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

beforeEach(() => {
  setAccessToken("tok");
  apiMock.getStreak.mockResolvedValue(STREAK);
  apiMock.getMyDogs.mockResolvedValue({ dogs: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  setAccessToken(null);
  cleanup();
});

describe("MePage: signed in", () => {
  it("greets by the hour with the feeder's first name", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 24, 9, 0));
    apiMock.getFeederMe.mockResolvedValue(feederMe({ displayName: "Priya Sharma" }));
    render(<MePage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Morning, Priya.");
  });

  it("shows the streak, the Tuesday joke with the first dog, the four badges and the trust bar", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe());
    apiMock.getMyDogs.mockResolvedValue({
      dogs: [{ slug: "ddr237xk2", name: "Bruno", wardId: "K-West", wardName: "Andheri West", lastFedAt: hoursAgo(2), myLastFedAt: hoursAgo(2) }],
    });
    render(<MePage />);
    expect(await screen.findByText("23")).not.toBeNull();
    expect(screen.getByText("day streak")).not.toBeNull();
    expect(
      screen.getByText("Fed someone every day since 1 September. Bruno still says you missed Tuesday."),
    ).not.toBeNull();
    for (const label of ["First feed", "A full week", "Monsoon feeder"]) expect(screen.getByText(label)).not.toBeNull();
    // month_streak is locked: its visible line is the countdown to 28.
    expect(screen.getByText("5 days to go")).not.toBeNull();
    expect(screen.getByText("Trusted feeder · Level 2")).not.toBeNull();
    expect(screen.getByText("Level 3 at 50")).not.toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("92");
  });

  it("links to My dogs, Register a dog, Alerts and Settings", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe());
    render(<MePage />);
    const group = await screen.findByRole("list", { name: "Your Hetja" });
    const links = within(group).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/me/dogs", "/register", "/alerts", "/settings"]);
    expect(links.map((l) => l.textContent?.replace(/\s*›$/, ""))).toEqual([
      "My dogs",
      "Register a dog",
      "Alerts",
      "Settings",
    ]);
    // The consent switch lives in Settings now: one loud button, no toggles here.
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("points the one button at the first dog not fed today", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe());
    apiMock.getMyDogs.mockResolvedValue({
      dogs: [
        { slug: "ddr237xk2", name: "Bruno", wardId: "K-West", wardName: null, lastFedAt: hoursAgo(0.05), myLastFedAt: hoursAgo(0.05) },
        { slug: "kaa234xyz", name: "Kaali", wardId: "K-West", wardName: null, lastFedAt: hoursAgo(49), myLastFedAt: hoursAgo(49) },
        { slug: "mot567abc", name: "Motu", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: hoursAgo(72) },
      ],
    });
    render(<MePage />);
    const cta = await screen.findByRole("link", { name: "Scan to log Kaali's feed" });
    expect(cta.getAttribute("href")).toBe("/scan?intent=feed&dog=kaa234xyz");
    expect(within(screen.getByRole("link", { name: /My dogs/ })).getByText("3")).not.toBeNull();
  });

  it("keeps the page when the dog list fails, with a generic button", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe());
    apiMock.getMyDogs.mockRejectedValue(new ApiError("boom", { status: 500 }));
    render(<MePage />);
    expect((await screen.findByRole("link", { name: "Scan to log a feed" })).getAttribute("href")).toBe(
      "/scan?intent=feed",
    );
  });
});

describe("MePage: signed out", () => {
  it("says Me, what signing in unlocks, a one-line reason and one blue Sign in", async () => {
    setAccessToken(null);
    render(<MePage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Me");
    expect(screen.getByText("A streak for every day you feed")).not.toBeNull();
    expect(screen.getByText("SOS alerts for hurt dogs in your wards")).not.toBeNull();
    expect(screen.getByText("No password, just a 6-digit code by email.")).not.toBeNull();
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe("/login?next=%2Fme");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(apiMock.getStreak).not.toHaveBeenCalled();
  });

  it("treats a rejected session as signed out", async () => {
    apiMock.getStreak.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    apiMock.getFeederMe.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    render(<MePage />);
    expect(await screen.findByRole("link", { name: "Sign in" })).not.toBeNull();
  });
});
