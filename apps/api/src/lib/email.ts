/**
 * Email-address canonicalisation and signup eligibility for the identity
 * channel.
 *
 * WHY THIS EXISTS. Signup and login are the same call (`upsertFeeder` on
 * `identity_hmac`), and `identity_hmac = HMAC(pepper, email)` hashes the
 * address exactly as typed. One real Gmail mailbox therefore surfaced as
 * several candidate Hetja accounts: `john@gmail.com`, `j.o.h.n@gmail.com` and
 * `john+7@gmail.com` all deliver to the same inbox, but hash to three
 * different HMACs — three accounts, three OTPs, three sets of feeds. Gmail
 * itself ignores every dot in the local part and everything from `+` onward,
 * so those renderings ARE one mailbox, and Hetja must treat them as one
 * account. The fix is to canonicalise BEFORE hashing, so one Gmail account is
 * one identity_hmac.
 *
 * THE RULE IS DELIBERATELY PROVIDER-SPECIFIC. Dots in the local part are
 * significant at most non-Gmail providers — `jane.doe@yahoo.com` and
 * `janedoe@yahoo.com` are two different people's mailboxes there — so
 * stripping dots (or dropping +suffixes) for every domain would silently
 * merge accounts that really are distinct, which is worse than never
 * merging. Only the provider that actually ignores these characters gets the
 * aggressive rule; everything else is lowercased only (case is ignored by
 * every mail system in practice). googlemail.com is the same service as
 * gmail.com and is folded onto it.
 *
 * ELIGIBILITY. New signups are restricted to a single mail provider family —
 * an operator decision, recorded here because nowhere user-facing says it:
 * no API message, no web copy, no privacy-page line may name a provider, a
 * domain or a policy. A refused address gets 400 ADDRESS_NOT_ELIGIBLE with
 * "We can't sign in that address right now." The restriction is honest about
 * what it is: an anti-abuse boundary chosen because the provider's aliasing
 * makes one-account-per-human enforceable there, not a claim that other
 * addresses are less real.
 *
 * THE RESTRICTION IS ENFORCED IN PRODUCTION ONLY, by explicit decision, and
 * callers say so per request (`enforceNewSignupDomain`). This mirrors how the
 * rest of auth already branches (the OTP mailer only sends in production;
 * devCode is only echoed outside it): the policy exists to bound abuse of the
 * PUBLIC self-signup surface, which is production. Development and the test
 * suite create new accounts at arbitrary addresses constantly — every fixture
 * in routes/auth.test.ts does — and an unconditional gate would have made
 * local development and CI unable to log in at all. Grandfathering is NOT
 * gated: an existing account signs in regardless of environment, because
 * that path never creates anything.
 *
 * THE LEAK THIS ACCEPTS, STATED PLAINLY: grandfathering by existence means
 * eligibility is checked ONLY when no account row exists, so for addresses
 * outside the eligible family, POST /auth/otp answers 200 for a registered
 * address and 400 ADDRESS_NOT_ELIGIBLE for an unregistered one — an account-
 * existence oracle for those domains. That is unavoidable while existing
 * users keep signing in regardless of their address's domain (revoking them
 * would lock real feeders out of their dogs' histories), and it is bounded:
 * it says nothing about addresses on the eligible family, where all new
 * accounts live and where both registered and unregistered requests get the
 * same 200-with-OTP answer. Inside the eligible family the endpoint is
 * existence-blind.
 */
import { query } from "@hetja/db";
import { identityHmac } from "./hmac.js";

/** The one provider family new signups may use. Never named in any
 * user-facing string — see the module header. Both spellings deliver
 * identically; canonical form always uses the shorter. */
const ELIGIBLE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Canonical form of an email address: lowercased; for the eligible provider
 * family, dots removed from the local part, any `+tag` suffix dropped, and
 * googlemail.com folded onto gmail.com. Everything else keeps its local part
 * verbatim (lowercased), because another provider may distinguish those
 * mailboxes.
 *
 * Input is expected to have passed the contracts EmailAddress schema; this
 * function defends only against surprises (trailing spaces, a stray second
 * `@`) rather than re-validating.
 */
