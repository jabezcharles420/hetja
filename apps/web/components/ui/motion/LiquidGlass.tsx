"use client";

import { createElement, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./LiquidGlass.module.css";

/**
 * <LiquidGlass> is an accent glass surface in the spirit of iOS 26 Liquid
 * Glass: frosted blur, a bright specular rim and, where the engine allows,
 * real edge refraction (the backdrop bends near the rim like a lens).
 *
 * Refraction = an SVG filter (feImage lens map into feDisplacementMap) used
 * as `backdrop-filter: url(#id)`. Only Chromium supports SVG filters inside
 * backdrop-filter; Safari and Firefox accept the syntax in @supports but do
 * not render it, so the upgrade is enabled by a JS check for a Chromium
 * engine (navigator.userAgentData), never by @supports. Everyone else gets
 * the plain blur glass, which is what most of the look comes from anyway.
 *
 * Cost: the filter re-runs whenever the backdrop moves (scroll), so keep it
 * to one small floating element (a tab bar, a pill), never a full-width band
 * or a list row. The lens map is a static image, so there is no per-frame
 * turbulence or map rebuild. Reduced transparency is respected.
 */

export interface LiquidGlassProps {
  children?: ReactNode;
  /** Refraction strength in px of displacement. Default 28. 0 disables. */
  refraction?: number;
  /** Frost blur in px. Default 14. */
  blur?: number;
  /** Corner radius. Default pill. */
  radius?: string;
  as?: "div" | "nav" | "span" | "aside";
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

/* The lens map: red = x shift, green = y shift, 50% grey = no shift. The
 * centre stays neutral; only the outer rim bends, like the edge of a lens. */
const LENS_MAP =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" preserveAspectRatio="none">` +
      `<defs>` +
      `<linearGradient id="x"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/></linearGradient>` +
      `<linearGradient id="y" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#0f0"/></linearGradient>` +
      `<filter id="b"><feGaussianBlur stdDeviation="14"/></filter>` +
      `</defs>` +
      `<rect width="200" height="200" fill="url(#x)"/>` +
      `<rect width="200" height="200" fill="url(#y)" style="mix-blend-mode:screen"/>` +
      `<rect x="26" y="26" width="148" height="148" rx="40" fill="#808000" filter="url(#b)"/>` +
      `</svg>`,
  );

function canRefract(): boolean {
  if (typeof navigator === "undefined" || typeof CSS === "undefined") return false;
  const isChromium = "userAgentData" in navigator;
  const reduceTransparency =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
  return isChromium && !reduceTransparency && CSS.supports("backdrop-filter", "blur(1px)");
}

export function LiquidGlass({
  children,
  refraction = 28,
  blur = 14,
  radius = "var(--h-radius-pill)",
  as = "div",
  className,
  style,
  "aria-label": ariaLabel,
}: LiquidGlassProps): React.JSX.Element {
  const rawId = useId();
  const filterId = `h-lg-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [refract, setRefract] = useState(false);

  useEffect(() => {
    setRefract(refraction > 0 && canRefract());
  }, [refraction]);

  const vars = {
    ...style,
    "--lg-blur": `${blur}px`,
    "--lg-r": radius,
    ...(refract ? { "--lg-refract": `url(#${filterId})` } : {}),
  } as CSSProperties;

  return createElement(
    as,
    {
      className: [styles.glass, className].filter(Boolean).join(" "),
      style: vars,
      "data-refract": refract ? "" : undefined,
      "aria-label": ariaLabel,
    },
    refract ? (
      <svg key="f" aria-hidden="true" focusable="false" className={styles.defs} width="0" height="0">
        <filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage href={LENS_MAP} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={refraction} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    ) : null,
    <span key="rim" aria-hidden="true" className={styles.rim} />,
    <span key="c" className={styles.content}>
      {children}
    </span>,
  );
}
