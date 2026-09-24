// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));

import {
  Gallery,
  GlowBorder,
  GradientText,
  HighlightText,
  LiquidGlass,
  Parallax,
  ParallaxLayer,
  PawBurst,
  ScrollReveal,
  Stagger,
  StickyZoom,
  Tilt,
  TransitionLink,
  computeProgress,
  useScrollProgress,
} from "./index";

/*
 * jsdom has no IntersectionObserver, no matchMedia, no CSS.supports for
 * scroll timelines and no layout: the "old browser, JS not yet run"
 * baseline. Every effect must leave its content present and visible here.
 */

const realMatchMedia = window.matchMedia;

function mockReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: realMatchMedia });
  push.mockReset();
});

const MANIFESTO =
  "Every street dog in Mumbai has someone. A feeder at 6am. A vet on Sunday. A neighbour who noticed the limp. Hetja just makes sure they can find each other.";

describe("HighlightText", () => {
  it("renders the full sentence once as real text, the word copy hidden", () => {
    const { container } = render(<HighlightText text={MANIFESTO} emphasis={["someone"]} />);
    expect(screen.getByText(MANIFESTO)).toBeTruthy();
    const words = container.querySelector('[aria-hidden="true"]')!;
    expect(words.textContent).toBe(MANIFESTO);
    expect(words.querySelectorAll("span").length).toBe(MANIFESTO.split(" ").length);
    // No engine armed in jsdom: nothing dimmed.
    expect(container.firstElementChild!.hasAttribute("data-js")).toBe(false);
  });
});

describe("ScrollReveal / Stagger", () => {
  it("leaves children visible (never armed without IntersectionObserver)", () => {
    const { container } = render(
      <>
        <ScrollReveal>
          <p>Bruno was fed in Dadar West</p>
        </ScrollReveal>
        <Stagger>
          <span>Biscuit</span>
          <span>Kaalu</span>
        </Stagger>
      </>,
    );
    expect(screen.getByText("Bruno was fed in Dadar West")).toBeTruthy();
    expect(screen.getByText("Kaalu")).toBeTruthy();
    expect(container.querySelectorAll("[data-reveal]").length).toBe(0);
  });

  it("gives staggered children increasing indexes", () => {
    const { container } = render(
      <Stagger as="ul">
        <span>a</span>
        <span>b</span>
        <span>c</span>
      </Stagger>,
    );
    const items = Array.from(container.querySelectorAll("li"));
    expect(items.map((li) => li.style.getPropertyValue("--i"))).toEqual(["0", "1", "2"]);
  });
});

