import { expect, test } from "@playwright/test";
import {
  GUTTER_TOKEN_PX,
  MIN_CONTAINER_PADDING_PX,
  MIN_HEADING_TO_PARAGRAPH_GAP_PX,
  MIN_TEXT_LEFT_PX,
  STATIC_ROUTES,
} from "./routes";

/* Regression test for the mobile-gutter bug, which shipped.
 *
 * WHAT BROKE: `.h-container` (app/globals.css) carries the only horizontal
 * gutter in the whole system -- `padding: 0 var(--h-gutter)`, i.e. `0 20px`.
 * Three other rules put a VERTICAL-ONLY `padding` shorthand on the SAME
 * element, at equal specificity, later in document order: `.section`
 * (components/Content.module.css, applied to 16 `<section className={`
 * `${styles.section} h-container`}>`), `.h-stats-row` and `.h-band-inner`.
 *
 * Two `padding` shorthands on one element do not merge. CSS resolves the whole
 * property from the winning declaration, so `padding: 64px 0` did not "add
 * vertical padding" -- it set padding-left and padding-right to 0 as well. The
 * result: every text block on the site except the hero (which uses
 * `.h-hero-grid`, a different class) had its body copy flush against the edge
 * of the screen on mobile. The fix was to convert those three rules to
 * `padding-block`, which touches only the two properties it means to.
 *
 * WHY IT SHIPPED: the Vitest + jsdom suite has excellent coverage of these
 * pages and could not possibly have caught this. jsdom parses CSS but resolves
 * no cascade and performs no layout: `getComputedStyle(el).paddingLeft` there
 * does not answer "which of two competing shorthands won", and
 * `getBoundingClientRect()` returns zeroes. A bug that is exclusively about
 * cascade resolution and computed geometry needs a real engine, which is the
 * entire reason this file exists.
 *
 * WHAT IT ASSERTS, per static route, at 390px:
 *   1. every visible `.h-container` still has its horizontal padding;
 *   2. no visible text starts within 8px of the viewport's left edge -- the
 *      user-visible symptom, caught independently of the mechanism, so a
 *      *different* way of losing the gutter still fails;
 *   3. the document does not scroll horizontally;
 *   4. no heading is touching the paragraph directly beneath it (same class of
 *      bug: `.prose > p + p` spaced only CONSECUTIVE paragraphs, so a heading
 *      sat on its first paragraph with a measured 0px gap).
 *
 * Assertions 1 and 2 overlap on purpose. 1 is the mechanism and gives a precise
 * diagnosis; 2 is the symptom and will still fail if the gutter is lost some
 * way nobody predicted. Deleting either one weakens the gate. */

/* Serialised into the page, so it must be self-contained -- no imports, no
 * closure over anything from the Node side. */
const PROBE = `(() => {
  /* Layout-relevant visibility only. An element that is display:none,
   * visibility:hidden, fully transparent, collapsed to a zero box, or clipped
   * by a visually-hidden pattern is not something a sighted user can see
   * sitting against the screen edge, so measuring it would only generate false
   * failures. */
  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (Number(cs.opacity) === 0) return false;
    /* The two standard screen-reader-only recipes both collapse the visible
     * box: clip: rect(0 0 0 0) (see SosModal.module.css) and
     * clip-path: inset(50%). Neither is a layout bug. */
    if (cs.clip && cs.clip !== "auto") return false;
    if (cs.clipPath && cs.clipPath.includes("inset(50%)")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return true;
  }

  /* A short, human-recognisable label. The point of this suite failing is that
   * somebody can tell WHICH element regressed without opening a trace, so this
   * carries the tag, the classes, and a snippet of the actual copy. */
  function describe(el) {
    const classes = (el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean);
    const sel = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
      (classes.length ? "." + classes.join(".") : "");
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60);
    return text ? sel + '  ["' + text + '"]' : sel;
  }

  const containers = [];
  for (const el of document.querySelectorAll(".h-container")) {
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    containers.push({
      selector: describe(el),
      paddingLeft: parseFloat(cs.paddingLeft),
      paddingRight: parseFloat(cs.paddingRight),
    });
  }

  const texts = [];
  for (const el of document.querySelectorAll("h1, h2, h3, p, li")) {
    if (!isVisible(el)) continue;
    /* Empty wrappers have no visible ink to be flush against anything. */
    if (!(el.textContent || "").trim()) continue;
    const r = el.getBoundingClientRect();
    texts.push({ selector: describe(el), left: r.left, right: r.right });
  }

  /* Heading immediately followed by a paragraph, measured border-box to
   * border-box. Margin collapse is already baked into these numbers, which is
   * exactly what we want -- the question is "do these two boxes touch on
   * screen", not "what does the stylesheet claim". */
  const headingGaps = [];
  for (const h of document.querySelectorAll("h2, h3")) {
    const next = h.nextElementSibling;
    if (!next || next.tagName !== "P") continue;
    if (!isVisible(h) || !isVisible(next)) continue;
    const gap = next.getBoundingClientRect().top - h.getBoundingClientRect().bottom;
    headingGaps.push({ selector: describe(h), gap, next: describe(next) });
  }

  const root = document.documentElement;
  return {
    containers,
    texts,
    headingGaps,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    innerWidth: window.innerWidth,
  };
})()`;

