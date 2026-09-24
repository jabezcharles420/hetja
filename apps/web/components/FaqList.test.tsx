// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import FaqList, { faqItemsFor, type FaqGroup } from "./FaqList";
import { FAQ_GROUPS } from "@/app/faq/questions";

afterEach(cleanup);

const groups: FaqGroup[] = [
  {
    label: "Feeders",
    items: [
      { q: "Can I feed a dog that isn't mine?", a: "Yes, please do." },
      { q: "What if the collar is missing?", a: "Report it to us." },
    ],
  },
  {
    label: "Vets",
    items: [{ q: "Can I edit or delete a record?", a: "No, that's the point." }],
  },
  {
    label: "Everyone",
    items: [{ q: "I found a collar on a dog. What should I do?", a: "Leave it on." }],
  },
];

function group(label: string): HTMLElement {
  return screen.getByTestId(`faq-group-${label}`);
}

describe("FaqList", () => {
  it("renders the three category chips as toggle buttons, Feeders pressed first", () => {
    render(<FaqList groups={groups} />);
    const chips = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
    expect(chips.map((c) => c.textContent)).toEqual(["Feeders", "Vets", "Everyone"]);
    expect(screen.getByRole("button", { name: "Feeders" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Vets" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows only the active category's questions", () => {
    render(<FaqList groups={groups} />);
    expect(group("Feeders").hidden).toBe(false);
    expect(group("Vets").hidden).toBe(true);
    expect(group("Everyone").hidden).toBe(true);
  });

  it("filters to another category when its chip is pressed", () => {
    render(<FaqList groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "Vets" }));
    expect(group("Vets").hidden).toBe(false);
    expect(group("Feeders").hidden).toBe(true);
    expect(screen.getByRole("button", { name: "Vets" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Feeders" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Everyone" }));
    expect(group("Everyone").hidden).toBe(false);
    expect(group("Vets").hidden).toBe(true);
  });

  it("honours an initial category", () => {
    render(<FaqList groups={groups} initial="Everyone" />);
    expect(group("Everyone").hidden).toBe(false);
    expect(group("Feeders").hidden).toBe(true);
  });

  it("uses native details rows, with only the first row of the first category open", () => {
    const { container } = render(<FaqList groups={groups} />);
    const rows = Array.from(container.querySelectorAll("details"));
    expect(rows.length).toBe(4);
    expect(rows.map((d) => d.open)).toEqual([true, false, false, false]);
    expect(rows[1].querySelector("summary")?.textContent).toContain("What if the collar is missing?");
    expect(screen.getByText("Report it to us.")).toBeTruthy();
  });

  it("can start with every row closed", () => {
    const { container } = render(<FaqList groups={groups} openFirst={false} />);
    expect(Array.from(container.querySelectorAll("details")).some((d) => d.open)).toBe(false);
  });

  it("faqItemsFor returns a category's rows and nothing for an unknown one", () => {
    expect(faqItemsFor(groups, "Vets").map((i) => i.q)).toEqual(["Can I edit or delete a record?"]);
    expect(faqItemsFor(groups, "Cats")).toEqual([]);
  });
});

describe("FAQ content (Pages 14)", () => {
  it("groups the questions as Feeders / Vets / Everyone", () => {
    expect(FAQ_GROUPS.map((g) => g.label)).toEqual(["Feeders", "Vets", "Everyone"]);
  });

  it("leads Feeders with the mock's four rows, the first with the mock's answer", () => {
    const feeders = faqItemsFor(FAQ_GROUPS, "Feeders");
    expect(feeders.slice(0, 4).map((i) => i.q)).toEqual([
      "Can I feed a dog that isn't mine?",
      "What if the collar is missing?",
      "How is my streak counted?",
      "Do I need to be an NGO?",
    ]);
    expect(feeders[0].a).toBe(
      "Street dogs aren't anyone's, which is the point. Log the feed so the dog's other feeders know it has eaten.",
    );
  });

  it("keeps every question from the previous FAQ", () => {
    const all = FAQ_GROUPS.flatMap((g) => g.items.map((i) => i.q));
    for (const q of [
      "Do I need an account to log a feed?",
      "How do I know the dog has been fed already?",
      "How do I verify a dog's medical records?",
      "Can I edit or delete a record?",
      "How do I get vet access?",
      "How does ABC integration work?",
      "Can we use the coverage data for planning?",
      "How do we partner with Hetja?",
      "I found a collar on a dog. What should I do?",
      "I think a dog needs help. How do I report it?",
      "Is the information on a profile reliable?",
      "Is my personal data used for anything else?",
    ]) {
      expect(all).toContain(q);
    }
    expect(all.length).toBe(16);
  });

  it("has no em dashes", () => {
    const text = JSON.stringify(FAQ_GROUPS);
    expect(text).not.toContain("\u2014");
  });
});
