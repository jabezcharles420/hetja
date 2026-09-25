/**
 * Loading, building and handing over a collar sheet (R7, R8 and the HTML
 * fallback pages). The PDF library is only reached through `makeSheetPdf`,
 * which imports lib/collar-pdf.ts (and pdf-lib) on demand.
 */

import { api, ApiError, type CollarForPrint, type DogProfileV5, type FeederMe, type Ward } from "./api";
import { recallDogSex, type DogSex } from "./dog-copy";
import {
  markPrinted,
  sheetFileName,
  sheetText,
  tagCountFor,
  type Paper,
  type SheetDog,
  type SheetLayout,
} from "./collar-sheet";

function wardCodeFor(wards: Ward[] | null, wardId: string): string {
  return wards?.find((w) => w.id === wardId)?.code ?? wardId;
}

/**
 * The dog's sex as the API has it, when a payload carries one: "male",
 * "female", or null (not known). undefined means the payload says nothing.
 */
export function apiSex(x: unknown): DogSex | null | undefined {
  if (!x || typeof x !== "object" || !("sex" in x)) return undefined;
  const v = (x as { sex?: unknown }).sex;
  return v === "male" || v === "female" ? v : null;
}

/**
 * Sexes for pronouns (she / he / they), from the API: GET /feeders/me/dogs
 * (which includes dogs not yet switched on), then GET /dogs/:slug for any
 * still missing. The registrator's pick remembered on this phone
 * (lib/dog-copy.ts) is only the fallback when the API says nothing; an API
 * null ("not known") wins over it and reads as they/them.
 */
export async function loadSexes(slugs: string[]): Promise<Record<string, DogSex | null>> {
  const out: Record<string, DogSex | null> = {};
  try {
    const mine = await api.getMyDogsV5();
    for (const d of mine.dogs) {
      const v = apiSex(d);
      if (slugs.includes(d.slug) && v !== undefined) out[d.slug] = v;
    }
  } catch {
    /* signed out or an older server */
  }
  const missing = slugs.filter((x) => !(x in out)).slice(0, 8);
  await Promise.all(
    missing.map(async (slug) => {
      try {
        const v = apiSex((await api.getDog(slug)) as DogProfileV5);
        if (v !== undefined) out[slug] = v;
      } catch {
        /* not public yet */
      }
    }),
  );
  for (const slug of slugs) if (!(slug in out)) out[slug] = recallDogSex(slug);
  return out;
}

export function toSheetDog(c: CollarForPrint, wards: Ward[] | null, sex?: DogSex | null): SheetDog {
  const own = apiSex(c);
  return {
    slug: c.slug,
    name: c.name ?? null,
    wardCode: c.wardId ? wardCodeFor(wards, c.wardId) : null,
    collarUrl: c.collarUrl,
    sex: own !== undefined ? own : sex !== undefined ? sex : recallDogSex(c.slug),
  };
}

/** The printer's public name for the batch header, e.g. "Priya S.". */
export function printerName(me: FeederMe | null): string | null {
  return me?.publicName ?? me?.displayName ?? null;
}

/**
 * One dog's signed collar: GET /dogs/:slug/collar (registrator or a feeder
 * of the dog), falling back to the registrator-only GET /registrations/:slug
 * for a server that predates v5. A 401 is final either way.
 */
export async function loadCollar(slug: string): Promise<CollarForPrint> {
  try {
    return await api.getCollar(slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    const r = await api.getRegistration(slug);
    return { slug: r.slug, name: r.name ?? null, wardId: r.wardId, collarUrl: r.collarUrl };
  }
}

export async function loadWards(): Promise<Ward[] | null> {
  try {
    return (await api.getWards()).wards;
  } catch {
    return null;
  }
}

export interface MadeSheet {
  bytes: Uint8Array;
  fileName: string;
}

export async function makeSheetPdf(
  layout: SheetLayout,
  paper: Paper,
  dogs: SheetDog[],
  printedBy: string | null,
): Promise<MadeSheet> {
  const { buildCollarPdf } = await import("./collar-pdf");
  const bytes = await buildCollarPdf({ layout, paper, dogs, text: sheetText(printedBy) });
  return { bytes, fileName: sheetFileName(layout, paper, dogs) };
}

function pdfBlob(sheet: MadeSheet): Blob {
  // Copy into a plain ArrayBuffer: Blob wants ArrayBuffer-backed views.
  const buf = new Uint8Array(sheet.bytes.byteLength);
  buf.set(sheet.bytes);
  return new Blob([buf], { type: "application/pdf" });
}

export function downloadSheet(sheet: MadeSheet): void {
  const url = URL.createObjectURL(pdfBlob(sheet));
  const a = document.createElement("a");
  a.href = url;
  a.download = sheet.fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * "Send to a print shop": the phone's share sheet with the PDF attached
 * (WhatsApp, email, the print shop's own app), else a plain download.
 * Returns what happened, so the screen can say it.
 */
export async function shareSheet(sheet: MadeSheet, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav && typeof nav.share === "function" && typeof File === "function") {
    const file = new File([pdfBlob(sheet)], sheet.fileName, { type: "application/pdf" });
    const data = { files: [file], title };
    const can = typeof nav.canShare === "function" ? nav.canShare(data) : false;
    if (can) {
      try {
        await nav.share(data);
        return "shared";
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
        /* fall back to a download */
      }
    }
  }
  downloadSheet(sheet);
  return "downloaded";
}

/** Tag problems a fresh print fixes. `wrong_dog` is not one: it needs a feeder's `checked_ok`. */
const REPRINT_FIXES = new Set(["damaged", "found_on_ground"]);

/**
 * After a sheet with this dog's tags is downloaded, shared or printed, close
 * the tag problems that a reprint fixes (F6 "Reprint tag" links here with
 * ?report=<id>). With a report id, that report is resolved as "reprinted",
 * unless GET /dogs/:slug/tags says it is a wrong_dog report; without one,
 * every open damaged or found_on_ground report is. Best effort, fire and
 * forget: it never blocks or fails the download.
 */
export function resolveReprinted(slug: string, reportId: string | null): Promise<void> {
  return (async () => {
    let open: { id: string; kind: string }[] | null = null;
    try {
      open = (await api.getDogTags(slug)).open;
    } catch {
      open = null; // not a feeder of this dog, or an older server
    }
    const ids = reportId
      ? open?.some((r) => r.id === reportId && r.kind === "wrong_dog")
        ? []
        : [reportId]
      : (open ?? []).filter((r) => REPRINT_FIXES.has(r.kind)).map((r) => r.id);
    await Promise.all(ids.map((id) => api.resolveTagReport(slug, id, "reprinted").catch(() => undefined)));
  })().catch(() => undefined);
}

/**
 * POST /dogs/:slug/prints for each dog on the sheet. Best effort: never
 * awaited by the download, never surfaced as an error.
 */
export function recordPrints(layout: SheetLayout, paper: Paper, dogs: SheetDog[], tagCount?: number): void {
  const slugs = dogs.map((d) => d.slug);
  markPrinted(slugs);
  for (const slug of slugs) {
    void api.recordPrint(slug, { layout, paper, tagCount: tagCount ?? tagCountFor(layout) }).catch(() => {});
  }
}
