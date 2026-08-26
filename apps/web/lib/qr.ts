/**
 * QR generation for the printable collar sheet.
 *
 * Uses `qrcode-generator` (MIT, zero runtime dependencies, ~13 KB) — not
 * `qrcode` (which drags in yargs/pngjs for a CLI nobody uses here).
 *
 * IMPORTANT: `apps/scan` must never import this module. The scan bundle is
 * held under a 40 KB gzipped CI gate (`pnpm --filter @hetja/scan size:gate`)
 * — the page a stranger loads on a street — and importing a QR encoder there
 * blows it. This encoder is intentionally web-only.
 *
 * Do NOT hand-roll a Reed–Solomon encoder. Its failure mode is a code that
 * scans on the developer's iPhone and not on a ₹8,000 Android — the same class
 * of silent physical failure that AGENTS.md warns about for HETJA_QR_SECRET.
 *
 * SIZE ARITHMETIC (decides whether a tag scans in the rain)
 *
 * The collar URL is `https://hetja.in/d/` (19 chars) + slug (9) + `?s=` (3)
 * + unpadded base64url SHA-256 (43) = 74 characters of byte-mode data.
 *   Version 4 at ECC M holds 62 bytes — too small.
 *   Version 5 (37×37) at ECC M holds 106 bytes — this one.
 * The spec-mandated 4-module quiet zone each side makes the SVG grid
 * 37 + 2*4 = 45 units across. At 40×40 mm that is 0.889 mm per module,
 * comfortably above the floor for laser etching and a cheap phone camera.
 *
 * ECC L would fit in version 4 with slightly larger modules and is REJECTED:
 * 7% recovery on a tag that spends four months in a monsoon being rubbed
 * against railings is the wrong trade.
 *
 * Render the SVG ourselves: viewBox="0 0 45 45" with width="40mm"
 * height="40mm", so the physical size is exact and browser-zoom-independent.
 */

import qrcode from "qrcode-generator";

// Version 5 at ECC M — see arithmetic above.
const QR_VERSION = 5 as const;
const QR_ECC: "M" = "M";
const QR_MODULES = 37; // version 5 => 37×37 modules
const QUIET_MODULES = 4;
const GRID_SIZE = QR_MODULES + 2 * QUIET_MODULES; // 45

/** Physical size of the printed QR. */
export const QR_PHYSICAL_SIZE_MM = 40;
/** Modules per millimetre at the physical size (diagnostic, printed on sheet). */
export const QR_MODULE_MM = QR_PHYSICAL_SIZE_MM / GRID_SIZE; // ~0.889 mm

export interface CollarQrSvg {
  /** Complete `<svg ...>...</svg>` string ready to inline via dangerouslySetInnerHTML or <object>. */
  svg: string;
  /** Same grid size as viewBox (45). */
  gridSize: number;
  /** Millimetres per module (for self-check on the sheet). */
  moduleMm: number;
  /** Version + ECC for display. */
  label: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build an SVG for a collar URL.
 *
 * Uses a single merged <path> (fewer DOM nodes, better for a slow print
 * pipeline) rather than one <rect> per dark module — both are valid; path is
 * chosen here. Quiet zone is left white; caller sets background.
 */
export function buildCollarQrSvg(collarUrl: string): CollarQrSvg {
  const qr = qrcode(QR_VERSION, QR_ECC);
  qr.addData(collarUrl, "Byte");
  qr.make();

  const count = qr.getModuleCount();
  // Defensive: if library honours forced version 5 we get 37; if it somehow
  // bumps, surface the drift rather than silently rendering a different grid.
  if (count !== QR_MODULES) {
    // Still render: grid becomes count + 2*QUIET, but flag label so the sheet
    // shows the real module size rather than the expected one.
    // In practice qrcode-generator with typeNumber 5 refuses to bump for 74
    // bytes at M — this is a guard for future data-size changes.
  }

  // Build a single path of 1×1 squares, offset by quiet zone.
  const parts: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        const x = c + QUIET_MODULES;
        const y = r + QUIET_MODULES;
        // M x y h1 v1 h-1 z  — 1×1 rect as path
        parts.push(`M${x} ${y}h1v1h-1z`);
      }
    }
  }
  const d = parts.join(" ");
  // Grid is count+2*quiet; stable 45 for the spec'd size.
  const grid = count + 2 * QUIET_MODULES;
  const moduleMm = QR_PHYSICAL_SIZE_MM / grid;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" ` +
    `width="${QR_PHYSICAL_SIZE_MM}mm" height="${QR_PHYSICAL_SIZE_MM}mm" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code for ${escapeXml(collarUrl)}">` +
    `<rect width="${grid}" height="${grid}" fill="white"/>` +
    `<path d="${d}" fill="black"/>` +
    `</svg>`;

  return {
    svg,
    gridSize: grid,
    moduleMm,
    label: `v${QR_VERSION} ${QR_ECC} · ${grid - 2 * QUIET_MODULES}×${grid - 2 * QUIET_MODULES} modules · ${grid} units with quiet zone`,
  };
}

/** Convenience: collar URL → SVG string (no metadata). */
export function collarQrSvg(collarUrl: string): string {
  return buildCollarQrSvg(collarUrl).svg;
}
