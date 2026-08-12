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
});
