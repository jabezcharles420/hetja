/**
 * Hetja daily-anchor signing (INVARIANT 10, enhancement stack §D.1 pick 16).
 *
 * INVARIANT 10 is "publish the ledger head daily", and its reasoning is that "a
 * hash chain that is computed and stored by the same party that could tamper
 * with it proves nothing about tampering by that party". Publishing alone only
 * gets half of that: an anchor row with no signature says a head existed, but
 * not WHO said so, so nothing stops the operator from later disowning it or
 * presenting a different one. `signChainHead` in `@hetja/ledger` exists to close
 * that gap — a compact JWS (EdDSA/Ed25519) over
 * `{ledger, head, merkleRoot, recordCount}` with `iat`/`exp`, verifiable by any
 * JOSE library against a published JWKS.
 *
 * This module is the application-layer half the package deliberately leaves to
 * the caller: where the key comes from, and what to do when it is absent.
 *
 * ===========================================================================
 * ONE HONEST LIMITATION. Read it before changing anything here.
 * ===========================================================================
 *
 * (Historical note: this file originally loaded `@hetja/ledger` through a
 * runtime-resolved specifier with hand-mirrored types, because the change that
 * introduced it could not add the dependency to `apps/worker/package.json`.
 * `"@hetja/ledger": "workspace:*"` is declared now, so the import is static and
 * the mirror types are gone. If you see `Cannot find package '@hetja/ledger'
 * imported from apps/worker`, that dependency line is missing — restore it and
 * run `pnpm install`; do not reintroduce the indirection.)
 *
 * (1) THE SIGNER IS THE OPERATOR, BUT `signChainHead` NAMES A VET.
 *
 * `signChainHead` models §D.1's per-vet ledgers: it puts
 * `did:web:hetja.in:vets/<vetId>` in `sub`, because that identifier is also the
 * JWKS lookup path. INVARIANT 10's anchor is not per-vet — it is one global
 * chain over every dog's `medical_records`, computed and published by the
 * operator. So `sub` on a daily anchor reads
 * `did:web:hetja.in:vets/<HETJA_LEDGER_SIGNER_ID>` where that id identifies
 * Hetja itself, not a clinic. That is a naming wart, not a security hole: the
 * signature still binds the key to the claims, `ledger` still names which
 * ledger, and `verifyChainHead` still refuses a token whose ledger does not
 * match. Fixing it properly means a second, operator-shaped signer in
 * `packages/ledger`, which is not this module's file to change.
 *
 * ===========================================================================
 * CONFIGURATION THE OPERATOR MUST ADD
 * ===========================================================================
 *
 * Read straight from `process.env`, the same way VAPID is in index.ts, and for
 * the same reason: `apps/api/src/config.ts` is the API's config with its
 * `requireInProd` pattern for secrets, and the worker does not load it. A
 * private key genuinely belongs in that pattern; when a `config.ts`-shaped
 * loader exists for the worker, move these there.
 *
 *   HETJA_LEDGER_SIGNING_JWK   REQUIRED to sign. The PRIVATE half of an Ed25519
 *                              key pair, as a JSON JWK on one line. Generate it
 *                              with `pnpm ledger:keygen` (add `--env` for just
 *                              the two env lines, `--jwks` for just the document
 *                              to publish). That command exists so this is not a
 *                              nine-line `node -e` in a runbook — a one-liner
 *                              that mishandles a private key is a bad way to
 *                              discover that quoting differs between shells.
 *                              Store the private JWK the way HETJA_HMAC_PEPPER
 *                              is stored (secret manager / .env.production,
 *                              never committed). Publish the public half at the
 *                              JWKS path — `jwks(publicJwk, kid)` renders the
 *                              document — or an auditor has nothing to verify
 *                              the signature against and the whole exercise is
 *                              decoration.
 *   HETJA_LEDGER_SIGNING_KID   Optional but strongly recommended: the `kid` from
 *                              the pair above, so the JWS header points at the
 *                              right key in a JWKS with more than one. Omitting
 *                              it makes key rotation ambiguous.
 *   HETJA_LEDGER_SIGNER_ID     Optional; defaults to "hetja-operator". Becomes
 *                              the `<id>` in `sub: did:web:hetja.in:vets/<id>`.
 *                              See limitation (1).
 *
 * NO DEV DEFAULT AND NO GENERATED KEY. A key invented at boot would sign
 * anchors with a value nobody can verify against and nobody kept — an
 * attestation that looks real and proves nothing, which is worse than an
 * unsigned anchor that admits what it is. And a committed dev key is a key an
 * attacker has, which would let anyone forge "Hetja states the ledger stood
 * here". So: no key configured means the anchor is published UNSIGNED, with one
 * clear warning line, and `ledger_anchors.head_signature` stays NULL.
 * `GET /api/v1/ledger/anchor` reports `signed: false` so a caller is told which
 * kind of anchor they are holding rather than left to assume.
 */
import { merkleRoot, signChainHead, type ChainHead, type LedgerRecord } from "@hetja/ledger";

/**
 * The key type `signChainHead` accepts, derived from the function rather than
 * imported from jose: `jose` is a dependency of `packages/ledger`, not of this
 * package, so naming its `JWK` type here would not resolve under pnpm's isolated
 * node_modules. Deriving it also means this cannot drift if the ledger package
 * ever narrows what it accepts.
 */
type LedgerPrivateKey = Parameters<typeof signChainHead>[1];


