// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import type { ReactNode } from "react";

const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/me",
  useRouter: () => router,
}));

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      el("a", { href, ...rest }, children),
  };
});

import {
  AppHeader,
  Button,
  CollarCode,
  CollarCodeInput,
  DogAvatar,
  SectionFade,
  StatusPill,
  Segmented,
  SettingsGroup,
  SettingsRow,
  Sheet,
  StickyFooter,
  Switch,
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
      <StatusPill variant={variant} icon={icon}>Vaccinated</StatusPill>,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("data-icon")).toBe(icon);
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Vaccinated")).toBeTruthy();
  });

  it("uses the handoff check path", () => {
    const { container } = render(
      <StatusPill variant="ok" icon="check">Fed</StatusPill>,
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

  it("has the owner's four tabs, in order, each a filled icon over its label", () => {
    const { container } = render(createElement(TabBar, {}));
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Home", "Map", "Scan", "Me"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/", "/map", "/scan", "/me"]);
    const icons = Array.from(container.querySelectorAll("svg[data-icon]"));
    expect(icons.map((i) => i.getAttribute("data-icon"))).toEqual(["home", "map", "scan", "me"]);
    expect(icons.every((i) => i.getAttribute("aria-hidden") === "true")).toBe(true);
  });
});

describe("AppHeader", () => {
  it("renders the back link as '‹ Me' pointing home", () => {
    render(<AppHeader back={{ href: "/me", label: "Me" }} />);
    const link = screen.getByRole("link", { name: /Me/ });
    expect(link.getAttribute("href")).toBe("/me");
    expect(link.textContent).toBe("‹ Me");
  });

  it("goes back in history only when the previous page was on this site", () => {
    router.back.mockReset();
    render(<AppHeader back={{ href: "/", label: "Back", history: true }} />);
    fireEvent.click(screen.getByRole("link", { name: /Back/ }));
    // jsdom has no referrer, so the link's own href is followed.
    expect(router.back).not.toHaveBeenCalled();
  });

  it("renders Cancel as a button when given a handler", () => {
    const onClick = vi.fn();
    render(<AppHeader cancel={{ onClick }} title="New dog" trailing={<a href="/x">Next</a>} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByText("New dog")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Next" })).toBeTruthy();
  });
});

describe("Switch, Segmented, SettingsRow", () => {
  it("Switch is a role=switch that flips", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="SOS alerts" />);
    const sw = screen.getByRole("switch", { name: "SOS alerts" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("Segmented is a radiogroup; arrows move the choice", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Which alerts"
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "SOS only" },
          { value: "b", label: "All" },
        ]}
      />,
    );
    const on = screen.getByRole("radio", { name: "SOS only" });
    expect(on.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(on, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  it("SettingsRow: a value with a chevron, a link, a button, a red row", () => {
    const onClick = vi.fn();
    render(
      <SettingsGroup>
        <SettingsRow label="Name shown" value="Priya S." onClick={onClick} />
        <SettingsRow label="Settings" href="/settings" />
        <SettingsRow label="Delete my account" tone="danger" chevron={false} onClick={onClick} />
      </SettingsGroup>,
    );
    const name = screen.getByRole("button", { name: /Name shown/ });
    expect(name.textContent).toBe("Name shownPriya S. ›");
    fireEvent.click(name);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /Settings/ }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("button", { name: "Delete my account" }).textContent).toBe("Delete my account");
  });
});

describe("Sheet", () => {
  it("is a labelled modal dialog that Escape and Cancel close", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Quiet hours">
        <input aria-label="From" />
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Quiet hours" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("From"));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing while closed", () => {
    render(
      <Sheet open={false} onClose={() => undefined} title="Quiet hours">
        <p>body</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Button", () => {
  it("sos renders the ! circle inside a real button", () => {
    render(<Button variant="sos">This dog needs help</Button>);
    const btn = screen.getByRole("button", { name: /This dog needs help/ });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    const bang = screen.getByTestId("sos-bang");
    expect(bang.textContent).toBe("!");
    expect(btn.contains(bang)).toBe(true);
  });

  it("sos with href is a real link", () => {
    render(
      <Button variant="sos" href="/dog/ddr017xk2/sos">This dog needs help</Button>,
    );
    const link = screen.getByRole("link", { name: /This dog needs help/ });
    expect(link.getAttribute("href")).toBe("/dog/ddr017xk2/sos");
    expect(link.contains(screen.getByTestId("sos-bang"))).toBe(true);
  });

  it("tel: links render a plain anchor", () => {
    render(<Button variant="tinted" href="tel:+911234">Call</Button>);
    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:+911234");
  });
});

describe("StickyFooter and SectionFade", () => {
  it("StickyFooter renders its caption", () => {
    render(
      <StickyFooter caption="Alerts his feeders and a vet nearby.">
        <Button variant="sos">This dog needs help</Button>
      </StickyFooter>,
    );
    expect(screen.getByText("Alerts his feeders and a vet nearby.")).toBeTruthy();
  });

  it("SectionFade leaves content visible without IntersectionObserver", () => {
    const { container } = render(<SectionFade>Three steps.</SectionFade>);
    expect(screen.getByText("Three steps.")).toBeTruthy();
    expect(container.firstElementChild?.className).not.toMatch(/hidden/);
  });
});
