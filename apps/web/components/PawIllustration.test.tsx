// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PawIllustration from "./PawIllustration";

describe("PawIllustration", () => {
  it("renders a decorative inline SVG paw with the requested size", () => {
    const { container } = render(<PawIllustration size={40} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.getAttribute("role")).toBe("presentation");
    expect(svg!.getAttribute("width")).toBe("40");
    expect(svg!.getAttribute("height")).toBe("40");
    expect(svg!.querySelectorAll("ellipse").length).toBeGreaterThan(0);
  });

  it("is announced as an image when given a title", () => {
    render(<PawIllustration size={48} title="A paw print" />);
    expect(screen.getByRole("img", { name: "A paw print" })).toBeTruthy();
  });
});
