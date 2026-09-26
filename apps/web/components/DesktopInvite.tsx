"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { LogoMark, StatusPill } from "@/components/ds";
import { API_BASE } from "@/lib/api";
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

const NAV = [
  { href: "/about", label: "About" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy" },
];

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

function useDogCount(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/stats/impact`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; data?: { dogsTracked?: unknown } } | null) => {
        const v = j?.ok ? j.data?.dogsTracked : null;
        if (alive && typeof v === "number" && Number.isFinite(v) && v > 0) setN(v);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return n;
}

function useShowcaseDog(): ShowcaseDog | null | undefined {
  const [dog, setDog] = useState<ShowcaseDog | null | undefined>(undefined);
  useEffect(() => {
    // Only a desktop ever sees D1: skip the requests on a phone.
    if (typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 745px)").matches) return;
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

export function DesktopInvite({ className }: { className?: string }): React.JSX.Element {
  const url = useHereUrl();
  const dogs = useDogCount();
  const real = useShowcaseDog();

  return (
    <div className={[styles.page, className ?? ""].filter(Boolean).join(" ")} data-testid="desktop-invite">
      <header className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="Hetja home">
          <LogoMark size={26} />
          <span>Hetja</span>
        </Link>
        <nav aria-label="Main" className={styles.links}>
          {NAV.map((l) => (
            <Link key={l.href} href={l.href} className={styles.link}>
              {l.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className={styles.grid}>
        <div className={styles.text}>
          <span className={styles.chip}>Hetja · for Mumbai&apos;s street dogs</span>
          <h1 className={styles.title}>
            Hetja lives
            <br />
            on your phone.
          </h1>
          <p className={styles.lead}>
            It&apos;s made for the street, not the desk.{" "}
            <span className={styles.ink}>Point your phone&apos;s camera at the code</span>{" "}
            {dogs !== null
              ? `and ${new Intl.NumberFormat("en-IN").format(dogs)} dogs are one tap away.`
              : "and every collared dog in Mumbai is one tap away."}
          </p>
          <div className={styles.card}>
            <PageQr url={url} size={148} label="QR code that opens this page on your phone" />
            <div className={styles.cardText}>
              <span className={styles.cardTitle}>Open on your phone</span>
              <span className={styles.cardSub}>
                Or type <b>hetja.in</b> into its browser. Then add it to your home screen.
              </span>
            </div>
          </div>
        </div>

        <figure className={styles.phoneWrap}>
          {real ? (
            <div className={styles.phone} aria-hidden="true" data-testid="d1-real-dog">
              <span className={styles.found}>You found {real.name}</span>
              {real.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.photo} src={real.photoUrl} alt="" />
              ) : (
                <div className={`${styles.photo} ${styles.initial}`}>{real.name.charAt(0).toUpperCase()}</div>
              )}
              <span className={styles.name}>{real.name}</span>
              <span className={styles.ward}>{real.wardLine}</span>
              {(real.vaccinated || real.sterilised) && (
                <div className={styles.pills}>
                  {real.vaccinated && (
                    <StatusPill variant="ok" icon="check" size="small">
                      Vaccinated
                    </StatusPill>
                  )}
                  {real.sterilised && (
                    <StatusPill variant="ok" icon="check" size="small">
                      Sterilised
                    </StatusPill>
                  )}
                </div>
              )}
              {real.fedLine && <span className={styles.fed}>{real.fedLine}</span>}
              <span className={styles.sos}>This dog needs help</span>
            </div>
          ) : (
            <div className={styles.phone} aria-hidden="true">
              <span className={styles.found}>You found Rani</span>
              <div className={styles.photo} />
              <span className={styles.name}>Rani</span>
              <span className={styles.ward}>K/W ward · Andheri West</span>
              <div className={styles.pills}>
                <StatusPill variant="ok" icon="check" size="small">
                  Vaccinated
                </StatusPill>
                <StatusPill variant="ok" icon="check" size="small">
                  Sterilised
                </StatusPill>
              </div>
              <span className={styles.fed}>Priya fed her 2 hours ago.</span>
              <span className={styles.sos}>This dog needs help</span>
            </div>
          )}
          <figcaption className={styles.caption}>
            {real ? `${real.name} is one of Mumbai's dogs on Hetja.` : "An example of a dog's page."}
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
