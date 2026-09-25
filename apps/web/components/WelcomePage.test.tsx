// @vitest-environment jsdom
/** N1 Become a feeder (design v5): the one PATCH that finishes onboarding. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const push = vi.fn();
const replace = vi.fn();

// Stable, like Next's own router: the page's load effect depends on it.
const router = { push, replace, back: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, getFeederMe: vi.fn(), patchFeederMe: vi.fn() } };
});

import WelcomePage from "@/app/welcome/page";
import { api, ApiError, setAccessToken } from "@/lib/api";

const getFeederMe = api.getFeederMe as unknown as ReturnType<typeof vi.fn>;
const patchFeederMe = api.patchFeederMe as unknown as ReturnType<typeof vi.fn>;

function me(over: Record<string, unknown> = {}) {
  return {
    feederId: "f1",
    displayName: "Priya Shah",
    publicName: "Priya S.",
    role: "feeder",
    trustScore: 10,
    verificationTier: "email",
    homeWard: "K-West",
    canRegister: false,
    registrationBudget: { pending: 0, max: 3 },
    capabilities: [],
    sosOptIn: false,
    wards: [],
    onboarded: false,
    ...over,
  };
}

beforeEach(() => {
  setAccessToken("tok");
  push.mockReset();
  replace.mockReset();
  getFeederMe.mockReset();
  patchFeederMe.mockReset();
  getFeederMe.mockResolvedValue(me());
  patchFeederMe.mockResolvedValue({ onboarded: true });
});

afterEach(() => {
  setAccessToken(null);
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("WelcomePage", () => {
  it("ships the mock's copy", async () => {
    render(<WelcomePage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Welcome. Where do you feed?");
    expect(screen.getByText("We only alert you about dogs in these wards.")).toBeTruthy();
    expect((screen.getByLabelText("Name shown to others") as HTMLInputElement).value).toBe("Priya S.");
    expect(screen.getByText("SOS alerts")).toBeTruthy();
    expect(screen.getByText("Hurt dogs in your wards")).toBeTruthy();
    expect(screen.getByText("Quiet hours")).toBeTruthy();
    expect(screen.getByText("SOS still comes through")).toBeTruthy();
    expect(screen.getByText("11 pm – 6 am ›")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ More wards" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start feeding" })).toBeTruthy();
  });

  it("suggests the home ward and its neighbours as chips", async () => {
    render(<WelcomePage />);
    const group = await screen.findByRole("group", { name: "Your wards" });
    const chips = within(group).getAllByRole("button", { pressed: false });
    expect(chips.map((c) => c.textContent)).toContain("K/W Andheri W");
    expect(chips.map((c) => c.textContent)).toContain("K/E Andheri E");
  });

  it("Start feeding sends name, wards, SOS, quiet hours and onboarded in one PATCH", async () => {
    render(<WelcomePage />);
    const group = await screen.findByRole("group", { name: "Your wards" });
    fireEvent.click(within(group).getByRole("button", { name: "K/W Andheri W" }));
    fireEvent.click(screen.getByRole("button", { name: "+ More wards" }));
    const picker = screen.getByRole("dialog", { name: "Your wards" });
    fireEvent.click(within(picker).getByRole("button", { name: /^H\/W/ }));
    fireEvent.click(within(picker).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("switch", { name: "SOS alerts" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Start feeding" }));
    await waitFor(() =>
      expect(patchFeederMe).toHaveBeenCalledWith({
        displayName: "Priya S.",
        wards: ["K-West", "H-West"],
        sosOptIn: true,
        quietHours: { start: "23:00", end: "06:00" },
        onboarded: true,
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/me"));
  });

  it("goes on to the page the feeder was heading for", async () => {
    window.history.replaceState({}, "", "/welcome?next=%2Ffeed%3Fdog%3Dabc");
    render(<WelcomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Start feeding" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/feed?dog=abc"));
  });

  it("can switch quiet hours off", async () => {
    render(<WelcomePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Quiet hours/ }));
    const sheet = screen.getByRole("dialog", { name: "Quiet hours" });
    fireEvent.click(within(sheet).getByRole("switch", { name: "Quiet hours" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(screen.getByText("Off ›")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start feeding" }));
    await waitFor(() => expect(patchFeederMe).toHaveBeenCalledWith(expect.objectContaining({ quietHours: null })));
  });

  it("asks for a name rather than sending an empty one", async () => {
    render(<WelcomePage />);
    fireEvent.change(await screen.findByLabelText("Name shown to others"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Start feeding" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Type the name others will see/);
    expect(patchFeederMe).not.toHaveBeenCalled();
  });

  it("shows the API's message when saving fails", async () => {
    patchFeederMe.mockRejectedValue(new ApiError("displayName is too long", { status: 400 }));
    render(<WelcomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Start feeding" }));
    expect((await screen.findByRole("alert")).textContent).toBe("displayName is too long");
    expect(push).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in first", async () => {
    setAccessToken(null);
    render(<WelcomePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fwelcome"));
  });
});
