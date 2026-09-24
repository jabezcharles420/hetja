// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/me",
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      el("a", { href, ...rest }, children),
  };
});

import {
  Button,
  CollarCode,
  CollarCodeInput,
  DogAvatar,
  SectionFade,
  StatusPill,
  StickyFooter,
  TabBar,
  avatarPalette,
  sayCollarCode,
  sanitizeCollarCode,
} from "./index";

afterEach(cleanup);

describe("StatusPill", () => {
  it.each([
    ["ok", "check"],
    ["warn", "clock"],
    ["neutral", "cross"],
    ["danger", "alert"],
  ] as const)("%s renders an icon and its words", (variant, icon) => {
    const { container } = render(
      createElement(StatusPill, { variant, icon, children: "Vaccinated" }),
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("data-icon")).toBe(icon);
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Vaccinated")).toBeTruthy();
  });

  it("uses the handoff check path", () => {
    const { container } = render(
      createElement(StatusPill, { variant: "ok", icon: "check", children: "Fed" }),
    );
    expect(container.querySelector("path")?.getAttribute("d")).toBe("M3 8.5l3 3 7-7");
  });
});

describe("CollarCode", () => {
  it("splits the stored code into three uppercase groups", () => {
    render(createElement(CollarCode, { code: "ddr017xk2" }));
    const groups = screen.getAllByTestId("collar-group").map((g) => g.textContent);
    expect(groups).toEqual(["DDR", "017", "XK2"]);
    expect(screen.getByText("Collar code")).toBeTruthy();
  });

  it("builds the Say it line", () => {
    expect(sayCollarCode("ddr017xk2")).toBe("D D R · zero one seven · X K two");
    render(createElement(CollarCode, { code: "ddr017xk2", sayIt: true }));
    expect(screen.getByTestId("collar-say").textContent).toBe(
      "Say it: D D R · zero one seven · X K two",
    );
  });

  it("copies the lowercase code and shows Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(createElement(CollarCode, { code: "ddr017xk2" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledWith("ddr017xk2");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });
});

describe("CollarCodeInput", () => {
  function Harness({ onValue }: { onValue: (v: string) => void }): React.JSX.Element {
    const [v, setV] = useState("");
    return createElement(CollarCodeInput, {
      value: v,
      onChange: (next: string) => {
        setV(next);
        onValue(next);
      },
      label: "Collar code",
      helper: "Auto-spaces as you type. Accepts any case.",
    });
  }

  it("drops characters outside the collar alphabet", () => {
    expect(sanitizeCollarCode("l0 1-a!b")).toBe("ab");
  });

  it("accepts 9 like the API's SLUG_REGEX, so legacy codes can be typed", () => {
    expect(sanitizeCollarCode("abc234569")).toBe("abc234569");
  });

  it("uppercases and spaces the display, stores lowercase, caps at 9", () => {
    const seen: string[] = [];
    render(createElement(Harness, { onValue: (v) => seen.push(v) }));
    const input = screen.getByLabelText("Collar code") as HTMLInputElement;
    expect(input.getAttribute("inputmode")).toBe("text");
    expect(input.getAttribute("autocapitalize")).toBe("characters");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");

    fireEvent.change(input, { target: { value: "ddR-2l3" } });
    expect(seen.at(-1)).toBe("ddr23");
    expect(input.value).toBe("DDR 23");

    fireEvent.change(input, { target: { value: "ddr234xk2mnpq" } });
    expect(seen.at(-1)).toBe("ddr234xk2");
    expect(input.value).toBe("DDR 234 XK2");
    expect(screen.getByText("Auto-spaces as you type. Accepts any case.")).toBeTruthy();
  });

  it("renders the error slot and marks the field invalid", () => {
    render(
      createElement(CollarCodeInput, {
        defaultValue: "ddr",
        error: "No dog with that code. Check the letters and try again.",
      }),
    );
    const input = screen.getByLabelText("Collar code");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "No dog with that code. Check the letters and try again.",
    );
  });
});

describe("DogAvatar", () => {
  it("is deterministic per id", () => {
    const a = render(createElement(DogAvatar, { id: "ddr017xk2", name: "Bruno" }));
    const first = a.container.firstElementChild?.getAttribute("data-palette");
    cleanup();
    const b = render(createElement(DogAvatar, { id: "ddr017xk2", name: "Bruno" }));
    expect(b.container.firstElementChild?.getAttribute("data-palette")).toBe(first);
    expect(avatarPalette("ddr017xk2")).toBe(first);
  });

  it("spreads ids over the five palettes", () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => avatarPalette(`dog-${i}`)));
    expect(seen.size).toBe(5);
  });

  it("shows the initial without a photo, and the photo when there is one", () => {
    const { container } = render(createElement(DogAvatar, { id: "x", name: "kaali" }));
    expect(container.textContent).toBe("K");
    cleanup();
    const withPhoto = render(
      createElement(DogAvatar, { id: "x", name: "Kaali", photoUrl: "/k.webp" }),
    );
    expect(withPhoto.container.querySelector("img")?.getAttribute("src")).toBe("/k.webp");
    expect(withPhoto.container.textContent).toBe("");
  });
});

describe("TabBar", () => {
  it("sets aria-current on the active tab only (derived from the path)", () => {
    render(createElement(TabBar, {}));
    expect(screen.getByRole("link", { name: "Me" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Scan" }).getAttribute("aria-current")).toBeNull();
  });

  it("honours an explicit active tab", () => {
    render(createElement(TabBar, { active: "scan" }));
    expect(screen.getByRole("link", { name: "Scan" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("Button", () => {
  it("sos renders the ! circle inside a real button", () => {
    render(createElement(Button, { variant: "sos", children: "This dog needs help" }));
    const btn = screen.getByRole("button", { name: /This dog needs help/ });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    const bang = screen.getByTestId("sos-bang");
    expect(bang.textContent).toBe("!");
    expect(btn.contains(bang)).toBe(true);
  });

  it("sos with href is a real link", () => {
    render(
      createElement(Button, { variant: "sos", href: "/dog/ddr017xk2/sos", children: "This dog needs help" }),
    );
    const link = screen.getByRole("link", { name: /This dog needs help/ });
    expect(link.getAttribute("href")).toBe("/dog/ddr017xk2/sos");
    expect(link.contains(screen.getByTestId("sos-bang"))).toBe(true);
  });

  it("tel: links render a plain anchor", () => {
    render(createElement(Button, { variant: "tinted", href: "tel:+911234", children: "Call" }));
    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:+911234");
  });
});

describe("StickyFooter and SectionFade", () => {
  it("StickyFooter renders its caption", () => {
    render(
      createElement(StickyFooter, {
        caption: "Alerts his feeders and a vet nearby.",
        children: createElement(Button, { variant: "sos", children: "This dog needs help" }),
      }),
    );
    expect(screen.getByText("Alerts his feeders and a vet nearby.")).toBeTruthy();
  });

  it("SectionFade leaves content visible without IntersectionObserver", () => {
    const { container } = render(createElement(SectionFade, { children: "Three steps." }));
    expect(screen.getByText("Three steps.")).toBeTruthy();
    expect(container.firstElementChild?.className).not.toMatch(/hidden/);
  });
});
