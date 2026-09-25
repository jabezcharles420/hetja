// @vitest-environment jsdom
/**
 * Log a feed (design v4, screen 06): photo optional, outcome optional and
 * posted through the offline queue, "Looks unwell" only ever suggests an SOS,
 * the streak caption is real, and signed-out feeders go to /login and back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

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
    bestEffortDeviceToken: vi.fn().mockResolvedValue("dev-tok"),
    api: { ...actual.api, getDog: vi.fn(), getStreak: vi.fn() },
  };
});

vi.mock("@/lib/offline-queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/offline-queue")>("@/lib/offline-queue");
  return {
    ...actual,
    enqueueFeed: vi.fn(),
    captureGeo: vi.fn().mockResolvedValue({ lat: 19.13, lng: 72.84 }),
  };
});

import FeedScreen, { BUSY_TOAST, feedNote, loggedToast, OUTCOMES, QUEUED_TOAST } from "@/app/feed/FeedScreen";
import { api, ApiError, setAccessToken } from "@/lib/api";
import { enqueueFeed } from "@/lib/offline-queue";
import { kolkataDay } from "@/lib/streak";

const apiMock = api as unknown as {
  getDog: ReturnType<typeof vi.fn>;
  getStreak: ReturnType<typeof vi.fn>;
};
const enqueue = enqueueFeed as unknown as ReturnType<typeof vi.fn>;

const BRUNO = {
  slug: "ddr237xk2",
  name: "Bruno",
  status: "active",
  wardId: "K-West",
  photoKey: null,
  abcStatus: null,
  vaccineStatus: null,
  microStory: null,
  lastSeenAt: null,
  geo: null,
  photoUrl: null,
};

function yesterday(): string {
  return kolkataDay(new Date(Date.now() - 86_400_000));
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  setAccessToken("tok");
  window.history.replaceState({}, "", "/feed?dog=ddr237xk2");
  apiMock.getDog.mockResolvedValue(BRUNO);
  apiMock.getStreak.mockResolvedValue({ streakDays: 23, lastFeedDate: yesterday(), badges: [], trustScore: 46 });
  enqueue.mockResolvedValue({ queued: {}, syncing: true, offline: false });
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
  setAccessToken(null);
});

describe("Log a feed", () => {
  it("shows the dog card, the optional photo, the four chips and the real streak", async () => {
    render(<FeedScreen />);
    expect(await screen.findByText("Bruno")).not.toBeNull();
    expect(screen.getByText("DDR 237 XK2")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Change" }).getAttribute("href")).toBe("/scan?intent=feed&dog=ddr237xk2");
    expect(screen.getByRole("link", { name: "Cancel" })).not.toBeNull();
    expect(screen.getByText("Add a photo (optional)")).not.toBeNull();
    expect(screen.getByText("How did it go? (optional)")).not.toBeNull();
    expect(OUTCOMES.map((o) => o.label)).toEqual(["Ate it all", "Ate a little", "Didn't eat", "Looks unwell"]);
    for (const o of OUTCOMES) expect(screen.getByRole("button", { name: o.label })).not.toBeNull();
    expect(await screen.findByText("Keeps your streak at 24 days.")).not.toBeNull();
    expect(apiMock.getDog).toHaveBeenCalledWith("ddr237xk2");
  });

  it("posts the chosen outcome through the offline queue, with no photo needed", async () => {
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Ate a little" }));
    expect(screen.getByRole("button", { name: "Ate a little" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Log feed" }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(enqueue.mock.calls[0]![0]).toEqual({
      dogSlug: "ddr237xk2",
      photo: undefined,
      geo: { lat: 19.13, lng: 72.84 },
      deviceToken: "dev-tok",
      outcome: "ate_some",
    });
    expect(await screen.findByText("Logged. Bruno is thrilled, in their own way.")).not.toBeNull();
  });

  it("sends no outcome when none is picked, and a second tap deselects", async () => {
    render(<FeedScreen />);
    const chip = await screen.findByRole("button", { name: "Ate it all" });
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Log feed" }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect("outcome" in (enqueue.mock.calls[0]![0] as object)).toBe(false);
  });

  it("suggests an SOS for 'Looks unwell' and never raises one itself", async () => {
    const report = vi.spyOn(api, "createReport");
    render(<FeedScreen />);
    expect(screen.queryByTestId("unwell-hint")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Looks unwell" }));
    const hint = screen.getByTestId("unwell-hint");
    expect(hint.textContent).toMatch(/raise an SOS/);
    expect(screen.getByRole("link", { name: /Open Bruno.s profile/ }).getAttribute("href")).toBe("/d/ddr237xk2");
    fireEvent.click(screen.getByRole("button", { name: "Log feed" }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect((enqueue.mock.calls[0]![0] as { outcome: string }).outcome).toBe("unwell");
    // The feed is the only write: no SOS report was opened.
    expect(report).not.toHaveBeenCalled();
  });

  it("says the feed is saved on the phone when offline", async () => {
    enqueue.mockResolvedValue({ queued: {}, syncing: false, offline: true });
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Log feed" }));
    expect(await screen.findByText(QUEUED_TOAST)).not.toBeNull();
  });

  it("says the server is busy (and the feed is kept) on 429 / 503", async () => {
    enqueue.mockResolvedValue({ queued: {}, syncing: true, offline: false, throttled: true, pending: false });
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Log feed" }));
    expect(await screen.findByText(BUSY_TOAST)).not.toBeNull();
    expect(BUSY_TOAST).toBe("Saved on this phone. It sends when the server is less busy.");
  });

  it("adds a quiet line when the photo was not kept", async () => {
    enqueue.mockResolvedValue({
      queued: {},
      syncing: true,
      offline: false,
      throttled: false,
      pending: false,
      result: { created: true, photoAccepted: false },
    });
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Log feed" }));
    expect((await screen.findByTestId("feed-note")).textContent).toBe("Feed logged. The photo wasn't kept this time.");
    expect(screen.getByRole("status").textContent).toContain("Logged. Bruno");
  });

  it("mentions an ignored out-of-Mumbai location quietly, and nothing else", () => {
    expect(feedNote({ geoAccepted: false })).toBe("Location outside Mumbai was ignored.");
    expect(feedNote({ photoAccepted: true, geoAccepted: true })).toBeNull();
    expect(feedNote({})).toBeNull();
    expect(feedNote(undefined)).toBeNull();
  });

  it("does not claim a permanently refused feed was logged", async () => {
    enqueue.mockResolvedValue({
      queued: {},
      syncing: false,
      offline: false,
      throttled: false,
      pending: false,
      dropped: new ApiError("bad", { status: 400, code: "INVALID_PHOTO" }),
    });
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Log feed" }));
    expect(await screen.findByText("Hetja couldn't log this feed. Try again.")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends a signed-out feeder to /login with a way back", async () => {
    setAccessToken(null);
    render(<FeedScreen />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/feed?dog=ddr237xk2")}`),
    );
    expect(apiMock.getDog).not.toHaveBeenCalled();
  });

  it("says 'No dog with that code' for an unknown dog", async () => {
    apiMock.getDog.mockRejectedValue(new ApiError("dog not found", { status: 404, code: "DOG_NOT_FOUND" }));
    render(<FeedScreen />);
    expect(await screen.findByText("No dog with that code. Check the letters and try again.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Scan a collar" }).getAttribute("href")).toBe(
      "/scan?intent=feed&dog=ddr237xk2",
    );
  });

  it("uses the dog's name in the toast", () => {
    expect(loggedToast("Kaali")).toBe("Logged. Kaali is thrilled, in their own way.");
  });
});
