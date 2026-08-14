#!/usr/bin/env node
/**
 * `pnpm ledger:keygen` — generate the Ed25519 pair that signs the daily ledger
 * anchor (INVARIANT 10).
 *
 * This exists because the alternative was a nine-line `node -e '...'` in a
 * runbook, and a runbook one-liner that mishandles a private key is a bad way to
 * learn that quoting rules differ between shells. It prints three things and
 * makes the split between them explicit, because getting that split wrong is the
 * whole risk:
 *
 *   1. HETJA_LEDGER_SIGNING_JWK — the PRIVATE half. Goes in
 *      apps/api/.env.production (which the worker unit loads as its
 *      EnvironmentFile) and nowhere else. Never committed, never pasted into a
 *      chat or an issue, and deliberately NOT included in a restic repository
 *      that a third party stores.
 *   2. HETJA_LEDGER_SIGNING_KID — the RFC 7638 thumbprint. Not secret.
 *   3. The JWKS document — the PUBLIC half. This one MUST be published, or the
 *      signature verifies against nothing and the exercise is decoration. An
 *      auditor fetches it, reads `kid` from the JWS header, and checks the
 *      signature on the head we published.
 *
 * Rotation: generate a new pair, publish a JWKS containing BOTH keys, then swap
 * the env vars. Retiring the old key immediately invalidates every anchor
 * signature it ever made — which is exactly the history an auditor may want to
 * check, so keep retired public keys in the JWKS.
 *
 * Usage:
 *   pnpm ledger:keygen              # human-readable, with the warnings
 *   pnpm ledger:keygen --env        # just the two env lines, for appending
 *   pnpm ledger:keygen --jwks       # just the JWKS JSON, for publishing
 */
import { generateLedgerKeyPair, jwks } from "./signing.js";

async function main(): Promise<number> {
  const mode = process.argv[2] ?? "";
  const { publicJwk, privateJwk, kid } = await generateLedgerKeyPair();

  if (mode === "--env") {
    // Single-line JSON on purpose: an env file cannot carry a newline.
    console.log(`HETJA_LEDGER_SIGNING_JWK=${JSON.stringify(privateJwk)}`);
    console.log(`HETJA_LEDGER_SIGNING_KID=${kid}`);
    return 0;
  }

  if (mode === "--jwks") {
    console.log(JSON.stringify(jwks(publicJwk, kid), null, 2));
    return 0;
  }

  console.log("Ed25519 pair for signing the daily ledger anchor (INVARIANT 10).\n");
  console.log("1. PRIVATE half -> apps/api/.env.production on the box, and nowhere else.");
  console.log("   Do not commit it. Do not paste it anywhere. Do not let it into a");
  console.log("   restic repository a third party stores.\n");
  console.log(`HETJA_LEDGER_SIGNING_JWK=${JSON.stringify(privateJwk)}`);
  console.log(`HETJA_LEDGER_SIGNING_KID=${kid}\n`);
  console.log("2. PUBLIC half -> publish this. Without it a verifier has nothing to");
  console.log("   check the signature against, and an unsigned-in-effect anchor proves");
  console.log("   nothing about who computed it.\n");
  console.log(JSON.stringify(jwks(publicJwk, kid), null, 2));
  console.log("\n3. Then restart the worker and confirm it took:");
  console.log("   systemctl restart hetja-worker");
  console.log("   curl -s localhost:8080/api/v1/ledger/anchor | grep -o '\"signed\":[a-z]*'");
  return 0;
}

process.exit(await main());
