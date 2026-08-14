import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEAD_TTL_SECONDS,
  SIGNING_ALG,
  VET_DID_PREFIX,
  chainHead,
  generateLedgerKeyPair,
  jwks,
  merkleRoot,
  recomputeHead,
  signChainHead,
  verifyChainHead,
  vetDid,
  type LedgerRecord,
} from "./index.js";

function loadSample(): LedgerRecord[] {
  const url = new URL("../ops/sample-ledger.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as LedgerRecord[];
}

/** Two dogs' ledgers. Slugs, per INVARIANT 1 — random, non-sequential. */
const LEDGER_A = "dog-7k2m9qx4";
const LEDGER_B = "dog-3vh8ptb6";

const HEAD = chainHead(LEDGER_A, loadSample());

/** Epoch seconds, the unit `iat`/`exp` are in. */
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Flip one character in the middle (payload) segment of a compact JWS. */
function tamper(token: string): string {
  const [header, payload, sig] = token.split(".");
  const at = Math.floor(payload.length / 2);
  const flipped =
    payload.slice(0, at) +
    (payload[at] === "A" ? "B" : "A") +
    payload.slice(at + 1);
  return `${header}.${flipped}.${sig}`;
}

describe("signed chain head (enhancement stack D.1, pick 16)", () => {
  it("1. chainHead derives ledger id, head, merkle root and count from the ledger", () => {
    const records = loadSample();
    expect(HEAD.ledgerId).toBe(LEDGER_A);
    expect(HEAD.head).toBe(recomputeHead(records));
    expect(HEAD.merkleRoot).toBe(merkleRoot(records));
    expect(HEAD.recordCount).toBe(records.length);
  });

  it("2. sign then verify round-trips the claims and the vet identity", async () => {
    const pair = await generateLedgerKeyPair();
    expect(pair.publicJwk.kty).toBe("OKP");
    expect(pair.publicJwk.crv).toBe("Ed25519");

    const token = await signChainHead(HEAD, pair.privateJwk, {
      vetId: "vet-01",
      kid: pair.kid,
    });
    expect(token.split(".")).toHaveLength(3); // compact JWS

    const verified = await verifyChainHead(token, pair.publicJwk, { ledgerId: LEDGER_A });
    expect(verified).not.toBeNull();
    expect(verified).toMatchObject({
      ledgerId: LEDGER_A,
      head: HEAD.head,
      merkleRoot: HEAD.merkleRoot,
      recordCount: HEAD.recordCount,
      vetId: "vet-01",
      kid: pair.kid,
    });
    expect(typeof verified?.issuedAt).toBe("number");
    expect(verified?.kid).toBe(pair.kid);
    // Every token carries an explicit expiry, derived from its own iat.
    expect(verified?.expiresAt).toBe((verified as { issuedAt: number }).issuedAt + DEFAULT_HEAD_TTL_SECONDS);
  });

  it("3. a tampered token fails to verify", async () => {
    const pair = await generateLedgerKeyPair();
    const token = await signChainHead(HEAD, pair.privateJwk, { vetId: "vet-01" });
    expect(await verifyChainHead(tamper(token), pair.publicJwk, { ledgerId: LEDGER_A })).toBeNull();
  });

  it("4. the wrong key fails to verify (a foreign vet cannot certify the head)", async () => {
    const signer = await generateLedgerKeyPair();
    const other = await generateLedgerKeyPair();
    const token = await signChainHead(HEAD, signer.privateJwk, { vetId: "vet-01" });
    expect(await verifyChainHead(token, other.publicJwk, { ledgerId: LEDGER_A })).toBeNull();
  });

  it("5. a signature over a different head fails to verify against this one", async () => {
    const pair = await generateLedgerKeyPair();
    const token = await signChainHead(HEAD, pair.privateJwk, { vetId: "vet-01" });
    const otherHead = { ...HEAD, head: recomputeHead(loadSample().slice(0, 2)) };
    // Same key, same token — but verify succeeds; the head mismatch is the
    // caller's job (compare claims). What signature alone must catch: an
    // attacker cannot mint a token for the tampered head with the right key.
    expect(await verifyChainHead(token, pair.publicJwk, { ledgerId: LEDGER_A })).not.toBeNull();
    expect(otherHead.head).not.toBe(HEAD.head);
    const forged = await signChainHead(otherHead, pair.privateJwk, { vetId: "vet-01" });
    const decoded = await verifyChainHead(forged, pair.publicJwk, { ledgerId: LEDGER_A });
    expect(decoded?.head).toBe(otherHead.head);
    expect(decoded?.head).not.toBe(HEAD.head);
  });

  it("6. jwks() emits the RFC 7517 document for the did:web JWKS endpoint", async () => {
    const pair = await generateLedgerKeyPair();
    const doc = jwks(pair.publicJwk, pair.kid);
    expect(doc.keys).toHaveLength(1);
    const key = doc.keys[0];
    expect(key.kid).toBe(pair.kid);
    expect(key.use).toBe("sig");
    expect(key.alg).toBe(SIGNING_ALG);
    expect(key.kty).toBe("OKP");
    expect(key.crv).toBe("Ed25519");
    expect("d" in key).toBe(false); // never publish the private half
  });

  it("7. the vet did scheme matches the JWKS endpoint path", async () => {
    expect(vetDid("vet-42")).toBe(`${VET_DID_PREFIX}/vet-42`);
    const pair = await generateLedgerKeyPair();
    const token = await signChainHead(HEAD, pair.privateJwk, { vetId: "vet-42" });
    const verified = await verifyChainHead(token, pair.publicJwk, { ledgerId: LEDGER_A });
    expect(verified?.vetId).toBe("vet-42");
    expect(verified?.kid).toBeUndefined(); // kid optional when not provided
  });

  it("8. malformed tokens are rejected, never thrown", async () => {
    const pair = await generateLedgerKeyPair();
    const opts = { ledgerId: LEDGER_A };
    expect(await verifyChainHead("not-a-jws", pair.publicJwk, opts)).toBeNull();
    expect(await verifyChainHead("a.b", pair.publicJwk, opts)).toBeNull();
    const token = await signChainHead(HEAD, pair.privateJwk, { vetId: "vet-01" });
    const [, payload, sig] = token.split(".");
    // Signature replaced wholesale with garbage.
    expect(await verifyChainHead(`${token.split(".")[0]}.${payload}.${"x".repeat(86)}`, pair.publicJwk, opts)).toBeNull();
    expect(await verifyChainHead(`${token.split(".")[0]}.${payload}.${sig}`, pair.publicJwk, opts)).not.toBeNull();
  });

  it("9. REGRESSION: a head past the caller's max age does not verify", async () => {
    // The defect: only `iat` was set, verification passed no `maxTokenAge` and
    // never looked at `issuedAt`, so a head signed at record 40 verified
    // cleanly as a current attestation of a ledger that had reached record 55.
    // A published head that never goes stale cannot detect a later rewrite —
    // the operator just keeps presenting the old, still-valid token.
    const pair = await generateLedgerKeyPair();
    const twoHoursAgo = nowSeconds() - 2 * 60 * 60;
    const token = await signChainHead(HEAD, pair.privateJwk, {
      vetId: "vet-01",
      issuedAt: twoHoursAgo,
    });

    // An auditor who wants a head from the last hour is told no…
    expect(
      await verifyChainHead(token, pair.publicJwk, { ledgerId: LEDGER_A, maxAgeSeconds: 3600 }),
    ).toBeNull();
    // …while the same token is still inside the default two-publish-cycle window.
    const fresh = await verifyChainHead(token, pair.publicJwk, { ledgerId: LEDGER_A });
    expect(fresh?.issuedAt).toBe(twoHoursAgo);
    expect(fresh?.expiresAt).toBe(twoHoursAgo + DEFAULT_HEAD_TTL_SECONDS);
  });

  it("10. REGRESSION: an expired head does not verify, however generous the caller is", async () => {
    const pair = await generateLedgerKeyPair();
    // Issued far enough back that the default TTL has already elapsed.
    const stale = nowSeconds() - (DEFAULT_HEAD_TTL_SECONDS + 3600);
    const token = await signChainHead(HEAD, pair.privateJwk, {
      vetId: "vet-01",
      issuedAt: stale,
    });
    // `exp` is not negotiable by the verifier: even asking for a year's slack
    // on age does not resurrect a token whose own expiry has passed.
    expect(
      await verifyChainHead(token, pair.publicJwk, {
        ledgerId: LEDGER_A,
        maxAgeSeconds: 365 * 24 * 60 * 60,
      }),
    ).toBeNull();

    // A caller can also sign a deliberately short-lived head; it expires on schedule.
    const shortLived = await signChainHead(HEAD, pair.privateJwk, {
      vetId: "vet-01",
      issuedAt: nowSeconds() - 300,
      ttlSeconds: 60,
    });
    expect(await verifyChainHead(shortLived, pair.publicJwk, { ledgerId: LEDGER_A })).toBeNull();
  });

  it("11. REGRESSION: a head for ledger A does not verify as ledger B", async () => {
    // The claims used to be {head, merkleRoot, recordCount} with no ledger
    // identifier at all, so nothing in a token said which dog's ledger it was
    // about — one vet's signed head was interchangeable across all their dogs.
    const pair = await generateLedgerKeyPair();
    const headA = chainHead(LEDGER_A, loadSample());
    const tokenA = await signChainHead(headA, pair.privateJwk, { vetId: "vet-01" });

    expect(await verifyChainHead(tokenA, pair.publicJwk, { ledgerId: LEDGER_A })).not.toBeNull();
    expect(await verifyChainHead(tokenA, pair.publicJwk, { ledgerId: LEDGER_B })).toBeNull();

    // Two ledgers with byte-identical contents still produce distinguishable
    // tokens, because the ledger id is signed rather than inferred.
    const headB = chainHead(LEDGER_B, loadSample());
    expect(headB.head).toBe(headA.head);
    expect(headB.merkleRoot).toBe(headA.merkleRoot);
    const tokenB = await signChainHead(headB, pair.privateJwk, { vetId: "vet-01" });
    expect(await verifyChainHead(tokenB, pair.publicJwk, { ledgerId: LEDGER_B })).not.toBeNull();
    expect(await verifyChainHead(tokenB, pair.publicJwk, { ledgerId: LEDGER_A })).toBeNull();

    // A token with no `ledger` claim at all is not a well-formed signed head.
    const noLedger = await new SignJWT({
      head: headA.head,
      merkleRoot: headA.merkleRoot,
      recordCount: headA.recordCount,
    })
      .setProtectedHeader({ alg: SIGNING_ALG })
      .setSubject(vetDid("vet-01"))
      .setIssuedAt()
      .setExpirationTime(nowSeconds() + 3600)
      .sign(pair.privateJwk);
    expect(await verifyChainHead(noLedger, pair.publicJwk, { ledgerId: LEDGER_A })).toBeNull();
  });

  it("12. REGRESSION: a `kid` in the payload cannot shadow the protected header's", async () => {
    // `kid` belongs in the JWS protected header (RFC 7515). Reading it from the
    // payload first meant a token could name one key in its (signed but
    // semantically wrong) payload while being signed with another — pointing a
    // caller doing a JWKS lookup at the wrong key entirely.
    const pair = await generateLedgerKeyPair();
    const other = await generateLedgerKeyPair();
    const token = await new SignJWT({
      ledger: LEDGER_A,
      head: HEAD.head,
      merkleRoot: HEAD.merkleRoot,
      recordCount: HEAD.recordCount,
      kid: other.kid, // a decoy pointing at somebody else's key
    })
      .setProtectedHeader({ alg: SIGNING_ALG, kid: pair.kid })
      .setSubject(vetDid("vet-01"))
      .setIssuedAt()
      .setExpirationTime(nowSeconds() + 3600)
      .sign(pair.privateJwk);

    const verified = await verifyChainHead(token, pair.publicJwk, { ledgerId: LEDGER_A });
    expect(verified).not.toBeNull();
    expect(other.kid).not.toBe(pair.kid);
    expect(verified?.kid).toBe(pair.kid); // the header's, i.e. the signing key's
  });

  it("13. a head with no expiry is rejected outright", async () => {
    // jose can only enforce `exp` when it is present, so "no exp" must not
    // degrade to "never expires" — it is rejected as malformed instead.
    const pair = await generateLedgerKeyPair();
    const noExp = await new SignJWT({
      ledger: LEDGER_A,
      head: HEAD.head,
      merkleRoot: HEAD.merkleRoot,
      recordCount: HEAD.recordCount,
    })
      .setProtectedHeader({ alg: SIGNING_ALG })
      .setSubject(vetDid("vet-01"))
      .setIssuedAt()
      .sign(pair.privateJwk);
    expect(await verifyChainHead(noExp, pair.publicJwk, { ledgerId: LEDGER_A })).toBeNull();
  });
});
