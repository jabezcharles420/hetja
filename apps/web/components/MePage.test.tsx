// @vitest-environment jsdom
/**
 * Tests for the feeder profile page's SOS paging consent.
 *
 * The gap these exist for: `feeders.sos_opt_in` defaults to false, the SOS
 * fan-out (routes/sos.ts) pages only feeders who have it set, and
 * `PATCH /api/v1/feeders/me` is its only writer — but no web surface ever
 * called that route. Every feeder was permanently opted out, so "help is on
 * the way" in the SOS dialog had nobody behind it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children }: { href: string; children: ReactNode }) => el("a", { href }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, getStreak: vi.fn(), getFeederMe: vi.fn(), updateFeederMe: vi.fn() },
  };
});

import MePage from "@/app/me/page";
import { api, ApiError } from "@/lib/api";

const apiMock = api as unknown as {
  getStreak: ReturnType<typeof vi.fn>;
  getFeederMe: ReturnType<typeof vi.fn>;
  updateFeederMe: ReturnType<typeof vi.fn>;
};

const STREAK = { trustScore: 55, streakDays: 4, badges: [] as string[], lastFeedDate: null };

function feederMe(overrides: Partial<{ sosOptIn: boolean; trustScore: number }> = {}) {
  return {
    feederId: "f1",
    displayName: "Asha",
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

describe("MePage — SOS paging consent", () => {
  beforeEach(() => {
    apiMock.getStreak.mockResolvedValue(STREAK);
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("renders the consent checkbox reflecting the server's sos_opt_in", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: true }));
    render(<MePage />);
    const box = (await screen.findByLabelText(
      "Page me when a dog near where I feed needs help",
    )) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it("PATCHes sosOptIn when toggled and confirms in a status line", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: false }));
    apiMock.updateFeederMe.mockResolvedValue({ sosOptIn: true });
    render(<MePage />);
    const box = (await screen.findByLabelText(
      "Page me when a dog near where I feed needs help",
    )) as HTMLInputElement;
    expect(box.checked).toBe(false);

    fireEvent.click(box);

    await waitFor(() => expect(apiMock.updateFeederMe).toHaveBeenCalledWith({ sosOptIn: true }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/You'll be paged/));
    expect((screen.getByLabelText("Page me when a dog near where I feed needs help") as HTMLInputElement).checked).toBe(true);
  });

  it("reverts the checkbox and shows the API's message when the PATCH fails", async () => {
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: false }));
    apiMock.updateFeederMe.mockRejectedValue(
      new ApiError("body must contain { sosOptIn?: boolean ... }", { status: 400, code: "INVALID_SOS_OPT_IN" }),
    );
    render(<MePage />);
    const box = (await screen.findByLabelText(
      "Page me when a dog near where I feed needs help",
    )) as HTMLInputElement;
    fireEvent.click(box);

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/body must contain/));
    expect((screen.getByLabelText("Page me when a dog near where I feed needs help") as HTMLInputElement).checked).toBe(false);
  });

  it("tells a low-trust feeder why opting in will not page them yet", async () => {
    apiMock.getStreak.mockResolvedValue({ ...STREAK, trustScore: 30 });
    apiMock.getFeederMe.mockResolvedValue(feederMe({ sosOptIn: false, trustScore: 30 }));
    render(<MePage />);
    await screen.findByLabelText("Page me when a dog near where I feed needs help");
    expect(screen.getByText(/trust score of 40 or more/).textContent).toMatch(/yours is 30/);
  });

  it("asks a signed-out visitor to sign in and shows no consent control", async () => {
    apiMock.getStreak.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    apiMock.getFeederMe.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    render(<MePage />);
    await screen.findByText("Sign in as a feeder to see your streak.");
    expect(screen.queryByLabelText("Page me when a dog near where I feed needs help")).toBeNull();
  });
});