describe("Gallery", () => {
  const items = ["Bruno", "Biscuit", "Kaalu", "Moti", "Rani"].map((n) => ({
    id: n.toLowerCase(),
    label: n,
    content: <p>{n} story</p>,
  }));

  it("has a pause control that toggles its label", () => {
    render(<Gallery items={items} label="Stories" autoplay />);
    const pause = screen.getByRole("button", { name: "Pause gallery" });
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: "Play gallery" })).toBe(pause);
    fireEvent.click(pause);
    expect(pause.getAttribute("aria-label")).toBe("Pause gallery");
  });

  it("does not autoplay under reduced motion", () => {
    mockReducedMotion(true);
    render(<Gallery items={items} label="Stories" autoplay />);
    expect(screen.getByRole("button", { name: "Play gallery" })).toBeTruthy();
  });

  it("moves with the arrow buttons and the keyboard", () => {
    render(<Gallery items={items} label="Stories" />);
    const prev = screen.getByRole("button", { name: "Previous slide" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Show slide 1: Bruno" }).getAttribute("aria-current")).toBe("true");

    fireEvent.click(next);
    expect(screen.getByRole("button", { name: "Show slide 2: Biscuit" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Slide 2 of 5: Biscuit")).toBeTruthy();
    expect(prev.disabled).toBe(false);

    fireEvent.click(prev);
    expect(screen.getByText("Slide 1 of 5: Bruno")).toBeTruthy();

    const track = screen.getByLabelText("Stories, use arrow keys to move");
    fireEvent.keyDown(track, { key: "ArrowRight" });
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(screen.getByText("Slide 3 of 5: Kaalu")).toBeTruthy();
    // Every slide is real content, labelled "n of 5".
    expect(screen.getAllByRole("group").length).toBe(5);
    expect(screen.getByText("Rani story")).toBeTruthy();
  });

  it("omits the pause control when there is no autoplay", () => {
    render(<Gallery items={items} label="Stories" />);
    expect(screen.queryByRole("button", { name: /gallery/ })).toBeNull();
  });
});

describe("decorative layers are hidden from assistive tech", () => {
  it("GlowBorder hides ring and bloom, keeps the child", () => {
    const { container } = render(
      <GlowBorder>
        <button type="button">Adopt Kaalu</button>
      </GlowBorder>,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
    expect(screen.getByRole("button", { name: "Adopt Kaalu" })).toBeTruthy();
  });

  it("GlowBorder with glow none renders only the ring", () => {
    const { container } = render(
      <GlowBorder glow="none">
        <span>x</span>
      </GlowBorder>,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(1);
  });

  it("Parallax layers are aria-hidden unless marked non-decorative", () => {
    const { container } = render(
      <Parallax pointer>
        <ParallaxLayer depth={0.5}>
          <span>blob</span>
        </ParallaxLayer>
        <ParallaxLayer depth={0} decorative={false}>
          <h2>Bandra</h2>
        </ParallaxLayer>
      </Parallax>,
    );
    const layers = container.querySelectorAll("[style]");
    expect(layers[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("heading", { name: "Bandra" })).toBeTruthy();
  });

  it("Tilt sheen and LiquidGlass rim are aria-hidden", () => {
    const { container } = render(
      <>
        <Tilt>
          <p>Bruno pass</p>
        </Tilt>
        <LiquidGlass aria-label="Tabs">
          <span>Home</span>
        </LiquidGlass>
      </>,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
    expect(screen.getByText("Bruno pass")).toBeTruthy();
    expect(screen.getByLabelText("Tabs")).toBeTruthy();
  });
});

describe("StickyZoom / GradientText", () => {
  it("renders header and media at rest", () => {
    const { container } = render(
      <StickyZoom header={<h2>Scan the collar</h2>} label="Scan">
        <div>device</div>
      </StickyZoom>,
    );
    expect(screen.getByRole("heading", { name: "Scan the collar" })).toBeTruthy();
    expect(screen.getByText("device")).toBeTruthy();
    expect(container.querySelector("section")!.hasAttribute("data-js")).toBe(false);
  });

  it("GradientText keeps its text", () => {
    render(<GradientText as="h2">Every dog, found.</GradientText>);
    expect(screen.getByRole("heading", { name: "Every dog, found." })).toBeTruthy();
  });
});

describe("PawBurst", () => {
  it("fires sticker particles and cleans them up", () => {
    vi.useFakeTimers();
    try {
      mockReducedMotion(false);
      const { container, rerender } = render(<PawBurst fire={0} />);
      expect(container.querySelectorAll("img").length).toBe(0);
      rerender(<PawBurst fire={1} count={8} announce="Feed logged for Bruno" />);
      expect(container.querySelectorAll("img").length).toBe(8);
      expect(container.querySelector("[data-burst]")!.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByText("Feed logged for Bruno")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1400);
      });
      expect(container.querySelectorAll("img").length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only a checkmark under reduced motion", () => {
    mockReducedMotion(true);
    const { container, rerender } = render(<PawBurst fire={0} />);
    rerender(<PawBurst fire={1} />);
    expect(container.querySelectorAll("img").length).toBe(0);
    expect(container.querySelector("[data-burst-check]")).toBeTruthy();
  });
});

describe("useScrollProgress", () => {
  function Probe(): React.JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const p = useScrollProgress(ref);
    return (
      <div ref={ref} data-testid="probe">
        {String(p)}
      </div>
    );
  }

  it("returns a number in [0, 1]", () => {
    render(<Probe />);
    const p = Number(screen.getByTestId("probe").textContent);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("computeProgress clamps and maps both modes", () => {
    expect(computeProgress({ top: 800, height: 400 }, 800, "view")).toBe(0);
    expect(computeProgress({ top: -400, height: 400 }, 800, "view")).toBe(1);
    expect(computeProgress({ top: 200, height: 400 }, 800, "view")).toBe(0.5);
    expect(computeProgress({ top: -800, height: 2400 }, 800, "contain")).toBe(0.5);
    expect(computeProgress({ top: 5000, height: 2400 }, 800, "contain")).toBe(0);
  });
});

describe("TransitionLink", () => {
  it("wraps same-origin navigation in a view transition when available", () => {
    const start = vi.fn((cb: () => unknown) => {
      cb();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    try {
      render(<TransitionLink href="/dog/bruno">Bruno</TransitionLink>);
      fireEvent.click(screen.getByRole("link", { name: "Bruno" }));
      expect(start).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith("/dog/bruno", { scroll: true });
    } finally {
      delete (document as unknown as Record<string, unknown>).startViewTransition;
    }
  });

  it("leaves modified clicks to the browser", () => {
    const start = vi.fn();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    // jsdom cannot follow the real link; stop it after our handler has run.
    const swallow = (e: Event): void => e.preventDefault();
    document.addEventListener("click", swallow);
    try {
      render(<TransitionLink href="/dog/biscuit">Biscuit</TransitionLink>);
      fireEvent.click(screen.getByRole("link", { name: "Biscuit" }), { metaKey: true });
      expect(start).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", swallow);
      delete (document as unknown as Record<string, unknown>).startViewTransition;
    }
  });
});
