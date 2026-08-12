// Slug alphabet per the generator in packages/db/src/slugs.ts:
// "abcdefghijkmnopqrstuvwxyz23456789" — a-z without the confusable `l`, digits
// 2-9. This file previously used /^[a-z2-7]{9}$/, which meant a collar URL
// containing an 8 never parsed at all: scanning the real Phase-0 tag
// /d/c3di5esh8 rendered "Unrecognized code" and the page could not identify the
// dog, on the one surface a stranger reaches by scanning a QR code.
const SLUG_RE = /^[a-km-z2-9]{9}$/;
const PATH_RE = /^\/d\/([a-km-z2-9]{9})\/?/;

export function parseSlug(pathname: string): string {
  const m = PATH_RE.exec(pathname);
  return m ? m[1] ?? "" : "";
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}
