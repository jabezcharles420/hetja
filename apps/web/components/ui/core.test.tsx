// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CAST, castFor, dogmojiSrc, hashString } from "@/lib/dogmoji";
import {
  Ambient,
  ChatPlayer,
  Dogmoji,
  Icon,
  ICON_NAMES,
  Marquee,
  NumberTicker,
  OrbitRing,
  PhoneFrame,
  Reveal,
  StatusPill,
  Sticker,
} from "./index";

afterEach(cleanup);

/*
 * jsdom has no IntersectionObserver, no matchMedia and no WebGL: exactly the
 * "old browser / no JS yet" conditions every component here must degrade to.
 * So these tests double as the progressive-enhancement contract: content is
 * present and visible without any of the motion machinery.
 */

describe("NumberTicker", () => {
  it("renders the final formatted value on first render", () => {
    render(<NumberTicker value={42} className="h-stat-value" />);
    const el = document.querySelector(".h-stat-value")!;
    expect(el.textContent).toBe("42");
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("formats with Indian digit grouping by default and supports affixes", () => {
    render(<NumberTicker value={123456} prefix="₹" suffix="+" />);
    expect(screen.getByText("₹1,23,456+")).toBeTruthy();
  });
});

describe("Reveal", () => {
  it("renders children visibly when IntersectionObserver is unavailable", () => {
    render(
      <Reveal delay={120}>
        <p>Bruno was fed three times today.</p>
      </Reveal>,
    );
    const p = screen.getByText("Bruno was fed three times today.");
    const wrapper = p.parentElement!;
    expect(wrapper.getAttribute("data-reveal")).toBe("static");
    expect(wrapper.style.opacity).toBe("");
  });

  it("renders the requested element", () => {
    render(
      <ul>
        <Reveal as="li">Kaalu</Reveal>
      </ul>,
    );
    expect(screen.getByText("Kaalu").tagName).toBe("LI");
  });
});

describe("decorative layers are hidden from assistive tech", () => {
  it("OrbitRing hides the ring and facepile but keeps the phone content", () => {
    render(
      <OrbitRing dogs={CAST.slice(0, 4)}>
        <p>Phone screen</p>
      </OrbitRing>,
    );
    const ring = document.querySelector("[data-orbit-ring]")!;
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    expect(ring.querySelectorAll("[data-dogmoji]").length).toBe(4);
    expect(document.querySelector("[data-facepile]")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Phone screen")).toBeTruthy();
  });

  it("Ambient is aria-hidden and drops the canvas without WebGL", () => {
    render(<Ambient />);
    const root = document.querySelector("[data-ambient]")!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.getAttribute("data-ambient")).toBe("aurora");
    expect(root.querySelectorAll("i").length).toBe(4);
    expect(root.querySelector("canvas")).toBeNull();
  });

  it("Ambient plain renders no blobs", () => {
    render(<Ambient variant="plain" />);
    const root = document.querySelector("[data-ambient]")!;
    expect(root.querySelectorAll("i").length).toBe(0);
  });
});

describe("Dogmoji", () => {
  it("renders the sticker for the dog's base with a srcset, lazily, decoratively", () => {
    render(<Dogmoji dog={CAST[1]} size={56} />);
    const root = document.querySelector("[data-dogmoji]")!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    const img = root.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(dogmojiSrc("poodle", 128));
    expect(img.getAttribute("srcset")).toContain("poodle-256.webp 256w");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("alt")).toBe("");
    // Biscuit has an open medical item.
    expect(root.querySelector("[data-dogmoji-medical]")).not.toBeNull();
  });

  it("falls back to the 🐶 glyph when the image errors", () => {
    render(<Dogmoji seed="bruno" />);
    const img = document.querySelector("[data-dogmoji] img")!;
    fireEvent.error(img);
    expect(document.querySelector("[data-dogmoji] img")).toBeNull();
    expect(document.querySelector("[data-dogmoji-glyph]")!.textContent).toBe("🐶");
  });

  it("prefers photoUrl, then falls back to the sticker if the photo fails", () => {
    render(<Dogmoji seed="bruno" photoUrl="https://example.test/bruno.jpg" label="Bruno" />);
    const root = screen.getByRole("img", { name: "Bruno" });
    const photo = root.querySelector("img")!;
    expect(photo.getAttribute("src")).toBe("https://example.test/bruno.jpg");
    fireEvent.error(photo);
    expect(root.querySelector("img")!.getAttribute("src")).toBe(dogmojiSrc("dog-face", 128));
  });

  it("Sticker renders a plain decorative 3D emoji", () => {
    render(<Sticker name="bone" size={40} />);
    const img = document.querySelector("[data-sticker=bone]")!;
    expect(img.getAttribute("width")).toBe("40");
    expect(img.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("castFor", () => {
  it("is deterministic for any slug", () => {
    for (const slug of ["dadar-w-017", "marine-drive-lab", "x", ""]) {
      expect(castFor(slug)).toBe(castFor(slug));
    }
    expect(hashString("dadar-w-017")).toBe(hashString("dadar-w-017"));
  });

  it("returns the named cast dog for a cast name, case-insensitively", () => {
    expect(castFor("Biscuit").name).toBe("Biscuit");
    expect(castFor("  bholu ").key).toBe("bholu");
  });

  it("spreads real slugs across the cast", () => {
    const picks = new Set(Array.from({ length: 60 }, (_, i) => castFor(`dog-${i}`).key));
    expect(picks.size).toBeGreaterThan(5);
  });
});

describe("Icon", () => {
  it("renders an accessible svg with <title> when titled", () => {
    render(<Icon name="paw" title="Paw" />);
    const svg = screen.getByRole("img", { name: "Paw" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelector("title")!.textContent).toBe("Paw");
    expect(svg.getAttribute("viewBox")).toBe("0 0 256 256");
  });

  it("is aria-hidden without a title, and every name has both weights", () => {
    const { container } = render(<Icon name="siren" weight="fill" size={24} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("width")).toBe("24");
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(30);
    for (const name of ICON_NAMES) {
      const r = render(
        <>
          <Icon name={name} />
          <Icon name={name} weight="fill" />
        </>,
      );
      expect(r.container.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
      r.unmount();
    }
  });
});

describe("Marquee", () => {
  it("duplicates children once, hiding the copy", () => {
    render(
      <Marquee label="Wards">
        <span>Dadar</span>
        <span>Worli</span>
      </Marquee>,
    );
    expect(screen.getByRole("region", { name: "Wards" })).toBeTruthy();
    expect(screen.getAllByText("Dadar").length).toBe(2);
    const copy = screen.getAllByText("Dadar")[1]!.parentElement!;
    expect(copy.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ChatPlayer", () => {
  it("shows history and the whole script when playback can't run", () => {
    render(
      <ChatPlayer
        header={<span>Bruno</span>}
        history={[{ stamp: "Today 9:41 AM" }, { from: "me", text: "Fed Bruno" }]}
        script={[
          { from: "them", text: "He says it was zero." },
          { from: "me", text: "It was three.", gap: true },
        ]}
      />,
    );
    expect(screen.getByText("Today 9:41 AM")).toBeTruthy();
    expect(screen.getByText("Fed Bruno").className).toContain("h-bubble-me");
    expect(screen.getByText("He says it was zero.")).toBeTruthy();
    expect(screen.getByText("It was three.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replay conversation" })).toBeTruthy();
  });
});

describe("PhoneFrame", () => {
  it("renders the screen, a hidden status bar, and a live activity", () => {
    render(
      <PhoneFrame label="Hetja preview" live={{ label: "Feeding Bruno", timer: 134 }}>
        <p>Dog profile</p>
      </PhoneFrame>,
    );
    expect(screen.getByRole("group", { name: "Hetja preview" })).toBeTruthy();
    expect(screen.getByText("Dog profile")).toBeTruthy();
    expect(screen.getByText("9:41").parentElement!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("02:14")).toBeTruthy();
    expect(screen.getByText("Feeding Bruno")).toBeTruthy();
  });
});

describe("StatusPill", () => {
  it("maps tone to the global status classes", () => {
    render(
      <StatusPill tone="late" icon="syringe">
        Rabies due Fri
      </StatusPill>,
    );
    const pill = screen.getByText("Rabies due Fri");
    expect(pill.className).toContain("h-status-late");
    expect(pill.querySelector("svg[data-icon=syringe]")).not.toBeNull();
  });
});
