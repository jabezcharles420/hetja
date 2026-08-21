import { parseSlug, isValidSlug } from "./slug";
import { fetchDogProfile } from "./api";
import { setStatus, setSub, renderProfile, renderError, setNote, clearNote } from "./ui";
import { flushOnOpen, evictionSoonCount } from "./offline";
import { listQueued } from "./idb";
import { listDroppedFeeds, clearDroppedFeeds } from "./dropped";
import { wirePanel, setPanelProfile } from "./panel";

const SLUG = parseSlug(location.pathname);
const SIG = new URLSearchParams(location.search).get("s") ?? "";

let viewInFlight = false;

async function view(): Promise<void> {
  if (viewInFlight) return;
  if (!isValidSlug(SLUG)) {
    renderError("Unrecognized code — check the collar and scan again.");
    return;
  }
  viewInFlight = true;
  setStatus("Loading…");
  setSub("");
  clearNote();
  try {
    const { profile, stale } = await fetchDogProfile(SLUG, SIG);
    renderProfile(profile, stale);
    setPanelProfile(profile);
    document.title = `${profile.name} — Hetja`;
  } catch {
    renderError("Can't reach Hetja right now. If you're offline, medical status shown may be outdated.");
    setPanelProfile(undefined);
  } finally {
    viewInFlight = false;
  }
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  try {
    // Served at /d/service-worker.js. A worker's default scope is the
    // directory of its own URL — /d/ — which already covers every /d/<slug>
    // page this app serves, so no Service-Worker-Allowed header is needed.
    void navigator.serviceWorker.register("/d/service-worker.js").catch(() => undefined);
  } catch {
    /* registration must never break the page */
  }
}

async function checkQueue(): Promise<void> {
  try {
    await flushOnOpen();
    // Feeds the flush just gave up on (queued before captures carried a
    // device token — they cannot be retroactively attested). Told here, once,
    // then cleared: the visitor is standing on the page the feed was logged
    // from, which is the only moment the message can land.
    const dropped = listDroppedFeeds();
    if (dropped.length > 0) clearDroppedFeeds();
    const queued = await listQueued();
    let message = "";
    if (dropped.length > 0) {
      const s = dropped.length === 1 ? "" : "s";
      message +=
        `${dropped.length} earlier feed log${s} couldn't be uploaded and ${dropped.length === 1 ? "was" : "were"} ` +
        `removed rather than retried — please log ${dropped.length === 1 ? "it" : "them"} again. `;
    }
    if (queued.length > 0) {
      const soon = await evictionSoonCount();
      const s = queued.length === 1 ? "" : "s";
      message += soon > 0
        ? `${queued.length} feed log${s} waiting to upload — cleared from this device after ~7 days. Get online to sync.`
        : `${queued.length} feed log${s} queued — will upload when you're online.`;
    }
    if (message) setNote(message.trim());
  } catch {
    /* ignore */
  }
}

wirePanel(SLUG);
registerServiceWorker();
void view();
void checkQueue();

/**
 * Telemetry loads AFTER the page is usable, as its own chunk.
 *
 * `web-vitals` was a static import, which put it in `main.js` — measured at
 * ~3.2 KB gzipped of an 11.7 KB bundle, so a quarter of the JavaScript on the
 * critical path of a page whose entire design constraint is that a stranger on
 * 4G can load it while standing over an injured dog. (The header comment in
 * web-vitals.ts claimed "~1.5 KB gzipped, tree-shaken"; that was optimistic by
 * about 2×.) It also ran its four observers during the LCP window it exists to
 * measure.
 *
 * Deferring it does not lose data: CLS/INP/LCP are all reported from buffered
 * PerformanceObserver entries, so registering slightly late still sees what
 * already happened. `requestIdleCallback` where available, a `load`-anchored
 * fallback elsewhere (Safari has no rIC).
 */
function loadTelemetry(): void {
  try {
    const s = document.createElement("script");
    s.src = "/d/telemetry.js";
    s.async = true;
    document.head.appendChild(s);
  } catch {
    /* telemetry is optional -- it must never surface to the user */
  }
}

const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
  .requestIdleCallback;
if (typeof idle === "function") {
  idle(loadTelemetry, { timeout: 5000 });
} else {
  // Safari has no requestIdleCallback.
  window.addEventListener("load", () => window.setTimeout(loadTelemetry, 1500), { once: true });
}
