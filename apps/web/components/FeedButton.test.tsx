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

// FeedButton mints the device token at CAPTURE time (the capture-time
// attestation fix) via bestEffortDeviceToken, which lazily imports this module.
// Without the mock the real mint would run here — a network round trip plus a
// proof-of-work solve — and every test would hang in "Logging feed…".
vi.mock("@/lib/device", () => ({
  getDeviceToken: vi.fn(async () => ({ ok: true, token: "tok-at-capture" })),
}));

import { captureGeo, enqueueFeed } from "@/lib/offline-queue";
import { prepareFeedPhoto } from "@/lib/photo";

const enqueueFeedMock = enqueueFeed as ReturnType<typeof vi.fn>;
const captureGeoMock = captureGeo as ReturnType<typeof vi.fn>;
const prepareFeedPhotoMock = prepareFeedPhoto as ReturnType<typeof vi.fn>;

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
      deviceToken: "tok-at-capture",
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
      deviceToken: "tok-at-capture",
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

  it("prefers the precise consented device fix over ward-coarsened photo EXIF GPS", async () => {
    // This precedence used to be the other way round (`photoGeo ?? await
    // captureGeo()`), and the consequence was a safety bug, not a privacy one:
    // what gets sent here becomes dogs.last_seen_geo, which routes/sos.ts reads
    // at full precision to centre the 2 km ST_DWithin responder fan-out. A
    // ≤2-decimal photo point (~1.1 km) winning over an available precise fix
    // moved the SOS circle up to ~1.5 km off the dog and, under LWW
    // (INVARIANT 4), overwrote a previously precise value with the coarse one.
    prepareFeedPhotoMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/webp" }),
      geo: { lat: 19.07, lng: 72.87 },
    });
    enqueueFeedMock.mockResolvedValue({ offline: false, syncing: false, queued: {} });
    const { container } = render(<FeedButton dogSlug="abc234567" />);

    pickPhoto(container);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Feed logged ♥");
    });
    expect(captureGeoMock).toHaveBeenCalled();
    expect(enqueueFeedMock).toHaveBeenCalledWith({
      dogSlug: "abc234567",
      photo: "RAW_BASE64",
      // The consented fix from the captureGeo mock, NOT the coarsened photo geo.
      geo: { lat: 19.07, lng: 72.88 },
      deviceToken: "tok-at-capture",
    });
  });

  it("falls back to ward-coarsened photo EXIF GPS when there is no consented fix", async () => {
    // captureGeo resolves undefined when the browser prompt is denied, dismissed
    // or times out. The photo's ward-level point is better than nothing there —
    // it stays coarsened on purpose, because photo EXIF is a silent, unconsented
    // channel and the capture may not be where the feeder is standing.
    captureGeoMock.mockResolvedValueOnce(undefined);
    prepareFeedPhotoMock.mockResolvedValue({
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
      deviceToken: "tok-at-capture",
    });
  });

  it("sends no geo at all when neither channel yields one", async () => {
    captureGeoMock.mockResolvedValueOnce(undefined);
    prepareFeedPhotoMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/webp" }),
      geo: undefined,
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
      geo: undefined,
      deviceToken: "tok-at-capture",
    });
  });

  it("still queues the feed when no device token can be minted", async () => {
    // Offline capture with nothing cached: bestEffortDeviceToken resolves
    // undefined rather than blocking or throwing, the record queues without a
    // token, and offline-queue's flush is the layer that reports it if no
    // session can vouch for it later. Capture must never hard-fail here.
    const { getDeviceToken } = await import("@/lib/device");
    (getDeviceToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: "challenge-unavailable",
    });
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
      deviceToken: undefined,
    });
  });
});
