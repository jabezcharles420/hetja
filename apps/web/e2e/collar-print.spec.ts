import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The test that actually protects the physical object.
 *
 * In Playwright's real Chromium, build the SVG for a known slug+signature with
 * the web's own QR lib (qrcode-generator, version 5 ECC M), render it to a
 * canvas, and decode it. Assert rawValue equals the collar URL byte for byte.
 * Three prints are checked: the 40 mm etched TPU tag, and the design v5 A4
 * sheet's 22 mm collar tag (quiet zone inside the box, 0.49 mm per module)
 * and 18 mm collar band (quiet zone taken from the band's 2 mm margin), each
 * drawn inside its real outline with the ink around it, at about the
 * resolution a phone camera sees a coin-sized tag. The PDF (lib/collar-pdf.ts)
 * draws its modules from the same lib/qr.ts matrix at the same sizes.
 *
 * No server, no database, no auth, no network, and it is the only thing
 * standing between us and a thousand etched tags that do not scan.
 *
 * The decoder is the SAME `barcode-detector` (zxing-wasm) ponyfill the PWA
 * ships to phones without a native BarcodeDetector (components/QrScanner.tsx),
 * not the browser's built-in one. This spec used to require
 * `window.BarcodeDetector`, which Playwright's headless Chromium does not
 * expose, so the a11y workflow that runs it had failed on every push since the
 * spec landed, and the one assertion about the collar had never once run in
 * CI. Loading the ponyfill also makes the test say something truer: "the QR we
 * print decodes with the decoder our own scanner uses".
 *
 * The ponyfill fetches its ~1 MB WASM from jsDelivr by default. CI must not
 * depend on a CDN being up, so the fetch is pointed at a fake origin and
 * fulfilled from the copy pnpm already installed under node_modules.
 */

const SLUG = "ab3de4fgh";
const SIG = "abcdEfGhIjKlMnOpQrStUvWxYz0123456789-_A1234"; // 43 chars base64url
const COLLAR_URL = `https://hetja.in/d/${SLUG}?s=${SIG}`;

/** A host nothing resolves; every request to it is intercepted below. */
const WASM_ORIGIN = "https://zxing-wasm.hetja-e2e.invalid";

/**
 * Locate the ponyfill's browser bundle and zxing's reader .wasm on disk, via
 * Node resolution from this package so pnpm's isolated layout is respected
 * (`barcode-detector` is a dependency of apps/web; `zxing-wasm` is ITS
 * dependency, resolved relative to it).
 */
function locateDecoder(): { ponyfillIife: string; wasmDir: string } {
  const require = createRequire(import.meta.url);
  const bdEntry = require.resolve("barcode-detector"); // …/barcode-detector/dist/cjs/index.js
  const bdRoot = path.resolve(path.dirname(bdEntry), "..", "..");
  const zxEntry = createRequire(bdEntry).resolve("zxing-wasm"); // …/zxing-wasm/dist/<build>/…
  const marker = `${path.sep}zxing-wasm${path.sep}`;
  const zxRoot = zxEntry.slice(0, zxEntry.lastIndexOf(marker) + marker.length);
  return {
    ponyfillIife: path.join(bdRoot, "dist", "iife", "ponyfill.js"),
    wasmDir: path.join(zxRoot, "dist"),
  };
}

async function setUpDecoder(page: Page): Promise<void> {
  const { ponyfillIife, wasmDir } = locateDecoder();

  // Serve zxing's .wasm from node_modules instead of the CDN. The ponyfill asks
  // for `<prefix>/<build>/zxing_<build>.wasm`; `locateFile` below rewrites the
  // prefix to WASM_ORIGIN and this route answers from disk.
  await page.route(`${WASM_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    // e.g. /reader/zxing_reader.wasm → <wasmDir>/reader/zxing_reader.wasm
    const rel = url.pathname.replace(/^\/+/, "");
    const file = path.join(wasmDir, ...rel.split("/"));
    if (!file.startsWith(wasmDir) || !file.endsWith(".wasm")) {
      return route.fulfill({ status: 404, body: "" });
    }
    return route.fulfill({
      status: 200,
      body: readFileSync(file),
      headers: {
        "content-type": "application/wasm",
        "access-control-allow-origin": "*",
      },
    });
  });

  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: ponyfillIife }); // defines window.BarcodeDetectionAPI
}

/** Rasterise an SVG onto a widthPx x heightPx canvas in the page and decode it with the ponyfill. */
async function decodeSvg(page: Page, svg: string, widthPx: number, heightPx: number): Promise<string | null> {
  return page.evaluate(
    async ({ svg, wasmOrigin, widthPx, heightPx }) => {
      type PonyfillApi = {
        setZXingModuleOverrides: (o: { locateFile: (file: string, prefix: string) => string }) => void;
        BarcodeDetector: new (o: { formats: string[] }) => {
          detect: (i: ImageBitmapSource) => Promise<{ format: string; rawValue: string }[]>;
        };
      };
      const api = (window as unknown as { BarcodeDetectionAPI?: PonyfillApi }).BarcodeDetectionAPI;
      if (!api) throw new Error("barcode-detector ponyfill did not load");
      api.setZXingModuleOverrides({
        // The default prefix is a jsDelivr URL ending in `/dist/<build>/`; keep
        // only the `<build>/` tail so the intercepted path mirrors dist/.
        locateFile: (file, prefix) => {
          const m = /\/dist\/([^/]+)\/$/.exec(prefix);
          const build = m ? m[1] : "reader";
          return `${wasmOrigin}/${build}/${file}`;
        },
      });

      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg image load failed"));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = widthPx;
      canvas.height = heightPx;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, widthPx, heightPx);
      ctx.drawImage(img, 0, 0, widthPx, heightPx);
      URL.revokeObjectURL(url);

      const detector = new api.BarcodeDetector({ formats: ["qr_code"] });
      const hits = await detector.detect(canvas);
      const hit = hits.find((h) => h.format === "qr_code" && h.rawValue);
      return hit ? hit.rawValue : null;
    },
    { svg, wasmOrigin: WASM_ORIGIN, widthPx, heightPx },
  );
}

/** Place a lib/qr.ts SVG at (x, y), `size` user units square, inside a mm-unit outer SVG. */
function place(qrSvg: string, x: number, y: number, size: number): string {
  return qrSvg
    .replace(/^<svg /, `<svg x="${x}" y="${y}" `)
    .replace(/width="[^"]+" height="[^"]+"/, `width="${size}" height="${size}"`);
}

test("collar QR decodes to the collar URL byte for byte", async ({ page }) => {
  // Build the SVG in Node using the app's own lib/qr.ts arithmetic (version 5 ECC M, 45 units).
  const { buildCollarQrSvg } = await import("../lib/qr");
  const built = buildCollarQrSvg(COLLAR_URL);
  expect(built.gridSize).toBe(45);

  await setUpDecoder(page);
  const decoded = await decodeSvg(page, built.svg, 450, 450);
  expect(decoded, `QR for ${COLLAR_URL} did not decode; check version/ECC/size arithmetic`).toBe(COLLAR_URL);
});

test("A4 sheet: the 22 mm collar tag and the 18 mm band decode inside their outlines", async ({ page }) => {
  const { buildCollarQrSvg, TAG_QR_MM, BAND_QR_MM } = await import("../lib/qr");
  await setUpDecoder(page);

  // The tag as printed (lib/collar-pdf.ts): 32 x 46 mm, dashed cut line,
  // punch circle, HETJA 1 mm above the QR box, the name 1.6 mm below it.
  const tagQr = buildCollarQrSvg(COLLAR_URL, { sizeMm: TAG_QR_MM });
  const tag =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 46" width="32mm" height="46mm">` +
    `<rect width="32" height="46" fill="white"/>` +
    `<rect x="0.15" y="0.15" width="31.7" height="45.7" fill="none" stroke="#8a8a8a" stroke-width="0.3" stroke-dasharray="1 0.8"/>` +
    `<circle cx="16" cy="3.5" r="1.35" fill="none" stroke="#8a8a8a" stroke-width="0.3"/>` +
    `<text x="16" y="8" font-size="1.94" font-weight="700" text-anchor="middle" font-family="Helvetica">HETJA</text>` +
    place(tagQr.svg, 5, 9.33, TAG_QR_MM) +
    `<text x="16" y="35.5" font-size="3.2" font-weight="700" text-anchor="middle" font-family="Helvetica">Rani</text>` +
    `<text x="16" y="39.5" font-size="2.5" font-weight="700" text-anchor="middle" font-family="Courier">RNI 482 PQ7</text>` +
    `</svg>`;
  // 7 px per mm: about 3.4 px per module, a phone held over a coin-sized tag.
  expect(await decodeSvg(page, tag, 224, 322), "22 mm tag QR did not decode").toBe(COLLAR_URL);

  // The band: 18 mm of modules with a 2 mm margin to the cut line, and a dark
  // collar right outside the cut, the worst case once it is glued on.
  const bandQr = buildCollarQrSvg(COLLAR_URL, { sizeMm: BAND_QR_MM, quietZone: false });
  const band =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 36 28" width="36mm" height="28mm">` +
    `<rect x="-3" y="-3" width="36" height="28" fill="#222"/>` +
    `<rect x="0" y="0" width="30" height="22" fill="white"/>` +
    place(bandQr.svg, 3, 2, BAND_QR_MM) +
    `<text x="24" y="10" font-size="3.5" font-weight="700" font-family="Helvetica">Rani</text>` +
    `</svg>`;
  expect(await decodeSvg(page, band, 288, 224), "18 mm band QR did not decode").toBe(COLLAR_URL);
});
