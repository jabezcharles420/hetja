// @vitest-environment jsdom
/**
 * F3 "Which dog is it?" and the F1 "Send SOS anyway" path (?sos=1).
 * GET /wards/:id/dogs, GET /care, GET /feeders/me and GET /wards are mocked
 * to the contract's shapes; geolocation is faked.
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
  return {
    ...actual,
    getAccessToken: vi.fn(() => null),
    api: {
      ...actual.api,
      getWardDogs: vi.fn(),
      getCare: vi.fn(),
      getFeederMe: vi.fn(),
      getWards: vi.fn(),
    },
  };
});

import FindScreen, { countLine } from "./FindScreen";
import * as apiModule from "@/lib/api";
import type { DogCard, WardDogsResult } from "@/lib/api";

type Mock = ReturnType<typeof vi.fn>;
const m = apiModule.api as unknown as Record<"getWardDogs" | "getCare" | "getFeederMe" | "getWards", Mock>;
const getAccessToken = apiModule.getAccessToken as unknown as Mock;

const dog = (slug: string, name: string | null): DogCard => ({
  slug,
  name,
  wardId: "K-West",
  wardCode: "K/W",
  photoUrl: null,
  markings: [],
  lastSeenAt: null,
});

const KW: WardDogsResult = {
  wardId: "K-West",
  total: 24,
  colourTotal: 9,
  dogs: [dog("rni482pq7", "Rani"), dog("bhr234abc", "Bhoori"), dog("nnn234abc", null)],
};

function setUrl(search = ""): void {
  Object.defineProperty(window, "location", {
    value: { ...window.location, search, hash: "" },
    configurable: true,
    writable: true,
  });
}

function fakeGeo(pos: { lat: number; lng: number } | null): void {
  Object.defineProperty(window.navigator, "geolocation", {
    value: {
      getCurrentPosition: (ok: (p: unknown) => void, fail: (e: unknown) => void) =>
        pos ? ok({ coords: { latitude: pos.lat, longitude: pos.lng } }) : fail({ code: 1 }),
    },
    configurable: true,
  });
}

beforeEach(() => {
  for (const k of ["getWardDogs", "getCare", "getFeederMe", "getWards"] as const) m[k].mockReset();
  getAccessToken.mockReturnValue(null);
  m.getWardDogs.mockResolvedValue(KW);
  m.getWards.mockRejectedValue(new Error("not needed"));
  setUrl();
});

afterEach(() => {
  cleanup();
});

describe("countLine", () => {
  it("reads like the mock", () => {
    expect(countLine(9, "brown", "K/W")).toBe("9 brown dogs registered in K/W");
    expect(countLine(1, null, "A")).toBe("1 dog registered in A");
    expect(countLine(0, "white", "K/W")).toBe("No white dogs registered in K/W yet.");
  });
});

describe("F3 Which dog is it?", () => {
  it("takes the ward from the phone's location and shows the grid", async () => {
    fakeGeo({ lat: 19.13, lng: 72.83 });
    render(<FindScreen />);
    expect(screen.getByRole("heading", { name: "Which dog is it?" })).not.toBeNull();
    expect(await screen.findByText("K/W · Andheri West")).not.toBeNull();
    expect(screen.getByText("Ward, from your location")).not.toBeNull();
    expect(await screen.findByText("24 dogs registered in K/W")).not.toBeNull();
    expect(m.getWardDogs).toHaveBeenCalledWith("K-West", undefined);
    expect(screen.getByRole("link", { name: /Rani/ }).getAttribute("href")).toBe("/d/rni482pq7");
    expect(screen.getByText("No name")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Not here? Register this dog" }).getAttribute("href")).toBe("/register");
  });

  it("narrows by one colour at a time", async () => {
    fakeGeo({ lat: 19.13, lng: 72.83 });
    render(<FindScreen />);
    await screen.findByText("24 dogs registered in K/W");
    const brown = screen.getByRole("button", { name: "Brown" });
    fireEvent.click(brown);
    expect(brown.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("9 brown dogs registered in K/W")).not.toBeNull();
    expect(m.getWardDogs).toHaveBeenLastCalledWith("K-West", "brown");
    fireEvent.click(screen.getByRole("button", { name: "Black" }));
    expect(brown.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(m.getWardDogs).toHaveBeenLastCalledWith("K-West", "black"));
  });

  it("falls back to the feeder's home ward when location is off", async () => {
    fakeGeo(null);
    getAccessToken.mockReturnValue("token");
    m.getFeederMe.mockResolvedValue({ homeWard: "H-West" });
    render(<FindScreen />);
    expect(await screen.findByText("H/W · Bandra West, Khar")).not.toBeNull();
    expect(screen.getByText("Your home ward")).not.toBeNull();
  });

  it("asks for a ward when it cannot tell, and Change reopens the list", async () => {
    fakeGeo(null);
    render(<FindScreen />);
    expect(await screen.findByText("We couldn't tell where you are. Pick the ward you're in.")).not.toBeNull();
    expect(m.getFeederMe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^T\s*Mulund$/ }));
    await waitFor(() => expect(m.getWardDogs).toHaveBeenCalledWith("T", undefined));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText("Pick a ward")).not.toBeNull();
  });

  it("says so when the ward's dogs cannot load, with Try again", async () => {
    fakeGeo({ lat: 19.13, lng: 72.83 });
    m.getWardDogs.mockRejectedValueOnce(new apiModule.ApiError("boom", { status: 500 }));
    render(<FindScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("24 dogs registered in K/W")).not.toBeNull();
  });
});

describe("?sos=1: Send SOS anyway", () => {
  it("lists the nearest vets and NGOs with Call buttons, then the finder", async () => {
    setUrl("?sos=1");
    fakeGeo({ lat: 19.13, lng: 72.83 });
    m.getCare.mockResolvedValue({
      providers: [
        {
          id: "c1",
          name: "Andheri Animal Rescue",
          kind: "ngo",
          phoneE164: "+912226200000",
          phoneVerifiedAt: "2026-01-01",
          hasAmbulance: true,
          is24x7: false,
          hoursNote: null,
          locality: "Andheri West",
        },
        { id: "c2", name: "No Phone Clinic", kind: "private_clinic", phoneE164: null, locality: null },
      ],
    });
    render(<FindScreen />);
    expect(screen.getByText("Call now")).not.toBeNull();
    const call = await screen.findByRole("link", { name: "Call Andheri Animal Rescue" });
    expect(call.getAttribute("href")).toBe("tel:+912226200000");
    expect(screen.getByText("NGO · Andheri West · ambulance")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Call No Phone Clinic" })).toBeNull();
    expect(m.getCare).toHaveBeenCalledWith(19.13, 72.83);
    expect(screen.getByRole("heading", { name: "Which dog is it?" })).not.toBeNull();
    expect(screen.getByText("Pick the dog to send the SOS to their feeders.")).not.toBeNull();
  });

  it("uses the picked ward's centre for help when location is off", async () => {
    setUrl("?sos=1");
    fakeGeo(null);
    m.getCare.mockResolvedValue({ providers: [] });
    render(<FindScreen />);
    expect(await screen.findByText(/Turn on location, or pick your ward below/)).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /^A\s*Colaba, Fort$/ }));
    await waitFor(() => expect(m.getCare).toHaveBeenCalledWith(18.918, 72.828));
  });

  it("gives honest guidance, and no dead Call button, when care fails to load", async () => {
    setUrl("?sos=1");
    fakeGeo({ lat: 19.13, lng: 72.83 });
    m.getCare.mockRejectedValue(new apiModule.ApiError("boom", { status: 500 }));
    render(<FindScreen />);
    expect(await screen.findByText(/Couldn't load nearby help right now/)).not.toBeNull();
    expect(screen.queryByRole("link", { name: /^Call/ })).toBeNull();
  });
});
