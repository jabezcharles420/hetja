/**
 * Whether the D1 desktop invitation is covering the app right now
 * (ChromeShell: wider than 744px on a route whose desktop mode is "invite").
 *
 * The app under the invitation is hidden with CSS only, so it still mounts
 * and runs. Anything with a side effect a visitor would notice must check
 * this first: the QR scanner opened the webcam (prompt, camera light) behind
 * "Hetja lives on your phone" for a scanner nobody could see.
 */
export const DESKTOP_QUERY = "(min-width: 745px)";

export function inviteCoversApp(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  if (!window.matchMedia(DESKTOP_QUERY).matches) return false;
  return document.querySelector('[data-desktop="invite"]') !== null;
}

/** Calls `cb` whenever the screen crosses the desktop breakpoint; returns the unsubscribe. */
export function onDesktopChange(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(DESKTOP_QUERY);
  if (typeof mq.addEventListener !== "function") return () => undefined;
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
