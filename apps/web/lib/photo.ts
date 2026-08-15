/**
 * Feeder photo pipeline (enhancement stack §K.3/§K.4).
 *
 * When a feeder picks a photo, three things happen before a single byte
 * leaves the browser:
 *
 *   1. READ — exifr extracts orientation + GPS from the original file.
 *   2. COARSEN — photo GPS is a *silent* data channel: the capture may have
 *      been taken somewhere other than where the feeder is standing, so it
 *      is truncated to ward (≤2 decimals) via @hetja/contracts'
 *      `coarsenToWard`. The feeder's own device location is a separate,
 *      consented channel (captureGeo, browser prompt) and stays precise.
 *      The two are NOT interchangeable and the coarse one is not the
 *      preferred one: `FeedButton` takes the consented fix when there is one
 *      and only falls back to this value when there is not, because what the
 *      scan route stores becomes the centre of the SOS responder fan-out.
 *      See the precedence comment in components/FeedButton.tsx.
 *   3. COMPRESS + STRIP — compressorjs re-encodes through a fresh <canvas>.
 *      `retainExif: false` means the output carries no EXIF/GPS at all.
 *      Verified against the library source: the ONLY code path that
 *      re-inserts EXIF (src/index.js) is guarded by `options.retainExif`,
 *      and `strict: false` guarantees we never fall back to the original
 *      file. We additionally re-read the compressed output with exifr and
 *      refuse to upload if any GPS or orientation survived.
 *
 * This is the first line of defence, not the only one: it runs in the browser,
 * so it protects an honest client and nothing else. `apps/api/src/lib/exif-strip.ts`
 * re-does the strip server-side on bytes as they arrive and rejects anything it
 * cannot parse as a JPEG/WebP/PNG, which is the half an attacker is subject to.
 */
import { coarsenToWard } from "@hetja/contracts";

export interface PreparedPhoto {
  blob: Blob;
  /** Ward-level (≤2 decimal) sighting coordinates from the photo's EXIF GPS. */
  geo?: { lat: number; lng: number };
}

const WEBP_MIME = "image/webp";
const JPEG_MIME = "image/jpeg";
const MAX_DIMENSION = 1600;

let webpSupport: boolean | null = null;

/** Cached feature probe — `canvas.toBlob` falls back to PNG for unsupported
 *  mime types, which would silently blow the size target, so we only ask for
 *  WebP when the browser can actually encode it. */
export function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL(WEBP_MIME).startsWith(`data:${WEBP_MIME}`);
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/** Extract ward-coarsened GPS from a photo's EXIF, if it has any. Never
 *  throws: unreadable images and EXIF-free captures simply yield `undefined`,
 *  and the caller falls back to consented device geolocation. */
export async function extractExifGeo(file: File): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const exifr = await import("exifr");
    const gps = await exifr.gps(file);
    if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
      return coarsenToWard(gps.latitude, gps.longitude);
    }
  } catch {
    /* not an image we can read, or no GPS block — nothing to coarsen */
  }
  return undefined;
}

/** Re-encode the image through a fresh canvas: auto-oriented, EXIF-stripped
 *  (`retainExif: false`), WebP when supported else JPEG, quality 0.8, capped
 *  at 1600px. `strict: false` is deliberate — the "return the original"
 *  escape hatch would hand back a file that still carries EXIF. */
export function compressPhoto(file: File): Promise<Blob> {
  const mimeType = supportsWebp() ? WEBP_MIME : JPEG_MIME;
  return new Promise((resolve, reject) => {
    import("compressorjs")
      .then(({ default: Compressor }) => {
        // eslint-disable-next-line no-new
        new Compressor(file, {
          quality: 0.8,
          maxWidth: MAX_DIMENSION,
          maxHeight: MAX_DIMENSION,
          checkOrientation: true,
          retainExif: false,
          mimeType,
          strict: false,
          success: (result) => resolve(result),
          error: (err) => reject(err),
        });
      })
      // Without this the executor could finish having called NEITHER resolve nor
      // reject, and a promise that never settles never rejects — it just hangs.
      // `compressorjs` is a dynamic import, so on a flaky connection where the
      // chunk is not already cached this fails with a ChunkLoadError, which is
      // exactly the network the feeder is on. `prepareFeedPhoto`'s Promise.all
      // hung with it, so FeedButton's `finally { setBusy(false) }` never ran and
      // the primary action stayed stuck on "Logging…" until a full page reload,
      // losing the photo and the feed. The `void` in front of the import chain
      // was also swallowing the rejection into an unhandled promise.
      .catch(reject);
  });
}

/** Defense in depth: re-read the compressed output and refuse to ship it if
 *  any GPS or a meaningful orientation survived. exifr only touches the
 *  header segments, so this is a cheap check against an ~800 KB blob. */
export async function assertExifFree(blob: Blob): Promise<void> {
  try {
    const exifr = await import("exifr");
    const [gps, orientation] = await Promise.all([
      exifr.gps(blob).catch(() => undefined),
      exifr.orientation(blob).catch(() => undefined),
    ]);
    if (gps || (typeof orientation === "number" && orientation > 1)) {
      throw new Error("compressed photo still carries EXIF metadata");
    }
  } catch (err) {
    if (err instanceof Error && err.message === "compressed photo still carries EXIF metadata") {
      throw err;
    }
    /* unreadable output (e.g. an opaque format) — the compressorjs strip is
     * the primary defense and already ran; do not fail the upload on it. */
  }
}

export async function prepareFeedPhoto(file: File): Promise<PreparedPhoto> {
  const [geo, blob] = await Promise.all([extractExifGeo(file), compressPhoto(file)]);
  await assertExifFree(blob);
  return { blob, geo };
}
