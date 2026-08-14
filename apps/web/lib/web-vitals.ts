/**
 * Web-vitals client (enhancement stack §M.16).
 *
 * Reports LCP/CLS/INP/TTFB to POST /api/v1/metrics/web-vitals via
 * navigator.sendBeacon. The one privacy rule that matters here: the path is
 * slug-stripped before it leaves the page ("/dog/:slug", never "/dog/xyz123abc"),
 * so per-dog page identity is never collected — the server enforces the same
 * contract (it rejects any path carrying a 9-char collar slug or ?s=).
 */
import { API_ORIGIN } from "@/lib/api";
import type { MetricType } from "web-vitals";

/**
 * A collar slug, anchored to the route prefixes where dog pages actually live
 * (`/d/<slug>` on apps/scan, `/dog/<slug>` on apps/web).
 *
 * The previous pattern was `/\/[a-km-z2-9]{9}\/?$/` — any trailing nine-character
 * segment in the reduced alphabet, with no prefix. That is not a slug test, it is
 * a length test, and ordinary route names collide with it: `/dashboard` is nine
 * in-alphabet characters, so its telemetry was reported as `/:slug` and silently
 * merged into the dog-page bucket. `/gamification` and `/territories` contain
 * nine-character runs too. The effect was mislabelled metrics -- LCP for a
 * dashboard attributed to the collar page, which is the one page whose
 * performance actually matters -- so the measurement that exists to keep us
 * honest about performance was quietly lying.
 *
 * Anchoring on the prefix rather than adding an INVARIANT 1 check-character test
 * is deliberate: the check-character validator lives in `@hetja/db`
 * (`isValidSlug`), which is a server package that pulls in a Postgres client, and
 * duplicating the alphabet arithmetic into the browser bundle is a second copy of
 * a rule that must not drift. The prefix is where slugs are, and it cannot
 * false-positive on a route name.
 *
 * The `(?:\/$|(?=\/|$))` tail consumes a trailing slash when the slug ends the
 * path (so `/d/<slug>/` normalises to `/d/:slug`, not `/d/:slug/`, and the two do
 * not become separate rows in the metrics table) while only *looking* at a slash
 * that is followed by more path, leaving `/d/<slug>/photos` as
 * `/d/:slug/photos`.
 */
const DOG_SLUG_PATH = /^(\/(?:d|dog|dogs))\/[a-km-z2-9]{9}(?:\/$|(?=\/|$))/;

export function slugStrippedPath(pathname: string): string {
  return pathname.replace(DOG_SLUG_PATH, "$1/:slug");
}

export function vitalsPayload(
  pathname: string,
  m: MetricType,
): { path: string; name: string; value: number; rating: string } {
  return { path: slugStrippedPath(pathname), name: m.name, value: m.value, rating: m.rating };
}

export function sendVitalsBeacon(pathname: string, m: MetricType): boolean {
  try {
    return navigator.sendBeacon(
      `${API_ORIGIN}/api/v1/metrics/web-vitals`,
      new Blob([JSON.stringify(vitalsPayload(pathname, m))], { type: "application/json" }),
    );
  } catch {
    return false;
  }
}
