"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa";
import { flushOnOpen } from "@/lib/offline-queue";

/**
 * Layout-level client bootstrap: registers the service worker (installs the
 * PWA + enables Background Sync) and flushes the offline feed queue on app
 * open / reconnect (the iOS fallback path).
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
      if (event.data && event.data.type === "STRAYNET_FLUSH") {
        void flushOnOpen();
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
