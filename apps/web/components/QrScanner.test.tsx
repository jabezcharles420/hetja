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

    // An explicit, generous budget. The default is 1000ms, and this is the one
    // assertion in the suite that waits on the scanner's real timer while CI
    // runs every package's tests in parallel — it failed intermittently on the
    // loaded runner while passing locally and in other jobs on the same commit,
    // which blocked the Deploy workflow at its Gate. The component now attempts
    // a decode immediately rather than only on the interval, so this should
    // resolve on the first attempt; the raised ceiling is here so a busy
    // machine cannot turn latency into a red build.
    await waitFor(
      () => {
        expect(push).toHaveBeenCalledWith("/dog/c3di5esh8?s=sig123");
      },
      { timeout: 5000 },
    );

    restore();
  });
});

/**
 * Regression: an unmounted component must not publish `window.BarcodeDetector`.
 *
 * This is the defect that made the suite above fail on CI while passing
 * locally, and it had nothing to do with the assertion that went red.
 *
 * The mount effect lazy-loads the ~13 KB WASM `barcode-detector` polyfill and
 * assigns it to the global. The assignment was not guarded by the effect's
 * `cancelled` flag, and the import can easily still be in flight after unmount
 * on a loaded machine. So: the first test here renders with no detector and
 * starts the import; its cleanup deletes the global; a later test installs a
 * fake and clicks "Use camera"; then the stale import resolves and overwrites
 * the fake with the real polyfill. The real polyfill dutifully tried to decode
 * pixels out of a jsdom <video> that has none, so no barcode was ever found,
 * `router.push` was never called, and the phase sat on "scanning" until the
 * test timed out — while the DOM looked entirely healthy.
 *
 * The fix is the `!cancelled` guard on that assignment. The package's own
 * side-effect write is a `??=`, which cannot overwrite a detector that is
 * already there — unlike the bare assignment, which is why only that one
 * needed guarding.
 */
describe("polyfill global hygiene", () => {
  class UnrelatedDetector {
    detect(): Promise<[]> {
      return Promise.resolve([]);
    }
  }

  it("does not let a stale in-flight import replace a detector installed since unmount", async () => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    stubMediaDevices(vi.fn().mockResolvedValue(fakeStream()));

    // Render with no detector present: this is what starts the dynamic import.
    render(<QrScanner />);
    cleanup();
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;

    // Whatever runs next installs its own detector and depends on it.
    Object.defineProperty(window, "BarcodeDetector", {
      value: UnrelatedDetector,
      configurable: true,
      writable: true,
    });

    // Give the in-flight import time to settle, as a loaded runner would.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect((window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector).toBe(
      UnrelatedDetector,
    );
  }, 10_000);
});
