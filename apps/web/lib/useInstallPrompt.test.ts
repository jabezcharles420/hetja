// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useInstallPrompt } from "./useInstallPrompt";

describe("useInstallPrompt", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("counts the first visit and does not offer install yet", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(localStorage.getItem("hetja:visits")).toBe("1");
    act(() => {
      window.dispatchEvent(new Event("beforeinstallprompt"));
    });
    expect(result.current.canInstall).toBe(false);
  });

  it("offers install from the second visit when the event fires", () => {
    localStorage.setItem("hetja:visits", "1");
    const { result } = renderHook(() => useInstallPrompt());
    expect(localStorage.getItem("hetja:visits")).toBe("2");
    act(() => {
      window.dispatchEvent(new Event("beforeinstallprompt"));
    });
    expect(result.current.canInstall).toBe(true);
  });

  it("promptInstall shows the native prompt and consumes it", async () => {
    localStorage.setItem("hetja:visits", "1");
    const prompt = vi.fn().mockResolvedValue(undefined);
    const userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    const event = new Event("beforeinstallprompt");
    Object.defineProperty(event, "prompt", { value: prompt });
    Object.defineProperty(event, "userChoice", { value: userChoice });

    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(event);
    });
    expect(result.current.canInstall).toBe(true);

    await act(async () => {
      await result.current.promptInstall();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(false);
  });

  it("dismiss hides the banner and remembers for good", () => {
    localStorage.setItem("hetja:visits", "1");
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(new Event("beforeinstallprompt"));
    });
    expect(result.current.canInstall).toBe(true);

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.canInstall).toBe(false);
    expect(localStorage.getItem("hetja:install-dismissed")).toBe("1");
  });
});
