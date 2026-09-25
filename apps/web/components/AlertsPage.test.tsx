// @vitest-environment jsdom
/** N5 Alerts (design v5): signed out, empty, error and the grouped rows. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
      el("a", { href, className }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, getAlerts: vi.fn() } };
});

import AlertsPage from "@/app/alerts/page";
import { api, ApiError, setAccessToken, type Alert } from "@/lib/api";

const getAlerts = api.getAlerts as unknown as ReturnType<typeof vi.fn>;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const ITEMS: Alert[] = [
  { id: "1", kind: "sos", at: ago(4 * 60e3), dog: { slug: "rni", name: "Rani" }, wardCode: "K/W", actorName: "Anil", detail: null, href: "/sos/c1" },
  { id: "2", kind: "tag", at: ago(12 * 60e3), dog: { slug: "rni", name: "Rani" }, wardCode: "K/W", actorName: null, detail: "found_on_ground", href: "/me/dogs/rni/tag" },
  { id: "3", kind: "verified", at: ago(2 * 3600e3), dog: { slug: "tgr", name: "Tiger" }, wardCode: "K/W", actorName: "Dr Mehta", detail: "vaccinated,sterilised", href: "/d/tgr" },
  { id: "4", kind: "fed", at: ago(2 * 3600e3 + 1000), dog: { slug: "klu", name: "Kalu" }, wardCode: "K/W", actorName: "Anil", detail: "Rice and egg", href: "/d/klu" },
  { id: "5", kind: "not_seen", at: ago(3 * 60e3), dog: { slug: "mti", name: "Moti" }, wardCode: "K/W", actorName: null, detail: "9", href: "/me/dogs/mti/status" },
];

beforeEach(() => {
  setAccessToken("tok");
  getAlerts.mockReset();
});

afterEach(() => {
  setAccessToken(null);
  cleanup();
});

describe("AlertsPage", () => {
  it("renders the mock's rows under Today, newest first, each linking to its screen", async () => {
    getAlerts.mockResolvedValue({ items: ITEMS });
    render(<AlertsPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Alerts");
    const today = await screen.findByRole("region", { name: "Today" });
    const links = within(today).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/me/dogs/mti/status",
      "/sos/c1",
      "/me/dogs/rni/tag",
      "/d/tgr",
      "/d/klu",
    ]);
    const sos = links[1]!;
    expect(within(sos).getByText("SOS · Rani is hurt")).toBeTruthy();
    expect(within(sos).getByText("K/W · Anil is going")).toBeTruthy();
    expect(within(sos).getByText("4m")).toBeTruthy();
    expect(within(sos).getByText("Urgent:")).toBeTruthy();
    expect(within(links[2]!).getByText("Rani's tag came off")).toBeTruthy();
    expect(within(links[2]!).getByText("Reported by a passer-by")).toBeTruthy();
    expect(within(links[3]!).getByText("Dr Mehta verified Tiger")).toBeTruthy();
    expect(within(links[3]!).getByText("Vaccinated · sterilised")).toBeTruthy();
    expect(within(links[4]!).getByText("Kalu was fed")).toBeTruthy();
    expect(within(links[4]!).getByText("Rice and egg · Anil")).toBeTruthy();
    expect(within(links[4]!).getByText("2h")).toBeTruthy();
    expect(within(links[0]!).getByText("Moti not seen in 9 days")).toBeTruthy();
    expect(within(links[0]!).getByText("Tap to update")).toBeTruthy();
  });

  it("puts older alerts under their own day", async () => {
    getAlerts.mockResolvedValue({
      items: [ITEMS[0], { ...ITEMS[3]!, id: "old", at: ago(4 * 86_400_000) }],
    });
    render(<AlertsPage />);
    await screen.findByRole("region", { name: "Today" });
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
  });

  it("says so, in the house voice, when there is nothing yet", async () => {
    getAlerts.mockResolvedValue({ items: [] });
    render(<AlertsPage />);
    expect(await screen.findByText("Nothing yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers a retry when the list fails", async () => {
    getAlerts.mockRejectedValueOnce(new ApiError("Server is having a moment.", { status: 500 }));
    render(<AlertsPage />);
    expect((await screen.findByRole("alert")).textContent).toBe("Server is having a moment.");
    getAlerts.mockResolvedValue({ items: [] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing yet.")).toBeTruthy();
  });

  it("signed out: one blue Sign in that comes back here", async () => {
    setAccessToken(null);
    render(<AlertsPage />);
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/login?next=%2Falerts");
    expect(getAlerts).not.toHaveBeenCalled();
  });

  it("treats a rejected session as signed out", async () => {
    getAlerts.mockRejectedValue(new ApiError("unauthenticated", { status: 401 }));
    render(<AlertsPage />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
  });
});
