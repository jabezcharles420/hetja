/**
 * The in-browser collar PDF (lib/collar-pdf.ts): real page sizes, the right
 * copy, and QR modules at the sizes lib/qr.ts documents. The decode test of
 * the printed QR itself is e2e/collar-print.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { buildCollarPdf, devanagariRuns, needsDevanagari } from "./collar-pdf";
import { sheetFileName, sheetText, tagsHeader, batchHeader, type SheetDog } from "./collar-sheet";
import { BAND_QR_MODULE_MM, TAG_QR_MODULE_MM, buildCollarQrMatrix } from "./qr";

const SIG = "abcdEfGhIjKlMnOpQrStUvWxYz0123456789-_A1234";
const dog = (slug: string, name: string | null = "Rani"): SheetDog => ({
  slug,
  name,
  wardCode: "K/W",
  collarUrl: `https://hetja.in/d/${slug}?s=${SIG}`,
  sex: "female",
});

const MM = 72 / 25.4;

describe("collar PDF", () => {
  it("is one A4 or Letter page at the exact size", async () => {
    for (const [paper, w, h] of [
      ["a4", 210, 297],
      ["letter", 215.9, 279.4],
    ] as const) {
      const bytes = await buildCollarPdf({ layout: "tags", paper, dogs: [dog("rni482pq7")], text: sheetText("Priya S.") });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      const { width, height } = doc.getPage(0).getSize();
      expect(width).toBeCloseTo(w * MM, 3);
      expect(height).toBeCloseTo(h * MM, 3);
      expect(doc.getTitle()).toBe("Hetja collar tags · Rani");
    }
  });

  it("builds the notice and a full batch without embedding fonts", async () => {
    const notice = await buildCollarPdf({ layout: "notice", paper: "a4", dogs: [dog("rni482pq7")], text: sheetText(null) });
    const batch = await buildCollarPdf({
      layout: "batch",
      paper: "a4",
      dogs: ["rni482pq7", "bru017xk2", "kab233mt8", "mot561hd4", "shr905ae3", "lxm148rb6", "tgr772nc5", "chk3a0wf8"].map((s) => dog(s)),
      text: sheetText("Priya S."),
    });
    // Standard fonts only: a sheet is a few tens of KB, not hundreds.
    expect(notice.byteLength).toBeLessThan(40_000);
    expect(batch.byteLength).toBeLessThan(80_000);
    expect((await PDFDocument.load(batch)).getTitle()).toBe("Hetja batch sheet · 8 dogs");
  });

  it("does not choke on a name the standard fonts cannot print, even without the font", async () => {
    const bytes = await buildCollarPdf({
      layout: "tags",
      paper: "a4",
      dogs: [dog("rni482pq7", "राणी")],
      text: sheetText(null),
      loadDevanagariFont: () => Promise.reject(new Error("offline")),
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("embeds a Noto Sans Devanagari subset only for a Devanagari name", async () => {
    const font = readFileSync(path.join(__dirname, "..", "public", "fonts", "NotoSansDevanagari-700-devanagari.woff"));
    let loads = 0;
    const loadDevanagariFont = async () => {
      loads++;
      return font;
    };
    const deva = await buildCollarPdf({ layout: "notice", paper: "a4", dogs: [dog("rni482pq7", "राणी")], text: sheetText(null), loadDevanagariFont });
    expect(loads).toBe(1);
    // Object streams are compressed, so look for the font through pdf-lib.
    const doc = await PDFDocument.load(deva);
    const baseFonts = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => (obj instanceof PDFDict ? obj.get(PDFName.of("BaseFont")) : undefined))
      .filter((v): v is PDFName => v instanceof PDFName)
      .map((n) => n.decodeText());
    expect(baseFonts.some((f) => /NotoSansDevanagari/.test(f))).toBe(true);
    // A subset, not the whole 72 KB font.
    expect(deva.byteLength).toBeLessThan(40_000);
    await buildCollarPdf({ layout: "notice", paper: "a4", dogs: [dog("rni482pq7", "Rani")], text: sheetText(null), loadDevanagariFont });
    expect(loads).toBe(1);
  }, 20_000);

  it("splits a line into Devanagari and Latin runs", () => {
    expect(needsDevanagari("This is राणी.")).toBe(true);
    expect(needsDevanagari("Rani")).toBe(false);
    expect(devanagariRuns("This is राणी.")).toEqual([
      ["This is ", false],
      ["राणी", true],
      [".", false],
    ]);
  });

  it("prints tags at 0.49 mm per module and bands at the same size", () => {
    const { count } = buildCollarQrMatrix(dog("rni482pq7").collarUrl);
    expect(count).toBe(37);
    expect(TAG_QR_MODULE_MM).toBeCloseTo(22 / 45, 6);
    expect(TAG_QR_MODULE_MM).toBeGreaterThan(0.48);
    expect(Math.abs(BAND_QR_MODULE_MM - TAG_QR_MODULE_MM)).toBeLessThan(0.01);
    // The band's quiet zone is its own 2 mm margin to the cut line.
    expect(4 * BAND_QR_MODULE_MM).toBeLessThanOrEqual(2);
  });

  it("names things the way the A4 mock does", () => {
    expect(tagsHeader(dog("rni482pq7"))).toBe("Collar tags · Rani · RNI 482 PQ7");
    expect(batchHeader([dog("rni482pq7"), dog("bru017xk2")])).toBe("Batch sheet · Ward K/W · 2 dogs × 2 tags");
    expect(sheetFileName("tags", "a4", [dog("rni482pq7")])).toBe("hetja-rni482pq7-tags-a4.pdf");
  });
});
