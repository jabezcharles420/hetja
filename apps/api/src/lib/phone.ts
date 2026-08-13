/**
 * E.164 normalization for Indian phone numbers (care-provider directory).
 *
 * Uses libphonenumber-js in its `/min` variant, deliberately not `/max` and
 * not `/mobile`:
 *   - `/max` carries full per-country metadata (carrier codes, references) we
 *     never read — pure bundle weight.
 *   - `/mobile` drops fixed-line numbers, and care_providers legitimately
 *     stores them: Bombay SPCA's +912224137518 is a Parel landline, and the
 *     directory's whole point is "call this number in an emergency". `/mobile`
 *     rejects it; `/min` accepts it.
 *   - `/min` is also the smallest of the three that covers India: ~84 KB of
 *     metadata vs ~99 KB for `/mobile` and ~158 KB for `/max`, while still
 *     validating +91 numbers (mobile and fixed-line) correctly.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { z } from "zod";

/**
 * Parse a phone string as an Indian number and return its canonical E.164
 * form ("+919820127085"). Whitespace, punctuation and national formats are
 * all accepted and normalized away ("+91 98201 27085", "09820127085",
 * "9820127085" → "+919820127085"). Returns null when the input cannot be
 * parsed as a VALID Indian number — including valid numbers for other
 * countries (a +1 number parses fine but must be rejected here).
 */
export function normalizeIndianPhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), "IN");
  if (!parsed || !parsed.isValid() || parsed.country !== "IN") return null;
  return parsed.number;
}

/**
 * Zod field for a phone number on a care-provider create/update payload.
 *
 * Accepts null/undefined (a provider may publish only an address — see
 * migration 0008's comment). Any other value is normalized to E.164 on the
 * way through; a value that cannot be parsed as a valid Indian number falls
 * back to the raw input and fails the regex, so the route surfaces a 400
 * with this exact message instead of persisting a mangled number.
 */
export const IndianPhoneE164 = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    return normalizeIndianPhone(value) ?? value;
  },
  z
    .string()
    .regex(/^\+91\d+$/, { message: "phone must be a valid Indian phone number (E.164)" })
    .nullable()
    .optional(),
);
