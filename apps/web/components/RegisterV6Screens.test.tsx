// @vitest-environment jsdom
/**
 * Design v6 register screens: L3 / V13 / V12 on /register, P1 to P4 on
 * /register/[slug], P5 (laser) on the print screen, and P6 on /register/new.
 * The API is mocked to the "Design v6 types" in lib/api.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className, "aria-label": (rest as { "aria-label"?: string })["aria-label"] }, children),
  };
});

vi.mock("@/lib/offline-queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/offline-queue")>("@/lib/offline-queue");
  return { ...actual, captureGeo: vi.fn(async () => ({ lat: 19.13, lng: 72.83 })) };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getFeederMe: vi.fn(),
      getWards: vi.fn(),
      getRegistrations: vi.fn(),
      getRegistrationsV6: vi.fn(),
      getRegistration: vi.fn(),
      getRegistrationV6: vi.fn(),
      checkRegistrationTag: vi.fn(),
      createScan: vi.fn(),
      electRegisterSurface: vi.fn(),
      getCollar: vi.fn(),
      recordPrint: vi.fn(),
      getDogTags: vi.fn(),
      resolveTagReport: vi.fn(),
      getMyDogsV5: vi.fn(),
      getDog: vi.fn(),
    },
  };
});

import RegistrationsClient, {
  firstDogFinePrint,
  registrationRows,
} from "@/app/(register)/register/RegistrationsClient";
import RegistrationClient from "@/app/(register)/register/[slug]/RegistrationClient";
import PrintClient from "@/app/(register)/register/[slug]/print/PrintClient";
import RegisterFlow from "@/app/(register)/register/new/RegisterFlow";
import ReadyClient from "@/app/(register)/register/[slug]/ready/ReadyClient";
import { loadSexes } from "@/lib/collar-print";
import { api, ApiError } from "@/lib/api";
import { rememberDogSex } from "@/lib/dog-copy";

const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const WARDS = [{ id: "K-West", code: "K/W", name: "Andheri West" }];
const SIG = "abcdEfGhIjKlMnOpQrStUvWxYz0123456789-_A1234";
const collarUrl = (slug: string) => `https://hetja.in/d/${slug}?s=${SIG}`;
const DAY = 86_400_000;

function me(extra: Record<string, unknown> = {}) {
  return {
    role: "registrator",
    capabilities: ["register"],
    homeWard: "K-West",
    displayName: "Priya",
    publicName: "Priya S.",
    registrationBudget: { pending: 0, max: 2 },
    ...extra,
  };
}

beforeEach(() => {
  push.mockReset();
  localStorage.clear();
  apiMock.getFeederMe!.mockResolvedValue(me());
  apiMock.getWards!.mockResolvedValue({ wards: WARDS });
  apiMock.recordPrint!.mockResolvedValue({ id: "p" });
  apiMock.getDogTags!.mockResolvedValue({ open: [], history: [], reportsThisWeek: 0, sturdierCollarSuggested: false });
  apiMock.resolveTagReport!.mockResolvedValue({ id: "x", resolution: "reprinted" });
  apiMock.getMyDogsV5!.mockResolvedValue({ dogs: [] });
  apiMock.getDog!.mockRejectedValue(new ApiError("not found", { status: 404, code: "DOG_NOT_FOUND" }));
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("/register: L3, V13, V12", () => {
  it("L3 when signed out, and sign-in comes straight back here", async () => {
    apiMock.getFeederMe!.mockRejectedValue(new ApiError("no", { status: 401, code: "UNAUTHENTICATED" }));
    render(<RegistrationsClient />);
    expect(await screen.findByText("There's a dog without a name near you.")).not.toBeNull();
    expect(
      screen.getByText("Sign in to give them one, and a collar code that tells strangers they're somebody's."),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "Sign in to register a dog" }).getAttribute("href")).toBe(
      "/login?next=%2Fregister",
    );
    expect(screen.getByRole("link", { name: "How registering works" })).not.toBeNull();
  });

  it("V13 for an account without the capability: the button switches registration on", async () => {
    apiMock.getFeederMe!.mockResolvedValue(me({ role: "feeder", capabilities: [] }));
    apiMock.electRegisterSurface!.mockResolvedValue({ role: "registrator" });
    render(<RegistrationsClient />);
    expect(await screen.findByText("Every dog on Hetja started with someone like you.")).not.toBeNull();
    for (const t of [
      "Pick a dog you see every day. Naming them is the hard part.",
      "A clear face photo",
      "1 min",
      "Print the tag",
      "Home printer or a shop",
      "A soft collar with a breakaway",
      "About ₹150",
      "You'll have 30 days to put the collar on. Up to two dogs at a time.",
    ]) {
      expect(screen.getByText(t)).not.toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "Register your first dog" }));
    await waitFor(() => expect(apiMock.electRegisterSurface).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/register/new"));
  });

  it("V13 takes its figures from the real rules", () => {
    expect(firstDogFinePrint(14, 2)).toBe("You'll have 14 days to put the collar on. Up to two dogs at a time.");
    expect(firstDogFinePrint(30, 1)).toBe("You'll have 30 days to put the collar on. One dog at a time.");
  });

  it("V13 for a registrator with no dogs yet goes straight to the form", async () => {
    apiMock.getRegistrationsV6!.mockResolvedValue({ registrations: [], budget: { pending: 0, max: 2, holders: [] } });
    render(<RegistrationsClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Register your first dog" }));
    expect(push).toHaveBeenCalledWith("/register/new");
    expect(apiMock.electRegisterSurface).not.toHaveBeenCalled();
  });

  it("V12: sentences about each dog, what needs doing first", async () => {
    rememberDogSex("k2au9pd3z", "male");
    apiMock.getRegistrationsV6!.mockResolvedValue({
      registrations: [
        { slug: "r4n7kw2ab", name: "Rani", status: "active", wardId: "K-West", scanCount: 14, liveSince: "2026-07-27T10:00:00Z" },
        { slug: "shr8a5ae3", name: "Sheru", status: "pending_activation", wardId: "K-West", printedAt: null, daysLeft: 3 },
        { slug: "k2au9pd3z", name: "Kalu", status: "pending_activation", wardId: "K-West", printedAt: "2026-09-23T10:00:00Z", daysLeft: 12 },
      ],
      budget: { pending: 2, max: 2, holders: [] },
    });
    render(<RegistrationsClient />);
    expect(await screen.findByText("Dogs you put on Hetja")).not.toBeNull();
    expect(screen.getByText("Needs you")).not.toBeNull();
    expect(screen.getByText("Kalu needs his collar")).not.toBeNull();
    expect(screen.getByText("Printed · 12 days to put it on")).not.toBeNull();
    expect(screen.getByText("Sheru's tag isn't printed")).not.toBeNull();
    expect(screen.getByText("3 days left, then the code expires")).not.toBeNull();
    expect(screen.getByText("Scanned 14 times since July")).not.toBeNull();
    const cta = screen.getByRole("link", { name: "Put Kalu's collar on" });
    expect(cta.getAttribute("href")).toBe("/register/k2au9pd3z");
    const titles = screen.getAllByText(/needs his collar|tag isn't printed/).map((n) => n.textContent);
    expect(titles).toEqual(["Kalu needs his collar", "Sheru's tag isn't printed"]);
  });

  it("orders printed collars before unprinted tags", () => {
    const { needs } = registrationRows(
      [
        { slug: "a", name: "A", status: "pending_activation", wardId: "K-West", printedAt: null, daysLeft: 1 },
        { slug: "b", name: "B", status: "pending_activation", wardId: "K-West", printedAt: "2026-09-20", daysLeft: 20 },
      ],
      {},
    );
    expect(needs.map((r) => r.slug)).toEqual(["b", "a"]);
  });
});

const PENDING = {
  slug: "k2au9pd3z",
  name: "Kalu",
  status: "pending_activation",
  wardId: "K-West",
  registeredAt: "2026-09-13T10:00:00Z",
  collarUrl: collarUrl("k2au9pd3z"),
  printedAt: "2026-09-23T10:00:00Z",
  daysLeft: 12,
};

describe("/register/[slug]: P1 to P4", () => {
  it("P1: countdown, tracker, one primary action, typing covers the rest", async () => {
    apiMock.getRegistrationV6!.mockResolvedValue(PENDING);
    render(<RegistrationClient slug="k2au9pd3z" />);
    expect(await screen.findByRole("heading", { name: "Kalu" })).not.toBeNull();
    expect(await screen.findByText("K/W ward · Andheri West")).not.toBeNull();
    expect(screen.getByText("Waiting for collar · 12 days left")).not.toBeNull();
    expect(screen.getByText(/Printed 23 Sep/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Reprint" }).getAttribute("href")).toBe("/register/k2au9pd3z/print");
    expect(screen.getByText("Two fingers under. Use a breakaway buckle so it can't catch.")).not.toBeNull();
    expect(screen.getByText("Hetja checks it's Kalu's tag, then asks for your location once.")).not.toBeNull();
    expect(
      screen.getByText("Location proves the collar is out in the ward, not in a drawer. Only the ward is kept."),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Scan Kalu's collar" })).not.toBeNull();
    // No paste box, no "confirm without paste".
    expect(screen.queryByText(/paste/i)).toBeNull();
    expect(screen.getByRole("link", { name: "‹ Registrations" }).getAttribute("href")).toBe("/register");
  });

  it("P2: a typed code for another dog names both dogs and never activates", async () => {
    apiMock.getRegistrationV6!.mockResolvedValue(PENDING);
    apiMock.checkRegistrationTag!.mockResolvedValue({
      match: false,
      expected: { slug: "k2au9pd3z", name: "Kalu" },
      scanned: { slug: "m6ot5hce4", name: "Moti" },
    });
    render(<RegistrationClient slug="k2au9pd3z" />);
    fireEvent.click(await screen.findByRole("button", { name: "Type the code instead" }));
    const input = screen.getByLabelText("Code on the tag");
    await act(async () => {
      fireEvent.change(input, { target: { value: "M6OT5HCE4" } });
    });
    // A full code checks itself (onComplete); "Check this code" is the manual path.
    expect(await screen.findByText("That's Moti's tag.")).not.toBeNull();
    expect(screen.getByText("You're confirming Kalu. Find the tag printed on 23 Sep.")).not.toBeNull();
    expect(screen.getByText("M6O T5H CE4")).not.toBeNull();
    expect(screen.getByText("K2A U9P D3Z")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Kalu's tag is lost? Reprint it" }).getAttribute("href")).toBe(
      "/register/k2au9pd3z/print",
    );
    expect(apiMock.createScan).not.toHaveBeenCalled();
  });

  it("P3: the right code activates with the location, then says the dog is live", async () => {
    apiMock.getRegistrationV6!.mockResolvedValue(PENDING);
    apiMock.createScan!.mockResolvedValue({ ok: true });
    render(<RegistrationClient slug="k2au9pd3z" />);
    fireEvent.click(await screen.findByRole("button", { name: "Type the code instead" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Code on the tag"), { target: { value: "K2AU9PD3Z" } });
    });
    expect(await screen.findByText("Kalu is live.")).not.toBeNull();
    const scan = apiMock.createScan!.mock.calls[0]![0] as { type: string; dogSlug: string; geo: unknown };
    expect(scan.type).toBe("retag");
    expect(scan.dogSlug).toBe("k2au9pd3z");
    expect(scan.geo).toEqual({ lat: 19.13, lng: 72.83 });
    expect(
      screen.getByText("Anyone who scans the collar now sees Kalu's page. You're listed as a feeder."),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: /Write Kalu's story/ }).getAttribute("href")).toBe("/me/dogs/k2au9pd3z/story");
    expect(screen.getByRole("link", { name: /Log today's feed/ }).getAttribute("href")).toBe("/feed?dog=k2au9pd3z");
    expect(screen.getByRole("link", { name: "Open Kalu's page" }).getAttribute("href")).toBe("/d/k2au9pd3z");
    expect(screen.getByRole("link", { name: "Register another dog" }).getAttribute("href")).toBe("/register/new");
  });

  it("P4: a live registration is a place to manage the dog", async () => {
    apiMock.getRegistrationV6!.mockResolvedValue({
      slug: "r4n7kw2ab",
      name: "Rani",
      status: "active",
      wardId: "K-West",
      registeredAt: "2026-07-20T10:00:00Z",
      collarUrl: collarUrl("r4n7kw2ab"),
      liveSince: "2026-07-27T10:00:00Z",
      lastScanAt: new Date(Date.now() - 2 * DAY - 1000).toISOString(),
      feederNames: ["Arjun M."],
    });
    render(<RegistrationClient slug="r4n7kw2ab" />);
    expect(await screen.findByText("R4N 7KW 2AB")).not.toBeNull();
    expect(screen.getByText("Live since 27 Jul")).not.toBeNull();
    expect(screen.getByText("Scanned 2 days ago")).not.toBeNull();
    expect(screen.getByText("Same code. Old tags keep working.")).not.toBeNull();
    expect(screen.getByText("You and Arjun M.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Invite" })).not.toBeNull();
    expect(screen.getByRole("link", { name: /Rani hasn't been seen/ }).getAttribute("href")).toBe("/me/dogs/r4n7kw2ab/status");
    expect(screen.getByRole("link", { name: "Log a feed for Rani" }).getAttribute("href")).toBe("/feed?dog=r4n7kw2ab");
  });
});

describe("P5 laser on TPU", () => {
  it("switches to the 40 mm laser sheet with the shop's specs one tap away", async () => {
    apiMock.getCollar!.mockResolvedValue({ slug: "k2au9pd3z", name: "Kalu", wardId: "K-West", collarUrl: collarUrl("k2au9pd3z") });
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, configurable: true, writable: true });
    const { container } = render(<PrintClient slug="k2au9pd3z" />);
    expect(await screen.findByText("Print the tag")).not.toBeNull();
    await screen.findByRole("img", { name: "Preview of the A4 sheet" });
    fireEvent.click(screen.getByLabelText("Laser on TPU"));
    expect(screen.getByText("40 × 40 mm")).not.toBeNull();
    expect(screen.getByText("100%, never smaller")).not.toBeNull();
    expect(screen.getByText("Cut on the dashed line")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /For the print shop/ }));
    expect(screen.getByText("TPU, Shore 95A")).not.toBeNull();
    // The printed output stays the 40 mm sheet.
    const sheet = container.querySelector("[data-laser-sheet]")!;
    expect(sheet.querySelector("svg")!.getAttribute("width")).toBe("40mm");
    expect(sheet.textContent).toContain("K2A U9P D3Z");
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as PDF to send to a shop" }));
    expect(print).toHaveBeenCalledTimes(2);
    expect(apiMock.recordPrint).toHaveBeenCalledWith("k2au9pd3z", { layout: "tags", paper: "a4", tagCount: 1 });
  });
});

describe("P6 at the slot limit", () => {
  it("is checked on open and names the dogs holding the slots", async () => {
    apiMock.getFeederMe!.mockResolvedValue(me({ registrationBudget: { pending: 2, max: 2 } }));
    apiMock.getRegistrationsV6!.mockResolvedValue({
      registrations: [],
      budget: {
        pending: 2,
        max: 2,
        holders: [
          { slug: "k2au9pd3z", name: "Kalu", printedAt: "2026-09-23T10:00:00Z", daysLeft: 12 },
          { slug: "shr8a5ae3", name: "Sheru", printedAt: null, daysLeft: 13 },
        ],
      },
    });
    render(<RegisterFlow />);
    expect(await screen.findByText("2 of 2 collars waiting")).not.toBeNull();
    expect(screen.getByText("Put one of these on first.")).not.toBeNull();
    expect(
      screen.getByText("It keeps unused codes off the street. Your third dog can start as soon as one is confirmed."),
    ).not.toBeNull();
    expect(screen.getByText("Printed 23 Sep · 12 days left")).not.toBeNull();
    expect(screen.getByText("Not printed · 13 days left")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Confirm Kalu" }).getAttribute("href")).toBe("/register/k2au9pd3z");
    expect(screen.getByRole("link", { name: "Print Sheru" }).getAttribute("href")).toBe("/register/shr8a5ae3/print");
    expect(screen.getByRole("link", { name: "Confirm Kalu's collar" }).getAttribute("href")).toBe("/register/k2au9pd3z");
    // The camera never opened.
    expect(screen.queryByText("Face in the oval. Crouch to their eye level.")).toBeNull();
  });
});

describe("pronouns come from the API's sex", () => {
  it("V14 reads it from GET /feeders/me/dogs, over the phone's memory", async () => {
    rememberDogSex("k2au9pd3z", "male");
    apiMock.getMyDogsV5!.mockResolvedValue({
      dogs: [{ slug: "k2au9pd3z", name: "Kalu", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: null, sex: "female" }],
    });
    apiMock.getRegistration!.mockResolvedValue({ ...PENDING });
    render(<ReadyClient slug="k2au9pd3z" />);
    expect(
      await screen.findByText("This is her code, for good. Print the tag, put it on, and scan it once to switch her page on."),
    ).not.toBeNull();
  });

  it("an API null means not known (they/them); the phone's memory is only for silence", async () => {
    rememberDogSex("aaa", "male");
    rememberDogSex("bbb", "female");
    apiMock.getMyDogsV5!.mockResolvedValue({
      dogs: [{ slug: "aaa", name: "A", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: null, sex: null }],
    });
    apiMock.getDog!.mockImplementation(async (slug: string) => {
      if (slug === "ccc") return { slug, sex: "male" };
      throw new ApiError("nf", { status: 404, code: "DOG_NOT_FOUND" });
    });
    expect(await loadSexes(["aaa", "bbb", "ccc"])).toEqual({ aaa: null, bbb: "female", ccc: "male" });
  });
});
