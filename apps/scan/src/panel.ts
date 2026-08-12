/**
 * The action panel: the one primary CTA ("This dog needs help") that opens
 * the severity sheet, and the quiet "Log a feed" text link beneath it.
 * Strangers must not choose between two buttons of equal weight — the CTA
 * is a button, feed-logging is a link.
 */
import type { DogProfile } from "./api";
import { openSeverity } from "./sheet";
import { logFeed } from "./offline";
import { toast, setNote } from "./ui";

let currentSlug = "";
let currentProfile: DogProfile | undefined;

export function wirePanel(slug: string): void {
  currentSlug = slug;
  document.querySelector("#primary-cta")?.addEventListener("click", () => {
    openSeverity({ slug: currentSlug, profile: currentProfile });
  });
  document.querySelector("#log-feed-link")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    void onLogFeed();
  });
}

export function setPanelProfile(profile: DogProfile | undefined): void {
  currentProfile = profile;
  const cta = document.querySelector<HTMLButtonElement>("#primary-cta");
  if (cta) cta.disabled = !profile;
}

async function onLogFeed(): Promise<void> {
  const link = document.querySelector<HTMLAnchorElement>("#log-feed-link");
  link?.setAttribute("aria-disabled", "true");
  toast("Opening camera…", 2500);
  try {
    const outcome = await logFeed(currentSlug);
    toast(outcome.message, 6000);
    if (outcome.evictionSoon) {
      setNote("Upload soon — offline logs are cleared from this device after ~7 days.");
    }
  } finally {
    link?.removeAttribute("aria-disabled");
  }
}
