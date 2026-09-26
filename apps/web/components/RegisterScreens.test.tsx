// @vitest-environment jsdom
/**
 * Design v5 register and print: R1 Start, R2 to R5 (one flow), R6 Code
 * ready, R7 Print tag, R8 Batch sheet. The API is mocked to the v5 shapes in
 * lib/api.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className }, children),
  };
});

vi.mock("@/lib/device", async () => {
  const actual = await vi.importActual<typeof import("@/lib/device")>("@/lib/device");
  return {
    ...actual,
    readCachedDeviceToken: () => "cached",
    getDeviceToken: () => Promise.resolve({ ok: true, token: "dev.tok", minted: false }),
  };
});

// The browser photo pipeline (compressorjs + canvas) does not run in jsdom.
vi.mock("@/lib/photo", () => ({
  prepareFeedPhoto: vi.fn(async () => ({
    blob: new Blob(["face"], { type: "image/jpeg" }),
    geo: { lat: 19.13, lng: 72.83 },
  })),
}));

vi.mock("@/lib/offline-queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/offline-queue")>("@/lib/offline-queue");
  return { ...actual, captureGeo: vi.fn(async () => undefined), blobToBase64: vi.fn(async () => "ZmFjZQ==") };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getFeederMe: vi.fn(),
      getWards: vi.fn(),
      createRegistration: vi.fn(),
      getRegistration: vi.fn(),
      getWardDogs: vi.fn(),
      getCollar: vi.fn(),
      getCollarBatch: vi.fn(),
      recordPrint: vi.fn(),
      getMyDogsV5: vi.fn(),
      getDogTags: vi.fn(),
      resolveTagReport: vi.fn(),
      getDog: vi.fn(),
    },
  };
});

import RegisterFlow, {
  REGISTRATION_WEEKLY_CAP_MESSAGE,
  nearestWard,
  wardLabel,
} from "@/app/(register)/register/new/RegisterFlow";
import ReadyClient, { readyTitle } from "@/app/(register)/register/[slug]/ready/ReadyClient";
import PrintClient from "@/app/(register)/register/[slug]/print/PrintClient";
import BatchClient, { batchNote, initialSelection } from "@/app/(register)/register/batch/BatchClient";
import { api, ApiError, type MyDogV5 } from "@/lib/api";
import { dogCopy, rememberDogSex } from "@/lib/dog-copy";

const apiMock = api as unknown as Record<
  | "getFeederMe"
  | "getWards"
  | "createRegistration"
  | "getRegistration"
  | "getWardDogs"
  | "getCollar"
  | "getCollarBatch"
  | "recordPrint"
  | "getMyDogsV5"
  | "getDogTags"
  | "resolveTagReport"
  | "getDog",
  ReturnType<typeof vi.fn>
>;

const WARDS = [
  { id: "A", code: "A", name: "Colaba" },
  { id: "K-West", code: "K/W", name: "Andheri West" },
];

const SIG = "abcdEfGhIjKlMnOpQrStUvWxYz0123456789-_A1234";
const collarUrl = (slug: string) => `https://hetja.in/d/${slug}?s=${SIG}`;

function me(homeWard: string | null = "K-West") {
  return { role: "registrator", capabilities: ["register"], homeWard, displayName: "Priya", publicName: "Priya S." };
}

beforeEach(() => {
  push.mockReset();
  localStorage.clear();
  apiMock.getFeederMe.mockResolvedValue(me());
  apiMock.getWards.mockResolvedValue({ wards: WARDS });
  apiMock.createRegistration.mockResolvedValue({ slug: "rni482pq7" });
  apiMock.recordPrint.mockResolvedValue({ id: "p1" });
  apiMock.getDogTags.mockResolvedValue({ open: [], history: [], reportsThisWeek: 0, sturdierCollarSuggested: false });
  apiMock.resolveTagReport.mockResolvedValue({ id: "x", resolution: "reprinted" });
  apiMock.getMyDogsV5.mockResolvedValue({ dogs: [] });
  apiMock.getDog.mockRejectedValue(new ApiError("not found", { status: 404, code: "DOG_NOT_FOUND" }));
  apiMock.getWardDogs.mockResolvedValue({
    wardId: "K-West",
    total: 1,
    colourTotal: 1,
    dogs: [
      {
        slug: "bho2ri4xk",
        name: "Bhoori",
        wardId: "K-West",
        wardCode: "K/W",
        photoUrl: null,
        markings: ["Brown", "White chest"],
        lastSeenAt: new Date(Date.now() - 86_400_000 - 1000).toISOString(),
      },
    ],
  });
  if (typeof URL.createObjectURL !== "function") {
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:x"), configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
  }
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

async function throughPhoto(): Promise<void> {
  expect(await screen.findByText("Face in the oval. Crouch to their eye level.")).not.toBeNull();
  const gallery = screen.getByLabelText("Choose a photo from the gallery");
  const file = new File(["jpg"], "dog.jpg", { type: "image/jpeg" });
  await act(async () => {
    fireEvent.change(gallery, { target: { files: [file] } });
  });
  expect(await screen.findByText("Is this dog already registered?")).not.toBeNull();
}

describe("R2 to R5, one flow", () => {
  it("photo, duplicate check, about, confirm: sends photo, markings, sex and the health answers", async () => {
    render(<RegisterFlow />);
    await throughPhoto();

    // R3: the ward comes from the photo's (ward-coarsened) position.
    expect(await screen.findByText("K/W · Andheri West", { selector: "span" })).not.toBeNull();
    expect(screen.getByText("Ward, from your location")).not.toBeNull();
    expect(screen.getByText("Similar dogs in K/W. If one matches, add your photo to them instead.")).not.toBeNull();
    expect(await screen.findByText("Bhoori")).not.toBeNull();
    expect(screen.getByText("Brown, white chest · seen yesterday")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Same dog: Bhoori" }).getAttribute("href")).toBe("/d/bho2ri4xk");
    expect(screen.getByText("2 of 4")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "None of these, continue" }));

    // R4: pronouns follow the sex.
    expect(await screen.findByText("About them")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Female"));
    expect(screen.getByText("About her")).not.toBeNull();
    expect(screen.getByText("How to spot her")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Name people call her"), { target: { value: " Rani " } });
    fireEvent.click(screen.getByRole("button", { name: "Brown" }));
    fireEvent.click(screen.getByRole("button", { name: "White chest" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    const add = screen.getByLabelText("Add a way to spot this dog");
    fireEvent.change(add, { target: { value: "Torn ear" } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Torn ear" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Health, if you know")).not.toBeNull();
    const vacc = screen.getByRole("radiogroup", { name: "Vaccinated" });
    fireEvent.click(vacc.querySelector('input[value="yes"]')!);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // R5
    expect(await screen.findByText("Check and confirm")).not.toBeNull();
    expect(screen.getByText("Female · Brown, white chest, torn ear")).not.toBeNull();
    expect(screen.getByText("Priya S.")).not.toBeNull();
    expect(
      screen.getByText("Your phone and email are never shown. The profile shows your first name and initial."),
    ).not.toBeNull();
    const register = screen.getByRole("button", { name: "Register Rani" });
    expect((register as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I see her at least once a week."));
    expect((register as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I won't post where she sleeps or eats."));
    expect((register as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(register);

    await waitFor(() => expect(apiMock.createRegistration).toHaveBeenCalledTimes(1));
    const [input, token] = apiMock.createRegistration.mock.calls[0]!;
    expect(token).toBe("dev.tok");
    expect(input).toEqual({
      wardId: "K-West",
      name: "Rani",
      sex: "female",
      vaccinatedReported: true,
      markings: ["Brown", "White chest", "Torn ear"],
      photoBase64: expect.any(String),
    });
    expect((input as { photoBase64: string }).photoBase64.length).toBeGreaterThan(0);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/register/rni482pq7/ready"));
    expect(localStorage.getItem("hetja.dogSex.rni482pq7")).toBe("female");
  });

  it("v7 N5: from a drive, sends driveId and returns to the drive", async () => {
    window.history.replaceState({}, "", "/register/new?drive=drv_123");
    render(<RegisterFlow />);
    await throughPhoto();
    await screen.findByText("K/W · Andheri West", { selector: "span" });
    fireEvent.click(screen.getByRole("button", { name: "None of these, continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByText("Check and confirm");
    fireEvent.click(screen.getByLabelText("I see them at least once a week."));
    fireEvent.click(screen.getByLabelText("I won't post where they sleep or eat."));
    fireEvent.click(screen.getByRole("button", { name: "Register this dog" }));
    await waitFor(() => expect(apiMock.createRegistration).toHaveBeenCalledTimes(1));
    expect(apiMock.createRegistration.mock.calls[0]![0]).toMatchObject({ wardId: "K-West", driveId: "drv_123" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/ngo/drives/drv_123"));
    window.history.replaceState({}, "", "/");
  });

  it("ignores a drive id that is not a plain id", async () => {
    window.history.replaceState({}, "", "/register/new?drive=..%2Fadmin");
    render(<RegisterFlow />);
    await throughPhoto();
    await screen.findByText("K/W · Andheri West", { selector: "span" });
    fireEvent.click(screen.getByRole("button", { name: "None of these, continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByText("Check and confirm");
    fireEvent.click(screen.getByLabelText("I see them at least once a week."));
    fireEvent.click(screen.getByLabelText("I won't post where they sleep or eat."));
    fireEvent.click(screen.getByRole("button", { name: "Register this dog" }));
    await waitFor(() => expect(apiMock.createRegistration).toHaveBeenCalledTimes(1));
    expect(apiMock.createRegistration.mock.calls[0]![0]).not.toHaveProperty("driveId");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/register/rni482pq7/ready"));
    window.history.replaceState({}, "", "/");
  });

  it("explains the weekly cap plainly on 429 REGISTRATION_WEEKLY_CAP", async () => {
    apiMock.createRegistration.mockRejectedValue(
      new ApiError("weekly cap", { status: 429, code: "REGISTRATION_WEEKLY_CAP" }),
    );
    render(<RegisterFlow />);
    await throughPhoto();
    await screen.findByText("K/W · Andheri West", { selector: "span" });
    fireEvent.click(screen.getByRole("button", { name: "None of these, continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByText("Check and confirm");
    fireEvent.click(screen.getByLabelText("I see them at least once a week."));
    fireEvent.click(screen.getByLabelText("I won't post where they sleep or eat."));
    fireEvent.click(screen.getByRole("button", { name: "Register this dog" }));
    expect(await screen.findByText(REGISTRATION_WEEKLY_CAP_MESSAGE)).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("maps a Mumbai position to its nearest ward and refuses one outside Mumbai", () => {
    expect(nearestWard(19.13, 72.83)).toBe("K-West");
    expect(nearestWard(18.92, 72.83)).toBe("A");
    expect(nearestWard(28.6, 77.2)).toBeNull();
    expect(wardLabel(WARDS[1]!)).toBe("K/W · Andheri West");
  });
});

describe("V14 Code ready (keeps R6's QR and pill)", () => {
  it("says what happens next, with the real QR, the grouped code and the Unverified pill", async () => {
    rememberDogSex("k2au9pd3z", "male");
    apiMock.getRegistration.mockResolvedValue({
      slug: "k2au9pd3z",
      name: "Kalu",
      status: "pending_activation",
      wardId: "K-West",
      registeredAt: null,
      collarUrl: collarUrl("k2au9pd3z"),
    });
    const { container } = render(<ReadyClient slug="k2au9pd3z" />);
    expect(await screen.findByText("Kalu is almost on Hetja.")).not.toBeNull();
    expect(
      screen.getByText("This is his code, for good. Print the tag, put it on, and scan it once to switch his page on."),
    ).not.toBeNull();
    expect(["K2A", "U9P", "D3Z"].every((g) => screen.getByText(g))).toBe(true);
    expect(screen.getByText("Kalu · Scan me if I look lost")).not.toBeNull();
    expect(screen.getByText("Unverified · needs one confirmation")).not.toBeNull();
    expect(container.querySelector("svg path")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Print Kalu's tag" }).getAttribute("href")).toBe("/register/k2au9pd3z/print");
    expect(screen.getByRole("link", { name: "I'll print it later" }).getAttribute("href")).toBe("/register");
  });

  it("words a nameless dog sensibly", () => {
    expect(readyTitle(null)).toBe("Your dog is almost on Hetja.");
    expect(readyTitle("Rani")).toBe("Rani is almost on Hetja.");
  });
});

describe("pronouns", () => {
  it("follow the sex and fall back to they/them", () => {
    expect(dogCopy.aboutTitle("female")).toBe("About her");
    expect(dogCopy.aboutTitle("male")).toBe("About him");
    expect(dogCopy.aboutTitle("unknown")).toBe("About them");
    expect(dogCopy.noPosting("female")).toBe("I won't post where she sleeps or eats.");
    expect(dogCopy.noticeLead("female")).toBe(
      "She lives on this street. Neighbours feed her and a vet checks on her.",
    );
    expect(dogCopy.noticeLead(null)).toBe("They live on this street. Neighbours feed them and a vet checks on them.");
    expect(dogCopy.justFedBody("male")).toBe("Scan and log it, so he isn't fed three times today.");
  });
});

describe("R7 + P5 Print the tag (paper)", () => {
  beforeEach(() => {
    apiMock.getCollar.mockResolvedValue({ slug: "rni482pq7", name: "Rani", wardId: "K-West", collarUrl: collarUrl("rni482pq7") });
  });

  it("offers the three layouts and the paper, and records every sheet it makes", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PrintClient slug="rni482pq7" />);
    expect(await screen.findByText("Print the tag")).not.toBeNull();
    for (const t of [
      "10 small tags + collar band",
      "Coin-sized, 32 × 46 mm",
      "1 large tag + wall notice",
      "For a shop or society gate",
      "Add to a batch sheet",
      "8 different dogs on one page",
      "Paper",
    ]) {
      expect(screen.getByText(t)).not.toBeNull();
    }
    expect(await screen.findByRole("link", { name: "‹ Rani" })).not.toBeNull();
    expect(await screen.findByRole("img", { name: "Preview of the A4 sheet" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(apiMock.recordPrint).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(apiMock.recordPrint).toHaveBeenCalledWith("rni482pq7", { layout: "tags", paper: "a4", tagCount: 10 });
    await waitFor(() => expect(click).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText("1 large tag + wall notice", { exact: false }));
    fireEvent.click(screen.getByLabelText("Letter"));
    expect(screen.getByRole("img", { name: "Preview of the Letter sheet" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send to a print shop" }));
    await waitFor(() => expect(apiMock.recordPrint).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    expect(apiMock.recordPrint).toHaveBeenLastCalledWith("rni482pq7", { layout: "notice", paper: "letter", tagCount: 1 });

    fireEvent.click(screen.getByLabelText("Add to a batch sheet", { exact: false }));
    expect(push).toHaveBeenCalledWith("/register/batch?add=rni482pq7");
    click.mockRestore();
  }, 20_000);

  it("never lets a failed print record block the download", async () => {
    apiMock.recordPrint.mockRejectedValue(new Error("offline"));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PrintClient slug="rni482pq7" />);
    await screen.findByRole("img", { name: "Preview of the A4 sheet" });
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(click).toHaveBeenCalled(), { timeout: 10_000 });
    click.mockRestore();
  }, 20_000);
});

describe("R7 reprint closes the tag problem", () => {
  const OPEN = [
    { id: "d1", kind: "damaged", createdAt: "2026-09-24T10:00:00Z", reporter: "a passer-by" },
    { id: "w1", kind: "wrong_dog", createdAt: "2026-09-24T11:00:00Z", reporter: "a passer-by" },
    { id: "f1", kind: "found_on_ground", createdAt: "2026-09-24T12:00:00Z", reporter: "Anil" },
  ];

  beforeEach(() => {
    apiMock.getCollar.mockResolvedValue({ slug: "rni482pq7", name: "Rani", wardId: "K-West", collarUrl: collarUrl("rni482pq7") });
    apiMock.getDogTags.mockResolvedValue({ open: OPEN, history: [], reportsThisWeek: 3, sturdierCollarSuggested: true });
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  async function downloadOnce(): Promise<void> {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PrintClient slug="rni482pq7" />);
    await screen.findByRole("img", { name: "Preview of the A4 sheet" });
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(click).toHaveBeenCalled(), { timeout: 10_000 });
    click.mockRestore();
  }

  it("resolves the F6 report it was opened for as reprinted", async () => {
    window.history.replaceState({}, "", "/register/rni482pq7/print?report=d1");
    await downloadOnce();
    await waitFor(() => expect(apiMock.resolveTagReport).toHaveBeenCalledWith("rni482pq7", "d1", "reprinted"));
    expect(apiMock.resolveTagReport).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("without a report id, resolves the open damaged and found-on-ground reports, never wrong_dog", async () => {
    await downloadOnce();
    await waitFor(() => expect(apiMock.resolveTagReport).toHaveBeenCalledTimes(2));
    expect(apiMock.resolveTagReport).toHaveBeenCalledWith("rni482pq7", "d1", "reprinted");
    expect(apiMock.resolveTagReport).toHaveBeenCalledWith("rni482pq7", "f1", "reprinted");
    expect(apiMock.resolveTagReport).not.toHaveBeenCalledWith("rni482pq7", "w1", expect.anything());
  }, 20_000);

  it("leaves a wrong_dog report for a feeder's check even when it is handed over", async () => {
    window.history.replaceState({}, "", "/register/rni482pq7/print?report=w1");
    await downloadOnce();
    await waitFor(() => expect(apiMock.getDogTags).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(apiMock.resolveTagReport).not.toHaveBeenCalled();
  }, 20_000);

  it("still downloads when the tag endpoints fail", async () => {
    apiMock.getDogTags.mockRejectedValue(new ApiError("forbidden", { status: 403, code: "FORBIDDEN" }));
    apiMock.resolveTagReport.mockRejectedValue(new Error("offline"));
    window.history.replaceState({}, "", "/register/rni482pq7/print?report=d1");
    await downloadOnce();
    await waitFor(() => expect(apiMock.resolveTagReport).toHaveBeenCalledWith("rni482pq7", "d1", "reprinted"));
  }, 20_000);
});

describe("R8 Batch sheet", () => {
  const dogs: MyDogV5[] = [
    { slug: "rni482pq7", name: "Rani", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: null, status: "pending_activation" },
    { slug: "bru017xk2", name: "Bruno", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: null, status: "active", attention: { kind: "tag", since: "2026-09-20", detail: null } },
    { slug: "kab233mt8", name: "Kalu", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: null, status: "active" },
    { slug: "tgr772nc5", name: "Tiger", wardId: "K-West", wardName: null, lastFedAt: null, myLastFedAt: null, status: "active" },
  ];

  it("notes New, Reprint and Printed and ticks what is not printed yet", () => {
    const printed = { tgr772nc5: 1 };
    expect(batchNote(dogs[0]!, printed)).toBe("New");
    expect(batchNote(dogs[1]!, printed)).toBe("Reprint");
    expect(batchNote(dogs[2]!, printed)).toBe("");
    expect(batchNote(dogs[3]!, printed)).toBe("Printed");
    const rows = dogs.map((d) => ({ slug: d.slug, name: d.name, note: batchNote(d, printed) }));
    expect(initialSelection(rows, null)).toEqual(["rni482pq7", "bru017xk2", "kab233mt8"]);
    expect(initialSelection(rows, "tgr772nc5")[0]).toBe("tgr772nc5");
  });

  it("builds the sheet from POST /collars/batch and records each dog", async () => {
    localStorage.setItem("hetja.printedTags", JSON.stringify({ tgr772nc5: 1 }));
    apiMock.getMyDogsV5.mockResolvedValue({ dogs });
    apiMock.getCollarBatch.mockImplementation(async (slugs: string[]) => ({
      dogs: slugs.map((slug) => ({ slug, name: "Dog", wardId: "K-West", collarUrl: collarUrl(slug) })),
      skipped: [],
    }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<BatchClient />);
    expect(await screen.findByText("Batch sheet")).not.toBeNull();
    expect(await screen.findByText("3 of 8 slots on this A4 page")).not.toBeNull();
    expect(screen.getByText("RNI 482 PQ7")).not.toBeNull();
    expect(screen.getByText("New")).not.toBeNull();
    expect(screen.getByText("Reprint")).not.toBeNull();
    expect(screen.getByText("Printed")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("4 of 8 slots on this A4 page")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download sheet · 4 tags" }));
    await waitFor(() => expect(apiMock.getCollarBatch).toHaveBeenCalledWith(["rni482pq7", "bru017xk2", "kab233mt8", "tgr772nc5"]));
    await waitFor(() => expect(apiMock.recordPrint).toHaveBeenCalledTimes(4), { timeout: 10_000 });
    expect(apiMock.recordPrint).toHaveBeenCalledWith("kab233mt8", { layout: "batch", paper: "a4", tagCount: 2 });
    await waitFor(() => expect(click).toHaveBeenCalled());
    click.mockRestore();
  }, 20_000);
});
