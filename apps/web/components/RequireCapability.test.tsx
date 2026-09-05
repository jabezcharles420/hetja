// @vitest-environment jsdom
/**
 * The pre-children states of the route gate must sit inside `.h-container`.
 *
 * e2e/mobile-layout.spec.ts asserts that no visible text element starts within
 * 8px of the viewport edge. The gate's "Checking access…" paragraph carried its
 * gutter as inline padding on the <p> itself, so the element's own box began at
 * x=0 and the spec flagged it — but only when it happened to sample /register
 * during the loading frame, which made the a11y workflow flaky rather than red.
 * Wrapping every state in the shared container puts the text where the rest of
 * the site puts it and makes the check deterministic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children }: { href: string; children: ReactNode }) => el("a", { href }, children),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, getFeederMe: vi.fn(), electRegisterSurface: vi.fn() },
  };
});

import RequireCapability from "./RequireCapability";
import { api, ApiError } from "@/lib/api";

const getFeederMe = (api as unknown as { getFeederMe: ReturnType<typeof vi.fn> }).getFeederMe;

describe("RequireCapability", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("renders the loading state inside the site gutter container", () => {
    getFeederMe.mockReturnValue(new Promise(() => {})); // never settles
    render(
      <RequireCapability capability="register">
        <p>child</p>
      </RequireCapability>,
    );
    const text = screen.getByText("Checking access…");
    expect(text.closest(".h-container")).not.toBeNull();
    expect(screen.queryByText("child")).toBeNull();
  });

  it("renders the signed-out state inside the site gutter container", async () => {
    getFeederMe.mockRejectedValue(new ApiError("unauthenticated", { status: 401, code: "UNAUTHENTICATED" }));
    render(
      <RequireCapability capability="register">
        <p>child</p>
      </RequireCapability>,
    );
    const text = await screen.findByText("Sign in as a feeder to use registration.");
    expect(text.closest(".h-container")).not.toBeNull();
  });

  it("renders the no-capability state inside the site gutter container", async () => {
    getFeederMe.mockResolvedValue({ role: "feeder", capabilities: [] });
    render(
      <RequireCapability capability="register">
        <p>child</p>
      </RequireCapability>,
    );
    const text = await screen.findByText(/does not have the registrator capability/);
    expect(text.closest(".h-container")).not.toBeNull();
  });

  it("renders children once the capability is confirmed", async () => {
    getFeederMe.mockResolvedValue({ role: "registrator", capabilities: ["register"] });
    render(
      <RequireCapability capability="register">
        <p>child</p>
      </RequireCapability>,
    );
    await waitFor(() => expect(screen.getByText("child")).toBeTruthy());
  });
});
