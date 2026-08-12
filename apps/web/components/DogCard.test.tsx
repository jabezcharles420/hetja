// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DogCard from "./DogCard";
import type { DogProfile, MedicalRecord } from "@/lib/api";

const dog: DogProfile = {
  slug: "abc234567",
  name: "Bella",
  status: "active",
  wardId: "W-12",
  photoKey: null,
  abcStatus: null,
  vaccineStatus: null,
  microStory: "Bella runs to greet every auto-rickshaw.",
  lastSeenAt: "2026-08-01T10:00:00.000Z",
  geo: null,
};

const records: MedicalRecord[] = [
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
  {
    record_type: "abc",
    vaccine_name: null,
    vaccine_date: null,
    abc_date: "2025-11-20",
    diagnosis: null,
    treatment: null,
    severity: null,
    created_at: "2025-11-20T00:00:00.000Z",
    hash_curr: "h2",
  },
];

describe("DogCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the Fraunces name, ward pill and verified status pills", () => {
    render(<DogCard dog={dog} records={records} />);
    expect(screen.getByRole("heading", { level: 1, name: "Bella" })).toBeTruthy();
    expect(screen.getByText("Ward W-12")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("ABC done")).toBeTruthy();
    expect(screen.getByText("Vaccinated · Rabies")).toBeTruthy();
  });

  it("renders a paw placeholder when the dog has no photo", () => {
    const { container } = render(<DogCard dog={dog} records={records} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the photo when photoKey is present", () => {
    render(<DogCard dog={{ ...dog, photoKey: "photos/bella.jpg" }} records={[]} />);
    const img = screen.getByAltText("Recent photo of Bella") as HTMLImageElement;
    expect(img.src).toContain("/photos/bella.jpg");
  });

  it("omits medical pills when there are no verified records", () => {
    render(<DogCard dog={dog} records={[]} />);
    expect(screen.queryByText("ABC done")).toBeNull();
    expect(screen.queryByText(/Vaccinated/)).toBeNull();
  });
});
