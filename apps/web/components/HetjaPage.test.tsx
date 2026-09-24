// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";

import HetjaMemorialPage from "@/app/hetja/page";

describe("Hetja memorial page (Pages 17)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the dictionary masthead and the essay", () => {
    render(createElement(HetjaMemorialPage));
    expect(screen.getByTestId("hetja-word").textContent).toBe("Hetja");
    expect(screen.getByTestId("hetja-definition").textContent).toBe("hero");
    expect(screen.getByText(/Icelandic, noun/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "In memory of Hetja" })).toBeTruthy();
    expect(screen.getByText(/Every dog in Hetja gets a tag/)).toBeTruthy();
  });

  it("captions the road: no tag, no name, three kilometers", () => {
    render(createElement(HetjaMemorialPage));
    // The road was three kilometers. It has always been three kilometers.
    expect(screen.getByText("no tag · no name · 3 km of road")).toBeTruthy();
  });

  it("keeps the essay's opening paragraph word for word", () => {
    render(createElement(HetjaMemorialPage));
    const p = screen.getByText(/^There is a word in Icelandic/);
    expect(p.textContent?.replace(/\s+/g, " ")).toBe(
      "There is a word in Icelandic, Hetja, that means hero. Not the metaphorical kind. The literal kind. A hero is someone who chooses to act with courage when they have nothing to gain and everything to lose. This is the story of a dog who earned that word, and the long, guilty silence that followed.",
    );
  });

  it("lists three songs as rows, each with a privacy-hardened embed", () => {
    render(createElement(HetjaMemorialPage));
    expect(screen.getByRole("heading", { name: "Three songs" })).toBeTruthy();
    const titles = ["This Place Is a Shelter", "Þú ert jörðin", "Saman"];
    ["shelter", "earth", "someday"].forEach((name, i) => {
      const row = screen.getByTestId(`song-${name}`);
      expect(row.id).toBe(`song-${name}`);
      expect(row.textContent).toContain(titles[i]);
      expect(row.textContent).toContain("Ólafur Arnalds");
      expect(row.querySelector("iframe")).not.toBeNull();
    });
    const iframes = screen.getAllByTitle(/Ólafur Arnalds/);
    expect(iframes.length).toBe(3);
    for (const frame of iframes) {
      const el = frame as HTMLIFrameElement;
      expect(el.getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
      expect(el.getAttribute("loading")).toBe("lazy");
    }
  });

  it("marks where each song plays in the story, linking to its row", () => {
    render(createElement(HetjaMemorialPage));
    for (const [label, name] of [
      ["i. shelter", "shelter"],
      ["ii. earth", "earth"],
      ["iii. someday", "someday"],
    ]) {
      const cue = screen.getByRole("link", { name: new RegExp(`^${label.replace(".", "\\.")}`) });
      expect(cue.getAttribute("href")).toBe(`#song-${name}`);
    }
  });

  it("closes with the thank-you that was never said at the gate", () => {
    render(createElement(HetjaMemorialPage));
    expect(screen.getByText("Thank you.")).toBeTruthy();
  });
});
