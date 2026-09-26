/**
 * The vaccination certificate (design v7 V4 "Vaccination certificate for
 * rescues and adoptions · PDF"), built in the browser from vet-signed
 * records, like the collar sheets (lib/collar-pdf.ts, the house approach):
 * pdf-lib dynamic-imported, the PDF standard fonts, and Noto Sans
 * Devanagari embedded as a subset only when the dog's name needs it.
 *
 * Only vet-signed records go on it. Feeder-noted care is not evidence a
 * rescue or an adopter can rely on, so it is left off, and the page says so.
 * Location is ward level (INVARIANT 2).
 */
import type { PDFFont, PDFPage } from "pdf-lib";
import { wardDisplay } from "@hetja/contracts";
import { DEVANAGARI_FONT_URL, devanagariRuns, needsDevanagari, printable } from "@/lib/collar-pdf";
import { prettyCode } from "@/lib/dog-copy";
import { dogName } from "@/lib/streak";
import type { HealthRecord } from "./vet-api";
import { governmentLabel, longDate, regLine } from "./vet-copy";

export interface CertificateInput {
  slug: string;
  name: string | null;
  wardId: string | null;
  /** The collar's printed batch number ("HJ-0412"), when it has one. */
  collarNo?: string | null;
  records: HealthRecord[];
  /** Test hook: the Devanagari font bytes. */
  loadDevanagariFont?: () => Promise<ArrayBuffer | Uint8Array>;
  now?: Date;
}

/** "Collar HJ-0412 · R4N 7KW 2AB", or "Collar R4N 7KW 2AB" with no batch number. */
export function collarLine(slug: string, collarNo?: string | null): string {
  const code = prettyCode(slug);
  const batch = collarNo?.trim();
  return batch && batch.toUpperCase() !== code.replace(/ /g, "") ? `Collar ${batch} · ${code}` : `Collar ${code}`;
}

