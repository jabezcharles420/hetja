/**
 * Grant or revoke the `admin` role, from the box.
 *
 *   pnpm --filter @hetja/api admin:grant   someone@example.org
 *   pnpm --filter @hetja/api admin:revoke  someone@example.org
 *   pnpm --filter @hetja/api admin:list
 *
 * WHY A CLI RATHER THAN A ROUTE. Admin is the role that can enrol dogs, mint
 * collars, moderate stories and define territories — i.e. write to the register
 * of every stray in a city. Every HTTP-shaped alternative puts a
 * privilege-escalation path on the public internet:
 *
 *   * "first user becomes admin" races anyone who finds the signup endpoint
 *     before you do, on an endpoint that is deliberately open to strangers;
 *   * "promote via an admin-only route" cannot mint the FIRST admin, so it
 *     needs a bootstrap path anyway, and bootstrap paths get left enabled;
 *   * "promote from an env allowlist at signup" silently re-grants the role
 *     every time that address logs in, which makes revocation a lie.
 *
 * Requiring a shell on the box is the honest statement that this is a
 * privileged act. It is auditable (the shell history and this tool's output),
 * it cannot be reached from the internet, and it needs no new surface.
 *
 * The address is never stored. It is HMAC'd with HETJA_HMAC_PEPPER into the
 * same `identity_hmac` the auth path uses (INVARIANT 3), so this tool can only
 * act on an account that has ALREADY signed in at least once — which is the
 * right constraint: you are promoting a real person who has proved they can
 * receive mail at that address, not creating an account out of thin air.
 */
import { pool, query } from "@hetja/db";
import { identityHmac } from "../lib/hmac.js";
import { loadConfig } from "../config.js";

type Action = "grant" | "revoke" | "list";

interface FeederRow {
  id: string;
  role: string;
  display_name: string;
  trust_score: number;
}

function usage(): never {
  console.error(
    [
      "",
      "Usage:",
      "  admin:grant  <email>    promote an existing feeder to admin",
      "  admin:revoke <email>    demote an admin back to feeder",
      "  admin:list              list current admins",
      "",
      "The feeder must have signed in at least once — this tool promotes an",
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
      `SELECT id, role, display_name, trust_score FROM feeders WHERE role = 'admin' ORDER BY id`,
    );
    if (res.rowCount === 0) {
      console.log("No admins. Nobody can enrol a dog or moderate a story.");
    } else {
      console.log(`${res.rowCount} admin(s):`);
      for (const r of res.rows) console.log(`  ${r.id}  ${r.display_name}  trust=${r.trust_score}`);
    }
    return;
  }

  const idHmac = identityHmac(email, config.HETJA_HMAC_PEPPER);
  const nextRole = action === "grant" ? "admin" : "feeder";

  const existing = await query<FeederRow>(
    `SELECT id, role, display_name, trust_score FROM feeders WHERE identity_hmac = $1`,
    [idHmac],
  );
  if (existing.rowCount === 0) {
    // Deliberately does NOT create the account. Creating a feeder here would
    // mean minting an admin for an address nobody has proved they control.
    console.error(
      `No feeder found for that address.\n` +
        `They must sign in at hetja.in/login once first — then re-run this.`,
    );
    process.exit(1);
  }
  const feeder = existing.rows[0];
  if (feeder.role === nextRole) {
    console.log(`No change: ${feeder.display_name} (${feeder.id}) is already '${nextRole}'.`);
    return;
  }

  const updated = await query<FeederRow>(
    `UPDATE feeders SET role = $2 WHERE identity_hmac = $1 RETURNING id, role, display_name, trust_score`,
    [idHmac, nextRole],
  );
  const row = updated.rows[0];
  console.log(`${feeder.role} -> ${row.role}  ${row.display_name}  (${row.id})`);
  if (nextRole === "admin") {
    console.log("They can now enrol dogs, mint collars, moderate stories and define territories.");
  }
}

main()
  .then(() => pool.end())
  .catch(async (err: unknown) => {
    console.error("admin role change failed:", err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
