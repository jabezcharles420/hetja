"use client";

import { useEffect } from "react";
import { FEED_LOGGED_EVENT } from "@/lib/api";
import { registerServiceWorker, maybeSubscribeAfterFeed } from "@/lib/pwa";
import { flushOnOpen } from "@/lib/offline-queue";
import { captureInstallPrompt } from "@/lib/install-offer";

/**
 * Layout-level client bootstrap: registers the service worker (installs the
 * PWA + enables Background Sync) and flushes the offline feed queue on app
 * open / reconnect (the iOS fallback path).
 *
 * Also asks for Web Push permission at the moment that earns it, a
 * feeder's first logged feed, never on page load (plan §3.3): on the API
 * client's FEED_LOGGED_EVENT (lib/api.ts), and on the service worker's
 * HETJA_FEED_LOGGED message, which only fires for a same-origin API.
 */
export function PwaBootstrap(): React.JSX.Element | null {
  useEffect(() => {
    // V23: hold the browser's install prompt for the first logged feed.
    captureInstallPrompt();
    void registerServiceWorker();
    void flushOnOpen();

    const onOnline = () => {
      void flushOnOpen();
    };
    window.addEventListener("online", onOnline);
    const onFeedLogged = () => {
      void maybeSubscribeAfterFeed();
    };
    window.addEventListener(FEED_LOGGED_EVENT, onFeedLogged);

    const onMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type === "HETJA_FLUSH") {
        void flushOnOpen();
      }
      if (event.data.type === "HETJA_FEED_LOGGED") {
        void maybeSubscribeAfterFeed();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(FEED_LOGGED_EVENT, onFeedLogged);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
