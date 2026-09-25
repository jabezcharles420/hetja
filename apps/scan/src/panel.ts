/**
 * The one loud button on the profile: "Rani needs help" (SOS red, pinned in
 * the footer; "This dog needs help" before the profile loads and on an
 * unknown collar). It opens the SOS flow in place.
 *
 * It is live from the first paint (P7 "Works before the page finishes
 * loading."): index.html ships it enabled, and an inline script records a
 * tap that lands before this bundle has run (`window.__sos`), which is
 * replayed here. It never waits on the profile fetch, and since design v6
 * it is never disabled for a bad code either (P8): a hurt dog with a
 * scratched tag is still hurt, so the SOS falls back to the visitor's ward.
 */
import type { DogProfile } from "./api";
import { openSos } from "./sos";

let currentSlug = "";
let currentProfile: DogProfile | undefined;
let dogless = false;

export function wirePanel(slug: string, noDog = false): void {
  currentSlug = slug;
  dogless = noDog;
  const open = (): void => openSos({ slug: currentSlug, profile: currentProfile, dogless });
  const cta = document.querySelector<HTMLButtonElement>("#primary-cta");
  if (!cta) return;
  cta.onclick = null;
  cta.disabled = false;
  cta.addEventListener("click", open);
  const w = window as Window & { __sos?: number };
  if (w.__sos) {
    w.__sos = 0;
    open();
  }
}

/**
 * Records the profile for the SOS screens' copy, or marks the code as
 * unknown (`dogless`, P8). Never touches the button's enabled state.
 */
export function setPanelProfile(profile: DogProfile | undefined, noDog = false): void {
  currentProfile = profile;
  dogless = noDog;
}
