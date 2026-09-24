// @vitest-environment jsdom
/**
 * Tests for the feeder sign-in page.
 *
 * The regression these exist for: this page sent a bare `uuid()` as its device
 * token, `POST /api/v1/auth/verify` gates on `verifyDeviceToken`, and a UUID has
 * no `.` separator, so the API answered 401 BAD_DEVICE_TOKEN and no feeder had
 * ever been able to log in on the web app. Nothing asserted anything about what
 * this form actually put on the wire.
 *
 * `@/lib/device` is mocked at the outcome boundary only: the real
 * `deviceTokenFailureMessage` copy is kept (so the assertions below are about the
 * words a feeder actually reads), while `getDeviceToken` is made deterministic.
 * Mocking it is what makes the failure-path test possible at all: jsdom has no
 * `crypto.subtle`, so an unmocked page would only ever be able to take the
 * "cannot attest" branch here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DeviceTokenOutcome } from "@/lib/device";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

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
    api: { ...actual.api, requestOtp: vi.fn(), verifyOtp: vi.fn() },
  };
});

/** Whatever the current test wants the attestation to do. */
let outcome: DeviceTokenOutcome;

vi.mock("@/lib/device", async () => {
  const actual = await vi.importActual<typeof import("@/lib/device")>("@/lib/device");
  return {
    ...actual,
    readCachedDeviceToken: () => undefined,
    getDeviceToken: () => Promise.resolve(outcome),
  };
});

import LoginPage from "@/app/login/page";
import { api, ApiError } from "@/lib/api";
import { deviceTokenFailureMessage } from "@/lib/device";

const apiMock = api as unknown as {
  requestOtp: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
};

/** Shaped like a real issueDeviceToken() output. */
const TOKEN = "MDZlNWFjM2YtODU5NS00OTZlLTg5YzAtZDYxZTY3YmVmMTllLA.qFq8kQ0mS7Vh2wAeQ1nZbGx0ZmYtc2ln";

/** Fills in the email, sends the code, then types the 6 digits (auto-submits). */
async function signIn(code = "123456"): Promise<void> {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "feeder@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  await waitFor(() => expect(screen.queryByLabelText("6-digit code")).not.toBeNull());

  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: code } });
}

