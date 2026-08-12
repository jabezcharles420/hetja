// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";

import HetjaMemorialPage from "@/app/hetja/page";

describe("Hetja memorial page", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the dictionary masthead and the essay", () => {
    render(createElement(HetjaMemorialPage));
    expect(screen.getByTestId("hetja-word").textContent).toBe("Hetja");
    expect(screen.getByTestId("hetja-definition").textContent).toBe("hero");
    expect(
      screen.getByRole("heading", { name: "In memory of Hetja" }),
    ).toBeTruthy();
    expect(screen.getByText(/Every dog in Hetja gets a tag/)).toBeTruthy();
  });

  it("renders the collar plate literally empty — no dash, no placeholder", () => {
    render(createElement(HetjaMemorialPage));
    const plate = screen.getByTestId("hetja-plate");
    expect(plate.textContent).toBe("");
    expect(plate.children.length).toBe(0);
    expect(screen.getByText(/no tag/)).toBeTruthy();
  });
});
