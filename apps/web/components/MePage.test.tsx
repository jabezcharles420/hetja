// @vitest-environment jsdom
/**
 * Me, a tab root (v4 screen 09, the v5 audit, v6 V7 / V8 / V9 / L1):
 * signed out it says what signing in is for; a brand-new feeder gets the
 * day-one checklist; a feeder with dogs gets the name, streak, dogs and rows
 * (My dogs, Alerts with an unread count, SOS alerts, Register, Settings).
 * The SOS switch never flips silently: off opens L1 (pause), on opens N13.
 * When Hetja cannot be reached, the last copy from this phone is shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className }, children),
  };
});

vi.mock("@/lib/pwa", () => ({ subscribeToPush: vi.fn(async () => true), isStandalone: () => false }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getStreak: vi.fn(),
      getFeederMe: vi.fn(),
      getMyDogs: vi.fn(),
      getAlerts: vi.fn(),
      patchFeederMe: vi.fn(),
    },
  };
});

import MePage from "@/app/me/page";
import { api, ApiError, setAccessToken } from "@/lib/api";
import { ALERTS_SEEN_KEY, ME_CACHE_KEY } from "@/lib/me-hub";

const apiMock = api as unknown as Record<
  "getStreak" | "getFeederMe" | "getMyDogs" | "getAlerts" | "patchFeederMe",
  ReturnType<typeof vi.fn>
>;

const STREAK = {
  trustScore: 46,
  streakDays: 23,
  badges: ["first_feed", "week_streak", "monsoon_hero"],
  lastFeedDate: "2026-09-23",
  streakStart: "2026-09-01",
  trustLevel: { name: "Trusted feeder", level: 2, nextThreshold: 50 },
};

function feederMe(overrides: Record<string, unknown> = {}) {
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
    sosOptIn: true,
    wards: ["K-West"],
    ...overrides,
  };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const DOGS = [
  { slug: "ddr237xk2", name: "Bruno", wardId: "K-West", wardName: null, lastFedAt: hoursAgo(0.05), myLastFedAt: hoursAgo(0.05) },
  { slug: "kaa234xyz", name: "Kaali", wardId: "K-West", wardName: null, lastFedAt: hoursAgo(49), myLastFedAt: hoursAgo(49) },
];

beforeEach(() => {
  localStorage.clear();
  setAccessToken("tok");
  apiMock.getStreak.mockResolvedValue(STREAK);
  apiMock.getMyDogs.mockResolvedValue({ dogs: DOGS });
  apiMock.getFeederMe.mockResolvedValue(feederMe());
  apiMock.getAlerts.mockResolvedValue({ items: [] });
  apiMock.patchFeederMe.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  setAccessToken(null);
  cleanup();
});

const rows = async () => within(await screen.findByRole("list", { name: "Your Hetja" }));

describe("MePage: signed in", () => {
  it("greets by the hour with the feeder's first name", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 24, 9, 0));
    apiMock.getFeederMe.mockResolvedValue(feederMe({ displayName: "Priya Sharma" }));
    render(<MePage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Morning, Priya." })).toBeTruthy();
  });

  it("shows the streak, the badges and the trust bar", async () => {
    render(<MePage />);
    expect(await screen.findByText("23")).not.toBeNull();
    expect(screen.getByText("day streak")).not.toBeNull();
    for (const label of ["First feed", "A full week", "Monsoon feeder"]) expect(screen.getByText(label)).not.toBeNull();
    expect(screen.getByText("Trusted feeder · Level 2")).not.toBeNull();
  });

  it("lists the dogs, not fed today first, each opening its page", async () => {
    render(<MePage />);
    await screen.findByText("Kaali");
    const kaali = screen.getAllByRole("link").find((l) => l.getAttribute("href") === "/me/dogs/kaa234xyz")!;
    expect(kaali.getAttribute("href")).toBe("/me/dogs/kaa234xyz");
    expect(within(kaali).getByText(/^Fed (yesterday|\d+ days ago)$/)).toBeTruthy();
    const cta = screen.getByRole("link", { name: "Scan to log Kaali's feed" });
    expect(cta.getAttribute("href")).toBe("/scan?intent=feed&dog=kaa234xyz");
  });

  it("has rows for My dogs, Alerts, SOS alerts, Register a dog and Settings", async () => {
    render(<MePage />);
    const g = await rows();
    const links = g.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/me/dogs", "/alerts", "/register", "/settings"]);
    expect(g.getByRole("switch", { name: "SOS alerts" }).getAttribute("aria-checked")).toBe("true");
  });

  it("counts alerts newer than the last visit to Alerts", async () => {
    localStorage.setItem(ALERTS_SEEN_KEY, String(Date.now() - 3600e3));
    apiMock.getAlerts.mockResolvedValue({
      items: [
        { id: "1", kind: "fed", at: hoursAgo(0.1), dog: null, wardCode: null, actorName: null, detail: null, href: "/" },
        { id: "2", kind: "fed", at: hoursAgo(0.2), dog: null, wardCode: null, actorName: null, detail: null, href: "/" },
        { id: "3", kind: "fed", at: hoursAgo(5), dog: null, wardCode: null, actorName: null, detail: null, href: "/" },
      ],
    });
    render(<MePage />);
    const g = await rows();
    expect(await g.findByLabelText("2 new")).toBeTruthy();
  });

  it("turning SOS alerts off opens the pause sheet (L1) instead of switching off", async () => {
    render(<MePage />);
    fireEvent.click((await rows()).getByRole("switch", { name: "SOS alerts" }));
    const sheet = screen.getByRole("dialog", { name: "Need a break from alerts?" });
    expect(apiMock.patchFeederMe).not.toHaveBeenCalled();
    expect(within(sheet).getByText(/If Kaali or Bruno is hurt, other feeders and the vets in K\/W will still hear\. You won't\./)).toBeTruthy();
    expect(within(sheet).getByRole("radio", { name: /Pause until tomorrow/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(sheet).getByRole("button", { name: "Pause alerts" }));
    await waitFor(() => expect(apiMock.patchFeederMe).toHaveBeenCalledTimes(1));
    const patch = apiMock.patchFeederMe.mock.calls[0]![0] as { sosOptIn: boolean; sosPausedUntil: string };
    expect(patch.sosOptIn).toBe(true);
    expect(Date.parse(patch.sosPausedUntil)).toBeGreaterThan(Date.now());
    expect(await screen.findByText(/^Alerts paused until/)).toBeTruthy();
  });

  it("Turn off in the pause sheet switches paging off", async () => {
    render(<MePage />);
    fireEvent.click((await rows()).getByRole("switch", { name: "SOS alerts" }));
    fireEvent.click(screen.getByRole("radio", { name: "Turn off" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off alerts" }));
    await waitFor(() => expect(apiMock.patchFeederMe).toHaveBeenCalledWith({ sosOptIn: false, sosPausedUntil: null }));
  });

  it("a paused feeder sees the resume time and can resume", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosPausedUntil: new Date(Date.now() + 5 * 3600e3).toISOString() }));
    render(<MePage />);
    expect(await screen.findByText(/^Alerts paused until /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(apiMock.patchFeederMe).toHaveBeenCalledWith({ sosPausedUntil: null }));
    await waitFor(() => expect(screen.queryByText(/^Alerts paused until/)).toBeNull());
  });

  it("turning SOS alerts on shows the alerts ask (N13) first", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: false }));
    render(<MePage />);
    fireEvent.click((await rows()).getByRole("switch", { name: "SOS alerts" }));
    const ask = screen.getByRole("dialog", { name: "Know when a dog near you is hurt." });
    expect(within(ask).getByText("Only for your wards, and only when someone raises an SOS. Most weeks, that's none.")).toBeTruthy();
    fireEvent.click(within(ask).getByRole("button", { name: "Turn on alerts" }));
    await waitFor(() =>
      expect(apiMock.patchFeederMe).toHaveBeenCalledWith(
        expect.objectContaining({ sosOptIn: true, sosPausedUntil: null, wards: ["K-West"] }),
      ),
    );
  });
});

describe("MePage: day one (V8)", () => {
  it("gives a brand-new feeder the checklist, not an empty dashboard", async () => {
    apiMock.getStreak.mockResolvedValue({ ...STREAK, streakDays: 0 });
    apiMock.getMyDogs.mockResolvedValue({ dogs: [] });
    apiMock.getFeederMe.mockResolvedValue(feederMe({ wards: [] }));
    render(<MePage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Day one, Priya." })).toBeTruthy();
    expect(screen.getByText("Three things and you're set. The dogs won't notice. Their next stranger will.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Scan a dog you feed/ }).getAttribute("href")).toBe("/scan");
    expect(screen.getByText("Starts your streak")).toBeTruthy();
    expect(screen.getByText("For SOS alerts nearby")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Register one ›" }).getAttribute("href")).toBe("/register");
    expect(screen.getByRole("link", { name: "Scan a collar" }).getAttribute("href")).toBe("/scan");
    expect(screen.queryByText("day streak")).toBeNull();
  });
});

describe("MePage: offline (V9)", () => {
  it("shows the last copy from this phone with a banner and Retry", async () => {
    localStorage.setItem(
      ME_CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), streak: { streakDays: 12 }, me: feederMe(), dogs: DOGS }),
    );
    apiMock.getStreak.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<MePage />);
    expect(await screen.findByText(/^Showing (this morning's|this afternoon's|this evening's) copy\. Can't reach Hetja\.$/)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Feeds you log now are saved on this phone and sent when you're back.")).toBeTruthy();
    apiMock.getStreak.mockResolvedValue(STREAK);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Can't reach Hetja/)).toBeNull());
  });

  it("without a saved copy, says so and offers a retry", async () => {
    apiMock.getStreak.mockRejectedValue(new ApiError("Server is having a moment.", { status: 503 }));
    render(<MePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("Server is having a moment.");
  });
});

describe("MePage: signed out (V7)", () => {
  it("says what signing in is for, with one Sign in with email", async () => {
    setAccessToken(null);
    render(<MePage />);
    expect(await screen.findByRole("heading", { level: 1, name: "You probably already feed someone." })).toBeTruthy();
    expect(
      screen.getByText("Sign in to put it on the record, so a stranger who scans the collar knows the dog is looked after."),
    ).toBeTruthy();
    for (const t of [
      "Log a feed in two taps. Keep a streak.",
      "Hear when a dog in your ward is hurt.",
      "Give a dog without a collar a name and a code.",
    ])
      expect(screen.getByText(t)).toBeTruthy();
    const signIn = screen.getByRole("link", { name: "Sign in with email" });
    expect(signIn.getAttribute("href")).toBe("/login?next=%2Fme");
    expect(apiMock.getStreak).not.toHaveBeenCalled();
  });

  it("treats a rejected session as signed out", async () => {
    apiMock.getStreak.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    apiMock.getFeederMe.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    render(<MePage />);
    expect(await screen.findByRole("link", { name: "Sign in with email" })).not.toBeNull();
  });
});
