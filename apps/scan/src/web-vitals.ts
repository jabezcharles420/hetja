/**
 * Web-vitals client for the scan landing (enhancement stack §M.16).
 *
 * Measured natively since design v6, not with the `web-vitals` package: that
 * package cost 3,590 B gzipped of the 40,960 B budget (INVARIANT 13), and
 * the v6 SOS screens needed the room. The four metrics are the same, with
 * the same names, thresholds and ratings the package uses:
 *
 * - TTFB: the navigation entry's responseStart.
 * - LCP: the last largest-contentful-paint entry before the first input or
 *   the page being hidden.
 * - CLS: the largest session window of layout shifts without recent input
 *   (windows end after a 1 s gap or at 5 s).
 * - INP: event timings grouped by interactionId; the worst interaction,
 *   ignoring one for every 50 (the package's p98 approximation).
 *
 * Not reproduced: the package's back/forward-cache restores and prerender
 * adjustments. Each metric is sent once, when the page is first hidden
 * (TTFB and LCP earlier, as soon as they are final).
 *
 * Privacy rule: the path is slug-stripped before it leaves the page
 * ("/d/:slug", never "/d/abc123def"), so per-dog page identity is never
 * collected. The API enforces the same contract server-side (it rejects any
 * path carrying a 9-char collar slug or ?s=).
 */

/**
 * A collar slug, anchored to the route prefix where scan pages actually live
 * (`/d/<slug>`; `/dog/<slug>` is the apps/web equivalent and is accepted here so
 * the two clients agree).
 *
 * The previous pattern was `/\/[a-km-z2-9]{9}\/?$/`: any trailing
 * nine-character segment in the reduced alphabet, with no prefix. That is a
 * length test, not a slug test, and ordinary route names collide with it:
 * `/dashboard` is nine in-alphabet characters, so its telemetry was rewritten to
 * `/:slug` and merged into the collar-page bucket. Mislabelled metrics are worse
 * than missing ones here, because the collar page's LCP is the single number
 * INVARIANT 13's 40 KB budget exists to defend, and a dashboard's timing folded
 * into it makes that number untrue.
 *
 * The identical bug was fixed in `apps/web/lib/web-vitals.ts`; this is the other
 * half. The two are deliberately kept in step: the server-side guard in
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

type Name = "CLS" | "INP" | "LCP" | "TTFB";

/** The package's thresholds: good up to the first, poor above the second. */
const LIMITS: Record<Name, [number, number]> = { CLS: [0.1, 0.25], INP: [200, 500], LCP: [2500, 4000], TTFB: [800, 1800] };

export function rating(name: Name, value: number): "good" | "needs-improvement" | "poor" {
  const [good, poor] = LIMITS[name];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

const sent = new Set<Name>();

function send(name: Name, value: number): void {
  if (sent.has(name) || !(value >= 0)) return;
  sent.add(name);
  try {
    const payload = JSON.stringify({ path: slugStrippedPath(location.pathname), name, value, rating: rating(name, value) });
    navigator.sendBeacon("/api/v1/metrics/web-vitals", new Blob([payload], { type: "application/json" }));
  } catch {
    /* telemetry must never break the life-safety page */
  }
}

type Entry = PerformanceEntry & { hadRecentInput?: boolean; value?: number; interactionId?: number; responseStart?: number };

function observe(type: string, fn: (list: Entry[]) => void, opts: Record<string, unknown> = {}): void {
  try {
    new PerformanceObserver((l) => fn(l.getEntries() as Entry[])).observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
  } catch {
    /* this browser does not support that entry type */
  }
}

/** CLS: the largest session window (gap under 1 s, window under 5 s). */
export function clsOf(shifts: Array<{ startTime: number; value: number }>): number {
  let best = 0;
  let win = 0;
  let first = 0;
  let last = 0;
  for (const s of shifts) {
    if (win && s.startTime - last < 1000 && s.startTime - first < 5000) win += s.value;
    else {
      win = s.value;
      first = s.startTime;
    }
    last = s.startTime;
    best = Math.max(best, win);
  }
  return best;
}

/** INP: worst interaction, skipping one per 50 interactions. */
export function inpOf(durations: number[]): number | undefined {
  const d = [...durations].sort((a, b) => b - a);
  return d.length ? d[Math.min(d.length - 1, Math.floor(d.length / 50))] : undefined;
}

export function reportWebVitals(): void {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as Entry | undefined;
    if (nav?.responseStart) send("TTFB", nav.responseStart);
    let lcp = -1;
    const shifts: Array<{ startTime: number; value: number }> = [];
    const worst = new Map<number, number>();
    observe("largest-contentful-paint", (l) => l.forEach((e) => (lcp = e.startTime)));
    observe("layout-shift", (l) => l.forEach((e) => e.hadRecentInput || shifts.push({ startTime: e.startTime, value: e.value ?? 0 })));
    observe(
      "event",
      (l) => l.forEach((e) => e.interactionId && worst.set(e.interactionId, Math.max(worst.get(e.interactionId) ?? 0, e.duration))),
      { durationThreshold: 40 },
    );
    const lcpDone = (): void => {
      if (lcp >= 0) send("LCP", lcp);
    };
    addEventListener("pointerdown", lcpDone, { once: true, capture: true });
    addEventListener("keydown", lcpDone, { once: true, capture: true });
    addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      lcpDone();
      send("CLS", clsOf(shifts));
      const inp = inpOf([...worst.values()]);
      if (inp !== undefined) send("INP", inp);
    });
  } catch {
    /* performance measurement is optional */
  }
}
