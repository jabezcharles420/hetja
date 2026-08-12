/**
 * PWA bootstrap: service-worker registration + web app manifest.
 *
 * The static `public/sw.js` caches the app shell, serves cached dog profiles
 * offline, and wakes the tab to flush the feed queue on Background Sync.
 * `public/manifest.webmanifest` declares the standalone install experience
 * (StrayNet Feeder).
 */

export const SW_PATH = "/sw.js";
export const MANIFEST_PATH = "/manifest.webmanifest";

export interface PwaManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

export function getManifest(): PwaManifest {
  return {
    name: "StrayNet Feeder",
    short_name: "Feeder",
    description: "Feed logs, profiles and SOS for Mumbai's stray dogs.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a1a12",
    theme_color: "#0b7a3b",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}

/** Inject the `<link rel="manifest">` if not already present. */
export function linkManifest(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = MANIFEST_PATH;
  document.head.appendChild(link);
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch {
    return null;
  }
}

export function isStandalone(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function isInstallable(): boolean {
  if (typeof window === "undefined") return false;
  return "BeforeInstallPromptEvent" in window;
}

/**
 * Full bootstrap for the layout: ensure the manifest link exists and register
 * the service worker (production). Returns whether a SW is active.
 */
export async function initPwa(): Promise<boolean> {
  linkManifest();
  const reg = await registerServiceWorker();
  return reg !== null;
}
