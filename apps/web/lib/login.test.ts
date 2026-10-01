import { describe, expect, it } from "vitest";
import { cancelHref, formatCountdown, safeNext } from "./login";

describe("login helpers", () => {
  it("only follows same-origin paths after sign-in", () => {
    expect(safeNext("/feed?dog=abc234567")).toBe("/feed?dog=abc234567");
    expect(safeNext(null)).toBe("/me");
    expect(safeNext("https://evil.example")).toBe("/me");
    expect(safeNext("//evil.example")).toBe("/me");
    expect(safeNext("/\\evil.example")).toBe("/me");
    // The URL parser drops tabs and newlines, so these become //evil.example.
    expect(safeNext("/\t/evil.example")).toBe("/me");
    expect(safeNext("/\n/evil.example")).toBe("/me");
    expect(safeNext("/admin?tab=vets#x")).toBe("/admin?tab=vets#x");
    expect(cancelHref("/\t/evil.example")).toBe("/");
    expect(cancelHref("/map")).toBe("/map");
  });

  it("formats the resend countdown like the mock", () => {
    expect(formatCountdown(24)).toBe("0:24");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});
