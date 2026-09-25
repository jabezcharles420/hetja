/**
 * Photo storage backend. Dev default is a local directory (STORAGE_LOCAL_DIR);
 * production uses S3. Photo writes happen in the background of a scan POST:
 * they never block the API response (and never block on AI).
 *
 * Every byte that reaches a backend here has already been through
 * `lib/exif-strip.ts`: the container was validated by magic bytes and all
 * metadata segments were dropped. That is not an optimisation, it is the
 * control. See `decodePhotoUpload` below and the header comment in
 * exif-strip.ts for the failure it closes.
 */
import { mkdir, statfs, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  stripImageMetadata,
  UnsupportedImageError,
  type ImageExtension,
  type StrippedImage,
} from "./exif-strip.js";

export interface StorageConfig {
  STORAGE_BACKEND: "local" | "s3";
  STORAGE_LOCAL_DIR: string;
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
}

/**
 * The extension is a parameter, not a constant. It used to be a hardcoded
 * `.jpg`, which was wrong for most real uploads: `apps/web/lib/photo.ts`
 * `compressPhoto` asks the canvas for `image/webp` whenever the browser can
 * encode it, so essentially every Chrome/Android feeder produced WebP bytes
 * stored under a `.jpg` name. Any static server labels those
 * `Content-Type: image/jpeg`, and because helmet sets
 * `X-Content-Type-Options: nosniff` the browser refuses to sniff its way out:
 * the `<img>` simply fails to render. The caller passes the extension derived
 * from the sniffed magic bytes so the name can never disagree with the bytes.
 */
export function newPhotoKey(ext: ImageExtension): string {
  return `photos/${randomUUID()}.${ext}`;
}

function stripDataPrefix(base64: string): string {
  return base64.replace(/^data:[a-z0-9/+-]+;base64,/, "");
}

/**
 * Base64 alphabet check. `Buffer.from(s, "base64")` is deliberately lenient:
 * it silently discards anything outside the alphabet rather than failing, so
 * without this a payload of prose decodes to a short run of arbitrary bytes
 * instead of an error. The container sniff would reject that anyway; this just
 * makes the resulting 400 say the true reason.
 */
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode a client-supplied `photoBase64`, validate the container by magic
 * bytes, and strip every metadata segment. Throws `UnsupportedImageError` for
 * anything that is not a parseable JPEG/WebP/PNG. Callers must turn that into
 * a 400 rather than storing bytes we did not understand.
 *
 * This runs on the request path, not in the background writer, because
 * "rejected" has to mean rejected: a background failure can only be logged,
 * which is indistinguishable from a photo that quietly never arrived.
 */
export function decodePhotoUpload(photoBase64: string): StrippedImage {
  const body = stripDataPrefix(photoBase64).replace(/\s+/g, "");
  if (body.length === 0 || !BASE64_BODY.test(body)) {
    throw new UnsupportedImageError("photo is not valid base64");
  }
  return stripImageMetadata(Buffer.from(body, "base64"));
}

/**
 * Thrown by storePhoto when the photo volume is nearly full. Callers treat it
 * like any other failed background write (the scan stays, the photo does
 * not), but it is its own class so the log says WHY.
 */
export class StorageFullError extends Error {
  constructor(freeBytes: number) {
    super(`photo storage has ${freeBytes} bytes free, under the ${MIN_FREE_BYTES}-byte floor`);
    this.name = "StorageFullError";
  }
}

/**
 * Keep at least this much free on the photo volume (hardening batch 1, T6).
 * The box is a shared LXC whose disk also holds the other tenant's state and
 * Hetja's own logs; filling it to the last byte with photos would take down
 * things that matter more than one more portrait. 1 GiB is ~500 photos at the
 * 2 MiB ceiling of headroom for an operator to notice.
 */
export const MIN_FREE_BYTES = 1024 * 1024 * 1024;

/** statfs is cached this long: one syscall a minute, not one per photo. */
const FREE_SPACE_TTL_MS = 60_000;

type FreeSpaceProbe = (dir: string) => Promise<number>;

const defaultProbe: FreeSpaceProbe = async (dir) => {
  const st = await statfs(dir);
  return Number(st.bavail) * Number(st.bsize);
};

let probe: FreeSpaceProbe = defaultProbe;
let freeCache: { dir: string; free: number; at: number } | null = null;

/** Test seam: replace the free-space probe (null restores statfs) and drop the cache. */
export function setFreeSpaceProbeForTests(next: FreeSpaceProbe | null): void {
  probe = next ?? defaultProbe;
  freeCache = null;
}

/** Throws StorageFullError when `dir`'s volume is under MIN_FREE_BYTES free. */
export async function assertFreeSpace(dir: string, now: number = Date.now()): Promise<void> {
  if (!freeCache || freeCache.dir !== dir || now - freeCache.at > FREE_SPACE_TTL_MS) {
    await mkdir(dir, { recursive: true });
    freeCache = { dir, free: await probe(dir), at: now };
  }
  if (freeCache.free < MIN_FREE_BYTES) throw new StorageFullError(freeCache.free);
}

async function storeLocal(bytes: Buffer, key: string, dir: string): Promise<void> {
  const filePath = join(dir, key);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

/**
 * Write an already-stripped image and return the key it was stored under. The
 * key is minted here rather than by the caller so it always carries the
 * extension of the container that was actually detected.
 */
export async function storePhoto(image: StrippedImage, config: StorageConfig): Promise<string> {
  const key = newPhotoKey(image.ext);
  switch (config.STORAGE_BACKEND) {
    case "local":
      await assertFreeSpace(config.STORAGE_LOCAL_DIR);
      await storeLocal(image.bytes, key, config.STORAGE_LOCAL_DIR);
      return key;
    case "s3":
      // S3 PUT requires signed requests; wired in a production follow-up.
      // Unreachable through normal boots: loadConfig() refuses
      // STORAGE_BACKEND=s3 outright, because this throw used to land in
      // persistScanAssets' warn-and-continue catch after the route had
      // already answered {ok:true} (silent photo loss). Kept as defence in
      // depth for any caller that bypasses config.
      throw new Error("STORAGE_BACKEND=s3 is not implemented in this build");
    default:
      throw new Error(`unknown STORAGE_BACKEND: ${String(config.STORAGE_BACKEND)}`);
  }
}
