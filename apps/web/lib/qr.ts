/**
 * QR generation for the printable collar sheet.
 *
 * Uses `qrcode-generator` (MIT, zero runtime dependencies, ~13 KB), not
 * `qrcode` (which drags in yargs/pngjs for a CLI nobody uses here).
 *
 * IMPORTANT: `apps/scan` must never import this module. The scan bundle is
 * held under a 40 KB gzipped CI gate (`pnpm --filter @hetja/scan size:gate`)
 * because it is the page a stranger loads on a street, and importing a QR encoder there
 * blows it. This encoder is intentionally web-only.
 *
 * Do NOT hand-roll a Reed–Solomon encoder. Its failure mode is a code that
 * scans on the developer's iPhone and not on a ₹8,000 Android: the same class
 * of silent physical failure that AGENTS.md warns about for HETJA_QR_SECRET.
 *
 * SIZE ARITHMETIC (decides whether a tag scans in the rain)
 *
 * The collar URL is `https://hetja.in/d/` (19 chars) + slug (9) + `?s=` (3)
 * + unpadded base64url SHA-256 (43) = 74 characters of byte-mode data.
 *   Version 4 at ECC M holds 62 bytes, too small.
 *   Version 5 (37×37) at ECC M holds 106 bytes: this one.
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
 *
 * DESIGN v5 PRINTED SIZES (Hetja Collar Sheet A4, generated as a vector PDF
 * by lib/collar-pdf.ts and as HTML by components/CollarSheet.tsx)
 *
 * Same data, same version 5 at ECC M, same 37 modules. Only the print size
 * changes, so nothing here touches the URL or its signature.
 *
 *   Collar tag (32 x 46 mm): the QR box is 22 mm INCLUDING the 4-module
 *     quiet zone, so 22 / 45 = 0.489 mm per module and the quiet zone
 *     (1.96 mm) is white inside the box itself. The "HETJA" line above and
 *     the name below sit outside the box, so no ink ever enters the quiet
 *     zone, and the box sits inside the tag's 2 mm padding (5 mm each side
 *     horizontally), so the dashed cut line never does either.
 *   Collar band (150 x 22 mm): 18 mm of MODULES (0.486 mm per module, the
 *     same as a tag), with the quiet zone taken from the band's own white
 *     margin: 2 mm to the cut line top and bottom, 3 mm to the side and to
 *     the text. 4 modules is 1.95 mm, so every side clears it.
 *   Wall notice: 68.8 mm (the 80 mm frame less its 5 mm padding and 0.6 mm
 *     border) INCLUDING the quiet zone, 1.53 mm per module.
 *   R6 on screen: 180 px of modules; the card's 22 px white padding is the
 *     quiet zone (4 x 4.9 px = 19.5 px).
 *
 * 0.49 mm is about half the 40 mm etched tag's module and still well above
 * what a phone camera resolves at the 10 to 15 cm a person holds it from a
 * coin-sized tag. Do not print the sheet below 100%: "fit to page" shrinks
 * every module with the page, which is why the sheet says so.
 */

import qrcode from "qrcode-generator";

// Version 5 at ECC M; see arithmetic above.
const QR_VERSION = 5 as const;
const QR_ECC: "M" = "M";
const QR_MODULES = 37; // version 5 => 37×37 modules
const QUIET_MODULES = 4;
const GRID_SIZE = QR_MODULES + 2 * QUIET_MODULES; // 45

/** Physical size of the printed QR. */
export const QR_PHYSICAL_SIZE_MM = 40;
/** Modules per millimetre at the physical size (diagnostic, printed on sheet). */
export const QR_MODULE_MM = QR_PHYSICAL_SIZE_MM / GRID_SIZE; // ~0.889 mm

/** Modules per side (version 5) and the quiet zone, for renderers that draw their own. */
export const QR_MODULE_COUNT = QR_MODULES;
export const QR_QUIET_MODULES = QUIET_MODULES;
export const QR_GRID_UNITS = GRID_SIZE;

/** v5 collar tag: 22 mm box including the quiet zone (0.489 mm per module). */
export const TAG_QR_MM = 22;
export const TAG_QR_MODULE_MM = TAG_QR_MM / GRID_SIZE;
/** v5 collar band: 18 mm of modules, quiet zone from the band's margin. */
export const BAND_QR_MM = 18;
export const BAND_QR_MODULE_MM = BAND_QR_MM / QR_MODULES;
/** v5 wall notice: 80 mm frame, 5 mm padding, 0.6 mm border; includes the quiet zone. */
export const NOTICE_QR_MM = 80 - 2 * 5 - 2 * 0.6;

/** The dark modules of a collar QR, row by row (no quiet zone). */
export interface CollarQrMatrix {
  /** Modules per side: 37 for version 5. */
  count: number;
  /** dark[row][col] */
  dark: boolean[][];
}

/**
 * Encode a collar URL at version 5, ECC M and return its module matrix, for
 * renderers that draw modules themselves (the PDF draws each dark module as
 * a filled rectangle so the printed size is exact to the micrometre).
 */
export function buildCollarQrMatrix(collarUrl: string): CollarQrMatrix {
  const qr = qrcode(QR_VERSION, QR_ECC);
  qr.addData(collarUrl, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const dark: boolean[][] = [];
  for (let r = 0; r < count; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
    dark.push(row);
  }
  return { count, dark };
}

export interface CollarQrSvgOptions {
  /** Printed width and height in mm (default 40, the etched TPU tag). */
  sizeMm?: number;
  /** Include the 4-module quiet zone inside the size (default true). */
  quietZone?: boolean;
}

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
 * pipeline) rather than one <rect> per dark module. Both are valid; path is
 * chosen here. Quiet zone is left white; caller sets background.
 *
 * `sizeMm` changes only the printed size; `quietZone: false` drops the white
 * margin for a caller whose own white padding is at least 4 modules wide.
 */
export function buildCollarQrSvg(collarUrl: string, opts: CollarQrSvgOptions = {}): CollarQrSvg {
  const sizeMm = opts.sizeMm ?? QR_PHYSICAL_SIZE_MM;
  const quiet = opts.quietZone === false ? 0 : QUIET_MODULES;
  // In practice qrcode-generator with typeNumber 5 refuses to bump for 74
  // bytes at M; the grid follows the real module count if data ever grows.
  const { count, dark } = buildCollarQrMatrix(collarUrl);

  // Build a single path of 1×1 squares, offset by the quiet zone.
  const parts: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (dark[r]![c]) {
        // M x y h1 v1 h-1 z  (1×1 rect as path)
        parts.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
      }
    }
  }
  const d = parts.join(" ");
  // Grid is count+2*quiet; stable 45 for the spec'd size.
  const grid = count + 2 * quiet;
  const moduleMm = sizeMm / grid;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" ` +
    `width="${sizeMm}mm" height="${sizeMm}mm" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code for ${escapeXml(collarUrl)}">` +
    `<rect width="${grid}" height="${grid}" fill="white"/>` +
    `<path d="${d}" fill="black"/>` +
    `</svg>`;

  return {
    svg,
    gridSize: grid,
    moduleMm,
    label: `v${QR_VERSION} ${QR_ECC} · ${count}×${count} modules · ${grid} units with quiet zone`,
  };
}

/** Convenience: collar URL → SVG string (no metadata). */
export function collarQrSvg(collarUrl: string): string {
  return buildCollarQrSvg(collarUrl).svg;
}
