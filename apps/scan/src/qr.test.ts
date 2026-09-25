/**
 * D2's QR encoder against a reference. apps/web prints every real collar
 * with qrcode-generator; this encoder must produce a matrix that library
 * would produce for the same version and level. Mask choice may differ
 * (both are valid, and any mask decodes), so the check is that the
 * reference matrix equals this encoder's output under one of the 8 masks.
 * The reference is loaded from the workspace store by path because apps/scan
 * must not depend on it (it would break the 40 KB budget).
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { qrMatrix, qrSvg } from "./qr.js";

type Ref = (v: number, l: string) => {
  addData(s: string, mode: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(r: number, c: number): boolean;
};

async function reference(): Promise<Ref> {
  const path = fileURLToPath(
    new URL("../../../node_modules/.pnpm/qrcode-generator@2.0.4/node_modules/qrcode-generator/dist/qrcode.mjs", import.meta.url),
  );
  const mod = (await import(/* @vite-ignore */ path)) as { default: Ref };
  return mod.default;
}

const URLS = [
  "https://h.in/d/a", // version 1
  "https://hetja.in/d/rni482pq7", // 2
  "https://hetja.in/d/rni482pq7?s=abcdefghijklmnop", // 3
  "https://hetja.in/d/c3di5esh8?s=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG", // 4: a real collar URL is 74 chars
  "https://hetja.in/d/c3di5esh8?s=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG&utm_source=whatsapp", // 5
  "https://hetja.in/d/c3di5esh8?s=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG&utm_source=whatsapp&utm_medium=share&x=1", // 6
];

describe("QR encoder (D2)", () => {
  it("matches qrcode-generator, version 1 to 6, level L", async () => {
    const qrcode = await reference();
    for (const [i, url] of URLS.entries()) {
      const ours = qrMatrix(url, 0)!;
      const version = (ours.length - 17) / 4;
      expect(version).toBe(i + 1);
      const ref = qrcode(version, "L");
      ref.addData(url, "Byte");
      ref.make();
      const want = [...Array(ref.getModuleCount())].map((_, r) => [...Array(ref.getModuleCount())].map((_, c) => (ref.isDark(r, c) ? 1 : 0)));
      const anyMask = [0, 1, 2, 3, 4, 5, 6, 7].some((k) => JSON.stringify(qrMatrix(url, k)) === JSON.stringify(want));
      expect(anyMask, url).toBe(true);
    }
  });

  it("picks one mask by penalty, and refuses text past version 6", () => {
    const m = qrMatrix(URLS[3]!)!;
    expect([0, 1, 2, 3, 4, 5, 6, 7].some((k) => JSON.stringify(qrMatrix(URLS[3]!, k)) === JSON.stringify(m))).toBe(true);
    expect(qrMatrix("x".repeat(135))).toBeNull();
    expect(qrSvg("x".repeat(135))).toBe("");
    expect(qrSvg(URLS[3]!)).toMatch(/^<svg class="qr" viewBox="-4 -4 41 41"/);
  });
});
