import { expect, test } from "@playwright/test";

/**
 * The test that actually protects the physical object.
 *
 * In Playwright's real Chromium, build the SVG for a known slug+signature with
 * the web's own QR lib (qrcode-generator, version 5 ECC M at 40×40 mm), render
 * it to a canvas, createImageBitmap it, decode with BarcodeDetector, and assert
 * rawValue equals the collar URL byte for byte.
 *
 * No server, no database, no auth — and it is the only thing standing between
 * us and a thousand etched tags that do not scan.
 */

const SLUG = "ab3de4fgh";
const SIG = "abcdEfGhIjKlMnOpQrStUvWxYz0123456789-_A"; // 43 chars base64url
const COLLAR_URL = `https://hetja.in/d/${SLUG}?s=${SIG}`;

test("collar QR decodes to the collar URL byte for byte", async ({ page }) => {
  // Build the SVG in Node using the app's own lib/qr.ts arithmetic (version 5 ECC M, 45 units).
  const { buildCollarQrSvg } = await import("../lib/qr");
  const built = buildCollarQrSvg(COLLAR_URL);
  const svg = built.svg;

  // Render SVG to a canvas and decode with BarcodeDetector inside the browser.
  const decoded: string | null = await page.evaluate(
    async ({ svg }) => {
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

      let source: CanvasImageSource = canvas;
      try {
        if (typeof createImageBitmap === "function") {
          source = await createImageBitmap(canvas);
        }
      } catch {
        source = canvas;
      }

      if (typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === "undefined") {
        throw new Error("BarcodeDetector unavailable in this Chromium — QR decode test cannot run");
      }

      const Detector = (
        window as unknown as {
          BarcodeDetector: new (o: { formats: string[] }) => {
            detect: (i: CanvasImageSource) => Promise<{ format: string; rawValue: string }[]>;
          };
        }
      ).BarcodeDetector;
      const detector = new Detector({ formats: ["qr_code"] });
      const hits = await detector.detect(source);
      const hit = hits.find((h) => h.format === "qr_code" && h.rawValue);
      return hit ? hit.rawValue : null;
    },
    { svg },
  );

  expect(decoded, `QR for ${COLLAR_URL} did not decode; check version/ECC/size arithmetic`).toBe(COLLAR_URL);
});
