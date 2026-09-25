// @vitest-environment jsdom
/**
 * F2 "Type what you can read" and N8 "No dog has this code." (design v5).
 * GET /dogs/lookup is mocked to the contract's shape.
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

import CodeScreen from "./CodeScreen";
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
  it("shows the mock's copy and starts in box 1", async () => {
    render(<CodeScreen />);
    expect(screen.getByRole("heading", { name: "Type what you can read" })).not.toBeNull();
    expect(screen.getByText("Skip what you can't read. 0 and O, 1 and I are treated as the same.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Can't read any of it? Find by photo" }).getAttribute("href")).toBe(
      "/scan/find",
    );
    expect(screen.getByRole("link", { name: /Scan/ }).getAttribute("href")).toBe("/scan");
    await waitFor(() => expect(document.activeElement).toBe(box(0)));
  });

  it("moves to the next box after three characters, folding 0 and 1", () => {
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rn1" } });
    expect(box(0).value).toBe("RNI");
    expect(document.activeElement).toBe(box(1));
    fireEvent.change(box(1), { target: { value: "0" } });
    expect(box(1).value).toBe("O");
  });

  it("spills a pasted full code across the boxes", () => {
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "RNI 482 PQ7" } });
    expect([box(0).value, box(1).value, box(2).value]).toEqual(["RNI", "482", "PQ7"]);
  });

  it("backspace in an empty box goes back and deletes there", () => {
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rni" } });
    fireEvent.keyDown(box(1), { key: "Backspace" });
    expect(box(0).value).toBe("RN");
    expect(document.activeElement).toBe(box(0));
  });

  it("waits for 4 known characters, then lists matches with ? for unknowns", async () => {
    lookupDogs.mockResolvedValue({ exact: null, matches: [RANI, RINKU], suggestions: [] });
    render(<CodeScreen />);
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
    fireEvent.change(box(0), { target: { value: "zzzz" } });
    expect(await screen.findByText("No dogs match")).not.toBeNull();
  });

  it("opens the dog for a full code that exists", async () => {
    lookupDogs.mockResolvedValue({ exact: RANI, matches: [], suggestions: [] });
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rni482pq7" } });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/d/rni482pq7"));
  });

  it("prefills from ?code= and keeps ?intent=feed on the way out", async () => {
    setUrl("?code=rni482pq7&intent=feed");
    lookupDogs.mockResolvedValue({ exact: RANI, matches: [], suggestions: [] });
    render(<CodeScreen />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/feed?dog=rni482pq7"));
  });

  it("explains a network failure in the v4 voice", async () => {
    lookupDogs.mockRejectedValue(new ApiError("offline", { status: 0, code: "NETWORK_ERROR" }));
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rni4" } });
    expect((await screen.findByRole("alert")).textContent).toContain("No signal.");
  });

  it("offers Try again after a server error", async () => {
    lookupDogs.mockRejectedValueOnce(new ApiError("boom", { status: 500 }));
    lookupDogs.mockResolvedValueOnce({ exact: null, matches: [RANI], suggestions: [] });
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rni4" } });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("1 dog matches")).not.toBeNull();
  });
});

describe("N8 No dog has this code", () => {
  it("shows the code, the mock's copy and the suggestion", async () => {
    lookupDogs.mockResolvedValue({ exact: null, matches: [], suggestions: [RANI] });
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rni428pq7" } });
    expect(await screen.findByRole("heading", { name: "No dog has this code." })).not.toBeNull();
    expect(screen.getByText("RNI 428 PQ7")).not.toBeNull();
    expect(screen.getByText("Two digits may be swapped. Did you mean this dog?")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Rani/ }).getAttribute("href")).toBe("/d/rni482pq7");
    expect(screen.getByRole("button", { name: "Type it again" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Find by ward and photo" }).getAttribute("href")).toBe("/scan/find");
    expect(screen.getByRole("button", { name: "Tag looks fake" })).not.toBeNull();
  });

  it("says plainly when there is nothing close, with no suggestion card", async () => {
    lookupDogs.mockResolvedValue({ exact: null, matches: [], suggestions: [] });
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rni428pq7" } });
    await screen.findByRole("heading", { name: "No dog has this code." });
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    expect(screen.getByText(/one swap or one letter away/)).not.toBeNull();
  });

  it("Type it again clears the boxes", async () => {
    lookupDogs.mockResolvedValue({ exact: null, matches: [], suggestions: [] });
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rni428pq7" } });
    fireEvent.click(await screen.findByRole("button", { name: "Type it again" }));
    expect(screen.getByRole("heading", { name: "Type what you can read" })).not.toBeNull();
    expect([box(0).value, box(1).value, box(2).value]).toEqual(["", "", ""]);
  });

  it("Tag looks fake explains what to do", async () => {
    lookupDogs.mockResolvedValue({ exact: null, matches: [], suggestions: [] });
    render(<CodeScreen />);
    fireEvent.change(box(0), { target: { value: "rni428pq7" } });
    fireEvent.click(await screen.findByRole("button", { name: "Tag looks fake" }));
    const dialog = screen.getByRole("dialog", { name: "If the tag looks fake" });
    expect(dialog.textContent).toContain("Don't log a feed on it");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
