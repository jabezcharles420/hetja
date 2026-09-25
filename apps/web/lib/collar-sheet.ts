/**
 * The printable collar sheets (design v5, "Hetja Collar Sheet A4"): one
 * description of every page, in millimetres, shared by the vector PDF
 * (lib/collar-pdf.ts) and the print-friendly HTML fallback
 * (components/CollarSheet.tsx), so the two cannot drift.
 *
 *   01 "tags"    10 collar tags (32 x 46 mm) + 2 collar bands (150 x 22 mm)
 *   02 "notice"  the wall notice ("This is Rani.") with the large QR
 *   03 "batch"   up to 8 dogs x 2 tags
 *
 * Letter paper reflows the same content: the margins stay, the content box
 * is simply wider and shorter, and every tag stays at its exact size.
 *
 * QR sizes and the quiet-zone arithmetic live in lib/qr.ts. No pdf-lib here:
 * this module is imported by screens that must stay light.
 */

import { dogCopy, prettyCode, printDate, type DogSex } from "./dog-copy";

export type SheetLayout = "tags" | "notice" | "batch";
export type Paper = "a4" | "letter";

export const PAPER_MM: Record<Paper, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
};

/** Collar tag: 32 x 46 mm, 2 mm padding (2.2 mm at the foot). */
export const TAG_W_MM = 32;
export const TAG_H_MM = 46;
/** Collar band: 150 x 22 mm. */
export const BAND_W_MM = 150;
export const BAND_H_MM = 22;
/** Tags on page 01 and tags per dog on page 03. */
export const TAGS_PER_SHEET = 10;
export const TAGS_PER_DOG_IN_BATCH = 2;
export const BATCH_MAX_DOGS = 8;

export interface SheetDog {
  slug: string;
  name: string | null;
  /** "K/W"; null when the ward list did not load. */
  wardCode: string | null;
  /** The signed collar URL, exactly as the API returned it. */
  collarUrl: string;
  sex?: DogSex | null;
}

/** Everything a sheet prints, worked out once. */
export interface SheetText {
  printedOn: string;
  /** Printer's public name for the batch header ("Priya S."). */
  printedBy: string | null;
}

export function sheetText(printedBy: string | null, now: Date = new Date()): SheetText {
  return { printedOn: printDate(now), printedBy };
}

/* ---- copy (verbatim from the A4 mock; the dog's name and code are data) ---- */

export const SHEET_COPY = {
  brand: "Hetja",
  tagBrand: "HETJA",
  tagsTitle: "Collar tags · 32 × 46 mm",
  bandTitle: "Collar band · wraps flat around the collar",
  bandFold: "Fold here, glue to itself around the collar",
  steps: [
    { title: "1 · Cut", body: "Along the dashed lines. Keep the spares dry." },
    { title: "2 · Seal", body: "Laminate, or wrap both sides in clear packing tape. No gaps at the edges." },
    { title: "3 · Punch", body: "Through the small circle. Use a split ring or cable tie." },
    { title: "4 · Tie", body: "On a soft, wide collar. Two fingers must fit underneath." },
  ],
  tagsFoot:
    'Print at 100% scale (not "fit to page"), then scan one tag before cutting. The tag is about the size of a large coin; the collar band sits flat and can\'t snag. Tags show no address. The code never changes, so reprint any time from the app.',
  noticeKicker: "HETJA · STREET DOG",
  noticeSos: "Hurt or in danger?",
  noticeSosBody: "Scan the code and tap SOS. Nearby feeders and vets are alerted.",
  noticeFoot: "For a gate or shop wall, not the dog. No smartphone? Go to hetja.in and type the code.",
  batchFoot:
    "Two tags per dog, one to wear and one spare. Match each tag to the right dog using the photos in the app. Print at 100% scale, cut, seal both sides, punch the circle, tie on a soft collar with two fingers of room.",
} as const;

export function dogName(d: Pick<SheetDog, "name">): string | null {
  const n = (d.name ?? "").trim();
  return n || null;
}

export function tagsHeader(d: SheetDog): string {
  const n = dogName(d);
  return ["Collar tags", n, prettyCode(d.slug)].filter(Boolean).join(" · ");
}

export function tagsHeaderRight(t: SheetText): string {
  return `Printed ${t.printedOn} · ${TAGS_PER_SHEET} tags`;
}

export function bandLine(d: SheetDog): string {
  const n = dogName(d);
  return n ? `${n} · scan if hurt or lost` : "Scan if hurt or lost";
}

export function bandCode(d: SheetDog): string {
  return `${prettyCode(d.slug)} · hetja.in`;
}

export function noticeWard(d: SheetDog): string {
  return d.wardCode ? `Ward ${d.wardCode}` : "";
}

export function noticeTitle(d: SheetDog): string {
  const n = dogName(d);
  return n ? `This is ${n}.` : "This is a street dog.";
}

export function noticeLead(d: SheetDog): string {
  return dogCopy.noticeLead(d.sex);
}

export function noticeFed(d: SheetDog): { title: string; body: string } {
  return { title: dogCopy.justFed(d.sex), body: dogCopy.justFedBody(d.sex) };
}

export function batchHeader(dogs: SheetDog[]): string {
  const wards = Array.from(new Set(dogs.map((d) => d.wardCode).filter((w): w is string => !!w)));
  const ward = wards.length === 0 ? null : wards.length === 1 ? `Ward ${wards[0]}` : `Wards ${wards.join(", ")}`;
  const count = `${dogs.length} ${dogs.length === 1 ? "dog" : "dogs"} × ${TAGS_PER_DOG_IN_BATCH} tags`;
  return ["Batch sheet", ward, count].filter(Boolean).join(" · ");
}

export function batchHeaderRight(t: SheetText): string {
  return t.printedBy ? `Printed by ${t.printedBy} · ${t.printedOn}` : `Printed ${t.printedOn}`;
}

/** The PDF's file name: hetja-rni482pq7-tags-a4.pdf, hetja-batch-6-dogs-a4.pdf. */
export function sheetFileName(layout: SheetLayout, paper: Paper, dogs: SheetDog[]): string {
  if (layout === "batch") return `hetja-batch-${dogs.length}-dogs-${paper}.pdf`;
  return `hetja-${dogs[0]?.slug ?? "dog"}-${layout}-${paper}.pdf`;
}

/** Tags a sheet prints, for POST /dogs/:slug/prints. Per dog. */
export function tagCountFor(layout: SheetLayout): number {
  if (layout === "tags") return TAGS_PER_SHEET;
  if (layout === "notice") return 1;
  return TAGS_PER_DOG_IN_BATCH;
}

/* ---- which dogs this phone has printed (R8 "Printed") -------------------- */

const PRINTED_KEY = "hetja.printedTags";

export function markPrinted(slugs: string[], now: number = Date.now()): void {
  try {
    const map = readPrinted();
    for (const s of slugs) map[s] = now;
    localStorage.setItem(PRINTED_KEY, JSON.stringify(map));
  } catch {
    /* no storage: the note just stays blank */
  }
}

export function readPrinted(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PRINTED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}