type Probe = {
  containers: { selector: string; paddingLeft: number; paddingRight: number }[];
  texts: { selector: string; left: number; right: number }[];
  headingGaps: { selector: string; gap: number; next: string }[];
  scrollWidth: number;
  clientWidth: number;
  innerWidth: number;
};

for (const route of STATIC_ROUTES) {
  test.describe(`mobile layout @390px — ${route}`, () => {
    let probe: Probe;

    test.beforeEach(async ({ page }) => {
      await page.goto(route, { waitUntil: "load" });
      /* A late-arriving webfont re-lays-out the page and would make every
       * geometry number below a race. Wait for font loading to settle first. */
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      probe = (await page.evaluate(PROBE)) as Probe;
    });

    test("every .h-container keeps its horizontal gutter", () => {
      expect(
        probe.containers.length,
        `no visible .h-container on ${route}. Either the page stopped using the ` +
          `layout container or it failed to render -- both mean this route is no ` +
          `longer covered by the gutter regression test.`,
      ).toBeGreaterThan(0);

      const starved = probe.containers.filter(
        (c) =>
          c.paddingLeft < MIN_CONTAINER_PADDING_PX ||
          c.paddingRight < MIN_CONTAINER_PADDING_PX,
      );

      expect(
        starved,
        `${starved.length} of ${probe.containers.length} .h-container element(s) on ` +
          `${route} lost horizontal padding (need >= ${MIN_CONTAINER_PADDING_PX}px; ` +
          `--h-gutter is ${GUTTER_TOKEN_PX}px):\n` +
          starved
            .map(
              (c) =>
                `  padding-left=${c.paddingLeft}px padding-right=${c.paddingRight}px  ${c.selector}`,
            )
            .join("\n") +
          `\n\nAlmost certainly a second \`padding\` SHORTHAND landing on the same ` +
          `element as \`.h-container\` at equal specificity, later in document order. ` +
          `Use \`padding-block\` there instead.`,
      ).toEqual([]);
    });

    test("no visible text is flush against the viewport edge", () => {
      const flush = probe.texts.filter((t) => t.left < MIN_TEXT_LEFT_PX);
      expect(
        flush,
        `${flush.length} visible text element(s) on ${route} start within ` +
          `${MIN_TEXT_LEFT_PX}px of the left edge of a ${probe.innerWidth}px viewport:\n` +
          flush.map((t) => `  left=${t.left.toFixed(1)}px  ${t.selector}`).join("\n"),
      ).toEqual([]);
    });

    test("the document does not scroll horizontally", () => {
      expect(
        probe.scrollWidth,
        `${route} overflows horizontally: documentElement.scrollWidth=` +
          `${probe.scrollWidth} vs clientWidth=${probe.clientWidth}. Something is ` +
          `wider than the viewport -- a fixed width, an unbroken string, or a ` +
          `negative margin.`,
      ).toBe(probe.clientWidth);
    });

    test("no heading is touching the paragraph directly below it", () => {
      const touching = probe.headingGaps.filter(
        (g) => g.gap <= MIN_HEADING_TO_PARAGRAPH_GAP_PX,
      );
      expect(
        touching,
        `${touching.length} heading(s) on ${route} sit within ` +
          `${MIN_HEADING_TO_PARAGRAPH_GAP_PX}px of their next paragraph:\n` +
          touching
            .map((g) => `  gap=${g.gap.toFixed(1)}px  ${g.selector}\n      -> ${g.next}`)
            .join("\n") +
          `\n\n\`.prose > p + p\` only spaces CONSECUTIVE paragraphs; a heading needs ` +
          `its own \`h2 + p\` / \`h3 + p\` rule (or a margin of its own) or it lands ` +
          `directly on the first paragraph of its section.`,
      ).toEqual([]);
    });
  });
}
