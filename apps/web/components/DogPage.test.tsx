// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "abc234567" }),
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children }: { href: string; children: ReactNode }) =>
      el("a", { href }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getDog: vi.fn(),
      getDogMedical: vi.fn(),
      getDogStories: vi.fn(),
      createReport: vi.fn(),
    },
  };
});

import DogPage from "@/app/dog/[slug]/page";
import { api } from "@/lib/api";

const apiMock = api as unknown as {
  getDog: ReturnType<typeof vi.fn>;
  getDogMedical: ReturnType<typeof vi.fn>;
  getDogStories: ReturnType<typeof vi.fn>;
};

const dog = {
  slug: "abc234567",
  name: "Bella",
  status: "active",
  wardId: "W-12",
  photoKey: null,
  abcStatus: null,
  vaccineStatus: null,
  microStory: "Bella is the queen of the corner.",
  lastSeenAt: "2026-08-01T10:00:00.000Z",
  geo: null,
};

const records = [
  {
    record_type: "vaccination",
    vaccine_name: "Rabies",
    vaccine_date: "2026-01-01",
    abc_date: null,
    diagnosis: null,
    treatment: null,
    severity: null,
    created_at: "2026-01-01T00:00:00.000Z",
    hash_curr: "h1",
  },
];

const stories = [
  {
    id: "s1",
    version: 2,
    paragraph: "She waited for me every evening.",
    moderatedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
  },
];

describe("DogPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("shows a shimmering skeleton while the profile loads", () => {
    apiMock.getDog.mockReturnValue(new Promise(() => {}));
    apiMock.getDogMedical.mockReturnValue(new Promise(() => {}));
    apiMock.getDogStories.mockReturnValue(new Promise(() => {}));

    render(createElement(DogPage));
    expect(screen.getByLabelText("Loading profile")).toBeTruthy();
  });

  it("renders the profile, the collapsed full record, and one primary action", async () => {
    apiMock.getDog.mockResolvedValue(dog);
    apiMock.getDogMedical.mockResolvedValue({ records });
    apiMock.getDogStories.mockResolvedValue({ stories });

    render(createElement(DogPage));

    await screen.findByRole("heading", { level: 1, name: "Bella" });
    expect(screen.getByText("Ward W-12")).toBeTruthy();
    expect(screen.getByText("Vaccinated · Rabies")).toBeTruthy();
    expect(screen.getByText("Full record")).toBeTruthy();
    expect(screen.getByText(/Medical history/)).toBeTruthy();
    expect(screen.getByText("✓ verified")).toBeTruthy();
    expect(screen.getByText(/She waited for me every evening/)).toBeTruthy();

    // One primary action (accent-filled, icon + explicit verb) and "Log a
    // feed" demoted to a plain text link — never two buttons of equal weight.
    expect(screen.getByRole("button", { name: /This dog needs help/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log a feed" })).toBeTruthy();
  });

  it("opens the SOS modal from the primary action", async () => {
    apiMock.getDog.mockResolvedValue(dog);
    apiMock.getDogMedical.mockResolvedValue({ records });
    apiMock.getDogStories.mockResolvedValue({ stories });

    render(createElement(DogPage));
    await screen.findByRole("heading", { level: 1, name: "Bella" });

    fireEvent.click(screen.getByRole("button", { name: /This dog needs help/ }));
    expect(screen.getByRole("dialog", { name: "Report SOS" })).toBeTruthy();
  });

  it("shows an error card with a retry when the API fails", async () => {
    apiMock.getDog.mockRejectedValue(new Error("offline"));
    apiMock.getDogMedical.mockRejectedValue(new Error("offline"));
    apiMock.getDogStories.mockRejectedValue(new Error("offline"));

    render(createElement(DogPage));

    await screen.findByRole("alert");
    expect(screen.getByText("Couldn't load this profile")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
