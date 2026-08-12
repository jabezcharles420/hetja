/**
 * Collar code parser for the Hetja scan flow.
 *
 * A collar code is exactly 9 characters drawn from `[a-z2-7]`: letters
 * `a`–`z` plus digits `2`–`7`. The digits `0`, `1`, `8` and `9` are dropped
 * from the alphabet to avoid visual ambiguity (O/0, l/1, B/8, g/9) when a
 * code is stamped on a collar. Input is trimmed and lowercased before
 * validation, so a scan or paste like `" ABC234567 "` resolves to the slug
 * `abc234567`.
 */

const COLLAR_RE = /^[a-z2-7]{9}$/;

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
      error: "That code can only use letters a–z and digits 2–7.",
    };
  }

  return { ok: true, slug: code };
}
