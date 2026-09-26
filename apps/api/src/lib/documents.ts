/**
 * Private documents (design v7, owner decision "Documents stay private"):
 * vets' registration certificates and photo IDs, NGOs' registration
 * certificates.
 *
 *   - Validated by magic bytes, not by the declared type: PDF ("%PDF-") up to
 *     5 MiB; JPEG, PNG or WebP through the same decoder every photo goes
 *     through (lib/exif-strip.ts via decodePhotoUpload), which caps images at
 *     2 MiB and strips every metadata segment, GPS included.
 *   - Encrypted at rest with AES-256-GCM under HETJA_DOCS_KEY. File layout:
 *     "HJD1" | 12-byte IV | 16-byte tag | ciphertext, with the document id
 *     as additional authenticated data, so a blob moved onto another
 *     document's row fails to decrypt instead of showing the wrong person's ID.
 *   - Written under DOCS_LOCAL_DIR (0700 directory, 0600 files), which is
 *     never the photos directory Caddy serves.
 *   - Streamed only to admins (routes/admin.ts, every open audited) and
 *     deleted 30 days after the application is decided (worker job
 *     `sweep_v7`, apps/worker/src/index.ts). The same store holds a signed
 *     record's vaccine-sticker photo and a sign request's clinic slip
 *     (routes/v7-public.ts; also 30 days, see docs/INVARIANTS.md v7).
 *     No file name is stored: a name can carry a person's name.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decodePhotoUpload } from "./storage.js";
import { UnsupportedImageError } from "./exif-strip.js";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
/** Base64 of 5 MiB plus room for the JSON envelope: the POST /documents body limit. */
export const DOCUMENT_ROUTE_BODY_LIMIT = Math.ceil(MAX_PDF_BYTES / 3) * 4 + 64 * 1024;

export type DocumentMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export class DocumentRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentRejectedError";
  }
}

export class DocumentsUnavailableError extends Error {
  constructor() {
    super("documents are not configured (HETJA_DOCS_KEY)");
    this.name = "DocumentsUnavailableError";
  }
}

interface DocsConfig {
  HETJA_DOCS_KEY: string;
  DOCS_LOCAL_DIR: string;
}

export function docsKey(cfg: DocsConfig): Buffer {
  if (!cfg.HETJA_DOCS_KEY) throw new DocumentsUnavailableError();
  const key = Buffer.from(cfg.HETJA_DOCS_KEY, "base64");
  if (key.length !== 32) throw new DocumentsUnavailableError();
  return key;
}

const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The uploaded file, checked. Returns the bytes that will be stored (images
 * re-encoded without metadata) and the type they really are.
 */
export function decodeDocument(base64: string): { bytes: Buffer; mime: DocumentMime } {
  const body = base64.replace(/^data:[a-z0-9/+.-]+;base64,/i, "").replace(/\s+/g, "");
  if (!body || !BASE64_BODY.test(body)) throw new DocumentRejectedError("file is not valid base64");
  const head = Buffer.from(body.slice(0, 16), "base64");
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") {
    const bytes = Buffer.from(body, "base64");
    if (bytes.length > MAX_PDF_BYTES) throw new DocumentRejectedError(`a PDF may be at most ${MAX_PDF_BYTES} bytes`);
    return { bytes, mime: "application/pdf" };
  }
  try {
    const img = decodePhotoUpload(body);
    const mime: DocumentMime = img.ext === "png" ? "image/png" : img.ext === "webp" ? "image/webp" : "image/jpeg";
    return { bytes: img.bytes, mime };
  } catch (err) {
    if (err instanceof UnsupportedImageError) {
      throw new DocumentRejectedError(`only PDF, JPEG, PNG or WebP files are accepted (${err.message})`);
    }
    throw err;
  }
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const MAGIC = Buffer.from("HJD1", "latin1");

export function encryptDocument(key: Buffer, documentId: string, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(documentId, "utf8"));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
}

export function decryptDocument(key: Buffer, documentId: string, blob: Buffer): Buffer {
  if (blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error("not a Hetja document blob");
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(documentId, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]);
}

/** Storage keys are minted here, never supplied by a caller. */
export function documentKey(documentId: string): string {
  return `documents/${documentId}.bin`;
}

const KEY_RE = /^documents\/[0-9a-f-]{36}\.bin$/;

function pathFor(cfg: DocsConfig, key: string): string {
  if (!KEY_RE.test(key)) throw new Error("unexpected document key");
  return join(cfg.DOCS_LOCAL_DIR, key);
}

export async function writeDocument(cfg: DocsConfig, documentId: string, plain: Buffer): Promise<string> {
  const key = documentKey(documentId);
  const blob = encryptDocument(docsKey(cfg), documentId, plain);
  const p = pathFor(cfg, key);
  await mkdir(dirname(p), { recursive: true, mode: 0o700 });
  await writeFile(p, blob, { mode: 0o600 });
  return key;
}

export async function readDocument(cfg: DocsConfig, documentId: string, key: string): Promise<Buffer> {
  return decryptDocument(docsKey(cfg), documentId, await readFile(pathFor(cfg, key)));
}

export async function removeDocumentFile(cfg: Pick<DocsConfig, "DOCS_LOCAL_DIR">, key: string): Promise<void> {
  try {
    await unlink(pathFor(cfg as DocsConfig, key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}
