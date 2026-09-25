// @vitest-environment jsdom
/**
 * Design v6 care screens outside the SOS page: V10 (has eaten), V11 (feed
 * round), L2 (looks unwell, tell a co-feeder), N15 (dog this week), N16
 * (story editor). The API is mocked to the v6 shapes in lib/api.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className, ...rest }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    bestEffortDeviceToken: vi.fn().mockResolvedValue("dev-tok"),
    api: {
      ...actual.api,
      getDog: vi.fn(),
      getStreak: vi.fn(),
      getFeederMe: vi.fn(),
      getMyDogsV5: vi.fn(),
      createScanBatch: vi.fn(),
      getDogWeek: vi.fn(),
      getDogStories: vi.fn(),
      createStory: vi.fn(),
    },
  };
});

vi.mock("@/lib/offline-queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/offline-queue")>("@/lib/offline-queue");
  return {
    ...actual,
    enqueueFeed: vi.fn(),
    listWaiting: vi.fn().mockResolvedValue([]),
    flushOnOpen: vi.fn().mockResolvedValue(0),
    captureGeo: vi.fn().mockResolvedValue(undefined),
  };
});

const { offerSpy } = vi.hoisted(() => ({ offerSpy: vi.fn(() => null) }));
vi.mock("@/components/AddToHomeScreen", () => ({ AddToHomeScreenAfterFeed: offerSpy }));

vi.mock("@/lib/care-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/care-cache")>("@/lib/care-cache");
  return {
    ...actual,
    refreshCareNumbers: vi.fn().mockResolvedValue(null),
    loadCareNumbers: vi.fn().mockResolvedValue(null),
    rememberDogNames: vi.fn().mockResolvedValue(undefined),
    cachedDogName: vi.fn().mockResolvedValue(null),
  };
});

import FeedScreen, { coFeederNames, coFeeders, FEEDS_LOGGED_KEY, logLabel } from "@/app/feed/FeedScreen";
import { eatenLead, eatenTitle, joinNames, nextBadgeLine } from "@/app/feed/FeedDone";
import { roundLabel, roundOrder } from "@/app/feed/FeedRound";
import DogWeekScreen, { fedByLine, fedCount, rabiesPill, weekNote } from "@/app/me/dogs/[slug]/DogWeekScreen";
import StoryScreen, { looksLikeAddress, prompts, storyLead } from "@/app/me/dogs/[slug]/story/StoryScreen";
import { api, ApiError, setAccessToken, type DogWeek, type MyDogV5 } from "@/lib/api";
import { pronouns } from "@/lib/care-copy";
import { enqueueFeed } from "@/lib/offline-queue";

type Mock = ReturnType<typeof vi.fn>;
const m = api as unknown as Record<string, Mock>;
const enqueue = enqueueFeed as unknown as Mock;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;

const RANI = {
  slug: "rni482pq7",
  name: "Rani",
  status: "active",
  wardId: "K-West",
  photoKey: null,
  abcStatus: null,
  vaccineStatus: null,
  microStory: null,
  lastSeenAt: null,
  geo: null,
  photoUrl: null,
  sex: "female",
  feeders: [{ firstName: "Priya" }, { firstName: "Arjun" }],
};

function myDog(slug: string, name: string, lastFedAt: string | null): MyDogV5 {
  return { slug, name, wardId: "K-West", wardName: null, lastFedAt, myLastFedAt: lastFedAt, status: "active" };
}

beforeEach(() => {
  setAccessToken("tok");
  replace.mockReset();
  push.mockReset();
  m.getStreak!.mockResolvedValue({ streakDays: 12, lastFeedDate: null, badges: [], trustScore: 40 });
  m.getFeederMe!.mockResolvedValue({ publicName: "Priya S.", displayName: "Priya" });
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
  setAccessToken(null);
});

// ---------------------------------------------------------------------------

describe("V10 has eaten", () => {
  it("replaces the toast with the moment, the streak, and Scan the next dog", async () => {
    window.history.replaceState({}, "", "/feed?dog=rni482pq7");
    m.getDog!.mockResolvedValue(RANI);
    enqueue.mockResolvedValue({ queued: {}, syncing: true, offline: false, throttled: false, pending: false, result: { created: true, streak: { streakDays: 13, lastFeedDate: "x" } } });
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Log feed" }));
    expect(await screen.findByRole("heading", { name: "Rani has eaten." })).not.toBeNull();
    expect(screen.getByText('She\'s thrilled, in her own way. Anyone who scans her collar now sees "Fed a few minutes ago".')).not.toBeNull();
    expect(screen.getByText("13")).not.toBeNull();
    expect(screen.getByText("day streak")).not.toBeNull();
    expect(screen.getByText("15 more for the 28 days badge")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Scan the next dog" })).not.toBeNull();
    // The first feed on this phone is marked for V23.
    expect(localStorage.getItem(FEEDS_LOGGED_KEY)).toBe("1");
    expect((offerSpy.mock.calls[0] as unknown[])[0]).toMatchObject({ dogName: "Rani" });
  });

  it("words", () => {
    expect(eatenTitle([{ slug: "a", name: "Rani" }, { slug: "b", name: "Kalu" }])).toBe("Rani and Kalu have eaten.");
    expect(joinNames(["A", "B", "C", "D", "E"])).toBe("A, B and 3 more");
    expect(eatenLead([{ slug: "a", name: "Kalu" }])).toBe(
      'They\'re thrilled, in their own way. Anyone who scans their collar now sees "Fed a few minutes ago".',
    );
    expect(nextBadgeLine(6)).toBe("One more for the full week badge");
    expect(nextBadgeLine(30)).toBe("Every day for four weeks and counting");
  });
});

// ---------------------------------------------------------------------------

describe("V11 who did you feed", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/feed");
  });

  it("lists my dogs least recently fed first, multi-selects, and logs the round in one batch", async () => {
    m.getMyDogsV5!.mockResolvedValue({
      dogs: [myDog("kaluaaaa2", "Kalu", ago(DAY)), myDog("rni482pq7", "Rani", ago(3 * DAY)), myDog("brunoab22", "Bruno", ago(60_000))],
    });
    m.createScanBatch!.mockResolvedValue({
      results: [
        { clientUuid: "1", dogSlug: "rni482pq7", created: true },
        { clientUuid: "2", dogSlug: "kaluaaaa2", created: true },
      ],
      streak: { streakDays: 5, lastFeedDate: "x" },
    });
    render(<FeedScreen />);
    expect(await screen.findByRole("heading", { name: "Who did you feed?" })).not.toBeNull();
    expect(screen.getByText("Tap everyone from tonight’s round.")).not.toBeNull();
    expect(screen.getByText("Your dogs, most recently fed last. Scan anyone new.")).not.toBeNull();
    const names = screen.getAllByRole("button", { pressed: false }).map((b) => b.textContent);
    expect(names).toEqual(["RRani", "KKalu", "BBruno"]);
    expect((screen.getByRole("button", { name: "Log feeds" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Rani/ }));
    fireEvent.click(screen.getByRole("button", { name: /Kalu/ }));
    expect(screen.getByRole("link", { name: /Scan/ }).getAttribute("href")).toBe("/scan?intent=feed");
    fireEvent.click(screen.getByRole("button", { name: "Log 2 feeds" }));
    expect(await screen.findByRole("heading", { name: "Rani and Kalu have eaten." })).not.toBeNull();
    const [feeds, opts] = m.createScanBatch!.mock.calls[0]!;
    expect((feeds as { dogSlug: string }[]).map((f) => f.dogSlug)).toEqual(["rni482pq7", "kaluaaaa2"]);
    expect(opts).toEqual({ deviceToken: "dev-tok" });
  });

  it("keeps the round on the phone when the network fails", async () => {
    m.getMyDogsV5!.mockResolvedValue({ dogs: [myDog("rni482pq7", "Rani", null)] });
    m.createScanBatch!.mockRejectedValue(new ApiError("down", { status: 0, code: "NETWORK_ERROR" }));
    enqueue.mockResolvedValue({ queued: {}, offline: false, pending: true, throttled: false, syncing: false });
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Rani/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log 1 feed" }));
    expect(await screen.findByText("Saved on this phone. It sends when the signal is back.")).not.toBeNull();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ dogSlug: "rni482pq7", dogName: "Rani" }));
  });

  it("with no dogs yet, asks for a scan", async () => {
    m.getMyDogsV5!.mockResolvedValue({ dogs: [] });
    render(<FeedScreen />);
    expect(await screen.findByText("Scan the collar of the dog you fed.")).not.toBeNull();
  });

  it("words and order", () => {
    expect(roundLabel(0)).toBe("Log feeds");
    expect(roundLabel(1)).toBe("Log 1 feed");
    expect(roundLabel(2)).toBe("Log 2 feeds");
    const gone = { ...myDog("x", "X", null), status: "deceased" as const };
    expect(roundOrder([myDog("a", "A", ago(DAY)), gone, myDog("b", "B", null)]).map((d) => d.slug)).toEqual(["b", "a"]);
  });
});

// ---------------------------------------------------------------------------

describe("L2 looks unwell", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/feed?dog=rni482pq7");
    m.getDog!.mockResolvedValue(RANI);
    enqueue.mockResolvedValue({ queued: {}, syncing: true, offline: false });
  });

  it("offers to tell the co-feeder, takes a note, and links to SOS", async () => {
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Looks unwell" }));
    expect(screen.getByText("Tell Arjun")).not.toBeNull();
    expect(screen.getByText("Arjun feeds her too. A note, not an alarm.")).not.toBeNull();
    expect(screen.getByRole("switch", { name: "Tell Arjun" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("link", { name: "It’s serious. Raise an SOS ›" }).getAttribute("href")).toBe("/d/rni482pq7");
    fireEvent.change(screen.getByLabelText("What did you notice? (optional)"), { target: { value: "Limping" } });
    fireEvent.click(screen.getByRole("button", { name: "Log feed and tell Arjun" }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ outcome: "unwell", note: "Limping", tellCoFeeders: true });
  });

  it("turning the switch off sends no push", async () => {
    render(<FeedScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Looks unwell" }));
    fireEvent.click(screen.getByRole("switch", { name: "Tell Arjun" }));
    fireEvent.click(screen.getByRole("button", { name: "Log feed" }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect("tellCoFeeders" in (enqueue.mock.calls[0]![0] as object)).toBe(false);
  });

  it("co-feeder words", () => {
    expect(coFeeders([{ firstName: "Priya" }, { firstName: "Arjun" }], "Priya")).toEqual([{ firstName: "Arjun" }]);
    expect(coFeederNames([{ firstName: "Arjun" }, { firstName: "Meera" }])).toBe("Arjun and Meera");
    expect(coFeederNames([{ firstName: "Arjun" }, { firstName: null }])).toBeNull();
    expect(logLabel(true, null)).toBe("Log feed and tell them");
    expect(logLabel(false, "Arjun")).toBe("Log feed");
  });
});

// ---------------------------------------------------------------------------

function week(): DogWeek {
  const dates = ["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
  return {
    days: dates.map((date, i) => ({
      date,
      fed: i !== 2,
      outcome: i === 5 ? "didnt_eat" : i === 2 ? null : "ate_all",
      byFirstName: i === 5 ? "Arjun" : "Priya",
    })),
    feederNames: ["Priya S.", "Arjun M."],
    rabiesDue: { lastGiven: "2025-10-08", dueDate: "2099-10-08" },
    vetRecordCount: 2,
  };
}

describe("N15 your dog this week", () => {
  it("shows who fed her, the week strip, the note, rabies, vet records and Log a feed", async () => {
    m.getDog!.mockResolvedValue(RANI);
    m.getDogWeek!.mockResolvedValue(week());
    render(<DogWeekScreen slug="rni482pq7" />);
    expect(await screen.findByRole("heading", { name: "Rani" })).not.toBeNull();
    expect(screen.getByText("Fed by you and Arjun M.")).not.toBeNull();
    expect(screen.getByText("This week")).not.toBeNull();
    expect(screen.getByText("6 of 7 days")).not.toBeNull();
    expect(screen.getByText('Wednesday: Arjun logged "Didn\'t eat". Fine since Thursday.')).not.toBeNull();
    expect(screen.getByLabelText("Thursday: fed (today)")).not.toBeNull();
    expect(screen.getByLabelText("Sunday: not logged")).not.toBeNull();
    expect(screen.getByText("Rabies booster")).not.toBeNull();
    expect(screen.getByText("Last given 8 Oct 2025")).not.toBeNull();
    expect(screen.getByText("Vet records")).not.toBeNull();
    expect(screen.getByText("2 ›")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Log a feed" }).getAttribute("href")).toBe("/feed?dog=rni482pq7");
    expect(screen.getByRole("link", { name: "Edit Rani's story" }).getAttribute("href")).toBe("/me/dogs/rni482pq7/story");
  });

  it("403: only feeders of the dog", async () => {
    m.getDog!.mockResolvedValue(RANI);
    m.getDogWeek!.mockRejectedValue(new ApiError("no", { status: 403 }));
    render(<DogWeekScreen slug="rni482pq7" />);
    expect(await screen.findByRole("heading", { name: "Only feeders of Rani see this." })).not.toBeNull();
  });

  it("words", () => {
    expect(fedCount(week().days)).toBe("6 of 7 days");
    expect(weekNote(week().days.map((d) => ({ ...d, fed: true, outcome: null })), "Rani")).toBe("Rani was fed every day this week.");
    expect(fedByLine(["Arjun M.", "Meera K."], null)).toBe("Fed by Arjun M. and Meera K.");
    const now = Date.parse("2026-09-25T00:00:00Z");
    expect(rabiesPill("2026-10-08", now)).toEqual({ variant: "warn", text: "Due in 13 days" });
    expect(rabiesPill("2026-09-01", now).text).toBe("Overdue");
  });
});

// ---------------------------------------------------------------------------

describe("N16 write the story", () => {
  it("edits, counts to 280, offers prompts, reminds about addresses, and saves", async () => {
    m.getDog!.mockResolvedValue({ ...RANI, slug: "kaluaaaa2", name: "Kalu", sex: "male" });
    m.getDogStories!.mockResolvedValue({ stories: [] });
    m.createStory!.mockResolvedValue({ id: "s1", version: 1, paragraph: "x", moderatedAt: null, createdAt: "x" });
    render(<StoryScreen slug="kaluaaaa2" />);
    expect(await screen.findByRole("heading", { name: "Kalu’s story" })).not.toBeNull();
    expect(screen.getByText("Two or three lines. It's how a stranger learns he's somebody's.")).not.toBeNull();
    expect(screen.getByText("Stuck? Try")).not.toBeNull();
    for (const c of ["Where he sleeps", "What he loves", "What scares him"]) expect(screen.getByRole("button", { name: c })).not.toBeNull();
    expect(screen.getByText("Landmarks are fine. Leave out house numbers and building names.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Save story" }) as HTMLButtonElement).disabled).toBe(true);
    const box = screen.getByLabelText("Kalu’s story") as HTMLTextAreaElement;
    const text = "Kalu guards the Four Bungalows bus stop and escorts late commuters to the corner. Tips not required.";
    fireEvent.change(box, { target: { value: text } });
    expect(screen.getByText(`${text.length} / 280`)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Where he sleeps" }));
    expect(box.value).toBe(`${text} He sleeps `);
    fireEvent.change(box, { target: { value: "He lives outside flat 12" } });
    expect(screen.getByText(/looks like part of an address/)).not.toBeNull();
    fireEvent.change(box, { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Save story" }));
    expect(await screen.findByRole("heading", { name: "Saved." })).not.toBeNull();
    expect(m.createStory).toHaveBeenCalledWith("kaluaaaa2", text);
  });

  it("429: five a day", async () => {
    m.getDog!.mockResolvedValue(RANI);
    m.getDogStories!.mockResolvedValue({ stories: [{ id: "s", version: 2, paragraph: "Rani naps by the temple.", moderatedAt: "x", createdAt: "x" }] });
    m.createStory!.mockRejectedValue(new ApiError("slow", { status: 429 }));
    render(<StoryScreen slug="rni482pq7" />);
    await waitFor(() => expect((screen.getByLabelText("Rani’s story") as HTMLTextAreaElement).value).toBe("Rani naps by the temple."));
    fireEvent.click(screen.getByRole("button", { name: "Save story" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That's five stories today. Try again tomorrow.");
  });

  it("words", () => {
    expect(prompts(pronouns(undefined)).map((p) => p.label)).toEqual(["Where they sleep", "What they love", "What scares them"]);
    expect(storyLead(pronouns("female"))).toBe("Two or three lines. It's how a stranger learns she's somebody's.");
    expect(looksLikeAddress("near the Juhu bus stop")).toBe(false);
    expect(looksLikeAddress("Room no. 4 in the chawl")).toBe(true);
    expect(looksLikeAddress("400058")).toBe(true);
  });
});
