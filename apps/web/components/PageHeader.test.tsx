// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PageHeader from "./PageHeader";

describe("PageHeader", () => {
  it("renders the kicker pill, Fraunces title and intro", () => {
    render(
      <PageHeader
        kicker="Our mission"
        title="A coordination layer"
        intro="Warm, human intro copy."
      />,
    );
    expect(screen.getByText("Our mission")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "A coordination layer" }),
    ).toBeTruthy();
    expect(screen.getByText("Warm, human intro copy.")).toBeTruthy();
  });

  it("omits the intro when not provided", () => {
    const { container } = render(<PageHeader kicker="Kicker" title="Title" />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    expect(container.querySelector("p")).toBeNull();
  });
});
