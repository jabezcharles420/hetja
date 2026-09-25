/**
 * The collar sheets as a real vector PDF, built in the browser (design v5,
 * R7 "Download PDF" and R8 "Download sheet"). There is no server-side PDF
 * rendering in the room (docs/design/v5-handoff/CONTRACT.md, adapted list).
 *
 * Library: pdf-lib (MIT, github.com/Hopding/pdf-lib), loaded with a dynamic
 * import so its ~200 KB gzipped only reaches the print screens, and only when
 * a sheet is actually built. It writes PDF operators directly: no canvas, no
 * rasterising, so every size below is exact on paper at 100% scale.
 *
 *   QR     each QR is ONE filled path of module rectangles drawn from
 *          lib/qr.ts's matrix (version 5, ECC M, the signed collar URL
 *          byte for byte). Horizontal runs are merged into one rectangle,
 *          which changes nothing on paper and keeps the file small.
 *   Fonts  the PDF standard 14 (Helvetica, Helvetica-Bold, Courier-Bold):
 *          nothing is embedded, so the file stays a few tens of KB. They
 *          encode WinAnsi only. When a dog's name is in Devanagari (Hindi,
 *          Marathi), and only then, Noto Sans Devanagari Bold (OFL,
 *          public/fonts/, 72 KB), @pdf-lib/fontkit (MIT, which shapes the
 *          conjuncts and vowel signs) and regenerator-runtime (MIT, which
 *          that fontkit build needs) are loaded and the font is embedded as
 *          a subset of just the glyphs used; Devanagari runs are drawn with it
 *          and everything else stays standard. Any other script still falls
 *          back to what the standard fonts can print (see `printable`). The
 *          code, which is what a stranger types, is always ASCII.
 *
 * Layout and copy come from lib/collar-sheet.ts, shared with the HTML
 * fallback, and are the A4 mock's values in millimetres ("Hetja Collar Sheet
 * A4.dc.html"). Letter reflows the same content inside the same margins.
 */

import type { PDFFont, PDFPage } from "pdf-lib";
import {
  BAND_H_MM,
  BAND_W_MM,
  PAPER_MM,
  SHEET_COPY,
  TAGS_PER_DOG_IN_BATCH,
  TAGS_PER_SHEET,
  TAG_H_MM,
  TAG_W_MM,
  bandCode,
  bandLine,
  batchHeader,
  batchHeaderRight,
  dogName,
  noticeFed,
  noticeLead,
  noticeTitle,
  noticeWard,
  tagsHeader,
  tagsHeaderRight,
  type Paper,
  type SheetDog,
  type SheetLayout,
  type SheetText,
} from "./collar-sheet";
import { prettyCode } from "./dog-copy";
import {
  BAND_QR_MM,
  NOTICE_QR_MM,
  QR_QUIET_MODULES,
  TAG_QR_MM,
  buildCollarQrMatrix,
} from "./qr";

const PT_PER_MM = 72 / 25.4;
const pt = (mm: number) => mm * PT_PER_MM;
const PT_TO_MM = 25.4 / 72;

/** Ascender and descender (em) of the standard fonts, from their AFM files. */
const HELV = { a: 0.718, d: 0.207 };
const COUR = { a: 0.629, d: 0.157 };

type Pdf = typeof import("pdf-lib");

interface Fonts {
  reg: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  /** Noto Sans Devanagari Bold, embedded only when a name needs it. */
  deva?: PDFFont;
}

/** Devanagari (and its extended blocks); ZWJ / ZWNJ join a run. */
const DEVA_CHAR = /[ऀ-ॿ᳐-᳿꣠-ꣿ‌‍]/;
const DEVA_TEST = /[ऀ-ॿ᳐-᳿꣠-ꣿ]/;

/** Where the browser fetches the Devanagari font from (apps/web/public). */
export const DEVANAGARI_FONT_URL = "/fonts/NotoSansDevanagari-700-devanagari.woff";

export function needsDevanagari(text: string | null | undefined): boolean {
  return !!text && DEVA_TEST.test(text);
}

/** Split into runs: [text, isDevanagari]. Spaces are drawn with the standard font. */
export function devanagariRuns(text: string): [string, boolean][] {
  const runs: [string, boolean][] = [];
  for (const ch of text) {
    const deva = DEVA_CHAR.test(ch);
    const last = runs[runs.length - 1];
    if (last && last[1] === deva) last[0] += ch;
    else runs.push([ch, deva]);
  }
  return runs;
}

