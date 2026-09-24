/**
 * Collar code helpers shared by CollarCode (display) and CollarCodeInput.
 *
 * The code is stored lowercase (`ddr017xk2`) and shown uppercase in three
 * groups of three (`DDR 017 XK2`) so it can be read over a bad phone line.
 * The input accepts exactly what the API's SLUG_REGEX (/^[a-km-z2-9]{9}$/)
 * accepts: no confusable `l`, `0`, `1`. The generator never emits `9`, but
 * the validator allows it (hand-minted legacy codes), so the input must too,
 * or such a collar could be scanned but never typed.
 */

export const COLLAR_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
export const COLLAR_LENGTH = 9;

/** Lowercases, drops anything outside the alphabet, caps at 9 characters. */
export function sanitizeCollarCode(raw: string): string {
  let out = "";
  for (const ch of raw.toLowerCase()) {
    if (COLLAR_ALPHABET.includes(ch)) out += ch;
    if (out.length === COLLAR_LENGTH) break;
  }
  return out;
}

/** "ddr017xk2" -> ["DDR", "017", "XK2"]. Works on partial codes too. */
export function collarGroups(code: string): string[] {
  const upper = code.replace(/\s+/g, "").toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < upper.length; i += 3) groups.push(upper.slice(i, i + 3));
  return groups;
}

const DIGIT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

/**
 * Spoken form for reading a code aloud: letters spelled, digits as words,
 * one group per triple. "ddr017xk2" -> "D D R · zero one seven · X K two".
 */
export function sayCollarCode(code: string): string {
  return collarGroups(code)
    .map((group) =>
      [...group]
        .map((ch) => (/[0-9]/.test(ch) ? DIGIT_WORDS[Number(ch)] : ch))
        .join(" "),
    )
    .join(" · ");
}