describe("feeder sign-in", () => {
  beforeEach(() => {
    push.mockReset();
    outcome = { ok: true, token: TOKEN, minted: true };
    apiMock.requestOtp.mockReset();
    apiMock.verifyOtp.mockReset();
    apiMock.requestOtp.mockResolvedValue({ expiresAt: "2026-08-14T10:00:00.000Z" });
    apiMock.verifyOtp.mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      feeder: { displayName: "Hetja Feeder", trustScore: 30, role: "feeder" },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("verifies with an attested device token, never a bare UUID", async () => {
    render(<LoginPage />);
    await signIn();

    await waitFor(() => expect(apiMock.verifyOtp).toHaveBeenCalledTimes(1));
    const sent = apiMock.verifyOtp.mock.calls[0]![0] as { deviceToken: string };

    expect(sent.deviceToken).toBe(TOKEN);
    // The assertion that would have caught the original bug: the API's
    // deviceTokenSubject() rejects anything without a `.` before it looks at the
    // HMAC, and a UUID has none.
    expect(sent.deviceToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sent.deviceToken).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/me"));
  });

  it("says why it cannot sign in when the device cannot be attested", async () => {
    // The plain-HTTP-over-LAN case, which is a real trap: crypto.subtle needs a
    // secure context, localhost is exempt, a LAN IP is not. The old code invented
    // a UUID here and let the server answer 401 with no explanation.
    outcome = { ok: false, reason: "insecure-context" };
    render(<LoginPage />);
    await signIn();

    await waitFor(() =>
      expect(screen.queryByText(deviceTokenFailureMessage("insecure-context"))).not.toBeNull(),
    );
    expect(apiMock.verifyOtp).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("re-enables the form after an attestation failure", async () => {
    // A failure that leaves the Verify button disabled forever is indistinguishable
    // from a hung app.
    outcome = { ok: false, reason: "pow-timeout" };
    render(<LoginPage />);
    await signIn();

    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it("retries once with a fresh token when the server rejects the device token", async () => {
    // The HETJA_DEVICE_SECRET-rotation case. Safe to retry only because auth.ts
    // checks the device token BEFORE consuming the OTP, so the code the feeder
    // typed has not been burned.
    apiMock.verifyOtp.mockRejectedValueOnce(
      new ApiError("attested device token required", { status: 401, code: "BAD_DEVICE_TOKEN" }),
    );
    render(<LoginPage />);
    await signIn();

    await waitFor(() => expect(apiMock.verifyOtp).toHaveBeenCalledTimes(2));
    const second = apiMock.verifyOtp.mock.calls[1]![0] as { code: string; deviceToken: string };
    expect(second.code).toBe("123456"); // the same one-time code, re-sent deliberately
    expect(second.deviceToken).toBe(TOKEN);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/me"));
  });

  it("surfaces the API's own message when the code itself is wrong", async () => {
    apiMock.verifyOtp.mockReset();
    apiMock.verifyOtp.mockRejectedValue(new ApiError("bad_code", { status: 400, code: "BAD_CODE" }));
    render(<LoginPage />);
    await signIn("000000");

    await waitFor(() => expect(screen.queryByText("bad_code")).not.toBeNull());
    // One attempt only: a wrong code must not be replayed, it consumes attempts.
    expect(apiMock.verifyOtp).toHaveBeenCalledTimes(1);
  });
});

describe("design v4 login screens", () => {
  beforeEach(() => {
    push.mockReset();
    outcome = { ok: true, token: TOKEN, minted: true };
    apiMock.requestOtp.mockReset();
    apiMock.verifyOtp.mockReset();
    apiMock.requestOtp.mockResolvedValue({ expiresAt: "2026-08-14T10:00:00.000Z" });
    apiMock.verifyOtp.mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      feeder: { displayName: "Priya", trustScore: 30, role: "feeder" },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  async function toCodeStep(): Promise<HTMLInputElement> {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "priya.feeds@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    return (await screen.findByLabelText("6-digit code")) as HTMLInputElement;
  }

  it("ships the mock's copy on both steps, with the 5-minute expiry", async () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in.No password.");
    expect(screen.getByText(/which dog hates the red scooter\./)).not.toBeNull();
    cleanup();
    await toCodeStep();
    expect(screen.getByText("Check your email.")).not.toBeNull();
    expect(screen.getByText("6 digits sent to priya.feeds@gmail.com. It works for 5 minutes.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "‹ Change email" })).not.toBeNull();
  });

  it("is one hidden one-time-code input painted as six boxes", async () => {
    const input = await toCodeStep();
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    fireEvent.change(input, { target: { value: "4a8 2" } });
    const boxes = screen.getAllByTestId("otp-box");
    expect(boxes).toHaveLength(6);
    expect(boxes.map((b) => b.textContent)).toEqual(["4", "8", "2", "", "", ""]);
    expect(apiMock.verifyOtp).not.toHaveBeenCalled();
  });

  it("auto-submits exactly once when the sixth digit lands, even if Verify is tapped too", async () => {
    const input = await toCodeStep();
    fireEvent.change(input, { target: { value: "482913" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/me"));
    expect(apiMock.verifyOtp).toHaveBeenCalledTimes(1);
    expect((apiMock.verifyOtp.mock.calls[0]![0] as { code: string }).code).toBe("482913");
  });

  it("asks for all six digits instead of sending a short code", async () => {
    const input = await toCodeStep();
    fireEvent.change(input, { target: { value: "482" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Type all 6 digits from the email.")).not.toBeNull();
    expect(apiMock.verifyOtp).not.toHaveBeenCalled();
  });

  it("counts the resend cooldown down from 0:30, then offers Resend", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await toCodeStep();
    expect(screen.getByText("Resend in 0:30")).not.toBeNull();
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(screen.getByText("Resend in 0:24")).not.toBeNull();
    for (let i = 0; i < 24; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    const resend = screen.getByRole("button", { name: "Resend" });
    fireEvent.click(resend);
    await waitFor(() => expect(apiMock.requestOtp).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Resend in 0:30")).not.toBeNull());
  });

  it("returns to the page that sent the feeder here", async () => {
    window.history.replaceState({}, "", "/login?next=%2Ffeed%3Fdog%3Dabc234567");
    const input = await toCodeStep();
    fireEvent.change(input, { target: { value: "123456" } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/feed?dog=abc234567"));
  });
});
