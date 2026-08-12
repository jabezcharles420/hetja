"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isStandalone } from "./pwa";

/**
 * Mobile-first install prompt.
 *
 * Captures the browser's `beforeinstallprompt` event and exposes a manual
 * `promptInstall()` (must be called from a user gesture, so it is wired to a
 * button tap). The offer is gated on the 2nd visit onward (localStorage visit
 * counter) and can be dismissed for good.
 */

export const VISIT_KEY = "hetja:visits";
export const LAST_VISIT_KEY = "hetja:last-visit-ts";
export const DISMISS_KEY = "hetja:install-dismissed";
export const OFFER_AFTER_VISITS = 2;

/** Ignore back-to-back mounts within a short window (React StrictMode remounts, reload spam). */
const MIN_VISIT_GAP_MS = 30_000;

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface InstallPrompt {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
  dismiss: () => void;
}

function readVisitCount(): number {
  try {
    return Number(localStorage.getItem(VISIT_KEY) ?? "0");
  } catch {
    return 0;
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function countVisit(): void {
  try {
    const last = Number(localStorage.getItem(LAST_VISIT_KEY) ?? "0");
    const now = Date.now();
    if (now - last < MIN_VISIT_GAP_MS) return;
    localStorage.setItem(LAST_VISIT_KEY, String(now));
    localStorage.setItem(VISIT_KEY, String(readVisitCount() + 1));
  } catch {
    /* storage unavailable — skip counting, never block the UI */
  }
}

export function useInstallPrompt(): InstallPrompt {
  const [canInstall, setCanInstall] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return;
    if (isStandalone()) return;

    countVisit();

    if (readDismissed()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      if (readVisitCount() >= OFFER_AFTER_VISITS) {
        setCanInstall(true);
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const prompt = deferredPrompt.current;
    if (!prompt) return;
    deferredPrompt.current = null;
    setCanInstall(false);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      /* the prompt was already shown or rejected — nothing to recover */
    }
  }, []);

  const dismiss = useCallback(() => {
    deferredPrompt.current = null;
    setCanInstall(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  return { canInstall, promptInstall, dismiss };
}