interface Ctx {
  lib: Pdf;
  page: PDFPage;
  hMm: number;
  fonts: Fonts;
}

type Rgb = ReturnType<Pdf["rgb"]>;

function grey(lib: Pdf, hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Drop characters the WinAnsi standard fonts cannot encode. */
export function printable(font: PDFFont, text: string): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    let out = "";
    for (const ch of text) {
      try {
        font.encodeText(ch);
        out += ch;
      } catch {
        /* not printable in a standard font */
      }
    }
    return out.trim();
  }
}

interface TextOpts {
  font: PDFFont;
  metrics?: { a: number; d: number };
  size: number; // pt
  lh?: number; // line-height multiple
  tracking?: number; // em
  color?: Rgb;
  align?: "left" | "center" | "right";
}

function widthMm(t: string, o: TextOpts): number {
  const w = o.font.widthOfTextAtSize(t, o.size) + (o.tracking ?? 0) * o.size * Math.max(0, [...t].length - 1);
  return w * PT_TO_MM;
}

function lineHeightMm(o: TextOpts): number {
  return (o.lh ?? 1.2) * o.size * PT_TO_MM;
}

type Run = { t: string; o: TextOpts };

/** The line as drawable runs: Devanagari with the embedded font, the rest standard. */
function runsOf(c: Ctx, raw: string, o: TextOpts): Run[] {
  if (!c.fonts.deva || !DEVA_TEST.test(raw)) {
    const t = printable(o.font, raw);
    return t ? [{ t, o }] : [];
  }
  const deva = c.fonts.deva;
  return devanagariRuns(raw)
    .map(([t, isDeva]): Run => (isDeva ? { t, o: { ...o, font: deva, tracking: 0 } } : { t: printable(o.font, t) || t.replace(/[^ ]/g, ""), o }))
    .filter((r) => r.t.length > 0);
}

/** Width of a line in mm, Devanagari runs included. */
function measure(c: Ctx, raw: string, o: TextOpts): number {
  const runs = runsOf(c, raw, o);
  return runs.reduce((sum, r, i) => sum + widthMm(r.t, r.o) + (i < runs.length - 1 ? (r.o.tracking ?? 0) * r.o.size * PT_TO_MM : 0), 0);
}

/** Draw one line whose CSS line box starts at `topMm`. `x` is the left edge, centre or right edge per `align`. */
function text(c: Ctx, raw: string, xMm: number, topMm: number, o: TextOpts): void {
  const runs = runsOf(c, raw, o);
  if (runs.length === 0) return;
  const m = o.metrics ?? HELV;
  const lh = o.lh ?? 1.2;
  const baselineMm = topMm + ((lh - (m.a + m.d)) / 2 + m.a) * o.size * PT_TO_MM;
  const w = measure(c, raw, o);
  let x = o.align === "center" ? xMm - w / 2 : o.align === "right" ? xMm - w : xMm;
  runs.forEach((r, i) => {
    const tracking = (r.o.tracking ?? 0) * r.o.size;
    if (tracking) c.page.pushOperators(c.lib.setCharacterSpacing(tracking));
    c.page.drawText(r.t, {
      x: pt(x),
      y: pt(c.hMm - baselineMm),
      size: r.o.size,
      font: r.o.font,
      color: o.color ?? c.lib.rgb(0, 0, 0),
    });
    if (tracking) c.page.pushOperators(c.lib.setCharacterSpacing(0));
    x += widthMm(r.t, r.o) + (i < runs.length - 1 ? tracking * PT_TO_MM : 0);
  });
}

/** Greedy word wrap at `maxMm`. */
function wrap(raw: string, maxMm: number, o: TextOpts): string[] {
  const words = printable(o.font, raw).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && widthMm(next, o) > maxMm) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw a wrapped paragraph; returns its height in mm. */
function para(c: Ctx, raw: string, xMm: number, topMm: number, maxMm: number, o: TextOpts): number {
  const lines = wrap(raw, maxMm, o);
  const lh = lineHeightMm(o);
  lines.forEach((l, i) => text(c, l, xMm, topMm + i * lh, o));
  return lines.length * lh;
}

function paraHeight(raw: string, maxMm: number, o: TextOpts): number {
  return wrap(raw, maxMm, o).length * lineHeightMm(o);
}

