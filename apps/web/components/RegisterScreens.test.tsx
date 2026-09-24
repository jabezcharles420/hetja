// @vitest-environment jsdom
/**
 * New dog (design v4, screen 10) and Collar ready (screen 11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    },
  };
});

import NewRegistrationForm, { wardLabel } from "@/app/(register)/register/new/NewRegistrationForm";
import ReadyClient, { readyTitle, tagLine } from "@/app/(register)/register/[slug]/ready/ReadyClient";
import { api } from "@/lib/api";

const apiMock = api as unknown as {
  getFeederMe: ReturnType<typeof vi.fn>;
  getWards: ReturnType<typeof vi.fn>;
  createRegistration: ReturnType<typeof vi.fn>;
  getRegistration: ReturnType<typeof vi.fn>;
};

const WARDS = [
  { id: "A", code: "A", name: "Colaba" },
  { id: "K-West", code: "K/W", name: "Andheri West" },
];

function me(homeWard: string | null = "K-West") {
  return { role: "registrator", capabilities: ["register"], homeWard };
}

beforeEach(() => {
  push.mockReset();
  apiMock.getWards.mockResolvedValue({ wards: WARDS });
  apiMock.createRegistration.mockResolvedValue({ slug: "rni482pq7" });
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("New dog", () => {
  it("shows the mock's copy and the feeder's own ward as 'K/W · Andheri West'", async () => {
    apiMock.getFeederMe.mockResolvedValue(me());
    render(<NewRegistrationForm />);
    expect(await screen.findByText("New dog")).not.toBeNull();
    expect(
      screen.getByText("A clear face photo. Strangers use it to check they found the right dog."),
    ).not.toBeNull();
    expect(screen.getByText("Only the ward is ever shown. Vets can confirm medical status later.")).not.toBeNull();
    expect(await screen.findByText("K/W · Andheri West", { selector: "span" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save & print collar" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/register");
    expect(wardLabel(WARDS[1]!)).toBe("K/W · Andheri West");
  });

  it("sends name, ward and both self-reported toggles, then goes to Collar ready", async () => {
    apiMock.getFeederMe.mockResolvedValue(me());
    render(<NewRegistrationForm />);
    await screen.findByText("K/W · Andheri West", { selector: "span" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Rani " } });
    const vacc = screen.getByRole("switch", { name: "Vaccinated" });
    fireEvent.click(vacc);
    expect(vacc.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Sterilised" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save & print collar" }));
    await waitFor(() => expect(apiMock.createRegistration).toHaveBeenCalledTimes(1));
    expect(apiMock.createRegistration).toHaveBeenCalledWith(
      { wardId: "K-West", name: "Rani", vaccinatedReported: true, sterilisedReported: false },
      "dev.tok",
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/register/rni482pq7/ready"));
  });

  it("makes the feeder pick a ward rather than filing the dog under the first one", async () => {
    apiMock.getFeederMe.mockResolvedValue(me(null));
    render(<NewRegistrationForm />);
    expect(await screen.findByText("Choose a ward", { selector: "span" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save & print collar" }));
    expect(await screen.findByText("Pick the ward the dog lives in.")).not.toBeNull();
    expect(apiMock.createRegistration).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Ward/), { target: { value: "A" } });
    expect(screen.getByText("A · Colaba", { selector: "span" })).not.toBeNull();
  });
});

describe("Collar ready", () => {
  it("prints the dog's name, the grouped code and the QR, and prints on either button", async () => {
    apiMock.getFeederMe.mockResolvedValue(me());
    apiMock.getRegistration.mockResolvedValue({
      slug: "rni482pq7",
      name: "Rani",
      status: "pending_activation",
      wardId: "K-West",
      registeredAt: null,
      collarUrl: "https://hetja.in/d/rni482pq7?s=abcdEfGhIjKlMnOpQrStUvWxYz0123456789-_A",
    });
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, configurable: true, writable: true });
    const { container } = render(<ReadyClient slug="rni482pq7" />);
    expect(await screen.findByText("Rani has a code.")).not.toBeNull();
    expect(
      screen.getByText(
        "Print it on waterproof paper, laminate it, and loop it on a soft collar. Not too tight: two fingers under.",
      ),
    ).not.toBeNull();
    expect(["RNI", "482", "PQ7"].every((g) => screen.getByText(g))).toBe(true);
    expect(screen.getByText("Rani · Scan me if I look lost")).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Print collar" }));
    const pdf = screen.getByRole("button", { name: "Save as PDF" });
    expect(pdf.getAttribute("title")).toMatch(/Save as PDF/);
    fireEvent.click(pdf);
    expect(print).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: /Switch the profile on/ }).getAttribute("href")).toBe("/register/rni482pq7");
  });

  it("words a nameless dog sensibly", () => {
    expect(readyTitle(null)).toBe("Your dog has a code.");
    expect(tagLine("")).toBe("Scan me if I look lost");
    expect(readyTitle("Rani")).toBe("Rani has a code.");
  });
});
