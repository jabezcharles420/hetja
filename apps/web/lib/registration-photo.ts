/**
 * The face photo taken on the New dog screen, held on this phone until the
 * collar is activated.
 *
 * POST /registrations has no photo field, and a dog's public photo is the
 * newest non-SOS scan photo (routes/dogs.ts). The registration is inert until
 * its activation scan (type "retag", routes/scans.ts), so that scan is where
 * the photo goes: ActivateClient attaches it as photoBase64 and then clears it.
 * Nothing is published before the dog is.
 *
 * Stored compressed (lib/photo.ts, EXIF stripped) and bounded to one entry
 * per slug. Every access is try/catch: private mode and full storage just
 * mean no photo, never a failed registration.
 */

const PREFIX = "hetja.regPhoto.";
/** ~1.5 MB of base64: comfortably above a compressed photo, below the quota. */
const MAX_CHARS = 1_500_000;

export function savePendingPhoto(slug: string, base64: string): boolean {
  if (!base64 || base64.length > MAX_CHARS) return false;
  try {
    localStorage.setItem(PREFIX + slug, base64);
    return true;
  } catch {
    return false;
  }
}

export function readPendingPhoto(slug: string): string | null {
  try {
    return localStorage.getItem(PREFIX + slug);
  } catch {
    return null;
  }
}

export function clearPendingPhoto(slug: string): void {
  try {
    localStorage.removeItem(PREFIX + slug);
  } catch {
    /* nothing to clear */
  }
}
