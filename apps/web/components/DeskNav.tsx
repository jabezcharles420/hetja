"use client";

import { Button, TopNav } from "@/components/ds";
import styles from "./DeskNav.module.css";

/**
 * The desktop nav (design v8, docs/design/v8-desktop: the design system's
 * ui_kits/desktop/DeskNav). One bar over the two desktop pages that are real
 * pages, the ward map and the "Hetja lives on your phone" invitation: the
 * logo, five links, "Sign in" and the "Open on your phone" pill, which opens
 * the invitation (any app route on a desktop shows it; "/" is its home).
 */
export const DESK_LINKS = [
  { href: "/map", label: "Map" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/how-it-works#feeders", label: "Feeders" },
  { href: "/how-it-works#vets", label: "Vets" },
  { href: "/privacy", label: "Privacy" },
];

export function DeskNav({
  current,
  hideCta = false,
  className,
}: {
  current?: string;
  /** On the invitation itself the pill would open the page it is on. */
  hideCta?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <TopNav
      layout="desktop"
      surface="solid"
      scrolled
      links={DESK_LINKS}
      current={current}
      className={[styles.wide, className ?? ""].filter(Boolean).join(" ")}
      cta={
        hideCta ? undefined : (
          <Button variant="navPill" href="/">
            Open on your phone
          </Button>
        )
      }
    />
  );
}
