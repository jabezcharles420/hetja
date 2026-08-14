// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import FeedButton from "./FeedButton";

vi.mock("@/lib/offline-queue", () => ({
  blobToBase64: vi.fn(async () => "RAW_BASE64"),
  captureGeo: vi.fn(async () => ({ lat: 19.07, lng: 72.88 })),
  stripDataPrefix: (dataUrl: string) => dataUrl.replace(/^data:[^,]+,/, ""),
  enqueueFeed: vi.fn(),
}));

vi.mock("@/lib/photo", () => ({
  prepareFeedPhoto: vi.fn(async (file: File) => ({
    blob: new Blob([file], { type: "image/webp" }),
    geo: undefined,
  })),
}));

import { enqueueFeed } from "@/lib/offline-queue";
import { prepareFeedPhoto } from "@/lib/photo";

const enqueueFeedMock = enqueueFeed as ReturnType<typeof vi.fn>;

function pickPhoto(container: HTMLElement): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "photo.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("FeedButton", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("shows the quiet 'Log a feed' text link and logs a feed with success feedback", async () => {
    enqueueFeedMock.mockResolvedValue({ offline: false, syncing: false, queued: {} });
    const { container } = render(<FeedButton dogSlug="abc234567" />);
    expect(screen.getByRole("button", { name: "Log a feed" })).toBeTruthy();

    pickPhoto(container);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Feed logged ♥");
    });
    expect(enqueueFeedMock).toHaveBeenCalledWith({
      dogSlug: "abc234567",
      photo: "RAW_BASE64",
      geo: { lat: 19.07, lng: 72.88 },
    });
  });

  it("reports the queued/offline state when the feed is saved offline", async () => {
    enqueueFeedMock.mockResolvedValue({ offline: true, syncing: false, queued: {} });
    const { container } = render(<FeedButton dogSlug="abc234567" />);

    pickPhoto(container);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("saved offline");
    });
    expect(enqueueFeedMock).toHaveBeenCalledWith({
      dogSlug: "abc234567",
      photo: "RAW_BASE64",
      geo: { lat: 19.07, lng: 72.88 },
    });
  });

  it("shows an error state when enqueueing fails", async () => {
    enqueueFeedMock.mockRejectedValue(new Error("indexedDB unavailable"));
    const { container } = render(<FeedButton dogSlug="abc234567" />);

    pickPhoto(container);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Could not log feed");
    });
  });

  it("prefers ward-coarsened photo GPS over device geolocation when EXIF GPS exists", async () => {
    (prepareFeedPhoto as ReturnType<typeof vi.fn>).mockResolvedValue({
      blob: new Blob(["x"], { type: "image/webp" }),
      geo: { lat: 19.07, lng: 72.87 },
    });
    enqueueFeedMock.mockResolvedValue({ offline: false, syncing: false, queued: {} });
    const { container } = render(<FeedButton dogSlug="abc234567" />);

    pickPhoto(container);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Feed logged ♥");
    });
    expect(enqueueFeedMock).toHaveBeenCalledWith({
      dogSlug: "abc234567",
      photo: "RAW_BASE64",
      geo: { lat: 19.07, lng: 72.87 },
    });
  });
});
