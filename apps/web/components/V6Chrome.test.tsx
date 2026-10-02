// @vitest-environment jsdom
/** Design v6 chrome pieces: D1, V1, V23. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => el("a", { href, ...rest }, children),
  };
});

vi.mock("@/lib/pwa", () => ({ isStandalone: () => false }));

import { DesktopInvite, qrPath, typedAddress } from "@/components/DesktopInvite";
import { prettyCode } from "@/lib/scan-code";
import NotFound from "@/app/not-found";
import { AddToHomeScreen, AddToHomeScreenAfterFeed } from "@/components/AddToHomeScreen";
import { __setHeldPromptForTests, INSTALL_OFFERED_KEY } from "@/lib/install-offer";

afterEach(() => {
  cleanup();
  localStorage.clear();
  __setHeldPromptForTests(null);
});

describe("D1 desktop invitation", () => {
  it("ships the mock's copy and a QR of this page", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
    render(<DesktopInvite />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hetja lives on your phone.");
    expect(screen.getByText("On your phone")).toBeTruthy();
    expect(screen.getByText("Open the camera and point it at the code. No app to install.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "QR code that opens this page on your phone" })).toBeTruthy();
    // Design v9: the desktop header (Live map first, then the five sections of
    // the export), "Look up a collar", "Open on phone", and the two ways on.
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Live map", "How it works", "About", "Vets & feeders", "Privacy", "FAQ"]);
    expect(screen.getByRole("button", { name: "Look up a collar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open on phone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Look up a collar code ›" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "How it works ›" }).getAttribute("href")).toBe("/how-it-works");
    // And the footer, with its eight links.
    expect(screen.getByRole("navigation", { name: "Site links" }).querySelectorAll("a")).toHaveLength(8);
    // The phone is an illustration and says so.
    expect(screen.getByText("An example of a dog's page.")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("tells the visitor what to type: the page's own address", () => {
    expect(typedAddress("https://hetja.in/map")).toBe("hetja.in/map");
    expect(typedAddress("https://hetja.in/")).toBe("hetja.in");
    expect(typedAddress("https://hetja.in/scan/")).toBe("hetja.in/scan");
  });

  it("encodes the URL it is given", () => {
    const a = qrPath("https://hetja.in/map");
    const b = qrPath("https://hetja.in/me");
    expect(a.size).toBeGreaterThan(20);
    expect(a.d).not.toBe(b.d);
  });
});

describe("V1 not found", () => {
  it("ships the mock's copy with one loud button", () => {
    render(<NotFound />);
    expect(screen.getByText("404")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This lane doesn't go anywhere.");
    expect(screen.getByText("The dogs know every shortcut in Mumbai. This page isn't one of them.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Go to the home page/ }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Scan a collar" }).getAttribute("href")).toBe("/scan");
  });
});

function fakePrompt(outcome: "accepted" | "dismissed") {
  const e = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string }> };
  e.prompt = vi.fn(async () => undefined);
  e.userChoice = Promise.resolve({ outcome, platform: "web" });
  return e as never;
}

describe("V23 add to home screen", () => {
  it("names the dog just fed and shows the browser's own dialog", async () => {
    const p = fakePrompt("accepted");
    __setHeldPromptForTests(p);
    const onClose = vi.fn();
    render(<AddToHomeScreen open dogName="Rani" onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Keep Rani one tap away." })).toBeTruthy();
    expect(screen.getByText("Put Hetja on your home screen. It opens straight to the scanner, even on a slow network.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to home screen" }));
    });
    expect((p as unknown as { prompt: ReturnType<typeof vi.fn> }).prompt).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith("installed");
    expect(localStorage.getItem(INSTALL_OFFERED_KEY)).toBe("1");
  });

  it("after a feed: offers itself once where Hetja can be installed, never again after Not now", async () => {
    __setHeldPromptForTests(fakePrompt("dismissed"));
    const first = render(<AddToHomeScreenAfterFeed dogName="Kalu" />);
    expect(await screen.findByRole("dialog", { name: "Keep Kalu one tap away." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    render(<AddToHomeScreenAfterFeed dogName="Kalu" />);
    await act(async () => undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays quiet where Hetja cannot be installed", async () => {
    render(<AddToHomeScreenAfterFeed dogName="Kalu" />);
    await act(async () => undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("D1 with a real dog (v6 contract, adapted list)", () => {
  it("shows a real public dog at ward level when one exists", async () => {
    sessionStorage.clear();
    window.matchMedia = ((q: string) => ({ matches: q.includes("745"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = (data: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, data }) });
        if (url.includes("/map/wards")) return body({ wards: [{ id: "K-East", dogs: 2 }, { id: "K-West", dogs: 9 }] });
        if (url.includes("/wards/K-West/dogs")) return body({ dogs: [{ slug: "klu123abc", name: "Kalu", photoUrl: null }] });
        if (url.includes("/dogs/klu123abc"))
          return body({ slug: "klu123abc", name: "Kalu", wardId: "K-West", wardName: "Andheri West", vaccinated: "yes", sterilised: "unknown", lastFedAt: hoursAgo(3), lastFedBy: "Anil", sex: "male" });
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({ ok: false }) };
      }),
    );
    render(<DesktopInvite />);
    const phone = await screen.findByTestId("d1-real-dog");
    expect(phone.textContent).toContain("You found Kalu");
    expect(phone.textContent).toContain("K/W ward · Andheri West");
    expect(phone.textContent).toContain("Vaccinated");
    expect(phone.textContent).not.toContain("Sterilised");
    // Design v9: the collar code on the phone (the fed line is gone; a pill
    // says "Not fed today" when that is true).
    expect(phone.textContent).toContain(prettyCode("klu123abc"));
    expect(screen.getByText("Kalu is one of Mumbai's dogs on Hetja.")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
