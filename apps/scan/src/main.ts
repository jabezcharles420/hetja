import { parseSlug, isValidSlug } from "./slug";
import { fetchDogProfile } from "./api";
import type { DogProfile } from "./api";
import { setStatus, setSub, setNet, renderProfile, renderError, toast, setNote, clearNote } from "./ui";
import { logFeed, flushOnOpen, evictionSoonCount } from "./offline";
import { listQueued } from "./idb";

const SLUG = parseSlug(location.pathname);
const SIG = new URLSearchParams(location.search).get("s") ?? "";
const EMERGENCY_NUMBER = "+91 900 000 0000";

let lastProfile: DogProfile | undefined;
let viewInFlight = false;

async function view(): Promise<void> {
  if (viewInFlight) return;
  if (!isValidSlug(SLUG)) {
    renderError("Unrecognized code — check the collar and scan again.");
    return;
  }
  viewInFlight = true;
  setStatus("Loading profile…");
  setSub("");
  clearNote();
  try {
    const { profile, stale } = await fetchDogProfile(SLUG, SIG);
    lastProfile = profile;
    renderProfile(profile, stale);
    setStatus(profile.name);
    setSub(profile.vibe ? profile.vibe : profile.slug);
  } catch {
    setStatus("Unavailable");
    setSub("Can't reach StrayNet right now. If you're offline, medical status shown may be outdated.");
  } finally {
    viewInFlight = false;
  }
}

async function onLogFeed(): Promise<void> {
  if (!isValidSlug(SLUG)) {
    toast("Unrecognized code — can't log feed.");
    return;
  }
  const btn = document.querySelector("#cta-feed") as HTMLButtonElement;
  btn.disabled = true;
  toast("Opening camera…", 2500);
  try {
    const outcome = await logFeed(SLUG);
    toast(outcome.message, 6000);
    if (outcome.evictionSoon) {
      setNote("Upload soon — offline logs are cleared from this device after ~7 days.");
    }
  } finally {
    btn.disabled = false;
  }
}

function onSos(): void {
  if (navigator.onLine) {
    location.assign(`/sos/${SLUG}${SIG ? `?s=${SIG}` : ""}`);
  } else {
    const p = lastProfile;
    const parts = ["StrayNet EMERGENCY"];
    if (SLUG) parts.push(`dog ${SLUG}`);
    if (p?.name) parts.push(p.name);
    if (p?.wardId) parts.push(`ward ${p.wardId}`);
    const body = encodeURIComponent(parts.join(" — "));
    location.assign(`sms:?body=${body}`);
  }
}

async function onOpen(): Promise<void> {
  setNet(navigator.onLine);
  window.addEventListener("online", () => setNet(true));
  window.addEventListener("offline", () => setNet(false));
  document.querySelector("#cta-view")?.addEventListener("click", () => void view());
  document.querySelector("#cta-feed")?.addEventListener("click", () => void onLogFeed());
  document.querySelector("#cta-sos")?.addEventListener("click", onSos);
  void view();
  void checkQueue();
}

async function checkQueue(): Promise<void> {
  try {
    await flushOnOpen();
    const queued = await listQueued();
    if (queued.length === 0) return;
    const soon = await evictionSoonCount();
    if (soon > 0) {
      setNote(`${queued.length} feed log${queued.length === 1 ? "" : "s"} waiting to upload — cleared from this device after ~7 days. Get online to sync.`);
    } else {
      setNote(`${queued.length} feed log${queued.length === 1 ? "" : "s"} queued — will upload when you're online.`);
    }
  } catch {
    /* ignore */
  }
}

onOpen();
