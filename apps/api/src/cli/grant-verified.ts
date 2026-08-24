/**
 * Grant or revoke the `verified` verification tier, from the box.
 *
 *   pnpm --filter @hetja/api verified:grant   someone@example.org
 *   pnpm --filter @hetja/api verified:revoke  someone@example.org
 *   pnpm --filter @hetja/api verified:list
 *
 * WHAT THIS TIER BUYS, AND WHY IT IS A CLI. Corroboration of a dog's SOS
 * eligibility (routes/scans.ts) is reached at two geotagged scans from distinct
 * subjects — or ONE geotagged scan by a "verified feeder". That second path
 * used to be dead code: nothing anywhere wrote `feeders.verification_tier` off
 * its 'provisional' default, so no feeder could ever satisfy it. This tool is
 * one half of the fix (the other half is the corroboration query itself
 * counting admin/vet/bmc_officer roles as verified).
 *
 * The tier deliberately does NOT ride on trust_score: the trust catalog's
 * economics are recalibrated by wave (INVARIANTS.md records `feed` going +60 →
 * +1), and tenure is simply not what that column measures. A human decision
 * about a human gets a human tool.
 *
 * WHY A CLI RATHER THAN A ROUTE. Mirrors cli/grant-admin.ts exactly, for the
 * same reasons set out in its header: every HTTP-shaped alternative puts a
 * privilege-escalation path on the public internet, and "promote via an
 * admin-only route" still needs a bootstrap path anyway. Requiring a shell on
 * the box is the honest statement that this is a privileged act — it is
 * auditable in the shell history and this tool's output, and it cannot be
 * reached from the internet.
 *
 * The address is never stored. It is HMAC'd with HETJA_HMAC_PEPPER into the
 * same `identity_hmac` the auth path uses (INVARIANT 3), so this tool can only
 * act on an account that has ALREADY signed in at least once.
 */
import { pool, query } from "@hetja/db";
import { identityHmac } from "../lib/hmac.js";
import { loadConfig } from "../config.js";

type Action = "grant" | "revoke" | "list";

interface FeederRow {
  id: string;
  role: string;
  display_name: string;
  verification_tier: string;
}

function usage(): never {
  console.error(
    [
      "",
      "Usage:",
      "  verified:grant  <email>    mark an existing feeder as verified",
      "  verified:revoke <email>    return an account to provisional",
      "  verified:list              list currently verified feeders",
      "",
      "The feeder must have signed in at least once — this tool verifies an",
      "existing account, it does not create one.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [, , rawAction, email] = process.argv;
  const action = rawAction as Action;
  if (!["grant", "revoke", "list"].includes(action)) usage();
  if (action !== "list" && !email) usage();

  // loadConfig enforces that HETJA_HMAC_PEPPER is set in production. Using it
  // rather than reading process.env directly means this tool cannot silently
  // compute a hash under the development default and then fail to match any
  // real row — a failure that would look like "no such feeder".
  const config = loadConfig();

  if (action === "list") {
    const res = await query<FeederRow>(
      `SELECT id, role, display_name, verification_tier FROM feeders
        WHERE verification_tier = 'verified' ORDER BY id`,
    );
    if (res.rowCount === 0) {
      console.log("No verified feeders. One scan corroborates nothing; two distinct subjects it is.");
    } else {
      console.log(`${res.rowCount} verified feeder(s):`);
      for (const r of res.rows) console.log(`  ${r.id}  ${r.display_name}  ${r.role}`);
    }
    return;
  }

  const idHmac = identityHmac(email, config.HETJA_HMAC_PEPPER);
  const nextTier = action === "grant" ? "verified" : "provisional";

  const existing = await query<FeederRow>(
    `SELECT id, role, display_name, verification_tier FROM feeders WHERE identity_hmac = $1`,
    [idHmac],
  );
  if (existing.rowCount === 0) {
    // Deliberately does NOT create the account, mirroring grant-admin.ts:
    // verifying an address nobody has proved they control would mint trust
    // out of thin air.
    console.error(
      `No feeder found for that address.\n` +
        `They must sign in at hetja.in/login once first — then re-run this.`,
    );
    process.exit(1);
  }
  const feeder = existing.rows[0];
  if (feeder.verification_tier === nextTier) {
    console.log(`No change: ${feeder.display_name} (${feeder.id}) is already '${nextTier}'.`);
    return;
  }

  const updated = await query<FeederRow>(
    `UPDATE feeders SET verification_tier = $2 WHERE identity_hmac = $1 RETURNING id, role, display_name, verification_tier`,
    [idHmac, nextTier],
  );
  const row = updated.rows[0];
  console.log(`${feeder.verification_tier} -> ${row.verification_tier}  ${row.display_name}  (${row.id})`);
  if (nextTier === "verified") {
    console.log("One geotagged scan by this account now corroborates a dog's sos eligibility.");
  }
}

main()
  .then(() => pool.end())
  .catch(async (err: unknown) => {
    console.error("verification tier change failed:", err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