function dashedRect(c: Ctx, xMm: number, yMm: number, wMm: number, hMm: number): void {
  c.page.drawRectangle({
    x: pt(xMm),
    y: pt(c.hMm - yMm - hMm),
    width: pt(wMm),
    height: pt(hMm),
    borderColor: grey(c.lib, "#8a8a8a"),
    borderWidth: pt(0.3),
    borderDashArray: [pt(1), pt(0.8)],
  });
}

function hLine(c: Ctx, xMm: number, yMm: number, wMm: number, thickMm: number, hex: string): void {
  c.page.drawLine({
    start: { x: pt(xMm), y: pt(c.hMm - yMm) },
    end: { x: pt(xMm + wMm), y: pt(c.hMm - yMm) },
    thickness: pt(thickMm),
    color: grey(c.lib, hex),
  });
}

/** Rounded-rectangle outline (the notice's QR frame and cards). */
function roundRect(c: Ctx, xMm: number, yMm: number, wMm: number, hMm: number, rMm: number, borderMm: number): void {
  // Stroke on the centre of the border, as CSS draws it inside the box.
  const i = borderMm / 2;
  const x0 = pt(i);
  const y0 = pt(i);
  const w = pt(wMm - borderMm);
  const h = pt(hMm - borderMm);
  const r = pt(rMm - i);
  const k = 0.5523 * r;
  const d = [
    `M ${x0 + r} ${y0}`,
    `L ${x0 + w - r} ${y0}`,
    `C ${x0 + w - r + k} ${y0} ${x0 + w} ${y0 + r - k} ${x0 + w} ${y0 + r}`,
    `L ${x0 + w} ${y0 + h - r}`,
    `C ${x0 + w} ${y0 + h - r + k} ${x0 + w - r + k} ${y0 + h} ${x0 + w - r} ${y0 + h}`,
    `L ${x0 + r} ${y0 + h}`,
    `C ${x0 + r - k} ${y0 + h} ${x0} ${y0 + h - r + k} ${x0} ${y0 + h - r}`,
    `L ${x0} ${y0 + r}`,
    `C ${x0} ${y0 + r - k} ${x0 + r - k} ${y0} ${x0 + r} ${y0}`,
    "Z",
  ].join(" ");
  c.page.drawSvgPath(d, {
    x: pt(xMm),
    y: pt(c.hMm - yMm),
    borderColor: c.lib.rgb(0, 0, 0),
    borderWidth: pt(borderMm),
  });
}

/**
 * The QR as one path of module rectangles. `sizeMm` is the box; with
 * `quiet` the 4-module quiet zone is inside it (tags, notice), without it the
 * modules fill it and the quiet zone is the surrounding white (bands).
 */
function qr(c: Ctx, url: string, xMm: number, yMm: number, sizeMm: number, quiet: boolean): void {
  const { count, dark } = buildCollarQrMatrix(url);
  const q = quiet ? QR_QUIET_MODULES : 0;
  const moduleMm = sizeMm / (count + 2 * q);
  const parts: string[] = [];
  for (let r = 0; r < count; r++) {
    let cIdx = 0;
    while (cIdx < count) {
      if (!dark[r]![cIdx]) {
        cIdx++;
        continue;
      }
      let run = 1;
      while (cIdx + run < count && dark[r]![cIdx + run]) run++;
      parts.push(`M${cIdx + q} ${r + q}h${run}v1h${-run}z`);
      cIdx += run;
    }
  }
  c.page.drawSvgPath(parts.join(""), {
    x: pt(xMm),
    y: pt(c.hMm - yMm),
    scale: pt(moduleMm),
    color: c.lib.rgb(0, 0, 0),
    borderWidth: 0,
  });
}

/* ---- pieces ------------------------------------------------------------ */

/** Page header ("Hetja  Collar tags · Rani · RNI 482 PQ7 ... Printed ..."). Returns its bottom. */
function header(c: Ctx, m: number, wMm: number, left: string, right: string): number {
  const brand: TextOpts = { font: c.fonts.bold, size: 16, tracking: -0.02 };
  const sub: TextOpts = { font: c.fonts.reg, size: 11, color: grey(c.lib, "#444444") };
  const meta: TextOpts = { font: c.fonts.reg, size: 10, color: grey(c.lib, "#444444"), align: "right" };
  const boxH = lineHeightMm(brand);
  // Baseline-aligned left group, bottom-aligned right line (flex-end).
  const baseOff = (o: TextOpts) => ((1.2 - (HELV.a + HELV.d)) / 2 + HELV.a) * o.size * PT_TO_MM;
  const baseline = m + baseOff(brand);
  text(c, SHEET_COPY.brand, m, m, brand);
  const subX = m + measure(c, SHEET_COPY.brand, brand) + 2;
  text(c, left, subX, baseline - baseOff(sub), sub);
  text(c, right, m + wMm, m + boxH - lineHeightMm(meta), meta);
  const ruleTop = m + boxH + 3;
  hLine(c, m, ruleTop + 0.2, wMm, 0.4, "#000000");
  return ruleTop + 0.4;
}

