// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      el("a", { href, ...rest }, children),
  };
});

import AboutPage from "@/app/about/page";
import HowItWorksPage from "@/app/how-it-works/page";
import FaqPage from "@/app/faq/page";
import PrivacyPage from "@/app/privacy/page";
import ContactPage from "@/app/contact/page";

afterEach(cleanup);

function body(page: () => React.JSX.Element): string {
  render(createElement(page));
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
}

/* The Pages mock copy (COPY_DECK.txt, screens 12 to 16), verbatim. */
const COPY: [string, () => React.JSX.Element, string[]][] = [
  [
    "12 About",
    AboutPage,
    [
      "Our mission",
      "A coordination layer for people who already care.",
      "Hetja is not another app asking you to care about stray dogs. The people who care (the feeders, vets, NGOs, and municipal staff) are already out there. We just give their care a memory, a ledger, and a voice.",
      "A memory",
      "Every dog has a profile that outlives any one feeder's phone.",
      "A ledger",
      "Feeds and vet records, in order, with names attached.",
      "A voice",
      "An SOS that reaches someone who can actually come.",
    ],
  ],
  [
    "13 How it works",
    HowItWorksPage,
    [
      "From collar to vet, in order.",
      "A feeder registers the dog",
      "Name, photo, ward. Hetja prints a collar tag with a random code.",
      "Feeders log each meal",
      "Scan, tap, done. The profile shows when the dog last ate.",
      "Vets add records",
      "Shots, sterilisation, treatment. Locked once saved.",
      "Anyone can raise an SOS",
      "It goes to the dog's feeders and the nearest vet on Hetja.",
    ],
  ],
  [
    "14 FAQ",
    FaqPage,
    [
      "Questions from the street.",
      "Everything feeders, vets, NGOs, and citizens ask us most. If your question isn't here, write to hello@hetja.in and a person will answer.",
      "Feeders",
      "Vets",
      "Everyone",
      "Can I feed a dog that isn't mine?",
      "Street dogs aren't anyone's, which is the point. Log the feed so the dog's other feeders know it has eaten.",
      "What if the collar is missing?",
      "How is my streak counted?",
      "Do I need to be an NGO?",
    ],
  ],
  [
    "15 Privacy",
    PrivacyPage,
    [
      "What we keep. What we don't.",
      "Short version: as little as possible, and never a dog's exact location.",
      "Ward only",
      "Dogs are placed by ward. No map pins, no street names.",
      "Random codes",
      "You can't guess the next dog from this one.",
      "No ads, no tracking",
      "Your email is for sign-in codes. That is all it is for.",
    ],
  ],
  [
    "16 Contact",
    ContactPage,
    [
      "Write to a person.",
      "hello@hetja.in",
      "We read everything. Replies take a day or two, longer in monsoon.",
      "For a dog in trouble, don't email. Scan its collar and press This dog needs help.",
    ],
  ],
];

describe.each(COPY)("%s", (_name, page, lines) => {
  it("ships every line of the mock copy", () => {
    const text = body(page);
    for (const line of lines) expect(text, line).toContain(line);
  });

  it("has exactly one h1 and no em dashes", () => {
    const text = body(page);
    expect(document.querySelectorAll("h1").length).toBe(1);
    expect(text).not.toContain("\u2014");
  });

  it("lays out inside the .h-container gutter", () => {
    render(createElement(page));
    expect(document.querySelectorAll(".h-container").length).toBeGreaterThan(0);
  });
});

describe("kept content below the mock sections", () => {
  it("About keeps the ledger, rollout and roles", () => {
    const text = body(AboutPage);
    for (const line of [
      "A medical record that can’t be quietly edited.",
      "Built street by street, not all at once.",
      "~50 dogs, one ward",
      "BMC & authorities",
      "Read why we built Hetja.",
    ]) {
      expect(text).toContain(line);
    }
    expect(screen.getByRole("link", { name: "Read why we built Hetja." }).getAttribute("href")).toBe(
      "/hetja",
    );
  });

  it("How it works anchors the desktop nav's Feeders and Vets links", () => {
    render(createElement(HowItWorksPage));
    expect(document.getElementById("feeders")?.textContent).toContain("Feeders log each meal");
    expect(document.getElementById("vets")?.textContent).toContain("Vets add records");
    expect(document.body.textContent).toContain("No signal? No problem.");
  });

  it("Privacy keeps the storage, location, access and rights detail", () => {
    const text = body(PrivacyPage);
    for (const line of [
      "Your email address, hashed",
      "Never exact",
      "Read · aggregate coverage",
      "Erasure",
      "Data requests:",
    ]) {
      expect(text).toContain(line);
    }
  });

  it("Contact mails hello@hetja.in and keeps the partnerships note", () => {
    const text = body(ContactPage);
    expect(screen.getAllByRole("link", { name: "hello@hetja.in" })[0].getAttribute("href")).toBe(
      "mailto:hello@hetja.in",
    );
    expect(text).toContain("Let’s cover more streets together.");
    expect(text).toContain("Looking for the vet or feeder line?");
  });
});
