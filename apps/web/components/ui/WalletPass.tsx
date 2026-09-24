"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { prefersReducedMotion } from "./Sheet";
import styles from "./WalletPass.module.css";

/**
 * Apple Wallet-style dog ID pass: the collar, as a card you can hold.
 *
 * Layout is Wallet's "generic" pass: logo + header field on top, one big
 * primary field (the dog's name) with a thumbnail (the Dogmoji), a row of
 * secondary fields (ward · collar code · vaccinated), and the barcode in a
 * white rounded well at the bottom with the code printed under it.
 *
 * Tilt: pointer position sets CSS custom properties on the card (no React
 * re-render per move); CSS turns them into a ≤8° rotateX/Y and moves the
 * sheen highlight. Mouse/pen only (a finger on a phone is scrolling), and
 * never under reduced motion (checked in JS, and the CSS drops the
 * transform too).
 *
 * `qr` accepts a real QR (e.g. the collar's qrcode-generator SVG); without it
 * a decorative pseudo-QR is drawn from the code so the card never looks
 * empty. The pseudo-QR is aria-hidden and not scannable, by design.
 */

export interface PassField {
  label: string;
  value: ReactNode;
}

export type PassTheme = "aurora" | "ocean" | "night";

export interface WalletPassProps {
  /** Primary field: the dog's name. */
  name: string;
  ward: string;
  /** Collar code, e.g. "H7K-2QM". */
  code: string;
  vaccinated?: boolean;
  /** Thumbnail (a <Dogmoji> or photo). */
  avatar?: ReactNode;
  /** Logo slot (top-left). Defaults to the word "Hetja". */
  logo?: ReactNode;
  /** Header label (top-right). */
  headerLabel?: string;
  /** Real QR node; otherwise a decorative pseudo-QR. */
  qr?: ReactNode;
  /** Extra secondary fields after ward/code/vaccinated. */
  fields?: PassField[];
  theme?: PassTheme;
  /** Custom CSS background, overrides `theme`. */
  background?: string;
  tilt?: boolean;
  className?: string;
}

export function WalletPass({
  name,
  ward,
  code,
  vaccinated,
  avatar,
  logo,
  headerLabel = "COLLAR",
  qr,
  fields = [],
  theme = "aurora",
  background,
  tilt = true,
  className,
}: WalletPassProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);

  const onMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!tilt || e.pointerType === "touch" || prefersReducedMotion()) return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width; // 0..1
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty("--ry", `${(x - 0.5) * 16}deg`);
      el.style.setProperty("--rx", `${(0.5 - y) * 12}deg`);
      el.style.setProperty("--mx", `${x * 100}%`);
      el.style.setProperty("--my", `${y * 100}%`);
      el.dataset.tilting = "";
    },
    [tilt],
  );

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    delete el.dataset.tilting;
  }, []);

  const secondary: PassField[] = [
    { label: "WARD", value: ward },
    { label: "CODE", value: <span className={styles.plate}>{code}</span> },
    ...(vaccinated === undefined
      ? []
      : [
          {
            label: "VACCINATED",
            value: vaccinated ? (
              <span className={styles.yes}>
                <Check /> Yes
              </span>
            ) : (
              "Not yet"
            ),
          },
        ]),
    ...fields,
  ];

  return (
    <article
      ref={ref}
      className={`${styles.pass} ${styles[theme]} ${className ?? ""}`}
      style={background ? { background } : undefined}
      aria-label={`Hetja collar pass for ${name}, ${ward}, code ${code}${
        vaccinated === undefined ? "" : vaccinated ? ", vaccinated" : ", not vaccinated"
      }`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <span className={styles.sheen} aria-hidden="true" />
      <header className={styles.top}>
        <span className={styles.logo}>{logo ?? "Hetja"}</span>
        <span className={styles.headerField}>
          <span className={styles.label}>{headerLabel}</span>
          <span className={styles.headerValue}>{code}</span>
        </span>
      </header>

      <div className={styles.primary}>
        <div>
          <span className={styles.label}>DOG</span>
          <h3 className={styles.name}>{name}</h3>
        </div>
        {avatar ? <span className={styles.thumb}>{avatar}</span> : null}
      </div>

      <dl className={styles.secondary}>
        {secondary.map((f) => (
          <div key={f.label} className={styles.field}>
            <dt className={styles.label}>{f.label}</dt>
            <dd className={styles.value}>{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.barcode}>
        <div className={styles.qrWell}>{qr ?? <PseudoQr seed={code} />}</div>
        <span className={styles.qrText} aria-hidden="true">
          {code}
        </span>
      </div>
    </article>
  );
}

function Check(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M2 6.5 5 9l5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Decorative 25×25 QR look-alike, deterministic per seed. Not scannable. */
export function PseudoQr({ seed, size = 25 }: { seed: string; size?: number }): React.JSX.Element {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = (): number => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };
  const inFinder = (x: number, y: number): boolean =>
    (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
  const cells: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inFinder(x, y)) continue;
      if (rand() > 0.52) cells.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  const finder = (fx: number, fy: number): string =>
    `M${fx} ${fy}h7v7h-7zM${fx + 1} ${fy + 1}v5h5v-5zM${fx + 2} ${fy + 2}h3v3h-3z`;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" aria-hidden="true" shapeRendering="crispEdges">
      <path d={cells.join("")} fill="currentColor" />
      <path
        d={`${finder(0, 0)}${finder(size - 7, 0)}${finder(0, size - 7)}`}
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