/** One 32 x 46 mm collar tag with its top-left at (x, y). */
function tag(c: Ctx, d: SheetDog, x: number, y: number): void {
  dashedRect(c, x, y, TAG_W_MM, TAG_H_MM);
  const cx = x + TAG_W_MM / 2;
  // Punch circle: 3 mm outside diameter, 0.3 mm line.
  c.page.drawCircle({
    x: pt(cx),
    y: pt(c.hMm - (y + 2 + 1.5)),
    size: pt(1.5 - 0.15),
    borderColor: grey(c.lib, "#8a8a8a"),
    borderWidth: pt(0.3),
  });
  const brand: TextOpts = { font: c.fonts.bold, size: 5.5, tracking: 0.14, align: "center" };
  const brandTop = y + 2 + 3 + 1;
  text(c, SHEET_COPY.tagBrand, cx, brandTop, brand);
  const qrTop = brandTop + lineHeightMm(brand) + 1;
  qr(c, d.collarUrl, cx - TAG_QR_MM / 2, qrTop, TAG_QR_MM, true);
  const nameO: TextOpts = { font: c.fonts.bold, size: 9, lh: 1, align: "center" };
  const nameTop = qrTop + TAG_QR_MM + 1 + 0.6;
  const n = dogName(d);
  if (n) text(c, n, cx, nameTop, nameO);
  const codeO: TextOpts = { font: c.fonts.mono, metrics: COUR, size: 7, tracking: 0.04, align: "center" };
  text(c, prettyCode(d.slug), cx, nameTop + lineHeightMm(nameO) + 1, codeO);
}

function band(c: Ctx, d: SheetDog, x: number, y: number): void {
  dashedRect(c, x, y, BAND_W_MM, BAND_H_MM);
  const qy = y + (BAND_H_MM - BAND_QR_MM) / 2;
  qr(c, d.collarUrl, x + 3, qy, BAND_QR_MM, false);
  qr(c, d.collarUrl, x + BAND_W_MM - 3 - BAND_QR_MM, qy, BAND_QR_MM, false);

  const l1: TextOpts = { font: c.fonts.bold, size: 10, lh: 1 };
  const l2: TextOpts = { font: c.fonts.mono, metrics: COUR, size: 8, tracking: 0.04 };
  const blockH = lineHeightMm(l1) + 0.8 + lineHeightMm(l2);
  const top = y + (BAND_H_MM - blockH) / 2;
  const tx = x + 3 + BAND_QR_MM + 3;
  text(c, bandLine(d), tx, top, l1);
  text(c, bandCode(d), tx, top + lineHeightMm(l1) + 0.8, l2);

  // Fold line and note, right of the text column.
  const foldX = x + BAND_W_MM - 3 - BAND_QR_MM - 3 - 34 - 3;
  c.page.drawLine({
    start: { x: pt(foldX), y: pt(c.hMm - y) },
    end: { x: pt(foldX), y: pt(c.hMm - y - BAND_H_MM) },
    thickness: pt(0.3),
    color: grey(c.lib, "#8a8a8a"),
    dashArray: [pt(0.3), pt(0.6)],
  });
  const fold: TextOpts = { font: c.fonts.reg, size: 7, lh: 1.3, color: grey(c.lib, "#666666") };
  const fh = paraHeight(SHEET_COPY.bandFold, 34, fold);
  para(c, SHEET_COPY.bandFold, foldX + 3, y + (BAND_H_MM - fh) / 2, 34, fold);
}

/* ---- pages ------------------------------------------------------------- */

