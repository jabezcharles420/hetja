/**
 * Server-side image metadata stripper (JPEG / WebP / PNG).
 *
 * WHY THIS EXISTS. `apps/web/lib/photo.ts` re-encodes every feeder photo
 * through a fresh canvas with `retainExif: false`, deliberately sets
 * `strict: false` so compressorjs can never fall back to handing the original
 * file back, and then re-reads the compressed output with exifr and refuses to
 * upload if any GPS or orientation survived. That is careful work and it
 * stays. It is also, on its own, not a control: it runs in the browser.
 * `POST /api/v1/scans` accepts `photoBase64` from anyone holding a device
 * token, and before this module existed those bytes were written to disk
 * verbatim (`storage.ts` did `writeFile(path, Buffer.from(base64,
 * "base64"))`), the key landed in `scans.photo_s3_key`, and
 * `GET /api/v1/dogs/:slug` handed it to `dogPhotoUrl()` to render publicly.
 * An unmodified iPhone JPEG carries `GPSLatitude`/`GPSLongitude`, so that path
 * published the feeder's exact feeding spot — the precise thing INVARIANT 2
 * exists to prevent: "a precise last-seen point for a dog a feeder cares for
 * is also, functionally, a precise location for that feeder."
 *
 * WHY NOT sharp (or any other native image library). A full re-encode is the
 * obvious way to guarantee no metadata survives, and it is the wrong trade
 * here. `sharp` pulls in libvips: a large native dependency and a large
 * resident-memory cost on a 2 GB box that also runs the PostgreSQL cluster
 * serving `dogs`, `scans` and `sos_cases`. It is also unnecessary. Metadata in
 * all three containers we accept lives in clearly delimited structures that
 * can be dropped without touching a single byte of compressed pixel data:
 * JPEG marker segments, RIFF chunks, PNG chunks. This module walks the
 * container and copies through only the structural and entropy-coded parts.
 * The pixels come out byte-identical; only metadata is removed.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not decode the image, so it cannot
 * promise the result renders — a file that is structurally a valid JPEG whose
 * scan data is garbage goes through unchanged. The property we need is "no
 * metadata, in a container we fully understand", not "provably renderable".
 * The corollary is the important half: anything that does not parse as one of
 * the three supported containers is REJECTED rather than stored, which also
 * closes the older hole of arbitrary attacker-chosen bytes being stored and
 * served under an image extension.
 *
 * It also does not preserve EXIF `Orientation`. Dropping APP1 drops rotation
 * along with GPS, so a raw upload that bypassed the browser pipeline may
 * render unrotated. That is the correct trade: the client bakes rotation into
 * the pixels (`checkOrientation: true`) precisely so the header is disposable,
 * and `assertExifFree` already treats a surviving `orientation > 1` as a
 * failure. A rotated photo is a cosmetic defect; a published GPS fix is not.
 */

export type ImageFormat = "jpeg" | "webp" | "png";

/** File extension for the storage key, derived from the detected container. */
export type ImageExtension = "jpg" | "webp" | "png";

export interface StrippedImage {
  format: ImageFormat;
  /**
   * The extension the storage key must use. `newPhotoKey()` used to hardcode
   * `.jpg` while the browser pipeline emits WebP for every browser that can
   * encode it (i.e. essentially every Chrome/Android feeder), so a static
   * server labelled those bytes `Content-Type: image/jpeg` and helmet's
   * `X-Content-Type-Options: nosniff` then stopped the `<img>` from rendering
   * at all. Deriving it from the sniffed magic bytes is the only way that
   * cannot drift from what was actually uploaded.
   */
  ext: ImageExtension;
  /** The metadata-free bytes to store. */
  bytes: Buffer;
}

/**
 * Thrown for anything we will not store: a container we cannot parse, a
 * truncated or self-contradictory one, or one outside the size bounds. The
 * caller turns this into a 400 — never into a silently dropped photo.
 */
export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

