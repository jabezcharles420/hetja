import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Result as AxeResult } from "axe-core";
import { STATIC_ROUTES } from "./routes";

/* The accessibility CI gate (enhancement plan, Top-25 #23).
 *
 * `axe-core` was already in the tree before this file existed, but only as a
 * transitive dependency of eslint-plugin-jsx-a11y via eslint-config-next. That
 * is a static linter over JSX source: it can tell you an <img> has no alt
 * attribute, and it cannot tell you that a computed contrast ratio fails, that
 * an aria-labelledby points at an id that is not in the rendered tree, or that
 * a control ends up with no accessible name once the components compose. Those
 * need the accessibility tree of a really-rendered page, which is what
 * @axe-core/playwright gives us. The two are complements, not duplicates.
 *
 * Companion to ops/contrast-gate.sh, which checks the design TOKENS in
 * isolation. This checks the pages that use them -- a palette can be perfectly
 * AA-compliant token-by-token and still be combined wrongly on a real page. */

/* WCAG 2.0/2.1 level A and AA only.
 *
 * Left out on purpose: the `best-practice` tag. Its rules are real advice but
 * they are not conformance failures (e.g. `region` wants every piece of content
 * inside a landmark; `heading-order` objects to an h2 following an h4). Putting
 * those in a blocking gate means the gate starts failing over style opinions,
 * which is how a team learns to reach for a bypass and stops trusting the gate
 * at all. Also left out: wcag2aaa, which is not the conformance target.
 *
 * To see the advisory findings, widen this list in a local run. Do not widen it
 * in the committed config without deciding what to do about every finding it
 * surfaces. */
const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/* `serious` and `critical` only. axe grades every violation by impact, and on
 * pages of static prose the `minor`/`moderate` tiers are dominated by findings
 * that are cosmetic or genuinely debatable. A gate that blocks on those gets
 * switched off; a gate that blocks on "a screen-reader user cannot get past
 * this" does not. The lower tiers are still reported below as advisory output,
 * so nothing is hidden -- they just do not fail the build. */
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/* Turn axe's result objects into something a CI log reader can act on. The
 * default assertion failure -- "expected 0, received 3" -- does not say WHICH
 * element on WHICH page a blind user cannot use, so this prints the rule id, the
 * impact, the help text, the docs URL, and the CSS selector plus markup of every
 * offending node. */
function formatResults(route: string, results: AxeResult[]): string {
  if (results.length === 0) return `none on ${route}`;
  const lines: string[] = [`${results.length} finding(s) on ${route} at 390x844:`, ""];
  for (const v of results) {
    lines.push(`  [${v.impact ?? "no impact"}] ${v.id} — ${v.help}`);
    lines.push(`    ${v.helpUrl}`);
    for (const node of v.nodes) {
      lines.push(`    at: ${node.target.map((t) => String(t)).join(" >> ")}`);
      /* failureSummary is axe's own "to fix this you need to..." text; it names
       * the specific missing attribute or the measured contrast ratio. */
      const summary = (node.failureSummary ?? "").trim();
      if (summary) for (const line of summary.split("\n")) lines.push(`      ${line.trim()}`);
      if (node.html) lines.push(`      html: ${node.html.slice(0, 200)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

for (const route of STATIC_ROUTES) {
  test(`no serious or critical WCAG-AA violations — ${route}`, async ({ page }, testInfo) => {
    await page.goto(route, { waitUntil: "load" });
    /* Fonts matter here as well as in the layout spec: axe's colour-contrast
     * rule samples rendered pixels, and a font swap part-way through analysis
     * can move text off the background it was measured against. */
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();

    const blocking = results.violations.filter(
      (v) => typeof v.impact === "string" && BLOCKING_IMPACTS.has(v.impact),
    );
    const lowerImpact = results.violations.filter((v) => !blocking.includes(v));

    /* axe returns a third bucket besides `violations` and `passes`:
     * `incomplete`, meaning "a rule fired but axe could not decide from the DOM
     * alone". Those do NOT fail this gate, deliberately, and this is the one
     * judgement call in the file worth writing down.
     *
     * As of this commit every route reports exactly one incomplete rule --
     * `color-contrast`, impact `serious` -- and in both of its forms axe is
     * telling us it declined to judge because the element holds a single glyph
     * rather than text:
     *
     *   - `.h-footer-dot` (`<span class="h-footer-dot">·</span>`, all six
     *     routes). Reason `shortTextContent`. The measured ratio really is
     *     1.27:1 (#e4e4e4 on #ffffff), but the glyph is a decorative separator
     *     between footer links, so SC 1.4.3 does not apply to it. It is still
     *     worth a fix: unlike the checkmarks below it carries no
     *     `aria-hidden="true"`, so a screen reader announces a meaningless
     *     "middle dot" between every footer link. That is a change to
     *     components/Footer.tsx.
     *   - `.Content_check` / `.Content_offlineCheck`
     *     (`<span aria-hidden="true">✓</span>`, /about and /how-it-works).
     *     Reason `nonBmp`. Already aria-hidden, and the real pair is #0f6b3f on
     *     #ffffff (~5.9:1) — nothing to fix.
     *
     * Making the bucket blocking would fail the build on two decorative glyphs
     * while telling us nothing true, and would fail unpredictably in future on
     * any element whose background axe cannot resolve. So every incomplete
     * result is attached to the report instead: visible on every run, and a NEW
     * one cannot slip past unnoticed, but it does not turn the build red by
     * itself. If one turns out to be a genuine failure, fix the page — do not
     * promote the whole bucket. */
    const advisory = [...lowerImpact, ...results.incomplete];
    if (advisory.length > 0) {
      await testInfo.attach(`axe-advisory${route.replace(/\//g, "_") || "_root"}.txt`, {
        body:
          `Not blocking. ${lowerImpact.length} minor/moderate violation(s), ` +
          `${results.incomplete.length} needs-review (incomplete) finding(s).\n\n` +
          formatResults(route, advisory),
        contentType: "text/plain",
      });
    }

    /* Sanity check that axe actually ran. An AxeBuilder that fails to inject,
     * or a tag list with a typo in it, produces zero violations and zero
     * passes — indistinguishable from a clean page in the reporter output.
     * Without this, the whole gate can silently become a no-op. */
    expect(
      results.passes.length,
      `axe reported no passing rules on ${route}, which means it did not really ` +
        `run — check the tag list in WCAG_AA_TAGS and that the page rendered.`,
    ).toBeGreaterThan(0);

    expect(blocking, formatResults(route, blocking)).toEqual([]);
  });
}