function tagsPage(c: Ctx, d: SheetDog, t: SheetText, wMm: number): void {
  const m = 12;
  const cw = wMm - 2 * m;
  let y = header(c, m, cw, tagsHeader(d), tagsHeaderRight(t)) + 6;

  const h11: TextOpts = { font: c.fonts.bold, size: 11 };
  text(c, SHEET_COPY.tagsTitle, m, y, h11);
  y += lineHeightMm(h11) + 2;
  for (let i = 0; i < TAGS_PER_SHEET; i++) {
    tag(c, d, m + (i % 5) * TAG_W_MM, y + Math.floor(i / 5) * TAG_H_MM);
  }
  y += 2 * TAG_H_MM + 6;

  text(c, SHEET_COPY.bandTitle, m, y, h11);
  y += lineHeightMm(h11) + 2;
  band(c, d, m, y);
  band(c, d, m, y + BAND_H_MM);
  y += 2 * BAND_H_MM + 6 + 1;

  const colW = (cw - 3 * 5) / 4;
  const body: TextOpts = { font: c.fonts.reg, size: 9.5, lh: 1.35, color: grey(c.lib, "#222222") };
  let stepsH = 0;
  SHEET_COPY.steps.forEach((s, i) => {
    const x = m + i * (colW + 5);
    text(c, s.title, x, y, h11);
    const h = para(c, s.body, x, y + lineHeightMm(h11) + 1.5, colW, body);
    stepsH = Math.max(stepsH, lineHeightMm(h11) + 1.5 + h);
  });
  y += stepsH + 6;

  hLine(c, m, y + 0.15, cw, 0.3, "#bbbbbb");
  const foot: TextOpts = { font: c.fonts.reg, size: 9, lh: 1.4, color: grey(c.lib, "#444444") };
  para(c, SHEET_COPY.tagsFoot, m, y + 0.3 + 2.5, cw, foot);
}

function noticePage(c: Ctx, d: SheetDog, wMm: number, hMm: number): void {
  const m = 16;
  const cw = wMm - 2 * m;
  const cx = wMm / 2;
  let y = m;
  const row: TextOpts = { font: c.fonts.bold, size: 11, tracking: 0.12 };
  text(c, SHEET_COPY.noticeKicker, m, y, row);
  text(c, noticeWard(d), m + cw, y, { font: c.fonts.reg, size: 11, color: grey(c.lib, "#444444"), align: "right" });
  y += lineHeightMm(row) + 7 + 6;

  const title: TextOpts = { font: c.fonts.bold, size: 60, lh: 0.95, tracking: -0.04, align: "center" };
  // A long name shrinks to fit the line rather than running off the page.
  const tw = measure(c, noticeTitle(d), title);
  if (tw > cw) title.size = Math.max(28, (title.size * cw) / tw);
  text(c, noticeTitle(d), cx, y, title);
  y += lineHeightMm(title) + 7;

  const lead: TextOpts = { font: c.fonts.reg, size: 18, lh: 1.35, align: "center" };
  const leadLines = wrap(noticeLead(d), Math.min(150, cw), lead);
  leadLines.forEach((l, i) => text(c, l, cx, y + i * lineHeightMm(lead), lead));
  y += leadLines.length * lineHeightMm(lead) + 7 + 2;

  roundRect(c, cx - 40, y, 80, 80, 6, 0.6);
  qr(c, d.collarUrl, cx - NOTICE_QR_MM / 2, y + 5.6, NOTICE_QR_MM, true);
  y += 80 + 7;

  const code: TextOpts = { font: c.fonts.mono, metrics: COUR, size: 26, tracking: 0.08, align: "center" };
  text(c, prettyCode(d.slug), cx, y, code);
  y += lineHeightMm(code) + 7 + 2;

  const cardW = (cw - 6) / 2;
  const ct: TextOpts = { font: c.fonts.bold, size: 14 };
  const cb: TextOpts = { font: c.fonts.reg, size: 12, lh: 1.35 };
  const fed = noticeFed(d);
  const cards = [
    { title: SHEET_COPY.noticeSos, body: SHEET_COPY.noticeSosBody },
    { title: fed.title, body: fed.body },
  ];
  const inner = cardW - 10 - 0.8;
  const cardH =
    Math.max(...cards.map((k) => paraHeight(k.body, inner, cb))) + lineHeightMm(ct) + 1.5 + 10 + 0.8;
  cards.forEach((k, i) => {
    const x = m + i * (cardW + 6);
    roundRect(c, x, y, cardW, cardH, 4, 0.4);
    text(c, k.title, x + 5.4, y + 5.4, ct);
    para(c, k.body, x + 5.4, y + 5.4 + lineHeightMm(ct) + 1.5, inner, cb);
  });

  const foot: TextOpts = { font: c.fonts.reg, size: 11, color: grey(c.lib, "#444444"), align: "center" };
  const footLines = wrap(SHEET_COPY.noticeFoot, cw, foot);
  const footTop = hMm - m - footLines.length * lineHeightMm(foot);
  footLines.forEach((l, i) => text(c, l, cx, footTop + i * lineHeightMm(foot), foot));
}