export function canonicalEmailAddress(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf("@");
  if (at <= 0 || at === lowered.length - 1) return lowered;
  const local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);
  if (!ELIGIBLE_DOMAINS.has(domain)) return lowered;

  // Drop the +tag before stripping dots: characters after `+` are irrelevant,
  // so this order also avoids wasting work dot-stripping a discarded tag.
  const base = local.includes("+") ? local.slice(0, local.indexOf("+")) : local;
  const stripped = base.replaceAll(".", "");
  // An address whose local part is empty after stripping cannot occur through
  // the validated path; if hand-fed, fall back to the lowercased input rather
  // than hashing an empty local part into a phantom identity.
  return stripped === "" ? lowered : `${stripped}@gmail.com`;
}

/**
 * Whether a genuinely NEW account may be created for this address. Existing
 * accounts bypass this entirely — see resolveIdentityHmac ("grandfather by
 * existence, not by domain").
 */
export function isEligibleForSignup(email: string): boolean {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf("@");
  return at > 0 && ELIGIBLE_DOMAINS.has(lowered.slice(at + 1));
}

export const ADDRESS_NOT_ELIGIBLE_MESSAGE = "We can't sign in that address right now.";

export type ResolvedIdentity =
  | { ok: true; hmac: string; existedBefore: boolean }
  | { ok: false; reason: "not_eligible" };

export interface ResolveIdentityOptions {
  /**
   * Enforce the signup-domain restriction for GENUINELY NEW addresses.
   * Production passes true; development and test pass false so local login
   * and the existing suite keep working (see module header). Grandfathered
   * accounts bypass eligibility either way — that is what grandfathering is.
   */
  enforceNewSignupDomain?: boolean;
}

/**
 * Which identity_hmac this login/signup belongs under.
 *
 * Grandfathering rule, applied identically by POST /auth/otp and
 * /auth/verify (they MUST agree or codes get issued against one hash and
 * verified against another):
 *
 *   1. Look up HMAC(raw-as-typed) and HMAC(canonical). If either row exists,
 *      proceed regardless of domain, using the hash that already exists —
 *      pre-canonicalisation rows were keyed on whatever string was typed at
 *      original signup, and a raw hit wins over a canonical one because the
 *      exact address is the stronger claim.
 *   2. Only when neither row exists — a genuinely new address — does the
 *      eligibility test apply (production only, see ResolveIdentityOptions).
 *      Eligible: key the account (and its OTP) on HMAC(canonical), so every
 *      future rendering of the same mailbox lands here. Ineligible: refuse.
 */
export async function resolveIdentityHmac(
  rawEmail: string,
  pepper: string,
  opts: ResolveIdentityOptions = {},
): Promise<ResolvedIdentity> {
  const rawHmac = identityHmac(rawEmail.trim(), pepper);
  const canonical = canonicalEmailAddress(rawEmail);
  const canonHmac = identityHmac(canonical, pepper);

  if (rawHmac !== canonHmac) {
    const existing = await query<{ identity_hmac: string }>(
      `SELECT identity_hmac FROM feeders WHERE identity_hmac IN ($1, $2)`,
      [rawHmac, canonHmac],
    );
    const rawRow = existing.rows.find((r) => r.identity_hmac === rawHmac);
    const canonRow = existing.rows.find((r) => r.identity_hmac === canonHmac);
    if (rawRow) return { ok: true, hmac: rawRow.identity_hmac, existedBefore: true };
    if (canonRow) return { ok: true, hmac: canonRow.identity_hmac, existedBefore: true };
  } else {
    // Already canonical (the common case for every post-change Gmail login).
    const existing = await query<{ identity_hmac: string }>(
      `SELECT identity_hmac FROM feeders WHERE identity_hmac = $1`,
      [rawHmac],
    );
    if (existing.rows.length > 0) {
      return { ok: true, hmac: existing.rows[0].identity_hmac, existedBefore: true };
    }
  }

  if (!isEligibleForSignup(rawEmail) && opts.enforceNewSignupDomain === true) {
    return { ok: false, reason: "not_eligible" };
  }
  return { ok: true, hmac: canonHmac, existedBefore: false };
}
