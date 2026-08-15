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
  // The emergency CTA is enabled by a VALID SLUG, not by a successful profile
  // fetch. `index.html` ships it `disabled` so it cannot be pressed before the
  // handler above is attached; this is the moment it becomes real.
  //
  // It used to be enabled only by `setPanelProfile(profile)`, so one failed
  // GET /api/v1/dogs/<slug> — a stranger on flaky 4G, standing over an injured
  // dog — rendered "Can't reach Hetja right now" above a permanently greyed-out
  // "This dog needs help". Nothing in the SOS path needs the profile:
  // `openSeverity` reads `ctx.slug`, `fileReport` posts `{dogSlug, severity}`,
  // and `sheet.ts` types `profile` as optional, using it only to decorate the
  // SMS fallback body. The page that exists to summon help disabled the button
  // that summons help, for a reason unrelated to summoning help.
  setPanelEnabled(isPlausibleSlug(slug));
  document.querySelector("#log-feed-link")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    void onLogFeed();
  });
}

/**
 * Records the profile for the SMS fallback body. Deliberately does NOT touch
 * the CTA's enabled state — see `wirePanel`.
 */
export function setPanelProfile(profile: DogProfile | undefined): void {
  currentProfile = profile;
}

function setPanelEnabled(enabled: boolean): void {
  const cta = document.querySelector<HTMLButtonElement>("#primary-cta");
  if (cta) cta.disabled = !enabled;
}

/**
 * Local shape check, not a signature check. `wirePanel` is only reached once
 * `main.ts` has already validated the slug, so this is a cheap guard against
 * wiring up an emergency button for a URL that carries no slug at all.
 */
function isPlausibleSlug(slug: string): boolean {
  return slug.length > 0;
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
