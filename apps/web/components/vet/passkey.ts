/**
 * Signing with a passkey (design v7 V3 "Sign with Face ID"; the adapted
 * list in docs/design/v7-portals/CONTRACT.md). On the web, Face ID signing
 * is a WebAuthn assertion: the server hashes the record, hands the hash over
 * as the challenge, and the phone signs it with Face ID, a fingerprint or
 * its screen lock, whichever it offers. The assertion is stored with the
 * record, which makes the signature verifiable later.
 *
 * @simplewebauthn/browser (MIT) does the base64url plumbing. It is imported
 * only when a vet actually signs or sets up a passkey.
 */
import { vetApi, type SignInput } from "./vet-api";

/** iPhone and iPad (iPadOS reports a Mac user agent, but has touch). */
export function isAppleMobile(ua = typeof navigator === "undefined" ? "" : navigator.userAgent, touch = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && touch > 1;
}

/**
 * What the passkey is called on this phone. "Face ID" is Apple's word, so it
 * is only said on an iPhone or iPad; everywhere else the neutral words cover
 * a fingerprint, a face or a PIN.
 */
export function unlockWord(apple = isAppleMobile()): string {
  return apple ? "Face ID" : "your screen lock";
}

/** "Sign with Face ID" / "Sign with your screen lock". */
export function signLabel(verb = "Sign", apple = isAppleMobile()): string {
  return `${verb} with ${unlockWord(apple)}`;
}

export type PasskeyFailure = "cancelled" | "unsupported" | "no-passkey" | "error";

export class PasskeyError extends Error {
  readonly reason: PasskeyFailure;
  constructor(reason: PasskeyFailure, message?: string) {
    super(message ?? reason);
    this.name = "PasskeyError";
    this.reason = reason;
  }
}

function classify(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err;
  const name = (err as { name?: string } | null)?.name;
  const code = (err as { code?: string } | null)?.code;
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED") return new PasskeyError("cancelled");
  const cause = (err as { cause?: { name?: string } } | null)?.cause?.name;
  if (name === "NotSupportedError" || (code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" && cause === "NotSupportedError")) {
    return new PasskeyError("unsupported");
  }
  if (cause === "NotAllowedError") return new PasskeyError("cancelled");
  if (code === "NO_PASSKEY" || code === "PASSKEY_REQUIRED") return new PasskeyError("no-passkey");
  return new PasskeyError("error", (err as Error)?.message);
}

export async function passkeysSupported(): Promise<boolean> {
  try {
    const { browserSupportsWebAuthn } = await import("@simplewebauthn/browser");
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** First-time setup: create a passkey on this phone for this vet account. */
export async function setUpPasskey(): Promise<void> {
  try {
    const { startRegistration, browserSupportsWebAuthn } = await import("@simplewebauthn/browser");
    if (!browserSupportsWebAuthn()) throw new PasskeyError("unsupported");
    const optionsJSON = await vetApi.registerOptions();
    const response = await startRegistration({ optionsJSON });
    await vetApi.registerPasskey(response);
  } catch (err) {
    throw classify(err);
  }
}

/** Sign a record (or a correction, or a withdrawal) with the passkey. */
export async function signWithPasskey(input: SignInput): Promise<{ recordId: string }> {
  try {
    const { startAuthentication, browserSupportsWebAuthn } = await import("@simplewebauthn/browser");
    if (!browserSupportsWebAuthn()) throw new PasskeyError("unsupported");
    const { challengeId, optionsJSON, draft } = await vetApi.signOptions(input);
    const assertion = await startAuthentication({ optionsJSON });
    return await vetApi.sign(challengeId, draft, assertion);
  } catch (err) {
    throw classify(err);
  }
}

/** The line under the button when a passkey step fails. Nothing is saved in any of these. */
export function passkeyMessage(e: PasskeyError): string {
  switch (e.reason) {
    case "cancelled":
      return "Signing was cancelled. Nothing was saved.";
    case "unsupported":
      return "This browser can't sign with a passkey. Open Hetja in Safari or Chrome on your phone.";
    case "no-passkey":
      return "This phone isn't set up to sign yet.";
    default:
      return e.message && !/^error$/i.test(e.message) ? e.message : "Signing didn't go through. Nothing was saved. Try again.";
  }
}
