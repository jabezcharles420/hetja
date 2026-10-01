"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, LogoMark, TopNav } from "@/components/ds";
import { getAccessToken } from "@/lib/api";
import styles from "./DeskNav.module.css";

/**
 * The desktop nav (design v8, docs/design/v8-desktop): the owner's Stitch
 * header in the design system. The logo with its "Mumbai canine ledger" line,
 * the five sections Stitch names, "Sign in" (or the account's avatar when
 * signed in) and the "Open on phone" pill: a QR dialog where the page offers
 * one (`onOpenPhone`, the map), otherwise the invitation ("/").
 */
export const DESK_LINKS = [
  { href: "/map", label: "Live map" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About & memorial" },
  { href: "/join", label: "Vets & feeders" },
  { href: "/privacy", label: "Privacy & ledger" },
];

export function DeskBrand(): React.JSX.Element {
  return (
    <Link href="/" className={styles.brand} aria-label="Hetja home">
      <LogoMark size={34} />
      <span className={styles.brandText}>
        <span className={styles.brandName}>Hetja</span>
        <span className={styles.brandSub}>Mumbai canine ledger</span>
      </span>
    </Link>
  );
}

function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(!!getAccessToken()), []);
  return signedIn;
}

export function DeskNav({
  current,
  hideCta = false,
  onOpenPhone,
  className,
}: {
  current?: string;
  /** On the invitation itself the pill would open the page it is on. */
  hideCta?: boolean;
  /** Show this page's QR in place (the map's dialog) instead of opening the invitation. */
  onOpenPhone?: () => void;
  className?: string;
}): React.JSX.Element {
  const signedIn = useSignedIn();
  return (
    <TopNav
      layout="desktop"
      surface="solid"
      scrolled
      links={DESK_LINKS}
      current={current}
      leading={<DeskBrand />}
      showSignIn={!signedIn}
      className={[styles.wide, className ?? ""].filter(Boolean).join(" ")}
      cta={
        <>
          {hideCta ? null : onOpenPhone ? (
            <Button variant="navPill" onClick={onOpenPhone}>
              Open on phone
            </Button>
          ) : (
            <Button variant="navPill" href="/">
              Open on phone
            </Button>
          )}
          {signedIn && (
            <Link href="/me" className={styles.avatar} aria-label="Your account">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="8" r="4" fill="currentColor" />
                <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" fill="currentColor" />
              </svg>
            </Link>
          )}
        </>
      }
    />
  );
}
