// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QrScanner, { extractCollarFromScan } from "./QrScanner";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

/** Installs a fake `BarcodeDetector` global whose every `detect()` call
 * resolves with the given barcodes. Returns a teardown to remove it. */
function installBarcodeDetector(barcodes: Array<{ rawValue: string; format: string }>): () => void {
  class FakeBarcodeDetector {
    detect(): Promise<Array<{ rawValue: string; format: string }>> {
      return Promise.resolve(barcodes);
    }
  }
  Object.defineProperty(window, "BarcodeDetector", {
    value: FakeBarcodeDetector,
    configurable: true,
    writable: true,
  });
  return () => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  };
}

function stubMediaDevices(getUserMedia: (...args: unknown[]) => Promise<MediaStream>): void {
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: undefined,
    configurable: true,
  });
});

describe("extractCollarFromScan", () => {
  it("parses the slug and signature out of a full collar URL", () => {
    expect(extractCollarFromScan("https://hetja.in/d/c3di5esh8?s=abc123")).toEqual({
      slug: "c3di5esh8",
      sig: "abc123",
    });
  });

  it("parses a bare /d/<slug> path with no signature", () => {
    expect(extractCollarFromScan("/d/c3di5esh8")).toEqual({ slug: "c3di5esh8", sig: null });
  });

  it("parses a bare 9-character code", () => {
    expect(extractCollarFromScan("c3di5esh8")).toEqual({ slug: "c3di5esh8", sig: null });
  });

  it("returns null for text that isn't a Hetja collar code", () => {
    expect(extractCollarFromScan("https://example.com/not-a-collar")).toBeNull();
  });
});

describe("QrScanner", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("renders the manual entry and no camera button when BarcodeDetector is absent", async () => {
    render(<QrScanner />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Use camera" })).toBeNull();
    });
    expect(screen.getByLabelText("Collar code")).toBeTruthy();
    expect(screen.getByText(/In-page scanning isn.t available in this browser/)).toBeTruthy();
  });

  it("does not request camera permission until the button is clicked", async () => {
    const restore = installBarcodeDetector([]);
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubMediaDevices(getUserMedia);

    render(<QrScanner />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Use camera" })).toBeTruthy();
    });
    expect(getUserMedia).not.toHaveBeenCalled();

    // The manual fallback is present alongside the camera option, not just
    // after a failure.
    expect(screen.getByLabelText("Collar code")).toBeTruthy();

    restore();
  });

  it("shows the denied message and still offers manual entry on NotAllowedError", async () => {
    const restore = installBarcodeDetector([]);
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    stubMediaDevices(getUserMedia);

    render(<QrScanner />);
    await waitFor(() => screen.getByRole("button", { name: "Use camera" }));
    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));

    await waitFor(() => {
      expect(screen.getByText(/Camera access was denied/)).toBeTruthy();
    });
    expect(screen.getByLabelText("Collar code")).toBeTruthy();

    restore();
  });

  it("decodes a scanned collar URL and navigates to the right slug", async () => {
    const restore = installBarcodeDetector([
      { rawValue: "https://hetja.in/d/c3di5esh8?s=sig123", format: "qr_code" },
    ]);
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubMediaDevices(getUserMedia);

    render(<QrScanner />);
    await waitFor(() => screen.getByRole("button", { name: "Use camera" }));
    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/dog/c3di5esh8?s=sig123");
    });

    restore();
  });
});
