/**
 * Separate bundle entry point for web-vitals telemetry.
 *
 * `web-vitals` used to be a static import in main.ts, which put it in main.js:
 * ~3.2 KB gzipped of an 11.7 KB bundle — a quarter of the JavaScript on the
 * critical path of the one page whose entire design constraint is that a
 * stranger on 4G can load it while standing over an injured dog. It also ran
 * its four observers during the LCP window it exists to measure.
 *
 * It is a separate ENTRY rather than a dynamic `import()` because the build
 * emits IIFE bundles (scripts/build.mjs), and esbuild cannot code-split IIFE
 * output — a dynamic import there is inlined straight back into main.js, which
 * is exactly what happened on the first attempt. main.ts injects a
 * `<script src="/d/telemetry.js" async>` once the page is idle, matching the
 * absolute-path convention the service-worker registration already uses.
 *
 * Deferring loses no data: CLS, INP and LCP are reported from buffered
 * PerformanceObserver entries, so registering late still sees what already
 * happened.
 */
import { reportWebVitals } from "./web-vitals";

reportWebVitals();
