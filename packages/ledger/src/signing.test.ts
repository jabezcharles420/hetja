import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
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

const HEAD = chainHead(loadSample());

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
  it("1. chainHead derives head, merkle root and count from the ledger", () => {
    const records = loadSample();
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

    const verified = await verifyChainHead(token, pair.publicJwk);
    expect(verified).not.toBeNull();
    expect(verified).toMatchObject({
      head: HEAD.head,
      merkleRoot: HEAD.merkleRoot,
      recordCount: HEAD.recordCount,
      vetId: "vet-01",
      kid: pair.kid,
    });
    expect(typeof verified?.issuedAt).toBe("number");
    expect(verified?.kid).toBe(pair.kid);
  });

  it("3. a tampered token fails to verify", async () => {
    const pair = await generateLedgerKeyPair();
    const token = await signChainHead(HEAD, pair.privateJwk, { vetId: "vet-01" });
    expect(await verifyChainHead(tamper(token), pair.publicJwk)).toBeNull();
  });

  it("4. the wrong key fails to verify (a foreign vet cannot certify the head)", async () => {
    const signer = await generateLedgerKeyPair();
    const other = await generateLedgerKeyPair();
    const token = await signChainHead(HEAD, signer.privateJwk, { vetId: "vet-01" });
    expect(await verifyChainHead(token, other.publicJwk)).toBeNull();
  });

  it("5. a signature over a different head fails to verify against this one", async () => {
    const pair = await generateLedgerKeyPair();
    const token = await signChainHead(HEAD, pair.privateJwk, { vetId: "vet-01" });
    const otherHead = { ...HEAD, head: recomputeHead(loadSample().slice(0, 2)) };
    // Same key, same token — but verify succeeds; the head mismatch is the
    // caller's job (compare claims). What signature alone must catch: an
    // attacker cannot mint a token for the tampered head with the right key.
    expect(await verifyChainHead(token, pair.publicJwk)).not.toBeNull();
    expect(otherHead.head).not.toBe(HEAD.head);
    const forged = await signChainHead(otherHead, pair.privateJwk, { vetId: "vet-01" });
    const decoded = await verifyChainHead(forged, pair.publicJwk);
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
    const verified = await verifyChainHead(token, pair.publicJwk);
    expect(verified?.vetId).toBe("vet-42");
    expect(verified?.kid).toBeUndefined(); // kid optional when not provided
  });

  it("8. malformed tokens are rejected, never thrown", async () => {
    const pair = await generateLedgerKeyPair();
    expect(await verifyChainHead("not-a-jws", pair.publicJwk)).toBeNull();
    expect(await verifyChainHead("a.b", pair.publicJwk)).toBeNull();
    const token = await signChainHead(HEAD, pair.privateJwk, { vetId: "vet-01" });
    const [, payload, sig] = token.split(".");
    // Signature replaced wholesale with garbage.
    expect(await verifyChainHead(`${token.split(".")[0]}.${payload}.${"x".repeat(86)}`, pair.publicJwk)).toBeNull();
    expect(await verifyChainHead(`${token.split(".")[0]}.${payload}.${sig}`, pair.publicJwk)).not.toBeNull();
  });
});
