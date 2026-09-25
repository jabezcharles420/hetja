// @vitest-environment jsdom
/**
 * N6 Settings (design v5), without the Language section (owner decision).
 * Every "›" row opens an editor that PATCHes /feeders/me. It also carries
 * the SOS paging consent (Alerts ›): `feeders.sos_opt_in` defaults to false,
 * the SOS fan-out pages only feeders who have it set, and PATCH /feeders/me
 * is its only writer, so a web surface for it must always exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
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
      getFeederMe: vi.fn(),
      patchFeederMe: vi.fn(),
      exportMyData: vi.fn(),
      deleteMyAccount: vi.fn(),
    },
  };
});

import SettingsPage from "@/app/settings/page";
import { api, ApiError, getAccessToken, setAccessToken } from "@/lib/api";

const apiMock = api as unknown as Record<"getFeederMe" | "patchFeederMe" | "exportMyData" | "deleteMyAccount", ReturnType<typeof vi.fn>>;

function me(over: Record<string, unknown> = {}) {
  return {
    feederId: "f1",
    displayName: "Priya Shah",
    publicName: "Priya S.",
    role: "feeder",
    trustScore: 55,
    verificationTier: "email",
    homeWard: "K-West",
    canRegister: true,
    registrationBudget: { pending: 0, max: 3 },
    capabilities: [],
    sosOptIn: false,
    wards: ["K-West", "H-West"],
    quietHours: { start: "23:00", end: "06:00" },
    alertsMode: "sos_only",
    onboarded: true,
    ...over,
  };
}

beforeEach(() => {
  setAccessToken("tok");
  push.mockReset();
  for (const k of ["getFeederMe", "patchFeederMe", "exportMyData", "deleteMyAccount"] as const) apiMock[k].mockReset();
  apiMock.getFeederMe.mockResolvedValue(me());
  apiMock.patchFeederMe.mockImplementation(async (p: object) => p);
});

afterEach(() => {
  setAccessToken(null);
  cleanup();
});

const row = (name: RegExp | string) => screen.findByRole("button", { name });

describe("SettingsPage", () => {
  it("ships the mock's rows and footnote, with no Language section", async () => {
    render(<SettingsPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Settings");
    expect(screen.getByRole("link", { name: /Me/ }).getAttribute("href")).toBe("/me");
    expect((await row(/Name shown/)).textContent).toBe("Name shownPriya S. ›");
    expect((await row(/My wards/)).textContent).toBe("My wardsK/W, H/W ›");
    expect((await row(/^Alerts/)).textContent).toBe("AlertsSOS only ›");
    for (const t of ["Download my data", "Sign out", "Delete my account"]) expect(await row(new RegExp(t))).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Account", "Your data"]);
    expect(
      screen.getByText("Deleting keeps the dogs you registered and their feed logs, with your name removed."),
    ).toBeTruthy();
    expect(screen.queryByText(/Language|English/)).toBeNull();
  });

  it("edits the name in a sheet and PATCHes displayName", async () => {
    apiMock.patchFeederMe.mockResolvedValue({ displayName: "Priya Kumar", publicName: "Priya K." });
    render(<SettingsPage />);
    fireEvent.click(await row(/Name shown/));
    const dialog = screen.getByRole("dialog", { name: "Name shown" });
    fireEvent.change(within(dialog).getByLabelText("Name shown to others"), { target: { value: " Priya Kumar " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.patchFeederMe).toHaveBeenCalledWith({ displayName: "Priya Kumar" }));
    expect((await row(/Name shown/)).textContent).toBe("Name shownPriya K. ›");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("picks wards from all 24 and saves them on Done", async () => {
    render(<SettingsPage />);
    fireEvent.click(await row(/My wards/));
    const dialog = screen.getByRole("dialog", { name: "Your wards" });
    expect(within(dialog).getAllByRole("button", { pressed: false }).length + 2).toBe(24);
    fireEvent.click(within(dialog).getByRole("button", { name: /^K\/E/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(apiMock.patchFeederMe).toHaveBeenCalledWith({ wards: ["K-West", "H-West", "K-East"] }),
    );
    expect((await row(/My wards/)).textContent).toBe("My wardsK/W, H/W, K/E ›");
  });

  it("Alerts ›: saves the mode", async () => {
    render(<SettingsPage />);
    fireEvent.click(await row(/^Alerts/));
    const dialog = screen.getByRole("dialog", { name: "Alerts" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "All" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.patchFeederMe).toHaveBeenCalledWith({ alertsMode: "all" }));
    expect((await row(/^Alerts/)).textContent).toBe("AlertsAll ›");
  });

  it("the SOS switch never flips silently: on opens the alerts ask (N13)", async () => {
    render(<SettingsPage />);
    fireEvent.click(await row(/^Alerts/));
    const sw = within(screen.getByRole("dialog", { name: "Alerts" })).getByRole("switch", { name: "SOS alerts" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    const ask = screen.getByRole("dialog", { name: "Know when a dog near you is hurt." });
    fireEvent.click(within(ask).getByRole("button", { name: "Turn on alerts" }));
    await waitFor(() =>
      expect(apiMock.patchFeederMe).toHaveBeenCalledWith(expect.objectContaining({ sosOptIn: true, sosPausedUntil: null })),
    );
  });

  it("the SOS switch never flips silently: off opens the pause sheet (L1)", async () => {
    apiMock.getFeederMe.mockResolvedValue(me({ sosOptIn: true }));
    render(<SettingsPage />);
    fireEvent.click(await row(/^Alerts/));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Alerts" })).getByRole("switch", { name: "SOS alerts" }));
    expect(screen.getByRole("dialog", { name: "Need a break from alerts?" })).toBeTruthy();
    expect(apiMock.patchFeederMe).not.toHaveBeenCalled();
  });

  it("Show my first name on dogs' pages: on by default, PATCHes showFirstName", async () => {
    render(<SettingsPage />);
    const sw = await screen.findByRole("switch", { name: "Show my first name on dogs' pages" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Shown as Priya. Never your surname.")).toBeTruthy();
    fireEvent.click(sw);
    await waitFor(() => expect(apiMock.patchFeederMe).toHaveBeenCalledWith({ showFirstName: false }));
    expect(await screen.findByText("You're counted as a feeder, not named.")).toBeTruthy();
  });

  it("tells a low-trust feeder why opting in will not page them yet", async () => {
    apiMock.getFeederMe.mockResolvedValue(me({ trustScore: 30 }));
    render(<SettingsPage />);
    fireEvent.click(await row(/^Alerts/));
    expect(screen.getByText(/trust score of 40 or more/).textContent).toMatch(/Yours is 30/);
  });

  it("keeps the sheet open and shows the API's message when a PATCH fails", async () => {
    apiMock.patchFeederMe.mockRejectedValue(new ApiError("wards must be BMC ward ids", { status: 400 }));
    render(<SettingsPage />);
    fireEvent.click(await row(/^Alerts/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("wards must be BMC ward ids");
    expect(screen.getByRole("dialog", { name: "Alerts" })).toBeTruthy();
  });

  it("edits quiet hours from the Alerts sheet", async () => {
    render(<SettingsPage />);
    fireEvent.click(await row(/^Alerts/));
    fireEvent.click(screen.getByRole("button", { name: /Quiet hours/ }));
    const dialog = screen.getByRole("dialog", { name: "Quiet hours" });
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "22:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiMock.patchFeederMe).toHaveBeenCalledWith({ quietHours: { start: "22:00", end: "06:00" } }),
    );
    // Back on the Alerts sheet, showing the new window.
    expect(await screen.findByText("10 pm – 6 am ›")).toBeTruthy();
  });

  it("Download my data saves a JSON file from the export endpoint", async () => {
    apiMock.exportMyData.mockResolvedValue({ feeder: { id: "f1" } });
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<SettingsPage />);
    fireEvent.click(await row(/Download my data/));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe("application/json");
    expect(await screen.findByText("Your data is downloading.")).toBeTruthy();
    click.mockRestore();
  });

  it("Sign out clears the session and goes home", async () => {
    render(<SettingsPage />);
    fireEvent.click(await row(/Sign out/));
    expect(getAccessToken()).toBeNull();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("Delete my account asks first, then deletes and signs out", async () => {
    apiMock.deleteMyAccount.mockResolvedValue({ deleted: true });
    render(<SettingsPage />);
    fireEvent.click(await row(/Delete my account/));
    expect(apiMock.deleteMyAccount).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(apiMock.deleteMyAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(getAccessToken()).toBeNull();
  });

  it("signed out: a Sign in that comes back here", async () => {
    setAccessToken(null);
    render(<SettingsPage />);
    expect((await screen.findByRole("link", { name: "Sign in" })).getAttribute("href")).toBe("/login?next=%2Fsettings");
    expect(apiMock.getFeederMe).not.toHaveBeenCalled();
  });
});
