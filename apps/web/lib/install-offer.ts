"use client";

import { useCallback, useEffect, useState } from "react";
import { isStandalone } from "./pwa";
import type { BeforeInstallPromptEvent } from "./useInstallPrompt";

/**
 * V23 (design v6): offer "Add to home screen" at an earned moment, after the
 * first logged feed, named after the dog just fed. Never on a first visit.
 *
 * The browser fires `beforeinstallprompt` once, early, whenever it likes. It
 * is captured here, at module load, and held until a screen asks for it.
 * `captureInstallPrompt()` is called from PwaBootstrap so the listener is up
 * before the event can fire. iOS Safari has no such event: there the offer
 * shows the Share, then Add to Home Screen steps instead.
 */

export const INSTALL_OFFERED_KEY = "hetja:install-offered";

let held: BeforeInstallPromptEvent | null = null;
let listening = false;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

/** Start holding the browser's install prompt. Safe to call more than once. */
export function captureInstallPrompt(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    held = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    held = null;
    notify();
  });
}

/** Test hook: pretend the browser handed us a prompt (or took it back). */
export function __setHeldPromptForTests(p: BeforeInstallPromptEvent | null): void {
  held = p;
  notify();
}

export function isIosSafari(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
  return ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
}

export type InstallPlatform = "prompt" | "ios" | null;

export interface InstallOffer {
  /** "prompt" = the browser's own dialog is held; "ios" = show the steps; null = cannot install here. */
  platform: InstallPlatform;
  /** Installable, not installed, and not offered before on this browser. */
  shouldOffer: boolean;
  /** Show the browser's dialog (from a tap). Resolves with what the visitor chose. */
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
  /** Remember the offer was made, so it is never made twice. */
  markOffered: () => void;
}

function readOffered(): boolean {
  try {
    return localStorage.getItem(INSTALL_OFFERED_KEY) === "1";
  } catch {
    return false;
  }
}

export function useInstallOffer(): InstallOffer {
  const [, force] = useState(0);
  const [offered, setOffered] = useState(true);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    captureInstallPrompt();
    const fn = () => force((n) => n + 1);
    subscribers.add(fn);
    setOffered(readOffered());
    setStandalone(isStandalone());
    setIos(isIosSafari());
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  const platform: InstallPlatform = standalone ? null : held ? "prompt" : ios ? "ios" : null;

  const install = useCallback(async () => {
    const p = held;
    if (!p) return "unavailable" as const;
    held = null;
    notify();
    try {
      await p.prompt();
      const choice = await p.userChoice;
      return choice.outcome;
    } catch {
      return "dismissed" as const;
    }
  }, []);

  const markOffered = useCallback(() => {
    setOffered(true);
    try {
      localStorage.setItem(INSTALL_OFFERED_KEY, "1");
    } catch {
      /* storage unavailable: the offer may come once more, which is fine */
    }
  }, []);

  return { platform, shouldOffer: platform !== null && !offered, install, markOffered };
}
