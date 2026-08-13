"use client";

import { useEffect } from "react";
import { registerServiceWorker, maybeSubscribeAfterFeed } from "@/lib/pwa";
import { flushOnOpen } from "@/lib/offline-queue";

/**
 * Layout-level client bootstrap: registers the service worker (installs the
 * PWA + enables Background Sync) and flushes the offline feed queue on app
 * open / reconnect (the iOS fallback path).
 *
 * Also listens for the service worker's HETJA_FEED_LOGGED message
 * (public/sw.js observing a successful POST /api/v1/scans) to ask for Web
 * Push permission at the moment that earns it -- a feeder's first logged
 * feed, never on page load (plan §3.3).
 */
export function PwaBootstrap(): React.JSX.Element | null {
  useEffect(() => {
    void registerServiceWorker();
    void flushOnOpen();

    const onOnline = () => {
      void flushOnOpen();
    };
    window.addEventListener("online", onOnline);

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
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
