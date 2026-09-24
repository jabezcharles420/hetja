// @vitest-environment jsdom
/**
 * Scan (design v4, screen 02): the camera opens by itself, decodes go through
 * a GET /dogs/:slug existence check, a 404 is the inline "No dog with that
 * code", and success is a FULL navigation to /d/<slug> (the profile is a
 * different app behind Caddy) or, with ?intent=feed, /feed?dog=<slug>.
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
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      el("a", { href, ...rest }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, getDog: vi.fn() } };
});

import QrScanner, { destinationFor, extractCollarFromScan, NO_DOG_MESSAGE } from "./QrScanner";
import { api, ApiError } from "@/lib/api";

const getDog = (api as unknown as { getDog: ReturnType<typeof vi.fn> }).getDog;
const assign = vi.fn();

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities?: () => { torch?: boolean };
  applyConstraints: ReturnType<typeof vi.fn>;
}

function fakeStream(torch = false): { stream: MediaStream; track: FakeTrack } {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => (torch ? { torch: true } : {}),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

function installBarcodeDetector(barcodes: Array<{ rawValue: string; format: string }>): void {
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
}

function stubMediaDevices(getUserMedia: (...args: unknown[]) => Promise<MediaStream>): void {
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
}

beforeEach(() => {
  push.mockReset();
  getDog.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign, search: "" },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  Object.defineProperty(window.navigator, "mediaDevices", { value: undefined, configurable: true });
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

describe("destinationFor (scan intent routing)", () => {
  it("goes to the /d/ profile, keeping the signature", () => {
    expect(destinationFor({ slug: "c3di5esh8", sig: "a b" }, null)).toBe("/d/c3di5esh8?s=a%20b");
    expect(destinationFor({ slug: "c3di5esh8", sig: null }, null)).toBe("/d/c3di5esh8");
  });

  it("goes to Log a feed for the scanned dog with ?intent=feed", () => {
    expect(destinationFor({ slug: "c3di5esh8", sig: "x" }, "feed")).toBe("/feed?dog=c3di5esh8");
  });
});

describe("QrScanner screen", () => {
  it("shows the mock's copy and opens the camera without a button", async () => {
    installBarcodeDetector([]);
    const gum = vi.fn().mockResolvedValue(fakeStream().stream);
    stubMediaDevices(gum);
    render(<QrScanner />);
    expect(screen.getByText("Point at the QR on the collar.")).not.toBeNull();
    expect(screen.getByText("It opens by itself. No button needed.")).not.toBeNull();
    expect(screen.getByText("No camera, or the QR is muddy?")).not.toBeNull();
    expect(screen.getByRole("button", { name: "View profile" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    await waitFor(() => expect(gum.mock.calls.length).toBe(1), { timeout: 3000 });
    expect(screen.queryByRole("button", { name: /camera/i })).toBeNull();
  });

  it("focuses the code input when arriving from 'Or type a collar code' (#code)", async () => {
    installBarcodeDetector([]);
    stubMediaDevices(vi.fn().mockReturnValue(new Promise(() => {})));
    (window.location as { hash: string }).hash = "#code";
    render(<QrScanner />);
    await waitFor(() => expect(document.activeElement?.id).toBe("scan-collar-code"));
  });

  it("hides the frame and focuses the code input when the camera is denied", async () => {
    installBarcodeDetector([]);
    stubMediaDevices(vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")));
    render(<QrScanner />);
    await waitFor(() => expect(screen.queryByTestId("scan-frame")).toBeNull());
    expect(document.activeElement?.id).toBe("scan-collar-code");
    expect(screen.getByText("No camera here.")).not.toBeNull();
  });

  it("verifies a decoded collar, then does a full navigation to /d/ with the signature", async () => {
    installBarcodeDetector([{ rawValue: "https://hetja.in/d/c3di5esh8?s=sig123", format: "qr_code" }]);
    const { stream, track } = fakeStream();
    stubMediaDevices(vi.fn().mockResolvedValue(stream));
    getDog.mockResolvedValue({ slug: "c3di5esh8" });
    render(<QrScanner />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/d/c3di5esh8?s=sig123"));
    expect(getDog).toHaveBeenCalledWith("c3di5esh8", "sig123");
    expect(push).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it("routes a scan to Log a feed when it came from Me (?intent=feed)", async () => {
    window.location.search = "?intent=feed&dog=kaa234xyz";
    installBarcodeDetector([{ rawValue: "https://hetja.in/d/c3di5esh8?s=sig123", format: "qr_code" }]);
    stubMediaDevices(vi.fn().mockResolvedValue(fakeStream().stream));
    getDog.mockResolvedValue({ slug: "c3di5esh8" });
    render(<QrScanner />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/feed?dog=c3di5esh8"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("says 'No dog with that code' inline for a typed code the API does not know", async () => {
    getDog.mockRejectedValue(new ApiError("dog not found", { status: 404, code: "DOG_NOT_FOUND" }));
    render(<QrScanner />);
    fireEvent.change(screen.getByLabelText("Collar code"), { target: { value: "ABC 234 567" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(await screen.findByText(NO_DOG_MESSAGE)).not.toBeNull();
    expect(NO_DOG_MESSAGE).toBe("No dog with that code. Check the letters and try again.");
    expect(getDog).toHaveBeenCalledWith("abc234567", null);
    expect(assign).not.toHaveBeenCalled();
  });

  it("goes to the profile for a known typed code", async () => {
    getDog.mockResolvedValue({ slug: "abc234567" });
    render(<QrScanner />);
    fireEvent.change(screen.getByLabelText("Collar code"), { target: { value: "abc234567" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/d/abc234567"));
  });

  it("still goes to the profile when the check cannot reach the network (the profile works offline)", async () => {
    getDog.mockRejectedValue(new ApiError("offline", { status: 0, code: "NETWORK_ERROR" }));
    render(<QrScanner />);
    fireEvent.change(screen.getByLabelText("Collar code"), { target: { value: "abc234567" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/d/abc234567"));
  });

  it("refuses a short code without calling the API", async () => {
    render(<QrScanner />);
    fireEvent.change(screen.getByLabelText("Collar code"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(getDog).not.toHaveBeenCalled();
  });

  it("offers Torch only when the camera supports it, and switches it with applyConstraints", async () => {
    installBarcodeDetector([]);
    const { stream, track } = fakeStream(true);
    stubMediaDevices(vi.fn().mockResolvedValue(stream));
    render(<QrScanner />);
    const torch = await screen.findByRole("button", { name: "Torch" });
    expect(torch.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(torch);
    await waitFor(() => expect(torch.getAttribute("aria-pressed")).toBe("true"));
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  });

  it("hides Torch when the camera has none", async () => {
    installBarcodeDetector([]);
    const gum = vi.fn().mockResolvedValue(fakeStream(false).stream);
    stubMediaDevices(gum);
    render(<QrScanner />);
    await waitFor(() => expect(gum).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Torch" })).toBeNull();
  });

  class UnrelatedDetector {
    detect(): Promise<[]> {
      return Promise.resolve([]);
    }
  }

  it("does not let a stale in-flight import replace a detector installed since unmount", async () => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    const gum = vi.fn().mockResolvedValue(fakeStream().stream);
    stubMediaDevices(gum);

    render(<QrScanner />);
    cleanup();
    Object.defineProperty(window, "BarcodeDetector", {
      value: UnrelatedDetector,
      configurable: true,
      writable: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect((window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector).toBe(UnrelatedDetector);
    // Nor may it open the camera for a page that is gone.
    expect(gum).not.toHaveBeenCalled();
  }, 10_000);
});
