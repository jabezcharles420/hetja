// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SosModal from "./SosModal";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      createReport: vi.fn(),
    },
  };
});

import { api, ApiError } from "@/lib/api";

const createReportMock = (api as unknown as { createReport: ReturnType<typeof vi.fn> })
  .createReport;

describe("SosModal", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<SosModal open={false} dogSlug="abc234567" onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("opens with calm-but-urgent copy and defaults to serious", () => {
    render(<SosModal open dogSlug="abc234567" onClose={() => {}} />);
    expect(screen.getByText("Someone needs help, right now.")).toBeTruthy();
    expect(screen.getByText("Take a breath. Tell us exactly what you saw.")).toBeTruthy();
    const serious = screen.getByLabelText("Serious") as HTMLInputElement;
    expect(serious.checked).toBe(true);
  });

  it("submits the selected severity + note and shows a confirmation", async () => {
    createReportMock.mockResolvedValue({ created: true, caseId: "case_1234567890", tier: 1 });
    const onClose = vi.fn();
    render(<SosModal open dogSlug="abc234567" onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Critical"));
    fireEvent.change(screen.getByLabelText("SOS note"), {
      target: { value: "Fever, not eating" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "SOS confirmed" })).toBeTruthy();
    });
    expect(createReportMock).toHaveBeenCalledWith({
      dogSlug: "abc234567",
      severity: "critical",
      note: "Fever, not eating",
    });
    expect(screen.getByText("SOS sent")).toBeTruthy();
    expect(screen.getByText("case_123", { exact: false })).toBeTruthy();
  });

  it("explains when an open case already exists", async () => {
    createReportMock.mockResolvedValue({ created: false, caseId: "case_old_000", tier: 1 });
    render(<SosModal open dogSlug="abc234567" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("already exists");
    });
  });

  it("reports the failure copy when the API throws", async () => {
    createReportMock.mockRejectedValue(new ApiError("network down", { status: 0 }));
    render(<SosModal open dogSlug="abc234567" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("network down");
    });
  });

  // Focus management. The dialog is `aria-modal="true"`, which promises AT
  // users that focus lives inside it; before these existed the modal kept
  // focus on the trigger behind the backdrop, Tab walked into the page, and
  // Escape did nothing. apps/scan/src/sheet.ts has had the same contract for
  // months; this brings the PWA's SOS dialog to parity.
  it("moves focus into the dialog when it opens", () => {
    render(<SosModal open dogSlug="abc234567" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Report SOS" });
    expect(document.activeElement).toBe(dialog);
  });

  it("traps Tab inside the dialog", () => {
    render(<SosModal open dogSlug="abc234567" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Report SOS" });
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    // No visibility filter here on purpose: jsdom computes no layout, so
    // offsetParent is null for everything. The controls are visible by
    // construction in this render.
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    // Tab from the last control wraps to the first; Shift+Tab from the first
    // wraps to the last. Either direction, focus never leaves the dialog.
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "This dog needs help";
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const { unmount } = render(<SosModal open dogSlug="abc234567" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("moves focus to the confirmation dialog once the report is accepted", async () => {
    createReportMock.mockResolvedValue({ created: true, caseId: "case_1234567890", tier: 1 });
    render(<SosModal open dogSlug="abc234567" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "SOS confirmed" })).toBeTruthy();
    });
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "SOS confirmed" }));
  });
});
