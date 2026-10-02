"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { StatusPill } from "@/components/ds";
import { DeskNav } from "@/components/DeskNav";
import { DeskFooter } from "@/components/DeskFooter";
import { useDeskDialogs } from "@/components/desk/DeskDialogs";
import { prettyCode } from "@/lib/scan-code";
import { DESKTOP_QUERY } from "@/lib/desktop-invite";
import { loadShowcaseDog, type ShowcaseDog } from "@/lib/showcase-dog";
import styles from "./DesktopInvite.module.css";

/**
 * D1 (design v6, "Desktop is an invitation"): what every app route shows on a
 * screen wider than 744px. Hetja is made for the street, so instead of 86
 * desktop screens there is one page that hands the visitor to their phone.
 * The QR encodes the current URL, so scanning the map on a laptop lands on
 * the map on the phone.
 *
 * The phone preview shows a real public dog when one exists (ward level
 * only: lib/showcase-dog), and otherwise the v4 sample dog, labelled as an
 * example: no fake dog is presented as real (v6 CONTRACT, adapted list).
 */

/** A QR as one SVG path of dark modules (quiet zone included). */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 2;
  let d = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return { size: count + quiet * 2, d };
}

export function PageQr({ url, size, label }: { url: string; size: number; label: string }): React.JSX.Element {
  const qr = useMemo(() => qrPath(url), [url]);
  return (
    <svg
      className={styles.qr}
      width={size}
      height={size}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.d} fill="#000" />
    </svg>
  );
}

/** The current page's absolute URL, read after hydration. */
export function useHereUrl(): string {
  const [url, setUrl] = useState("https://hetja.in/");
  useEffect(() => {
    setUrl(window.location.href);
  }, []);
  return url;
}

function useShowcaseDog(): ShowcaseDog | null | undefined {
  const [dog, setDog] = useState<ShowcaseDog | null | undefined>(undefined);
  useEffect(() => {
    // Only a desktop ever sees D1: skip the requests on a phone (the example
    // dog stands in if the window is later widened).
    if (typeof window.matchMedia === "function" && !window.matchMedia(DESKTOP_QUERY).matches) {
      setDog(null);
      return;
    }
    let alive = true;
    loadShowcaseDog().then(
      (d) => alive && setDog(d),
      () => alive && setDog(null),
    );
    return () => {
      alive = false;
    };
  }, []);
  return dog;
}

/** "hetja.in/map" for https://hetja.in/map, "hetja.in" for the root. */
export function typedAddress(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `hetja.in${path}`;
  } catch {
    return "hetja.in";
  }
}

export function DesktopInvite({ className }: { className?: string }): React.JSX.Element {
  const url = useHereUrl();
  const real = useShowcaseDog();
  const { openLookup } = useDeskDialogs();

  // Design v9 (docs/design/v9-desktop, the owner's "Hetja Desktop" export,
  // "Home A: invitation"): the desktop header, the title, the QR card, a
  // collar lookup and How it works, the phone with a real dog, the footer.
  return (
    <div className={[styles.page, className ?? ""].filter(Boolean).join(" ")} data-testid="desktop-invite">
      <DeskNav />

      <div className={styles.grid}>
        <div className={styles.text}>
          <h1 className={styles.title}>Hetja lives on your phone.</h1>
          <p className={styles.lead}>
            It&apos;s made for the street.{" "}
            <span className={styles.ink}>A laptop can&apos;t follow a dog down a lane, but the phone in your pocket can.</span>
          </p>
          <div className={styles.card}>
            <div className={styles.qrBox}>
              <PageQr url={url} size={112} label="QR code that opens this page on your phone" />
            </div>
            <div className={styles.cardText}>
              <span className={styles.cardLabel}>On your phone</span>
              <span className={styles.cardBody}>Open the camera and point it at the code. No app to install.</span>
              <span className={styles.cardSub}>
                Or type <b>{typedAddress(url)}</b> into its browser.
              </span>
            </div>
          </div>
          <div className={styles.more}>
            <button type="button" className={styles.moreLink} onClick={openLookup}>
              Look up a collar code ›
            </button>
            <Link href="/how-it-works" className={styles.moreLink}>
              How it works ›
            </Link>
          </div>
        </div>

        <figure className={styles.phoneWrap} data-loading={real === undefined ? "" : undefined}>
          {real ? (
            <div className={styles.phone} aria-hidden="true" data-testid="d1-real-dog">
              <span className={styles.notch} />
              <span className={styles.found}>You found {real.name}</span>
              {real.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.photo} src={real.photoUrl} alt="" />
              ) : (
                <div className={`${styles.photo} ${styles.initial}`}>{real.name.charAt(0).toUpperCase()}</div>
              )}
              <span className={styles.name}>{real.name}</span>
              <span className={styles.ward}>{real.wardLine}</span>
              <div className={styles.pills}>
                {real.fedToday === false && (
                  <StatusPill variant="warn" icon="clock" size="small">
                    Not fed today
                  </StatusPill>
                )}
                {real.vaccinated ? (
                  <StatusPill variant="ok" icon="check" size="small">
                    Vaccinated
                  </StatusPill>
                ) : (
                  <StatusPill variant="neutral" icon="clock" size="small">
                    Vaccination unknown
                  </StatusPill>
                )}
              </div>
              {real.slug && (
                <div className={styles.codeBox}>
                  <span className={styles.codeLabel}>Collar code</span>
                  <span className={styles.code}>{prettyCode(real.slug)}</span>
                </div>
              )}
              <span className={styles.sos}>
                <span className={styles.bang}>!</span>This dog needs help
              </span>
            </div>
          ) : (
            <div className={styles.phone} aria-hidden="true">
              <span className={styles.notch} />
              <span className={styles.found}>You found Rani</span>
              <div className={styles.photo} />
              <span className={styles.name}>Rani</span>
              <span className={styles.ward}>K/W ward · Andheri West</span>
              <div className={styles.pills}>
                <StatusPill variant="ok" icon="check" size="small">
                  Vaccinated
                </StatusPill>
              </div>
              <div className={styles.codeBox}>
                <span className={styles.codeLabel}>Collar code</span>
                <span className={styles.code}>DDR 017 XK2</span>
              </div>
              <span className={styles.sos}>
                <span className={styles.bang}>!</span>This dog needs help
              </span>
            </div>
          )}
          <figcaption className={styles.caption}>
            {real ? `${real.name} is one of Mumbai's dogs on Hetja.` : "An example of a dog's page."}
          </figcaption>
        </figure>
      </div>
      <DeskFooter />
    </div>
  );
}
