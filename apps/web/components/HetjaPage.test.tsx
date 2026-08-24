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
    // The road was three kilometers. It has always been three kilometers.
    expect(screen.getByText(/3 km of road/)).toBeTruthy();
  });

  it("scores the three songs, each with a privacy-hardened embed", () => {
    render(createElement(HetjaMemorialPage));
    for (const name of ["shelter", "earth", "someday"]) {
      expect(screen.getByTestId(`song-${name}`)).toBeTruthy();
    }
    const iframes = screen.getAllByTitle(/Ólafur Arnalds/);
    expect(iframes.length).toBe(3);
    for (const frame of iframes) {
      const el = frame as HTMLIFrameElement;
      expect(el.getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
      expect(el.getAttribute("loading")).toBe("lazy");
    }
  });

  it("closes with the thank-you that was never said at the gate", () => {
    render(createElement(HetjaMemorialPage));
    expect(screen.getByText("Thank you.")).toBeTruthy();
  });
});
