"use client";

import { useEffect } from "react";
import { onCLS, onINP, onLCP, onTTFB } from "web-vitals";
import type { MetricType } from "web-vitals";
import { sendVitalsBeacon } from "@/lib/web-vitals";

/**
 * Best-effort Core Web Vitals telemetry. Renders nothing; mounts once in the
 * root layout. The path sent is slug-stripped in lib/web-vitals.ts, so a dog
 * page reports as "/dog/:slug", never the real collar code.
 */
export function WebVitalsReporter(): null {
  useEffect(() => {
    const report = (m: MetricType) => void sendVitalsBeacon(window.location.pathname, m);
    onCLS(report);
    onINP(report);
    onLCP(report);
    onTTFB(report);
  }, []);
  return null;
}
