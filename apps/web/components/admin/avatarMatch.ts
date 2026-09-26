/**
 * A3 file-name matching (adapted list: by dog ID or collar batch number
 * only; there is no photo matching, so everything else is "No match").
 *
 * The server does the real match (it knows which batch numbers exist); this
 * reads the same two shapes out of a file name so a tile can say what it is
 * waiting for while the upload runs, and so a folder drop can be filtered
 * to images before anything is sent.
 */

/** The API's SLUG_REGEX. */
const SLUG = /^[a-km-z2-9]{9}$/;
/** Collar batch numbers as printed: "HJ-0412", "P2-0007". */
const BATCH_NO = /^[a-z][a-z0-9]{0,3}-\d{2,6}$/i;

const IMAGE_EXT = /\.(png|jpe?g|webp|heic|heif)$/i;

export type FileKey = { kind: "slug"; value: string } | { kind: "batch_no"; value: string } | { kind: "none" };

/** "r4n7kw2ab.png" is a slug, "HJ-0412.png" a batch number, "IMG_2231.png" nothing. */
export function fileKey(fileName: string): FileKey {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();
  // Tolerate the copies a folder picks up: "HJ-0412 (1)", "r4n7kw2ab copy".
  const clean = base.replace(/\s*\(\d+\)$/, "").replace(/\s+copy$/i, "");
  const lower = clean.toLowerCase();
  if (SLUG.test(lower)) return { kind: "slug", value: lower };
  if (BATCH_NO.test(clean)) return { kind: "batch_no", value: clean.toUpperCase() };
  return { kind: "none" };
}

export function isImageFile(file: { name: string; type?: string }): boolean {
  return (file.type ? file.type.startsWith("image/") : false) || IMAGE_EXT.test(file.name);
}

interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: EntryLike[]) => void, err: (e: unknown) => void) => void };
}

async function walk(entry: EntryLike, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const f = await new Promise<File>((ok, err) => entry.file!(ok, err));
    out.push(f);
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns at most 100 at a time: keep reading until empty.
    for (;;) {
      const batch = await new Promise<EntryLike[]>((ok, err) => reader.readEntries(ok, err));
      if (!batch.length) break;
      for (const e of batch) await walk(e, out);
    }
  }
}

/** Every image in a drop, folders included (Chrome, Edge, Safari, Firefox). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) => (it.webkitGetAsEntry?.() ?? null) as unknown as EntryLike | null)
    .filter((e): e is EntryLike => !!e);
  if (entries.length) {
    for (const e of entries) await walk(e, out);
  } else {
    out.push(...Array.from(dt.files ?? []));
  }
  return out.filter(isImageFile).sort((a, b) => a.name.localeCompare(b.name));
}