/**
 * Decoded-byte ceiling. `@hetja/contracts`' `MAX_PHOTO_BASE64_CHARS` already
 * caps the base64 *string* at the equivalent of 2 MiB, but that check lives in
 * a different package and applies to a different unit, so it cannot be relied
 * on to bound what reaches the parsers below. This is the bound that matters:
 * every loop here is linear in it.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Smaller than the shortest possible RIFF header — nothing valid fits. */
const MIN_IMAGE_BYTES = 16;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const EXTENSIONS: Record<ImageFormat, ImageExtension> = {
  jpeg: "jpg",
  webp: "webp",
  png: "png",
};

/**
 * Container detection by magic bytes only. Never by the client-supplied MIME
 * type or filename: both are attacker-chosen strings, and the whole point of
 * this module is that the client is not trusted.
 */
export function detectImageFormat(bytes: Buffer): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_SOS = 0xda;
const JPEG_COM = 0xfe;
const JPEG_APP0 = 0xe0;
const JPEG_APP1 = 0xe1;
const JPEG_APPF = 0xef;

/**
 * TEM (0x01) and RST0..RST7 (0xd0..0xd7) are the only markers besides SOI/EOI
 * that carry no length field. Treating one of them as a length-bearing segment
 * would read two bytes of unrelated data as a segment length and desynchronise
 * the whole walk.
 */
function isJpegStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * SOF0..SOF15 — the frame headers that describe the image itself. The three
 * gaps (0xc4 DHT, 0xc8 JPG, 0xcc DAC) share the 0xcN range but are not frame
 * headers, so they must not count as "this file contains an image".
 */
function isJpegFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * A JFIF/JFXX APP0 is pixel density plus an optional thumbnail: no camera
 * model, no timestamp, no GPS. Some decoders expect it, so it is kept. Any
 * other APP0 is a vendor block we do not understand, and an unparsed block is
 * exactly what this module exists to refuse to store — so it is dropped.
 */
function isBenignJfifApp0(payload: Buffer): boolean {
  // The identifier is NUL-terminated: "JFIF" or "JFXX" followed by 0x00.
  // Compared as bytes so this source file carries no raw NUL byte of its own.
  if (payload.length < 5 || payload[4] !== 0x00) return false;
  const id = payload.toString("latin1", 0, 4);
  return id === "JFIF" || id === "JFXX";
}

