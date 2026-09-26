/**
 * Vet passkeys (design v7, V3 "Sign with Face ID", adapted to WebAuthn).
 *
 * Registration: a verified vet's phone creates a passkey bound to
 * WEBAUTHN_RP_ID (hetja.in), user verification required (Face ID, a
 * fingerprint or the screen lock). We keep the credential id, public key,
 * counter and transports (webauthn_credentials).
 *
 * Signing: THE CHALLENGE IS THE RECORD HASH. The server canonicalises the
 * record the vet is about to sign, hashes it together with the signer
 * (recordHash, below) and asks the passkey for an assertion over exactly
 * those 32 bytes. The assertion is stored with the ledger row, so anyone
 * holding the credential's public key can check that THIS vet's phone
 * approved THIS record: the vet cannot later say they never signed it, and
 * nobody can swap a batch number after the fact without breaking both the
 * assertion and the hash chain (INVARIANTs 8 and 9).
 *
 * Challenges are single-use and expire after five minutes (webauthn_challenges).
 * Library: @simplewebauthn/server (MIT, docs/CREDITS.md).
 */
import { createHash, randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { canonicalJSON } from "@hetja/ledger";

export const CHALLENGE_TTL_MS = 5 * 60_000;

export interface WebAuthnConfig {
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_ORIGINS: string;
}

export function origins(cfg: WebAuthnConfig): string[] {
  return cfg.WEBAUTHN_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
}

export function b64url(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * sha256 over canonicalJSON({ v: 1, signer, record }), hex. `record` is the
 * parsed, normalised draft (routes/vet.ts), so the same draft always hashes
 * the same whatever key order the client sent.
 */
export function recordHash(signerFeederId: string, record: Record<string, unknown>): string {
  return createHash("sha256")
    .update(canonicalJSON({ v: 1, signer: signerFeederId, record }))
    .digest("hex");
}

export async function registrationOptions(
  cfg: WebAuthnConfig,
  user: { feederId: string; name: string },
  exclude: { id: string; transports: string[] }[],
) {
  const challenge = randomBytes(32);
  const options = await generateRegistrationOptions({
    rpName: "Hetja",
    rpID: cfg.WEBAUTHN_RP_ID,
    userName: user.name.slice(0, 64) || "Hetja vet",
    userDisplayName: user.name.slice(0, 64) || "Hetja vet",
    userID: new Uint8Array(Buffer.from(user.feederId.replace(/-/g, ""), "hex")),
    challenge: new Uint8Array(challenge),
    attestationType: "none",
    excludeCredentials: exclude.map((c) => ({ id: c.id, transports: c.transports as never })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    timeout: CHALLENGE_TTL_MS,
  });
  return { options, challenge: b64url(challenge) };
}

export async function verifyRegistration(cfg: WebAuthnConfig, response: unknown, expectedChallenge: string) {
  const out = await verifyRegistrationResponse({
    response: response as never,
    expectedChallenge,
    expectedOrigin: origins(cfg),
    expectedRPID: cfg.WEBAUTHN_RP_ID,
    requireUserVerification: true,
  });
  if (!out.verified) return null;
  const c = out.registrationInfo.credential;
  return {
    credentialId: c.id,
    publicKey: Buffer.from(c.publicKey),
    counter: c.counter,
    transports: (c.transports ?? []) as string[],
  };
}

export async function signingOptions(
  cfg: WebAuthnConfig,
  hashHex: string,
  allow: { id: string; transports: string[] }[],
) {
  return generateAuthenticationOptions({
    rpID: cfg.WEBAUTHN_RP_ID,
    challenge: new Uint8Array(Buffer.from(hashHex, "hex")),
    allowCredentials: allow.map((c) => ({ id: c.id, transports: c.transports as never })),
    userVerification: "required",
    timeout: CHALLENGE_TTL_MS,
  });
}

export async function verifySigning(
  cfg: WebAuthnConfig,
  response: unknown,
  hashHex: string,
  credential: { id: string; publicKey: Buffer; counter: number; transports: string[] },
): Promise<{ newCounter: number } | null> {
  try {
    const out = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: b64url(Buffer.from(hashHex, "hex")),
      expectedOrigin: origins(cfg),
      expectedRPID: cfg.WEBAUTHN_RP_ID,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports as never,
      },
      requireUserVerification: true,
    });
    return out.verified ? { newCounter: out.authenticationInfo.newCounter } : null;
  } catch {
    return null;
  }
}
