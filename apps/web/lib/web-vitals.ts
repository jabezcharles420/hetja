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

/** Reduced-alphabet 9-char collar slug as a final path segment. */
const SLUG_SEGMENT = /\/[a-km-z2-9]{9}\/?$/;

export function slugStrippedPath(pathname: string): string {
  return pathname.replace(SLUG_SEGMENT, "/:slug");
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
