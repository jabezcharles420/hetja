/**
 * Collar code parser for the Hetja scan flow.
 *
 * A collar code is exactly 9 characters drawn from the same alphabet the slug
 * generator uses (`ALPHABET` in packages/db/src/slugs.ts):
 *
 *   abcdefghijkmnopqrstuvwxyz23456789
 *
 * Only `l`, `0` and `1` are absent. Despite the generator's comment claiming
 * "no l/1/o/0", `o` IS in that string and is emitted. Digits `8`/`9` are not
 * excluded either, so the shape is `/^[a-km-z2-9]{9}$/`, matching isValidSlug()
 * in packages/db/src/slugs.ts.
 *
 * (Trivia worth knowing: that string is 33 characters, but toBase32 masks with
 * `& 31` and the check digit is `% 32`, so index 32 — `9` — is unreachable.
 * Empirically the generator emits exactly `2345678abcdefghijkmnopqrstuvwxyz`.
 * `9` is accepted here anyway, so fixing that off-by-one later needs no change
 * on this side.)
 *
 * This regex previously read `/^[a-z2-7]{9}$/`, which disagreed with the
 * generator in both directions: it accepted `l` (never generated) and rejected
 * `8` (emitted about 1 character in 32, so roughly a quarter of all 9-character
 * slugs contain one). Real collar codes were refused at the keypad — including
 * the Phase-0 seed dog Rosie, whose collar reads `c3di5esh8`.
 *
 * Input is trimmed and lowercased before validation, so a scan or paste like
 * `" C3DI5ESH8 "` resolves to the slug `c3di5esh8`.
 */

const COLLAR_RE = /^[a-km-z2-9]{9}$/;

export interface CollarCodeOk {
  ok: true;
  slug: string;
}

export interface CollarCodeError {
  ok: false;
  error: string;
}

export type CollarCodeResult = CollarCodeOk | CollarCodeError;

export function parseCollarCode(input: string): CollarCodeResult {
  const code = input.trim().toLowerCase();

  if (code.length !== 9) {
    return {
      ok: false,
      error: "That code looks incomplete — it should be 9 characters",
    };
  }

  if (!COLLAR_RE.test(code)) {
    return {
      ok: false,
      error: "That code can only use letters a–z except l, and digits 2–9.",
    };
  }

  return { ok: true, slug: code };
}
