// @vitest-environment jsdom
/**
 * Me (design v4, screen 09), plus the SOS paging consent it keeps.
 *
 * The consent gap these exist for: `feeders.sos_opt_in` defaults to false, the
 * SOS fan-out (routes/sos.ts) pages only feeders who have it set, and
 * `PATCH /api/v1/feeders/me` is its only writer. Until a web surface called it,
 * every feeder was permanently opted out.
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

describe("MePage: design v4", () => {
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

  it("lists dogs not fed today first and points the button at the first of them", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe());
    apiMock.getMyDogs.mockResolvedValue({
      dogs: [
        { slug: "ddr237xk2", name: "Bruno", wardId: "K-West", wardName: null, lastFedAt: hoursAgo(0.05), myLastFedAt: hoursAgo(0.05) },
        { slug: "kaa234xyz", name: "Kaali", wardId: "K-West", wardName: null, lastFedAt: hoursAgo(49), myLastFedAt: hoursAgo(49) },
        { slug: "mot567abc", name: "Motu", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: hoursAgo(72) },
      ],
    });
    render(<MePage />);
    await screen.findByText("Kaali");
    const rows = screen.getAllByTestId("list-row");
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["Kaali", "Motu", "Bruno"]);
    expect(within(rows[0]!).getByText("Not fed today")).not.toBeNull();
    expect(within(rows[2]!).getByText(/^Fed (just now|\d+m ago)$/)).not.toBeNull();
    const cta = screen.getByRole("link", { name: "Scan to log Kaali's feed" });
    expect(cta.getAttribute("href")).toBe("/scan?intent=feed&dog=kaa234xyz");
    // Profiles live on the /d/ app.
    expect(within(rows[0]!).getByRole("link").getAttribute("href")).toBe("/d/kaa234xyz");
  });

  it("keeps the page when the dog list fails, with a generic button", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe());
    apiMock.getMyDogs.mockRejectedValue(new ApiError("boom", { status: 500 }));
    render(<MePage />);
    expect(await screen.findByText(/No dogs yet/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Scan to log a feed" }).getAttribute("href")).toBe("/scan?intent=feed");
  });

  it("gives a signed-out visitor a friendly card and a Sign in button, and no consent control", async () => {
    setAccessToken(null);
    render(<MePage />);
    expect(await screen.findByText("Hello, stranger.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login?next=%2Fme");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(apiMock.getStreak).not.toHaveBeenCalled();
  });

  it("treats a rejected session as signed out", async () => {
    apiMock.getStreak.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    apiMock.getFeederMe.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    render(<MePage />);
    expect(await screen.findByText("Hello, stranger.")).not.toBeNull();
  });
});

describe("MePage: SOS paging consent (the quiet settings row)", () => {
  const sw = () => screen.findByRole("switch", { name: "SOS paging" });

  it("reflects the server's sos_opt_in", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: true }));
    render(<MePage />);
    expect((await sw()).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Page me when a dog near where I feed needs help")).not.toBeNull();
  });

  it("PATCHes sosOptIn when toggled and confirms in a status line", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: false }));
    apiMock.updateFeederMe.mockResolvedValue({ sosOptIn: true });
    render(<MePage />);
    const toggle = await sw();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(apiMock.updateFeederMe).toHaveBeenCalledWith({ sosOptIn: true }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/You'll be paged/));
    expect((await sw()).getAttribute("aria-checked")).toBe("true");
  });

  it("reverts and shows the API's message when the PATCH fails", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: false }));
    apiMock.updateFeederMe.mockRejectedValue(
      new ApiError("body must contain { sosOptIn?: boolean ... }", { status: 400, code: "INVALID_SOS_OPT_IN" }),
    );
    render(<MePage />);
    fireEvent.click(await sw());
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/body must contain/));
    expect((await sw()).getAttribute("aria-checked")).toBe("false");
  });

  it("tells a low-trust feeder why opting in will not page them yet", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: false, trustScore: 30 }));
    render(<MePage />);
    await sw();
    expect(screen.getByText(/trust score of 40 or more/).textContent).toMatch(/Yours is 30/);
  });
});
