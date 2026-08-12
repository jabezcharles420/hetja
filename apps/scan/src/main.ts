import { parseSlug, isValidSlug } from "./slug";
import { fetchDogProfile } from "./api";
import { setStatus, setSub, renderProfile, renderError, setNote, clearNote } from "./ui";
import { flushOnOpen, evictionSoonCount } from "./offline";
import { listQueued } from "./idb";
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
    const queued = await listQueued();
    if (queued.length === 0) return;
    const soon = await evictionSoonCount();
    if (soon > 0) {
      setNote(
        `${queued.length} feed log${queued.length === 1 ? "" : "s"} waiting to upload — cleared from this device after ~7 days. Get online to sync.`,
      );
    } else {
      setNote(`${queued.length} feed log${queued.length === 1 ? "" : "s"} queued — will upload when you're online.`);
    }
  } catch {
    /* ignore */
  }
}

wirePanel(SLUG);
registerServiceWorker();
void view();
void checkQueue();
