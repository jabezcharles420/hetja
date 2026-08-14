import { defineConfig } from "@playwright/test";

/* Playwright exists in this repo for exactly one class of bug: things that are
 * only wrong once a real browser has resolved the CSS cascade and laid the page
 * out. The Vitest + jsdom suite next door is the right tool for logic and for
 * "is this element in the tree", and it is deliberately staying that way --
 * jsdom implements no cascade and no layout, so it cannot see a `padding`
 * shorthand losing to a later shorthand at equal specificity, and it cannot see
 * the resulting text sitting flush against the edge of a 390px screen. That is
 * precisely how the missing-gutter regression shipped. See
 * e2e/mobile-layout.spec.ts for the assertions that would have caught it.
 *
 * Kept out of the `test` script on purpose. `pnpm -r test` runs in the main CI
 * `quality` job, and if Playwright hung off `test` that job would start
 * downloading a ~120 MB browser build before it could typecheck anything. This
 * suite runs under `test:e2e`, in its own workflow (.github/workflows/a11y.yml).
 */

/* Port 3211, not 3100 (the real web port) and not 3199 (a dev server is
 * commonly already sitting there on a developer box). Nothing else in the repo
 * claims 3211, so `test:e2e` on a laptop will not fight the app you already
 * have running. */
const PORT = Number(process.env.HETJA_E2E_PORT ?? 3211);

/* Escape hatch for a developer who already has `next dev` up and does not want
 * a second Next process compiling into the same shared `.next/` directory --
 * two dev servers writing one build cache concurrently is a real source of
 * "why is my page suddenly a 500". Set HETJA_E2E_BASE_URL and Playwright skips
 * `webServer` entirely and tests whatever is already listening. CI never sets
 * it: there, Playwright owns the server so the run is reproducible. */
const externalBaseUrl = process.env.HETJA_E2E_BASE_URL?.replace(/\/+$/, "");
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",

  /* One worker, no parallelism. Every spec in here talks to a single Next dev
   * server that compiles routes on first request; extra workers do not get
   * extra throughput, they just queue behind the same compile while each one
   * holds a browser context open. Serial is both faster and less flaky here. */
  workers: 1,
  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  /* No retries. These are deterministic layout and accessibility assertions
   * against static pages -- a flake here means the test is wrong, or the page
   * is, and retrying would hide which. */
  retries: 0,

  /* 60s per test because the first navigation to each route pays for Next's
   * on-demand dev compile, which on a cold CI runner is genuinely slow. */
  timeout: 60_000,
  expect: { timeout: 10_000 },

  /* Everything Playwright writes goes under apps/web/build/.
   *
   * Not the conventional `playwright-report/` + `test-results/` at the package
   * root, and that is a deliberate compromise: neither of those names is in the
   * repo's .gitignore, so a single local run would leave two untracked
   * directories sitting in `git status` for everyone working in this checkout.
   * `build/` is already ignored (root .gitignore, matches at any depth), so
   * artifacts land somewhere already understood to be disposable. If
   * `playwright-report/` and `test-results/` are ever added to .gitignore, move
   * these back to the defaults and update .github/workflows/a11y.yml with them. */
  outputDir: "./build/test-results",

  /* `github` gives inline PR annotations on the failing line; `list` gives a
   * readable log; `html` is what the CI failure artifact actually contains --
   * including the axe advisory attachments and the failure traces. */
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { outputFolder: "./build/playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "./build/playwright-report", open: "never" }]],

  use: {
    baseURL,
    browserName: "chromium",

    /* 390x844 with mobile emulation on. This is not an arbitrary "small"
     * viewport: Hetja's users are on cheap Android phones on Mumbai 4G, and
     * every layout bug this suite is here to catch was a mobile-only bug that
     * a 1280px desktop viewport rendered perfectly. `isMobile` matters beyond
     * the width -- it turns on Chromium's mobile emulation, so the
     * `width=device-width` viewport meta in app/layout.tsx is actually
     * honoured and overlay (zero-width) scrollbars are used, which is what
     * makes the horizontal-overflow assertion meaningful rather than an
     * artifact of a 15px desktop scrollbar. */
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,

    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: externalBaseUrl
    ? undefined
    : {
        /* Invoked as `node <path-to-next-bin>` rather than `next dev` or
         * `pnpm dev`: pnpm is not on PATH on every box here (AGENTS.md -- use
         * `corepack pnpm`), and a bare `next` depends on node_modules/.bin
         * being on PATH, which differs between Windows and the Linux runner.
         * Spawning the JS entrypoint through node directly works identically
         * in both places.
         *
         * `next dev`, not `next build && next start`, because the six routes
         * under test are fully static marketing pages -- no database, no API,
         * no Supabase keys needed to render them -- so dev mode needs zero
         * environment setup, while `next build` would also have to compile
         * /dog/[slug] and /scan, which do need both. */
        command: `node ./node_modules/next/dist/bin/next dev --port ${PORT} --hostname 127.0.0.1`,
        url: baseURL,
        /* Reuse locally (fast iteration), never in CI (a leftover server from
         * a previous step would silently serve stale code). */
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