/**
 * The ledger this worker's daily anchor is a statement about. `verifyChainHead`
 * REQUIRES the caller to name the ledger it is asking about (a head that does
 * not name its ledger is only a statement about *some* ledger), so this string
 * is part of the public verification contract, not an internal label — it is
 * persisted on every anchor row (`ledger_anchors.ledger_id`, migration 0014)
 * and returned by GET /api/v1/ledger/anchor. Changing it invalidates every
 * previously published signature's ledger claim.
 */
export const HETJA_GLOBAL_LEDGER_ID = "hetja:medical:global";

/** A Merkle leaf: the two columns a tree actually needs. */
export interface MerkleLeaf {
  id: string;
  hash: string;
}

/**
 * What the signature commits to. Aliased to the ledger package's own `ChainHead`
 * rather than restated, so the two cannot drift: an earlier version of this file
 * hand-mirrored the shape because it could not import the package, and a mirror
 * that silently disagrees with the real claims is how a signature ends up
 * attesting to something other than what an auditor verifies.
 */
export type ChainHeadClaims = ChainHead;

const SIGNER_ID = process.env.HETJA_LEDGER_SIGNER_ID || "hetja-operator";
const SIGNING_KID = process.env.HETJA_LEDGER_SIGNING_KID;

/**
 * The private JWK, parsed once. A malformed value is reported at startup rather
 * than once per daily run, so a typo surfaces on deploy instead of tomorrow.
 * Only the shape is validated here; whether the key is actually usable is
 * decided by jose at first signature, and reported there.
 */
const SIGNING_JWK: Record<string, unknown> | null = (() => {
  const raw = process.env.HETJA_LEDGER_SIGNING_JWK;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.kty !== "string") {
      throw new Error("not a JWK object (no kty)");
    }
    return parsed;
  } catch (err) {
    console.error(
      "anchor_ledger: HETJA_LEDGER_SIGNING_JWK is set but unusable (" +
        `${(err as Error).message}) -- anchors will be published UNSIGNED. ` +
        "Expected the private half of an Ed25519 pair as one-line JSON JWK; " +
        "see apps/worker/src/sign-anchor.ts for how to generate one. The value " +
        "itself is deliberately not logged.",
    );
    return null;
  }
})();

if (!SIGNING_JWK) {
  console.warn(
    "anchor_ledger: HETJA_LEDGER_SIGNING_JWK not set -- the daily ledger anchor will be " +
      "published UNSIGNED (head_signature stays NULL, and GET /api/v1/ledger/anchor reports " +
      "signed: false). The anchor is still worth publishing: an auditor can compare a later " +
      "recomputation against it. What is missing is attribution -- an unsigned head proves " +
      "nothing about the party that computed it (INVARIANT 10). Set the variable to turn " +
      "signing on; no key is invented here on purpose.",
  );
}

/**
 * RFC 6962 Merkle root over every ledger leaf, or null if the computation itself
 * fails. Null means "not computed", never "empty tree" — the package's
 * `EMPTY_MERKLE_ROOT` is a real value for a real empty ledger and must not be
 * confused with a missing one, which is why this returns null and the column
 * stays NULL rather than being filled with a plausible-looking hash.
 *
 * `merkleRoot` takes `LedgerRecord[]`, but reads only `id` and `hash` (its
 * implementation is `records.map(r => leafHash(r.hash))`). `MerkleLeaf` carries
 * exactly those two fields, so the cast is narrowing a structural type to the
 * subset actually consumed rather than asserting something unproven.
 */
export async function globalMerkleRoot(leaves: MerkleLeaf[]): Promise<string | null> {
  try {
    return merkleRoot(leaves as unknown as LedgerRecord[]);
  } catch (err) {
    console.error(`anchor_ledger: merkleRoot failed (${(err as Error).message})`);
    return null;
  }
}

/**
 * Compact JWS over the anchor's claims, or null when no key is configured (or
 * the package is unavailable, or jose rejects the key).
 *
 * `issuedAt` is the anchor's own publish timestamp rather than "now", which is
 * what `SignChainHeadOptions.issuedAt` is for: the token's `iat` then matches
 * `ledger_anchors.published_at` exactly, so an auditor comparing the two never
 * sees unexplained drift, and a retried run attests as of the anchor rather
 * than as of the retry.
 *
 * A signing failure never costs the anchor. Publishing an unsigned head is a
 * degraded outcome; throwing here would fail the job, leave the day with no
 * anchor at all, and hand the retry loop a permanent error — strictly worse for
 * the invariant this exists to serve.
 */
export async function signAnchor(
  claims: ChainHeadClaims,
  publishedAt: Date,
): Promise<string | null> {
  if (!SIGNING_JWK) return null;
  try {
    return await signChainHead(claims, SIGNING_JWK as LedgerPrivateKey, {
      vetId: SIGNER_ID,
      ...(SIGNING_KID ? { kid: SIGNING_KID } : {}),
      issuedAt: Math.floor(publishedAt.getTime() / 1000),
    });
  } catch (err) {
    console.error(
      `anchor_ledger: signing the chain head failed (${(err as Error).message}) -- ` +
        "publishing this anchor unsigned. Check that HETJA_LEDGER_SIGNING_JWK is the " +
        "PRIVATE half of an Ed25519 (OKP/Ed25519) pair; the ledger package signs EdDSA only.",
    );
    return null;
  }
}
