// @vitest-environment jsdom
/**
 * Design v5 care screens: N4 My dogs, N9 Update on a dog, F6 tag alert and
 * history, N3 vet checkup. The API is mocked to exactly the contract shapes
 * (docs/design/v5-handoff/CONTRACT.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// Fixtures below compute relative times at load, so the clock is pinned
// before them (and again in beforeEach). See the note in beforeEach.
vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-24T06:30:00Z"));

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
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
    api: {
      ...actual.api,
      getMyDogsV5: vi.fn(),
      confirmDog: vi.fn(),
      getDog: vi.fn(),
      getStatusReports: vi.fn(),
      createStatusReport: vi.fn(),
      confirmStatusReport: vi.fn(),
      getDogTags: vi.fn(),
      resolveTagReport: vi.fn(),
      getFeederMe: vi.fn(),
      createCheckup: vi.fn(),
    },
  };
});

vi.mock("@/lib/care-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/care-cache")>("@/lib/care-cache");
  return {
    ...actual,
    refreshCareNumbers: vi.fn().mockResolvedValue(null),
    rememberDogNames: vi.fn().mockResolvedValue(undefined),
  };
});

import MyDogsScreen, { confirmable, sortMyDogs } from "@/app/me/dogs/MyDogsScreen";
import StatusScreen, { lastLoggedLine, PASSED_FOOTNOTE, statusButtonLabel } from "@/app/me/dogs/[slug]/status/StatusScreen";
import TagScreen, { reportSub } from "@/app/me/dogs/[slug]/tag/TagScreen";
import VetCheckupScreen, { aYearFrom, isVet } from "@/app/vet/[slug]/VetCheckupScreen";
import { api, ApiError, setAccessToken, type DogProfile, type DogProfileV5, type DogTags, type MyDogV5 } from "@/lib/api";
import { refreshCareNumbers } from "@/lib/care-cache";

type Mock = ReturnType<typeof vi.fn>;
const m = api as unknown as Record<string, Mock>;

const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function dog(over: Partial<MyDogV5> & { slug: string; name: string }): MyDogV5 {
  return {
    wardId: "K-West",
    wardName: "Andheri West",
    lastFedAt: ago(DAY),
    myLastFedAt: ago(DAY),
    photoUrl: null,
    status: "active",
    verified: true,
    registeredByMe: true,
    lastFedByName: null,
    attention: null,
    ...over,
  };
}

const MINE: MyDogV5[] = [
  dog({ slug: "kaluaaaa2", name: "Kalu", lastFedAt: ago(2 * 60 * MIN), myLastFedAt: ago(DAY), lastFedByName: "Anil" }),
  dog({
    slug: "rni482pq7",
    name: "Rani",
    attention: { kind: "tag", since: ago(12 * MIN), detail: "found_on_ground" },
  }),
  dog({
    slug: "motiaaaa2",
    name: "Moti",
    lastFedAt: ago(9 * DAY + 60 * MIN),
    attention: { kind: "missing", since: ago(DAY), detail: null },
  }),
  dog({ slug: "sheruaaa2", name: "Sheru", attention: { kind: "vet", since: ago(DAY), detail: "2099-10" } }),
  dog({
    slug: "tigeraaa2",
    name: "Tiger",
    verified: false,
    registeredByMe: false,
    attention: { kind: "new", since: ago(DAY), detail: null },
  }),
];

function profile(over: Partial<DogProfile> = {}): DogProfile {
  return {
    slug: "motiaaaa2",
    name: "Moti",
    status: "active",
    wardId: "K-West",
    photoKey: null,
    abcStatus: null,
    vaccineStatus: null,
    microStory: null,
    lastSeenAt: null,
    geo: null,
    lastFedAt: ago(9 * DAY + 60 * MIN),
    photoUrl: null,
    ...over,
  };
}

beforeEach(() => {
  // Pin the clock to midday in Mumbai: "8 hours ago" must stay "Today"
  // whenever CI runs (it once ran at 00:01 IST and every relative time fell
  // into "Yesterday").
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T06:30:00Z"));
  setAccessToken("tok");
  replace.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  cleanup();
  setAccessToken(null);
});

// ---------------------------------------------------------------------------

describe("N4 My dogs", () => {
  it("shows the header, the count line, the chips and the needs-you rows first", async () => {
    m.getMyDogsV5!.mockResolvedValue({ dogs: MINE });
    render(<MyDogsScreen />);
    expect(await screen.findByRole("heading", { name: "My dogs" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "‹ Me" }).getAttribute("href")).toBe("/me");
    expect(screen.getByRole("link", { name: "+ Register" }).getAttribute("href")).toBe("/register");
    expect(screen.getByText("5 dogs · 2 need you today")).not.toBeNull();
    const needs = screen.getByRole("button", { name: "Needs you · 2" });
    expect(needs.getAttribute("aria-pressed")).toBe("true");
    // Needs you: only Rani (tag) and Moti (missing).
    expect(screen.getByText("Tag reported off · 12 min")).not.toBeNull();
    expect(screen.getByText("Not logged in 9 days")).not.toBeNull();
    expect(screen.queryByText("Kalu")).toBeNull();
    expect(screen.getByRole("link", { name: /Rani/ }).getAttribute("href")).toBe("/me/dogs/rni482pq7/tag");
    expect(screen.getByRole("link", { name: /Moti/ }).getAttribute("href")).toBe("/me/dogs/motiaaaa2/status");
    expect(screen.getByRole("link", { name: "Print a batch sheet" }).getAttribute("href")).toBe("/register/batch");
    expect(refreshCareNumbers).toHaveBeenCalled();
  });

  it("All shows every dog with its pill and sub line", async () => {
    m.getMyDogsV5!.mockResolvedValue({ dogs: MINE });
    render(<MyDogsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "All · 5" }));
    expect(screen.getByText("Fed 2 h ago by Anil")).not.toBeNull();
    expect(screen.getByText("Vaccine due Oct 2099")).not.toBeNull();
    expect(screen.getAllByText("Unverified").length).toBeGreaterThan(0);
    for (const tag of ["Tag", "Missing?", "Fed", "Vet", "New"]) expect(screen.getAllByText(tag).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Kalu/ }).getAttribute("href")).toBe("/me/dogs/kaluaaaa2");
  });

  it("confirms a dog another feeder registered, as a second feeder", async () => {
    m.getMyDogsV5!.mockResolvedValue({ dogs: MINE });
    m.confirmDog!.mockResolvedValue({ verified: true, via: "feeder" });
    render(<MyDogsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Tiger" }));
    expect(await screen.findByText("Confirmed. Thank you.")).not.toBeNull();
    expect(m.confirmDog).toHaveBeenCalledWith("tigeraaa2");
  });

  it("explains a 403 on confirm", async () => {
    m.getMyDogsV5!.mockResolvedValue({ dogs: MINE });
    m.confirmDog!.mockRejectedValue(new ApiError("no", { status: 403 }));
    render(<MyDogsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Tiger" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Only a second feeder of Tiger can confirm, not the one who registered.",
    );
  });

  it("with nothing needing you, opens on All", async () => {
    m.getMyDogsV5!.mockResolvedValue({ dogs: [MINE[0]!] });
    render(<MyDogsScreen />);
    expect(await screen.findByText("1 dog · nothing needs you today")).not.toBeNull();
    expect(screen.getByRole("button", { name: "All · 1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("signed out goes to login", async () => {
    setAccessToken(null);
    render(<MyDogsScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/me/dogs")}`));
  });

  it("sorts needs-you first and finds confirmable dogs", () => {
    expect(sortMyDogs(MINE).map((d) => d.name)).toEqual(["Rani", "Moti", "Kalu", "Sheru", "Tiger"]);
    expect(confirmable(MINE).map((d) => d.name)).toEqual(["Tiger"]);
  });
});

// ---------------------------------------------------------------------------

describe("N9 Update on a dog", () => {
  it("shows the three choices, the footnote and a label that follows the choice", async () => {
    m.getDog!.mockResolvedValue(profile());
    m.getStatusReports!.mockResolvedValue({ reports: [] });
    m.createStatusReport!.mockResolvedValue({ id: "r1", status: "lost", needsConfirmation: false });
    render(<StatusScreen slug="motiaaaa2" />);
    expect(await screen.findByRole("heading", { name: "Update on Moti" })).not.toBeNull();
    expect(screen.getByText("Nobody has logged Moti in 9 days.")).not.toBeNull();
    expect(screen.getByText("Asks feeders in K/W to look out")).not.toBeNull();
    expect(screen.getByText("Profile stays, feeding stops")).not.toBeNull();
    expect(screen.getByText("Needs a second feeder to confirm")).not.toBeNull();
    expect(screen.getByText(PASSED_FOOTNOTE)).not.toBeNull();
    expect(screen.getByRole("link", { name: "‹ Moti" }).getAttribute("href")).toBe("/d/motiaaaa2");

    expect(screen.getByRole("radio", { name: /Not seen lately/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Ask K/W feeders to look" })).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Adopted or moved to a shelter/ }));
    expect(screen.getByRole("button", { name: "Mark Moti as rehomed" })).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Moti has passed away/ }));
    expect(screen.getByRole("button", { name: "Ask a second feeder to confirm" })).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Not seen lately/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ask K/W feeders to look" }));
    expect(await screen.findByRole("heading", { name: "K/W feeders will look out for Moti." })).not.toBeNull();
    expect(m.createStatusReport).toHaveBeenCalledWith("motiaaaa2", "not_seen");
  });

  it("passed away waits for a second feeder, and says so", async () => {
    m.getDog!.mockResolvedValue(profile());
    m.getStatusReports!.mockResolvedValue({ reports: [] });
    m.createStatusReport!.mockResolvedValue({ id: "r1", status: "active", needsConfirmation: true });
    render(<StatusScreen slug="motiaaaa2" />);
    fireEvent.click(await screen.findByRole("radio", { name: /Moti has passed away/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ask a second feeder to confirm" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Another feeder of Moti will be asked to confirm. Until then, their page stays as it is.",
    );
    expect(m.createStatusReport).toHaveBeenCalledWith("motiaaaa2", "passed_away");
  });

  it("a second feeder with a pending report sees the gentle confirm screen", async () => {
    m.getDog!.mockResolvedValue(profile());
    m.getStatusReports!.mockResolvedValue({
      reports: [{ id: "r9", kind: "passed_away", createdAt: ago(DAY), reportedByName: "Priya S.", mine: false }],
    });
    m.confirmStatusReport!.mockResolvedValue({ id: "r9", status: "deceased" });
    render(<StatusScreen slug="motiaaaa2" />);
    expect(await screen.findByRole("heading", { name: "Moti may have passed away." })).not.toBeNull();
    expect(screen.getByText(/Priya S\. said Moti has passed away/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yes, Moti has passed" }));
    expect(await screen.findByRole("heading", { name: "Thank you for confirming." })).not.toBeNull();
    expect(m.confirmStatusReport).toHaveBeenCalledWith("motiaaaa2", "r9");
  });

  it("'I'm not sure' goes back to the form without confirming", async () => {
    m.getDog!.mockResolvedValue(profile());
    m.getStatusReports!.mockResolvedValue({
      reports: [{ id: "r9", kind: "passed_away", createdAt: ago(DAY), reportedByName: null, mine: false }],
    });
    render(<StatusScreen slug="motiaaaa2" />);
    fireEvent.click(await screen.findByRole("button", { name: "I’m not sure" }));
    expect(await screen.findByRole("heading", { name: "Update on Moti" })).not.toBeNull();
    expect(m.confirmStatusReport).not.toHaveBeenCalled();
  });

  it("the reporter's own pending report cannot be sent twice", async () => {
    m.getDog!.mockResolvedValue(profile());
    m.getStatusReports!.mockResolvedValue({
      reports: [{ id: "r9", kind: "passed_away", createdAt: ago(DAY), reportedByName: "Me", mine: true }],
    });
    render(<StatusScreen slug="motiaaaa2" />);
    fireEvent.click(await screen.findByRole("radio", { name: /Moti has passed away/ }));
    expect(
      (screen.getByRole("button", { name: "Ask a second feeder to confirm" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("You said Moti has passed away. It is waiting for a second feeder to confirm.")).not.toBeNull();
  });

  it("follows the dog's sex in the gentle lines", async () => {
    m.getDog!.mockResolvedValue({ ...profile(), sex: "male" } as DogProfileV5);
    m.getStatusReports!.mockResolvedValue({ reports: [] });
    m.createStatusReport!.mockResolvedValue({ id: "r1", status: "active", needsConfirmation: true });
    render(<StatusScreen slug="motiaaaa2" />);
    fireEvent.click(await screen.findByRole("radio", { name: /Moti has passed away/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ask a second feeder to confirm" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Another feeder of Moti will be asked to confirm. Until then, his page stays as it is.",
    );
  });

  it("403: only this dog's feeders", async () => {
    m.getDog!.mockResolvedValue(profile());
    m.getStatusReports!.mockRejectedValue(new ApiError("no", { status: 403 }));
    render(<StatusScreen slug="motiaaaa2" />);
    expect(await screen.findByRole("heading", { name: "Only this dog’s feeders can send an update." })).not.toBeNull();
  });

  it("words", () => {
    const now = Date.parse("2026-09-25T10:00:00Z");
    expect(lastLoggedLine("Moti", "2026-09-16T09:00:00Z", now)).toBe("Nobody has logged Moti in 9 days.");
    expect(lastLoggedLine("Moti", null, now)).toBe("Nobody has logged Moti yet.");
    expect(lastLoggedLine("Moti", "2026-09-25T08:00:00Z", now)).toBe("Moti was logged today.");
    expect(statusButtonLabel("not_seen", "Moti", null)).toBe("Ask feeders to look");
  });
});

// ---------------------------------------------------------------------------

const TAGS: DogTags = {
  open: [{ id: "t1", kind: "found_on_ground", createdAt: ago(12 * MIN), reporter: "a passer-by" }],
  history: [
    { kind: "reported", at: ago(12 * MIN), detail: "found_on_ground", byName: null },
    { kind: "printed", at: "2026-08-12T06:00:00Z", detail: "6", byName: "Priya S." },
    { kind: "registered", at: "2026-08-12T05:00:00Z", detail: null, byName: "Priya S." },
  ],
  reportsThisWeek: 1,
  sturdierCollarSuggested: false,
};

describe("F6 tag alert and history", () => {
  const rani = profile({ slug: "rni482pq7", name: "Rani" });

  it("shows the alert card, both actions, the history and the footnote", async () => {
    m.getDog!.mockResolvedValue(rani);
    m.getDogTags!.mockResolvedValue(TAGS);
    render(<TagScreen slug="rni482pq7" />);
    expect(await screen.findByRole("heading", { name: "Rani's tag came off" })).not.toBeNull();
    expect(screen.getByText("Found near their usual spot · 12 min ago")).not.toBeNull();
    expect(screen.getByText("Needs a new tag")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Reprint tag" }).getAttribute("href")).toBe("/register/rni482pq7/print?report=t1");
    expect(screen.getByRole("button", { name: "I have a spare" })).not.toBeNull();
    expect(screen.getByText("Tag history · RNI 482 PQ7")).not.toBeNull();
    expect(screen.getByText("Reported off by a passer-by")).not.toBeNull();
    expect(screen.getByText("Printed · 6 tags · Priya S.")).not.toBeNull();
    expect(screen.getByText("Registered · Priya S.")).not.toBeNull();
    expect(screen.getByText("Today")).not.toBeNull();
    expect(
      screen.getByText(
        "Only feeders of Rani see this. After 3 reports in a week, their profile asks for a sturdier collar.",
      ),
    ).not.toBeNull();
  });

  it("follows the dog's sex when a payload carries it", async () => {
    m.getDog!.mockResolvedValue({ ...rani, sex: "female" } as DogProfileV5);
    m.getDogTags!.mockResolvedValue(TAGS);
    render(<TagScreen slug="rni482pq7" />);
    expect(await screen.findByText("Found near her usual spot · 12 min ago")).not.toBeNull();
    expect(screen.getByText(/her profile asks for a sturdier collar/)).not.toBeNull();
  });

  it("I have a spare resolves the report as spare", async () => {
    m.getDog!.mockResolvedValue(rani);
    m.getDogTags!.mockResolvedValueOnce(TAGS).mockResolvedValueOnce({ ...TAGS, open: [] });
    m.resolveTagReport!.mockResolvedValue({ id: "t1", resolution: "spare" });
    render(<TagScreen slug="rni482pq7" />);
    fireEvent.click(await screen.findByRole("button", { name: "I have a spare" }));
    expect(await screen.findByText("Thanks. Rani's spare tag is noted.")).not.toBeNull();
    expect(m.resolveTagReport).toHaveBeenCalledWith("rni482pq7", "t1", "spare");
  });

  it("wrong dog: 'Checked, tag is right' resolves checked_ok, and SOS still works", async () => {
    m.getDog!.mockResolvedValue(rani);
    m.getDogTags!.mockResolvedValue({
      ...TAGS,
      open: [{ id: "t2", kind: "wrong_dog", createdAt: ago(5 * MIN), reporter: "a passer-by" }],
    });
    m.resolveTagReport!.mockResolvedValue({ id: "t2", resolution: "checked_ok" });
    render(<TagScreen slug="rni482pq7" />);
    expect(await screen.findByText("Tag under review")).not.toBeNull();
    expect(screen.getByText(/SOS still works/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Reprint tag" }).getAttribute("href")).toBe(
      "/register/rni482pq7/print?report=t2",
    );
    fireEvent.click(screen.getByRole("button", { name: "Checked, tag is right" }));
    await waitFor(() => expect(m.resolveTagReport).toHaveBeenCalledWith("rni482pq7", "t2", "checked_ok"));
  });

  it("says when the profile now asks for a sturdier collar", async () => {
    m.getDog!.mockResolvedValue(rani);
    m.getDogTags!.mockResolvedValue({ ...TAGS, reportsThisWeek: 3, sturdierCollarSuggested: true });
    render(<TagScreen slug="rni482pq7" />);
    expect(await screen.findByText("3 reports this week. Rani’s profile now asks for a sturdier collar.")).not.toBeNull();
  });

  it("403: only feeders of the dog", async () => {
    m.getDog!.mockResolvedValue(rani);
    m.getDogTags!.mockRejectedValue(new ApiError("no", { status: 403 }));
    render(<TagScreen slug="rni482pq7" />);
    expect(await screen.findByRole("heading", { name: "Only feeders of Rani see this." })).not.toBeNull();
  });

  it("report sub line", () => {
    const now = Date.parse("2026-09-25T10:00:00Z");
    expect(
      reportSub({ id: "x", kind: "damaged", createdAt: "2026-09-25T09:00:00Z", reporter: "Anil" }, "her", now),
    ).toBe("Reported by Anil · 1 h ago");
  });
});

// ---------------------------------------------------------------------------

describe("N3 vet checkup", () => {
  const rani = profile({ slug: "rni482pq7", name: "Rani" });

  it("a vet fills the record; the button waits for every answer and the checkbox", async () => {
    m.getFeederMe!.mockResolvedValue({ role: "vet", capabilities: ["feed", "register"] });
    m.getDog!.mockResolvedValue(rani);
    m.createCheckup!.mockResolvedValue({ verified: true, via: "vet" });
    render(<VetCheckupScreen slug="rni482pq7" />);
    expect(await screen.findByRole("heading", { name: "Checkup record" })).not.toBeNull();
    expect(screen.getByText("Vet account")).not.toBeNull();
    expect(screen.getByRole("link", { name: "‹ Rani" }).getAttribute("href")).toBe("/d/rni482pq7");
    const save = screen.getByRole("button", { name: "Save and verify Rani" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Given today" }));
    fireEvent.click(screen.getByRole("radio", { name: "Yes, confirmed" }));
    expect(save.disabled).toBe(true);
    expect((screen.getByLabelText("Next vaccine due") as HTMLInputElement).value).toBe(aYearFrom());
    fireEvent.change(screen.getByLabelText("Note for feeders"), {
      target: { value: "Cut on front left paw, cleaned. Soft food for 3 days." },
    });
    fireEvent.click(screen.getByLabelText("I examined this dog and the photo matches."));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByRole("heading", { name: "Rani is verified." })).not.toBeNull();
    expect(m.createCheckup).toHaveBeenCalledWith("rni482pq7", {
      rabies: "given_today",
      sterilised: true,
      examined: true,
      nextVaccineDue: aYearFrom(),
      noteForFeeders: "Cut on front left paw, cleaned. Soft food for 3 days.",
    });
  });

  it("a feeder who is not a vet gets a clear explanation, and no form", async () => {
    m.getFeederMe!.mockResolvedValue({ role: "feeder", capabilities: ["feed"] });
    render(<VetCheckupScreen slug="rni482pq7" />);
    expect(await screen.findByText(/Checkups are recorded by vet accounts/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Contact Hetja" }).getAttribute("href")).toBe("/contact");
    expect(screen.queryByRole("button", { name: /Save and verify/ })).toBeNull();
    expect(m.getDog).not.toHaveBeenCalled();
  });

  it("a 403 on save says only vets can add one", async () => {
    m.getFeederMe!.mockResolvedValue({ role: "vet", capabilities: [] });
    m.getDog!.mockResolvedValue(rani);
    m.createCheckup!.mockRejectedValue(new ApiError("no", { status: 403 }));
    render(<VetCheckupScreen slug="rni482pq7" />);
    fireEvent.click(await screen.findByRole("radio", { name: "Up to date" }));
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByLabelText("I examined this dog and the photo matches."));
    fireEvent.click(screen.getByRole("button", { name: "Save and verify Rani" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Only vet accounts can add a checkup.");
  });

  it("isVet", () => {
    expect(isVet({ role: "vet", capabilities: [] })).toBe(true);
    expect(isVet({ role: "feeder", capabilities: ["vet"] })).toBe(true);
    expect(isVet({ role: "registrator", capabilities: ["feed", "register"] })).toBe(false);
    expect(aYearFrom(new Date(2026, 8, 25))).toBe("2027-09");
  });
});
