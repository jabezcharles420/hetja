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

/** Reduced-alphabet 9-char collar slug as a final path segment. */
const SLUG_SEGMENT = /\/[a-km-z2-9]{9}\/?$/;

export function slugStrippedPath(pathname: string): string {
  return pathname.replace(SLUG_SEGMENT, "/:slug");
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
