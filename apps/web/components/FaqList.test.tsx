// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import FaqList, { type FaqGroup } from "./FaqList";

afterEach(cleanup);

const groups: FaqGroup[] = [
  {
    label: "Feeders",
    items: [
      { q: "Can I feed a dog that isn't mine?", a: "Yes, please do." },
      { q: "What if the collar is damaged?", a: "Report it to us." },
    ],
  },
];

describe("FaqList", () => {
  it("renders group labels and every question", () => {
    render(<FaqList groups={groups} />);
    expect(screen.getByRole("heading", { name: "Feeders" })).toBeTruthy();
    expect(screen.getByText("Can I feed a dog that isn't mine?")).toBeTruthy();
    expect(screen.getByText("What if the collar is damaged?")).toBeTruthy();
  });

  it("keeps answers hidden until a question is opened", () => {
    render(<FaqList groups={groups} />);
    expect(screen.queryByText("Yes, please do.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Can I feed a dog/ }));
    expect(screen.getByText("Yes, please do.")).toBeTruthy();
  });

  it("toggles an answer closed again", () => {
    render(<FaqList groups={groups} />);
    const button = screen.getByRole("button", { name: /Can I feed a dog/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByText("Yes, please do.")).toBeNull();
  });

  it("marks the open button as expanded", () => {
    render(<FaqList groups={groups} />);
    const button = screen.getByRole("button", { name: /Can I feed a dog/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});
