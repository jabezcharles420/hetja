/**
 * Email canonicalisation + signup eligibility (lib/email.ts).
 *
 * The property that matters: renderings that Gmail delivers to ONE inbox must
 * produce ONE identity_hmac, so a feeder cannot fragment their account by
 * typing their address differently — and renderings that other providers
 * would deliver to DIFFERENT inboxes must stay distinct.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalEmailAddress,
  isEligibleForSignup,
} from "./email.js";
import { identityHmac } from "./hmac.js";

const PEPPER = "test-pepper-email-canonicalisation";

describe("canonicalEmailAddress", () => {
  it("collapses every Gmail rendering of one mailbox onto one canonical form", () => {
    // The three renderings from the wave brief: dots ignored, +tag ignored.
    const variants = [
      "john@gmail.com",
      "j.o.h.n@gmail.com",
      "john+7@gmail.com",
      "j.o.h.n+sorting@gmail.com",
      "John@Gmail.com",
      "JOHN@gmail.com",
    ];
    const hashes = new Set(
      variants.map((v) => identityHmac(canonicalEmailAddress(v), PEPPER)),
    );
    expect(hashes.size).toBe(1);
    expect(canonicalEmailAddress("j.o.h.n+7@gmail.com")).toBe("john@gmail.com");
  });

  it("folds googlemail.com onto gmail.com (same service)", () => {
    expect(canonicalEmailAddress("john@googlemail.com")).toBe("john@gmail.com");
    expect(identityHmac(canonicalEmailAddress("john@googlemail.com"), PEPPER)).toBe(
      identityHmac(canonicalEmailAddress("john@gmail.com"), PEPPER),
    );
  });

  it("keeps distinct non-Gmail mailboxes distinct — dots are significant there", () => {
    // jane.doe@yahoo.com and janedoe@yahoo.com are two different people's
    // inboxes at that provider. Merging them would be an account-takeover
    // bug, which is why the aggressive rule is provider-specific.
    expect(canonicalEmailAddress("jane.doe@yahoo.com")).toBe("jane.doe@yahoo.com");
    expect(identityHmac(canonicalEmailAddress("jane.doe@yahoo.com"), PEPPER)).not.toBe(
      identityHmac(canonicalEmailAddress("janedoe@yahoo.com"), PEPPER),
    );
  });

  it("lowercases but otherwise leaves non-Gmail addresses alone (+tags included)", () => {
    expect(canonicalEmailAddress("Feeder+streetdogs@yahoo.com")).toBe(
      "feeder+streetdogs@yahoo.com",
    );
  });

  it("defends against degenerate input without throwing", () => {
    expect(canonicalEmailAddress("  John@Gmail.COM  ")).toBe("john@gmail.com");
    // Empty local part after stripping cannot arrive via the validated path;
    // the fallback keeps it from becoming a phantom identity if hand-fed.
    expect(canonicalEmailAddress("+7@gmail.com")).toBe("+7@gmail.com");
  });
});

describe("isEligibleForSignup", () => {
  it("admits both spellings of the eligible family, case-insensitively", () => {
    expect(isEligibleForSignup("john@gmail.com")).toBe(true);
    expect(isEligibleForSignup("j.o.h.n+7@googlemail.com")).toBe(true);
    expect(isEligibleForSignup("John@GMAIL.com")).toBe(true);
  });

  it("refuses every other domain", () => {
    expect(isEligibleForSignup("feeder@yahoo.com")).toBe(false);
    expect(isEligibleForSignup("feeder@outlook.com")).toBe(false);
    expect(isEligibleForSignup("feeder@hetja.in")).toBe(false);
    // Lookalike domains are not the family: eligibility is exact-match on the
    // full domain, never a suffix test.
    expect(isEligibleForSignup("feeder@notgmail.com")).toBe(false);
    expect(isEligibleForSignup("feeder@gmail.com.evil.example")).toBe(false);
  });
});