function stripJpeg(bytes: Buffer): Buffer {
  const out: Buffer[] = [Buffer.from([0xff, JPEG_SOI])];
  let i = 2;
  let sawFrameHeader = false;
  let sawScan = false;

  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      throw new UnsupportedImageError("JPEG: expected a marker");
    }
    // A marker may be preceded by any number of 0xFF fill bytes. Those are
    // optional padding, so they are skipped rather than copied.
    let markerAt = i;
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt++;
    if (markerAt >= bytes.length) {
      throw new UnsupportedImageError("JPEG: file ends inside a marker");
    }
    const marker = bytes[markerAt];
    i = markerAt + 1;

    if (marker === 0x00) {
      // 0xFF00 is the in-scan escape for a literal 0xFF; reaching it here
      // means the walk has desynchronised and every offset after this point
      // is meaningless.
      throw new UnsupportedImageError("JPEG: stray 0xFF00 outside scan data");
    }
    if (marker === JPEG_EOI) {
      out.push(Buffer.from([0xff, JPEG_EOI]));
      // Stop copying at EOI. Anything appended past it (some tools park
      // metadata there) is not part of the image and is not stored.
      break;
    }
    if (marker === JPEG_SOI) continue;
    if (isJpegStandaloneMarker(marker)) continue;

    if (i + 2 > bytes.length) {
      throw new UnsupportedImageError("JPEG: file ends inside a segment length");
    }
    const length = bytes.readUInt16BE(i);
    // The length field includes its own two bytes, so anything below 2 is a
    // negative payload.
    if (length < 2) {
      throw new UnsupportedImageError("JPEG: invalid segment length");
    }
    const segmentEnd = i + length;
    if (segmentEnd > bytes.length) {
      throw new UnsupportedImageError("JPEG: segment runs past the end of the file");
    }
    const payload = bytes.subarray(i + 2, segmentEnd);

    // APP1 is Exif *and* XMP — both go. APP2..APPF are ICC, Photoshop IRB,
    // Ducky, vendor maker-notes: all dropped. COM is a free-text comment.
    const drop =
      marker === JPEG_COM ||
      (marker >= JPEG_APP1 && marker <= JPEG_APPF) ||
      (marker === JPEG_APP0 && !isBenignJfifApp0(payload));

    if (!drop) {
      // markerAt - 1 is the 0xFF immediately before the marker byte, so this
      // copies the segment exactly as it appeared: FF, marker, length, payload.
      out.push(bytes.subarray(markerAt - 1, segmentEnd));
    }
    if (isJpegFrameHeader(marker)) sawFrameHeader = true;
    i = segmentEnd;

    if (marker === JPEG_SOS) {
      sawScan = true;
      // Entropy-coded data follows the SOS header with no length field, so its
      // end has to be found by scanning. Inside the scan a literal 0xFF is
      // escaped as 0xFF00, and RST0..RST7 are legal in-band restart markers;
      // neither terminates it. Anything else does — which in a progressive
      // JPEG is another DHT/SOS, and otherwise EOI.
      let end = i;
      let foundMarker = false;
      while (end + 1 < bytes.length) {
        if (bytes[end] === 0xff) {
          const next = bytes[end + 1];
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) {
            foundMarker = true;
            break;
          }
        }
        end++;
      }
      // No following marker at all: the scan runs to EOF. That is a truncated
      // file, but the pixel data present is still what the uploader sent, and
      // the sawFrameHeader/sawScan check below is what decides whether we
      // store it.
      if (!foundMarker) end = bytes.length;
      out.push(bytes.subarray(i, end));
      i = end;
    }
  }

  if (!sawFrameHeader || !sawScan) {
    throw new UnsupportedImageError("JPEG: no frame header or no scan data");
  }
  return Buffer.concat(out);
}

// ---------------------------------------------------------------------------
// WebP (RIFF)
// ---------------------------------------------------------------------------

const RIFF_HEADER_BYTES = 12;

/** The three RIFF chunks that carry metadata. Everything else is image data. */
const WEBP_METADATA_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);

/**
 * VP8X flag bits in the first byte of its payload: ICC 0x20, Alpha 0x10,
 * EXIF 0x08, XMP 0x04, Animation 0x02. Dropping the ICCP/EXIF/XMP chunks
 * without clearing the matching bits leaves a VP8X that advertises chunks the
 * file no longer contains, which strict decoders report as a malformed file —
 * i.e. exactly the "the stripper broke the photo" outcome that would be worse
 * than the bug being fixed.
 */
const VP8X_DROPPED_FLAGS = 0x20 | 0x08 | 0x04;

