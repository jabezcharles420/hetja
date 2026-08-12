// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ScanEntry from "./ScanEntry";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("ScanEntry", () => {
  it("navigates to the dog profile for a valid code", () => {
    push.mockClear();
    render(<ScanEntry />);
    fireEvent.change(screen.getByLabelText("Collar code"), { target: { value: "ABC234567" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(push).toHaveBeenCalledWith("/dog/abc234567");
  });

  it("shows the friendly parser error for an invalid code and does not navigate", () => {
    push.mockClear();
    render(<ScanEntry />);
    fireEvent.change(screen.getByLabelText("Collar code"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByText("That code looks incomplete — it should be 9 characters"),
    ).toBeTruthy();
  });

  it("clears the error once the user edits the code", () => {
    render(<ScanEntry />);
    const input = screen.getByLabelText("Collar code");
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(input, { target: { value: "abc234567" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the offline notice when the device goes offline", () => {
    render(<ScanEntry />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status").textContent).toContain("No signal");
  });

  it("hides the offline notice once the connection returns", () => {
    render(<ScanEntry />);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still navigates for a valid code while offline", () => {
    push.mockClear();
    render(<ScanEntry />);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    fireEvent.change(screen.getByLabelText("Collar code"), { target: { value: "abc234567" } });
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(push).toHaveBeenCalledWith("/dog/abc234567");
  });
});
