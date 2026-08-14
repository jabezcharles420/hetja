/**
 * Web-vitals client for the scan landing (enhancement stack §M.16).
 *
 * This is the one addition the scan app allows itself beyond its core, kept
 * deliberately tiny (the web-vitals package is ~1.5 KB gzipped and esbuild
 * tree-shakes it down to the four on* functions actually used).
 *
 * Privacy rule: the path is slug-stripped before it leaves the page
 * ("/d/:slug", never "/d/abc123def"), so per-dog page identity is never
 * collected. The API enforces the same contract server-side (it rejects any
 * path carrying a 9-char collar slug or ?s=).
 */
import { onCLS, onINP, onLCP, onTTFB } from "web-vitals";
import type { MetricType } from "web-vitals";

/**
 * A collar slug, anchored to the route prefix where scan pages actually live
 * (`/d/<slug>`; `/dog/<slug>` is the apps/web equivalent and is accepted here so
 * the two clients agree).
 *
 * The previous pattern was `/\/[a-km-z2-9]{9}\/?$/` — any trailing
 * nine-character segment in the reduced alphabet, with no prefix. That is a
 * length test, not a slug test, and ordinary route names collide with it:
 * `/dashboard` is nine in-alphabet characters, so its telemetry was rewritten to
 * `/:slug` and merged into the collar-page bucket. Mislabelled metrics are worse
 * than missing ones here, because the collar page's LCP is the single number
 * INVARIANT 13's 40 KB budget exists to defend — a dashboard's timing folded
 * into it makes that number untrue.
 *
 * The identical bug was fixed in `apps/web/lib/web-vitals.ts`; this is the other
 * half. The two are deliberately kept in step — the server-side guard in
 * `routes/metrics.ts` rejects a slug-shaped segment that passes the INVARIANT 1
 * check character anywhere in the path, so a client that fails to strip one gets
 * a 400 the beacon cannot report, and its telemetry silently disappears.
 *
 * Anchoring on the prefix rather than adding a check-character test is
 * deliberate: the validator lives in `@hetja/db` (`isValidSlug`), a server
 * package that pulls in a Postgres client, and apps/scan has no `@hetja/*`
 * dependency at all on purpose. Reimplementing the alphabet arithmetic here
 * would be a second copy of a rule that must not drift, in the bundle that can
 * least afford it.
 *
 * The `(?:\/$|(?=\/|$))` tail consumes a trailing slash only when the slug ends
 * the path, so `/d/<slug>/` normalises to `/d/:slug` rather than `/d/:slug/`
 * (otherwise the two become separate rows), while `/d/<slug>/photos` keeps its
 * remainder.
 */
const DOG_SLUG_PATH = /^(\/(?:d|dog|dogs))\/[a-km-z2-9]{9}(?:\/$|(?=\/|$))/;

export function slugStrippedPath(pathname: string): string {
  return pathname.replace(DOG_SLUG_PATH, "$1/:slug");
}

function send(m: MetricType): void {
  try {
    const payload = JSON.stringify({
      path: slugStrippedPath(location.pathname),
      name: m.name,
      value: m.value,
      rating: m.rating,
    });
    navigator.sendBeacon(
      "/api/v1/metrics/web-vitals",
      new Blob([payload], { type: "application/json" }),
    );
  } catch {
    /* telemetry must never break the life-safety page */
  }
}

export function reportWebVitals(): void {
  try {
    onCLS(send);
    onINP(send);
    onLCP(send);
    onTTFB(send);
  } catch {
    /* performance measurement is optional */
  }
}
