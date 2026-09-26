"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/api";
import styles from "./vet.module.css";

/** The 52px header with a 15px back link ("‹ Profile", "‹ Vet"). `/d/` is another app: a plain anchor. */
export function VetTop({
  back,
  href,
  trailing,
  onBack,
}: {
  back: string;
  href: string;
  trailing?: ReactNode;
  /** A step inside the same screen: go back without a navigation. */
  onBack?: () => void;
}): React.JSX.Element {
  const label = (
    <>
      <span aria-hidden="true">{"‹ "}</span>
      {back}
    </>
  );
  return (
    <div className={styles.top}>
      {onBack ? (
        <button type="button" className={styles.back} onClick={onBack}>
          {label}
        </button>
      ) : href.startsWith("/d/") ? (
        <a href={href} className={styles.back}>
          {label}
        </a>
      ) : (
        <Link href={href} className={styles.back}>
          {label}
        </Link>
      )}
      {trailing}
    </div>
  );
}

/** The plain frame every vet screen shares while it loads or fails. */
export function VetMessage({
  back,
  href,
  title,
  lead,
  children,
  role,
}: {
  back: string;
  href: string;
  title?: string;
  lead?: string;
  children?: ReactNode;
  role?: "status" | "alert";
}): React.JSX.Element {
  return (
    <div className={styles.page}>
      <VetTop back={back} href={href} />
      <div className={styles.body}>
        {title && <h1 className={styles.title}>{title}</h1>}
        {lead && (
          <p className={styles.lead} role={role}>
            {lead}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

/** Sends a signed-out visitor to sign in and back here. Returns `toLogin` for 401s later. */
export function useSignedIn(here: string): { toLogin: () => void; signedIn: () => boolean } {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const toLogin = useCallback(() => {
    routerRef.current.replace(`/login?next=${encodeURIComponent(here)}`);
  }, [here]);
  const signedIn = useCallback(() => {
    if (getAccessToken()) return true;
    toLogin();
    return false;
  }, [toLogin]);
  return { toLogin, signedIn };
}

/** Runs `load` once on mount, if signed in. */
export function useOnMount(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
  }, []);
}

/** The board's ⌗ icon for "Scan a collar", as an SVG so it renders the same everywhere. */
export function ScanGlyph(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7 3v14M13 3v14M3 7h14M3 13h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** The board's photo placeholder icon. */
export function PhotoGlyph(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <circle cx="9" cy="10" r="1.8" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

/** Reads a picked file as base64 (no data: prefix). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const out = String(r.result ?? "");
      const i = out.indexOf(",");
      resolve(i >= 0 ? out.slice(i + 1) : out);
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}