function stripWebp(bytes: Buffer): Buffer {
  const declared = bytes.readUInt32LE(4);
  // RIFF's size field covers everything after the first 8 bytes. Take the
  // smaller of the declared and the real extent: a file shorter than its
  // declared size is truncated, and bytes past the declared size are not part
  // of the container and are not stored.
  const end = Math.min(bytes.length, 8 + declared);
  if (end < RIFF_HEADER_BYTES) {
    throw new UnsupportedImageError("WebP: RIFF size is shorter than the header");
  }

  const kept: Buffer[] = [];
  let sawImageData = false;
  let i = RIFF_HEADER_BYTES;

  while (i + 8 <= end) {
    const fourcc = bytes.toString("latin1", i, i + 4);
    const size = bytes.readUInt32LE(i + 4);
    if (size > end - (i + 8)) {
      throw new UnsupportedImageError(`WebP: chunk ${JSON.stringify(fourcc)} runs past the end of the RIFF`);
    }
    const payloadEnd = i + 8 + size;

    if (!WEBP_METADATA_CHUNKS.has(fourcc)) {
      if (fourcc === "VP8 " || fourcc === "VP8L" || fourcc === "ANMF") sawImageData = true;
      const header = Buffer.from(bytes.subarray(i, i + 8));
      const payload = Buffer.from(bytes.subarray(i + 8, payloadEnd));
      if (fourcc === "VP8X" && payload.length >= 1) {
        payload[0] &= ~VP8X_DROPPED_FLAGS;
      }
      kept.push(header, payload);
      // RIFF chunks are 2-byte aligned. The pad byte is regenerated rather
      // than copied so the output is correctly aligned even when the input's
      // final pad byte was missing.
      if (size % 2 === 1) kept.push(Buffer.from([0x00]));
    }

    i = payloadEnd + (size % 2);
  }

  if (!sawImageData) {
    throw new UnsupportedImageError("WebP: no VP8/VP8L/ANMF image data");
  }

  const body = Buffer.concat(kept);
  const out = Buffer.alloc(RIFF_HEADER_BYTES + body.length);
  out.write("RIFF", 0, "latin1");
  // The RIFF size field must be fixed up after dropping chunks, or every
  // decoder reads past the real end of the file. It counts the "WEBP" fourcc
  // plus every chunk that survived.
  out.writeUInt32LE(4 + body.length, 4);
  out.write("WEBP", 8, "latin1");
  body.copy(out, RIFF_HEADER_BYTES);
  return out;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/**
 * `eXIf` is a literal EXIF block (GPS included). `tEXt`/`iTXt`/`zTXt` are
 * free-text keyword/value pairs, which is where exporters park camera and
 * location strings. Every kept chunk is copied verbatim, and a PNG CRC covers
 * only its own chunk type and data, so the surviving CRCs stay valid without
 * being recomputed.
 */
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "iTXt", "zTXt"]);

function stripPng(bytes: Buffer): Buffer {
  const out: Buffer[] = [Buffer.from(PNG_SIGNATURE)];
  let i = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;

  // length(4) + type(4) + data + crc(4) = 12 bytes of overhead per chunk.
  while (i + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(i);
    // PNG caps chunk length at 2^31-1; a larger value is either corruption or
    // an attempt to make the offset arithmetic below overflow.
    if (size > 0x7fffffff) {
      throw new UnsupportedImageError("PNG: chunk length out of range");
    }
    const type = bytes.toString("latin1", i + 4, i + 8);
    const chunkEnd = i + 12 + size;
    if (chunkEnd > bytes.length) {
      throw new UnsupportedImageError(`PNG: chunk ${JSON.stringify(type)} runs past the end of the file`);
    }
    if (type === "IHDR") sawIhdr = true;
    if (type === "IDAT") sawIdat = true;
    if (!PNG_METADATA_CHUNKS.has(type)) out.push(bytes.subarray(i, chunkEnd));
    i = chunkEnd;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!sawIhdr || !sawIdat || !sawIend) {
    throw new UnsupportedImageError("PNG: missing IHDR, IDAT or IEND");
  }
  return Buffer.concat(out);
}

// ---------------------------------------------------------------------------

/**
 * Validate the container by magic bytes and return metadata-free bytes plus
 * the extension the storage key must use. Throws `UnsupportedImageError` for
 * anything we will not store.
 */
export function stripImageMetadata(bytes: Buffer): StrippedImage {
  if (bytes.length < MIN_IMAGE_BYTES) {
    throw new UnsupportedImageError("image is too small to be a JPEG, WebP or PNG");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new UnsupportedImageError(`image exceeds the ${MAX_IMAGE_BYTES}-byte limit`);
  }

  const format = detectImageFormat(bytes);
  if (!format) {
    throw new UnsupportedImageError("unrecognised container (expected JPEG, WebP or PNG magic bytes)");
  }

  const stripped =
    format === "jpeg" ? stripJpeg(bytes) : format === "webp" ? stripWebp(bytes) : stripPng(bytes);

  return { format, ext: EXTENSIONS[format], bytes: stripped };
}
