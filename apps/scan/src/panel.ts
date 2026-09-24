/**
 * The one loud button on the profile: "This dog needs help" (SOS red, pinned
 * in the footer). It opens screen 04 in place.
 *
 * The design gives this screen exactly one action (hard rule 1), so the old
 * quiet "Log a feed" link is gone from here; feeders log feeds from apps/web
 * (screen 06). The offline feed queue this page flushes on open is unchanged
 * (main.ts).
 */
import type { DogProfile } from "./api";
import { openSos } from "./sos";

let currentSlug = "";
let currentProfile: DogProfile | undefined;

export function wirePanel(slug: string): void {
  currentSlug = slug;
  document.querySelector("#primary-cta")?.addEventListener("click", () => {
    openSos({ slug: currentSlug, profile: currentProfile });
  });
  // The emergency CTA is enabled by a VALID SLUG, not by a successful profile
  // fetch. `index.html` ships it `disabled` so it cannot be pressed before the
  // handler above is attached; this is the moment it becomes real.
  //
  // It used to be enabled only by `setPanelProfile(profile)`, so one failed
  // GET /api/v1/dogs/<slug> (a stranger on flaky 4G, standing over an injured
  // dog) rendered "Can't reach Hetja right now" above a permanently greyed-out
  // "This dog needs help". Nothing in the SOS path needs the profile:
  // `openSos` reads `ctx.slug`, `fileReport` posts `{dogSlug, severity}`, and
  // `sos.ts` types `profile` as optional, using it only for the dog's name,
  // ward and the SMS fallback body. The page that exists to summon help
  // disabled the button that summons help, for a reason unrelated to
  // summoning help.
  setPanelEnabled(isPlausibleSlug(slug));
}

/**
 * Records the profile for the SOS screens' copy and the SMS fallback body.
 * Deliberately does NOT touch the CTA's enabled state; see `wirePanel`.
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