function batchPage(c: Ctx, dogs: SheetDog[], t: SheetText, wMm: number): void {
  const m = 12;
  const cw = wMm - 2 * m;
  let y = header(c, m, cw, batchHeader(dogs), batchHeaderRight(t)) + 5;
  const pairW = TAGS_PER_DOG_IN_BATCH * TAG_W_MM;
  dogs.forEach((d, i) => {
    const x = m + (i % 2) * (pairW + 8);
    const top = y + Math.floor(i / 2) * (TAG_H_MM + 4);
    for (let k = 0; k < TAGS_PER_DOG_IN_BATCH; k++) tag(c, d, x + k * TAG_W_MM, top);
  });
  const rows = Math.ceil(dogs.length / 2);
  y += rows * TAG_H_MM + Math.max(0, rows - 1) * 4 + 5;
  const foot: TextOpts = { font: c.fonts.reg, size: 9.5, lh: 1.4, color: grey(c.lib, "#222222") };
  para(c, SHEET_COPY.batchFoot, m, y, cw, foot);
}

/* ---- entry point --------------------------------------------------------- */

export interface BuildSheetInput {
  layout: SheetLayout;
  paper: Paper;
  /** One dog for "tags" and "notice"; 1 to 8 for "batch". */
  dogs: SheetDog[];
  text: SheetText;
  /**
   * The Devanagari font's bytes, fetched only when a name needs it. Defaults
   * to DEVANAGARI_FONT_URL; tests pass the file from disk.
   */
  loadDevanagariFont?: () => Promise<ArrayBuffer | Uint8Array>;
}

let devanagariFont: Promise<ArrayBuffer> | null = null;

/** Fetched once per page load; a failure is not cached, so the next sheet retries. */
function fetchDevanagariFont(): Promise<ArrayBuffer> {
  devanagariFont ??= fetch(DEVANAGARI_FONT_URL).then((res) => {
    if (!res.ok) throw new Error(`font ${res.status}`);
    return res.arrayBuffer();
  });
  devanagariFont.catch(() => {
    devanagariFont = null;
  });
  return devanagariFont;
}

export async function buildCollarPdf(input: BuildSheetInput): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const doc = await lib.PDFDocument.create();
  const fonts: Fonts = {
    reg: await doc.embedFont(lib.StandardFonts.Helvetica),
    bold: await doc.embedFont(lib.StandardFonts.HelveticaBold),
    mono: await doc.embedFont(lib.StandardFonts.CourierBold),
  };
  if (input.dogs.some((d) => needsDevanagari(d.name))) {
    try {
      // @pdf-lib/fontkit's Indic shaper is compiled against a global
      // regeneratorRuntime (a known issue in its 1.1.1 build): provide it,
      // by assignment rather than the package's eval fallback.
      const g = globalThis as unknown as { regeneratorRuntime?: unknown };
      if (!g.regeneratorRuntime) g.regeneratorRuntime = (await import("regenerator-runtime")).default;
      const [{ default: fontkit }, bytes] = await Promise.all([
        import("@pdf-lib/fontkit"),
        (input.loadDevanagariFont ?? fetchDevanagariFont)(),
      ]);
      doc.registerFontkit(fontkit);
      fonts.deva = await doc.embedFont(bytes, { subset: true });
    } catch {
      /* no font: the name falls back to what the standard fonts can print */
    }
  }
  const { w, h } = PAPER_MM[input.paper];
  const page = doc.addPage([pt(w), pt(h)]);
  const c: Ctx = { lib, page, hMm: h, fonts };
  const first = input.dogs[0];
  if (!first) throw new Error("a sheet needs at least one dog");

  if (input.layout === "tags") tagsPage(c, first, input.text, w);
  else if (input.layout === "notice") noticePage(c, first, w, h);
  else batchPage(c, input.dogs, input.text, w);

  const who = input.layout === "batch" ? `${input.dogs.length} dogs` : dogName(first) ?? prettyCode(first.slug);
  doc.setTitle(`Hetja ${input.layout === "notice" ? "wall notice" : input.layout === "batch" ? "batch sheet" : "collar tags"} · ${who}`);
  doc.setCreator("Hetja (hetja.in)");
  doc.setProducer("Hetja web, pdf-lib");
  doc.setCreationDate(new Date());
  return doc.save();
}
