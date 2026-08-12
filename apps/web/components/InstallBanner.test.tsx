// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

const install = vi.hoisted(() => ({
  canInstall: true,
  promptInstall: vi.fn().mockResolvedValue(undefined),
  dismiss: vi.fn(),
}));

vi.mock("@/lib/useInstallPrompt", () => ({
  useInstallPrompt: () => install,
}));

import { InstallBanner } from "./InstallBanner";

describe("InstallBanner", () => {
  afterEach(() => {
    vi.clearAllMocks();
    install.canInstall = true;
    cleanup();
  });

  it("renders nothing when install is not offered", () => {
    install.canInstall = false;
    const { container } = render(createElement(InstallBanner));
    expect(container.innerHTML).toBe("");
  });

  it("renders the amber install pill with a dismiss control", () => {
    render(createElement(InstallBanner));
    expect(screen.getByText(/Add Hetja to your home screen/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss install prompt" })).toBeTruthy();
  });

  it("triggers promptInstall when Install is tapped", () => {
    render(createElement(InstallBanner));
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(install.promptInstall).toHaveBeenCalledTimes(1);
  });

  it("dismisses when the close button is tapped", () => {
    render(createElement(InstallBanner));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss install prompt" }));
    expect(install.dismiss).toHaveBeenCalledTimes(1);
  });
});