/** The rows the certificate prints: vet-signed only, vaccinations first, newest first. */
export function certificateRows(records: HealthRecord[]): HealthRecord[] {
  const rank = (r: HealthRecord) => (r.kind === "vaccination" ? 0 : r.kind === "sterilisation" ? 1 : 2);
  return records
    .filter((r) => r.status === "vet_signed" && !r.withdrawn)
    .sort((a, b) => rank(a) - rank(b) || String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

export function certificateFileName(slug: string, name: string | null): string {
  const base = (name ?? "").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return `hetja-certificate-${base || slug}.pdf`;
}

const W = 595.28;
const H = 841.89;
const M = 56;

interface Fonts {
  reg: PDFFont;
  bold: PDFFont;
  deva?: PDFFont;
}

export async function buildCertificatePdf(input: CertificateInput): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const doc = await lib.PDFDocument.create();
  const fonts: Fonts = {
    reg: await doc.embedFont(lib.StandardFonts.Helvetica),
    bold: await doc.embedFont(lib.StandardFonts.HelveticaBold),
  };
  if (needsDevanagari(input.name)) {
    try {
      const g = globalThis as unknown as { regeneratorRuntime?: unknown };
      if (!g.regeneratorRuntime) g.regeneratorRuntime = (await import("regenerator-runtime")).default;
      const [{ default: fontkit }, bytes] = await Promise.all([
        import("@pdf-lib/fontkit"),
        (input.loadDevanagariFont ?? (() => fetch(DEVANAGARI_FONT_URL).then((r) => r.arrayBuffer())))(),
      ]);
      doc.registerFontkit(fontkit);
      fonts.deva = await doc.embedFont(bytes, { subset: true });
    } catch {
      /* the name falls back to what the standard fonts can print */
    }
  }

  const ink = lib.rgb(0.114, 0.114, 0.122);
  const mid = lib.rgb(0.282, 0.282, 0.302);
  const soft = lib.rgb(0.431, 0.431, 0.451);
  const rule = lib.rgb(0.82, 0.82, 0.843);

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const draw = (raw: string, x: number, size: number, font: PDFFont, color = ink): number => {
    let cx = x;
    const runs: [string, boolean][] = fonts.deva && needsDevanagari(raw) ? devanagariRuns(raw) : [[raw, false]];
    for (const [t, deva] of runs) {
      const f = deva && fonts.deva ? fonts.deva : font;
      const text = deva ? t : printable(f, t) || t.replace(/[^ ]/g, "");
      if (!text) continue;
      page.drawText(text, { x: cx, y, size, font: f, color });
      cx += f.widthOfTextAtSize(text, size);
    }
    return cx;
  };

  /** Wrap to `width` points; returns the lines. */
  const wrap = (raw: string, size: number, font: PDFFont, width: number): string[] => {
    const words = printable(font, raw).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  const name = dogName(input.name);
  const ward = input.wardId ? wardDisplay(input.wardId) : null;

  // Header
  draw("Hetja", M, 13, fonts.bold);
  const right = "Vaccination certificate";
  page.drawText(right, { x: W - M - fonts.reg.widthOfTextAtSize(right, 11), y, size: 11, font: fonts.reg, color: soft });
  y -= 18;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: rule });

  y -= 44;
  draw(name, M, 30, fonts.bold);
  y -= 22;
  const facts = [collarLine(input.slug, input.collarNo), ward ? `${ward.code} ward${ward.name ? ` · ${ward.name}` : ""}` : ""]
    .filter(Boolean)
    .join(" · ");
  draw(facts, M, 11, fonts.reg, mid);

  const rows = certificateRows(input.records);
  const section = (title: string) => {
    y -= 34;
    draw(title.toUpperCase(), M, 9, fonts.bold, soft);
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rule });
  };

  const newPageIfNeeded = (need: number) => {
    if (y - need > M + 60) return;
    page = doc.addPage([W, H]);
    y = H - M;
  };

  const groups: [string, HealthRecord[]][] = [
    ["Vaccinations", rows.filter((r) => r.kind === "vaccination")],
    ["Sterilisation", rows.filter((r) => r.kind === "sterilisation")],
    ["Treatments", rows.filter((r) => r.kind !== "vaccination" && r.kind !== "sterilisation")],
  ];

  if (rows.length === 0) {
    section("Records");
    y -= 20;
    draw("No vet-signed records yet.", M, 11, fonts.reg, mid);
  }

  for (const [title, list] of groups) {
    if (list.length === 0) continue;
    newPageIfNeeded(80);
    section(title);
    for (const r of list) {
      newPageIfNeeded(70);
      y -= 22;
      draw(r.title, M, 12, fonts.bold);
      const when =
        r.kind === "vaccination"
          ? [longDate(r.date), r.dueOn ? `due again ${longDate(r.dueOn)}` : ""].filter(Boolean).join(" · ")
          : [longDate(r.date), r.note].filter(Boolean).join(" · ");
      const w = fonts.reg.widthOfTextAtSize(printable(fonts.reg, when), 11);
      page.drawText(printable(fonts.reg, when), { x: W - M - w, y, size: 11, font: fonts.reg, color: mid });
      if (r.brand || r.batch) {
        y -= 16;
        draw([r.brand, r.batch ? `batch ${r.batch}` : ""].filter(Boolean).join(" · "), M, 10.5, fonts.reg, mid);
      }
      if (r.vet) {
        y -= 15;
        draw(
          ["Signed by " + r.vet.name, governmentLabel(r.vet.isGovernment), regLine(r.vet)].filter(Boolean).join(" · "),
          M,
          10.5,
          fonts.reg,
          soft,
        );
      }
      y -= 10;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: rule });
    }
  }

  // Footer, on the last page.
  const now = input.now ?? new Date();
  const printed = longDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  const foot = [
    "Every record here was signed on Hetja by the vet named, with a passkey on their own phone. Care that feeders noted themselves is not on this certificate.",
    `Check the current record at hetja.in/d/${input.slug}. Printed ${printed}.`,
  ];
  let fy = M + 38;
  for (const para of foot) {
    for (const line of wrap(para, 9.5, fonts.reg, W - 2 * M)) {
      page.drawText(line, { x: M, y: fy, size: 9.5, font: fonts.reg, color: soft });
      fy -= 13;
    }
    fy -= 4;
  }

  doc.setTitle(`Hetja vaccination certificate · ${printable(fonts.reg, name) || prettyCode(input.slug)}`);
  doc.setCreator("Hetja (hetja.in)");
  doc.setProducer("Hetja web, pdf-lib");
  doc.setCreationDate(now);
  return doc.save();
}

/** Build and hand the PDF to the phone (a download, or the share sheet's viewer). */
export async function downloadCertificate(input: CertificateInput): Promise<void> {
  const bytes = await buildCertificatePdf(input);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = certificateFileName(input.slug, input.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
