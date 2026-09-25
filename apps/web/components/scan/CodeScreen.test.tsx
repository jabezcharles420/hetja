// @vitest-environment jsdom
/**
 * /scan/code: V2 "Type the code on the collar." and V3 "No dog has this
 * code." (design v6), and F2 "Type what you can read" (design v5, at
 * ?part=1 or with a short ?code=). GET /dogs/lookup is mocked to the
 * contract's shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      el("a", { href, ...rest }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, lookupDogs: vi.fn() } };
});

import CodeScreen, { startFor } from "./CodeScreen";
import { api, ApiError, type DogCard } from "@/lib/api";

const lookupDogs = (api as unknown as { lookupDogs: ReturnType<typeof vi.fn> }).lookupDogs;
const assign = vi.fn();

const RANI: DogCard = {
  slug: "rni482pq7",
  name: "Rani",
  wardId: "K-West",
  wardCode: "K/W",
  photoUrl: null,
  markings: [],
  lastSeenAt: null,
};
const RINKU: DogCard = { ...RANI, slug: "rni407kd2", name: "Rinku", wardId: "H-West", wardCode: "H/W" };

function setUrl(search = ""): void {
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign, search, hash: "" },
    configurable: true,
    writable: true,
  });
}

const box = (i: number) => screen.getByTestId(`code-box-${i}`) as HTMLInputElement;

beforeEach(() => {
  lookupDogs.mockReset();
  assign.mockReset();
  setUrl();
});

afterEach(() => {
  cleanup();
});

describe("F2 Type what you can read", () => {
  beforeEach(() => setUrl("?part=1"));

  it("shows the mock's copy and starts in box 1", async () => {
    render(<CodeScreen />);
    expect(await screen.findByRole("heading", { name: "Type what you can read" })).not.toBeNull();
    expect(screen.getByText("Skip what you can't read. 0 and O, 1 and I are treated as the same.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Can't read any of it? Find by photo" }).getAttribute("href")).toBe(
      "/scan/find",
    );
    expect(screen.getByRole("link", { name: /Scan/ }).getAttribute("href")).toBe("/scan");
    await waitFor(() => expect(document.activeElement).toBe(box(0)));
  });

  it("moves to the next box after three characters, folding 0 and 1", async () => {
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "rn1" } });
    expect(box(0).value).toBe("RNI");
    expect(document.activeElement).toBe(box(1));
    fireEvent.change(box(1), { target: { value: "0" } });
    expect(box(1).value).toBe("O");
  });

  it("spills a pasted full code across the boxes", async () => {
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "RNI 482 PQ7" } });
    expect([box(0).value, box(1).value, box(2).value]).toEqual(["RNI", "482", "PQ7"]);
  });

  it("backspace in an empty box goes back and deletes there", async () => {
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "rni" } });
    fireEvent.keyDown(box(1), { key: "Backspace" });
    expect(box(0).value).toBe("RN");
    expect(document.activeElement).toBe(box(0));
  });

  it("waits for 4 known characters, then lists matches with ? for unknowns", async () => {
    lookupDogs.mockResolvedValue({ exact: null, matches: [RANI, RINKU], suggestions: [] });
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "rni" } });
    expect(screen.getByText("Type 1 more to see matching dogs.")).not.toBeNull();
    fireEvent.change(box(1), { target: { value: "4" } });
    expect(await screen.findByText("2 dogs match")).not.toBeNull();
    expect(lookupDogs).toHaveBeenCalledTimes(1);
    expect(lookupDogs).toHaveBeenCalledWith("rni4?????");
    expect(screen.getByText("Rani")).not.toBeNull();
    expect(screen.getByText("RNI 482 PQ7 · K/W")).not.toBeNull();
    expect(screen.getByText("RNI 407 KD2 · H/W")).not.toBeNull();
    expect(screen.getByText("Check the photo before you log anything.")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Rani/ }).getAttribute("href")).toBe("/d/rni482pq7");
  });

  it("debounces: fast typing makes one lookup", async () => {
    lookupDogs.mockResolvedValue({ exact: null, matches: [RANI], suggestions: [] });
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "rni" } });
    fireEvent.change(box(1), { target: { value: "4" } });
    fireEvent.change(box(1), { target: { value: "48" } });
    fireEvent.change(box(1), { target: { value: "482" } });
    expect(await screen.findByText("1 dog matches")).not.toBeNull();
    expect(lookupDogs).toHaveBeenCalledTimes(1);
    expect(lookupDogs).toHaveBeenCalledWith("rni482???");
  });

  it("says so when nothing matches", async () => {
    lookupDogs.mockResolvedValue({ exact: null, matches: [], suggestions: [] });
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "zzzz" } });
    expect(await screen.findByText("No dogs match")).not.toBeNull();
  });

  it("opens the dog for a full code that exists", async () => {
    lookupDogs.mockResolvedValue({ exact: RANI, matches: [], suggestions: [] });
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "rni482pq7" } });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/d/rni482pq7"));
  });

  it("a whole ?code= opens V2, checks it, and keeps ?intent=feed on the way out", async () => {
    setUrl("?code=rni482pq7&intent=feed");
    lookupDogs.mockResolvedValue({ exact: RANI, matches: [], suggestions: [] });
    render(<CodeScreen />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/feed?dog=rni482pq7"));
  });

  it("explains a network failure in the v4 voice", async () => {
    lookupDogs.mockRejectedValue(new ApiError("offline", { status: 0, code: "NETWORK_ERROR" }));
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "rni4" } });
    expect((await screen.findByRole("alert")).textContent).toContain("No signal.");
  });

  it("offers Try again after a server error", async () => {
    lookupDogs.mockRejectedValueOnce(new ApiError("boom", { status: 500 }));
    lookupDogs.mockResolvedValueOnce({ exact: null, matches: [RANI], suggestions: [] });
    render(<CodeScreen />);
    await screen.findByTestId("code-box-0");
    fireEvent.change(box(0), { target: { value: "rni4" } });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("1 dog matches")).not.toBeNull();
  });
});

describe("startFor", () => {
  it("opens V2 by default and F2 for part of a code", () => {
    expect(startFor("")).toEqual({ mode: "full", code: "" });
    expect(startFor("?code=rni482pq7")).toEqual({ mode: "full", code: "rni482pq7" });
    expect(startFor("?code=rni4")).toEqual({ mode: "part", code: "rni4" });
    expect(startFor("?part=1")).toEqual({ mode: "part", code: "" });
  });
});

const field = () => screen.getByLabelText("Collar code") as HTMLInputElement;

describe("V2 Type the code on the collar", () => {
  it("shows the mock's copy, a counter, and enables Find the dog at 9", async () => {
    render(<CodeScreen />);
    expect(screen.getByRole("heading", { name: "Type the code on the collar." })).not.toBeNull();
    expect(
      screen.getByText("Nine letters and numbers, printed under the QR. Capitals or not, it doesn't matter."),
    ).not.toBeNull();
    expect(screen.getByText("Easy to mix up: 0 and O, 1 and I. Hetja reads them as the same.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Use the camera instead ›" }).getAttribute("href")).toBe("/scan");
    const find = screen.getByRole("button", { name: "Find the dog" }) as HTMLButtonElement;
    expect(find.disabled).toBe(true);
    expect(screen.getByText("0 / 9")).not.toBeNull();
    fireEvent.change(field(), { target: { value: "R4N 7KW 2A" } });
    expect(screen.getByText("One more to go")).not.toBeNull();
    expect(screen.getByText("8 / 9")).not.toBeNull();
    expect(find.disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "R4N 7KW 2AB" } });
    expect(screen.getByText("9 / 9")).not.toBeNull();
    expect(find.disabled).toBe(false);
  });

  it("reads 0 as O and 1 as I instead of dropping them", () => {
    render(<CodeScreen />);
    fireEvent.change(field(), { target: { value: "r0n1" } });
    expect(field().value).toBe("RON I");
  });

  it("opens the dog when the code exists", async () => {
    lookupDogs.mockResolvedValue({ exact: RANI, matches: [], suggestions: [] });
    render(<CodeScreen />);
    fireEvent.change(field(), { target: { value: "rni482pq7" } });
    fireEvent.click(screen.getByRole("button", { name: "Find the dog" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/d/rni482pq7"));
    expect(lookupDogs).toHaveBeenCalledWith("rni482pq7");
  });

  it("switches to the three boxes for part of a code", async () => {
    render(<CodeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Can't read all of it/ }));
    expect(await screen.findByRole("heading", { name: "Type what you can read" })).not.toBeNull();
  });

  it("explains a network failure without leaving the screen", async () => {
    lookupDogs.mockRejectedValue(new ApiError("offline", { status: 0, code: "NETWORK_ERROR" }));
    render(<CodeScreen />);
    fireEvent.change(field(), { target: { value: "rni482pq7" } });
    fireEvent.click(screen.getByRole("button", { name: "Find the dog" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No signal.");
  });
});

const RANI_F: DogCard = { ...RANI, slug: "r4n7kw2ab", sex: "female" };

async function miss(code: string, suggestions: DogCard[]) {
  lookupDogs.mockResolvedValue({ exact: null, matches: [], suggestions });
  render(<CodeScreen />);
  fireEvent.change(field(), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Find the dog" }));
  await screen.findByText("No dog has this code.");
}

describe("V3 No dog has this code", () => {
  it("offers the one near match by photo, name and ward", async () => {
    await miss("r4n7kw2ar", [RANI_F]);
    expect(screen.getByText("One letter off. Is it her?")).not.toBeNull();
    expect(screen.getByText("Rani")).not.toBeNull();
    expect(screen.getByText("K/W ward \u00b7 Andheri West")).not.toBeNull();
    // The differing character is marked.
    expect(screen.getByText("B").tagName).toBe("B");
    expect(field().value).toBe("R4N 7KW 2AR");
    fireEvent.click(screen.getByRole("button", { name: "Yes, that's Rani" }));
    expect(assign).toHaveBeenCalledWith("/d/r4n7kw2ab");
  });

  it("Not her. Type it again clears the field and goes back to V2", async () => {
    await miss("r4n7kw2ar", [RANI_F]);
    fireEvent.click(screen.getByRole("button", { name: "Not her. Type it again" }));
    expect(field().value).toBe("");
    expect(screen.getByText("0 / 9")).not.toBeNull();
    expect(screen.queryByText("No dog has this code.")).toBeNull();
  });

  it("uses the dog's name when its sex is not recorded", async () => {
    await miss("r4n7kw2ar", [{ ...RANI_F, sex: null }]);
    expect(screen.getByText("One letter off. Is it Rani?")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Not Rani. Type it again" })).not.toBeNull();
  });

  it("lists several near matches to pick from", async () => {
    await miss("rni428pq7", [RANI, RINKU]);
    expect(screen.getByText("One letter off. Is it one of these?")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Rinku/ }).getAttribute("href")).toBe("/d/rni407kd2");
    expect(screen.getByRole("button", { name: "None of these. Type it again" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Yes, that's/ })).toBeNull();
  });

  it("says plainly when nothing is close, and keeps Find by ward and photo and Tag looks fake", async () => {
    await miss("rni428pq7", []);
    expect(screen.queryByText(/Is it/)).toBeNull();
    expect(screen.getByText(/Nothing on Hetja is one letter off either/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Find by ward and photo" }).getAttribute("href")).toBe("/scan/find");
    fireEvent.click(screen.getByRole("button", { name: "Tag looks fake" }));
    const dialog = screen.getByRole("dialog", { name: "If the tag looks fake" });
    expect(dialog.textContent).toContain("Don't log a feed on it");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Type it again" })).not.toBeNull();
  });

  it("editing the code goes back to V2", async () => {
    await miss("r4n7kw2ar", [RANI_F]);
    fireEvent.change(field(), { target: { value: "r4n7kw2a" } });
    expect(screen.queryByText("No dog has this code.")).toBeNull();
    expect(screen.getByText("One more to go")).not.toBeNull();
  });

  it("a full code typed into F2's boxes that is no dog lands on V3", async () => {
    setUrl("?part=1");
    lookupDogs.mockResolvedValue({ exact: null, matches: [], suggestions: [RANI_F] });
    render(<CodeScreen />);
    fireEvent.change(await screen.findByTestId("code-box-0"), { target: { value: "r4n7kw2ar" } });
    expect(await screen.findByText("No dog has this code.")).not.toBeNull();
    expect(screen.getByText("One letter off. Is it her?")).not.toBeNull();
    expect(field().value).toBe("R4N 7KW 2AR");
  });
});
