import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The test that actually protects the physical object.
 *
 * In Playwright's real Chromium, build the SVG for a known slug+signature with
 * the web's own QR lib (qrcode-generator, version 5 ECC M at 40×40 mm), render
 * it to a canvas, and decode it. Assert rawValue equals the collar URL byte for
 * byte.
 *
 * No server, no database, no auth, no network — and it is the only thing
 * standing between us and a thousand etched tags that do not scan.
 *
 * The decoder is the SAME `barcode-detector` (zxing-wasm) ponyfill the PWA
 * ships to phones without a native BarcodeDetector (components/QrScanner.tsx),
 * not the browser's built-in one. This spec used to require
 * `window.BarcodeDetector`, which Playwright's headless Chromium does not
 * expose — so the a11y workflow that runs it had failed on every push since the
 * spec landed, and the one assertion about the collar had never once run in
 * CI. Loading the ponyfill also makes the test say something truer: "the QR we
 * print decodes with the decoder our own scanner uses".
 *
 * The ponyfill fetches its ~1 MB WASM from jsDelivr by default. CI must not
 * depend on a CDN being up, so the fetch is pointed at a fake origin and
 * fulfilled from the copy pnpm already installed under node_modules.
 */

const SLUG = "ab3de4fgh";
const SIG = "abcdEfGhIjKlMnOpQrStUvWxYz0123456789-_A"; // 43 chars base64url
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

test("collar QR decodes to the collar URL byte for byte", async ({ page }) => {
  // Build the SVG in Node using the app's own lib/qr.ts arithmetic (version 5 ECC M, 45 units).
  const { buildCollarQrSvg } = await import("../lib/qr");
  const built = buildCollarQrSvg(COLLAR_URL);
  const svg = built.svg;

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

  // Render SVG to a canvas and decode with the ponyfill inside the browser.
  const decoded: string | null = await page.evaluate(
    async ({ svg, wasmOrigin }) => {
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

      const scale = 10;
      const size = 45 * scale;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);

      const detector = new api.BarcodeDetector({ formats: ["qr_code"] });
      const hits = await detector.detect(canvas);
      const hit = hits.find((h) => h.format === "qr_code" && h.rawValue);
      return hit ? hit.rawValue : null;
    },
    { svg, wasmOrigin: WASM_ORIGIN },
  );

  expect(decoded, `QR for ${COLLAR_URL} did not decode; check version/ECC/size arithmetic`).toBe(COLLAR_URL);
});
