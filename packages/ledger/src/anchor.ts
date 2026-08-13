/**
 * Hetja ledger anchoring — INVARIANT 10: the anchor message is a canonical,
 * deterministic encoding (stable key order, no whitespace) of the head hash,
 * record count and publish timestamp, so the same anchor always serializes
 * identically for notarization.
 */
import { canonicalJSON } from "./chain.js";

/** anchorMessage: deterministic string payload for a public-notarization anchor. */
export function anchorMessage(
  headHash: string,
  recordCount: number,
  publishedAt: string,
): string {
  return canonicalJSON({ headHash, recordCount, publishedAt });
}
