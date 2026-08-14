import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

/* The routes this suite is allowed to visit.
 *
 * Deliberately only the fully-static marketing pages. `/dog/[slug]` and `/scan`
 * render real data: they need the Fastify API on 8080 and a PostgreSQL cluster
 * with PostGIS/pgvector behind it (AGENTS.md §b/§f). Pulling those into this
 * gate would mean standing up a database service just to check a padding value,
 * and would make the gate fail for reasons that have nothing to do with
 * accessibility or layout. `/login` and `/me` are excluded for the same reason
 * -- they are auth surfaces, not static copy.
 *
 * If you add a static marketing page, add it here. A page that is not in this
 * list is not covered by either the a11y gate or the gutter regression test. */
export const STATIC_ROUTES = [
  "/",
  "/about",
  "/privacy",
  "/faq",
  "/how-it-works",
  "/contact",
] as const;

/* The absolute floor for a horizontal gutter, independent of what the design
 * token happens to say. 16px is the smallest inset at which body copy on a
 * 390px screen does not read as touching the bezel. It exists so that
 * "somebody lowered --h-gutter" is caught as a failure rather than silently
 * lowering the bar the test enforces. */
const MIN_GUTTER_PX = 16;

/* Read --h-gutter out of the single source of truth rather than hardcoding
 * 20px here. INVARIANT-adjacent: tokens come from ONE place
 * (packages/design/tokens.css, see the header comment in app/globals.css), and
 * a test that duplicates a token value becomes a second source of truth that
 * drifts. If the token is raised to 24px the test tightens automatically; if it
 * is lowered below MIN_GUTTER_PX the test does not loosen. */
function readGutterToken(): number {
  const tokensPath = fileURLToPath(
    new URL("../../../packages/design/tokens.css", import.meta.url),
  );
  const css = readFileSync(tokensPath, "utf8");
  const match = /--h-gutter:\s*([0-9.]+)px/.exec(css);
  if (!match) {
    throw new Error(
      `could not find --h-gutter in ${tokensPath}. If the token was renamed, ` +
        `update this test -- do not delete the assertion, it is the only thing ` +
        `standing between mobile body copy and the edge of the screen.`,
    );
  }
  return Number(match[1]);
}

export const GUTTER_TOKEN_PX = readGutterToken();

/* What .h-container's computed padding-left/right must be at least. */
export const MIN_CONTAINER_PADDING_PX = Math.max(MIN_GUTTER_PX, GUTTER_TOKEN_PX);

/* How close to the viewport's left edge a piece of visible text is allowed to
 * start. 8px, not 0, because 0 would also pass for text at 1px -- the point is
 * "nothing is flush against the edge", and a value this small can only happen
 * if some element lost its gutter entirely. */
export const MIN_TEXT_LEFT_PX = 8;

/* Minimum vertical gap between a heading and the paragraph immediately after
 * it. 2px is not a design value, it is a "these two boxes are touching"
 * detector: the bug this catches measured a literal 0px gap. */
export const MIN_HEADING_TO_PARAGRAPH_GAP_PX = 2;
