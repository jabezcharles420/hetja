/**
 * The one canonical ordering of the medical_records hash chain.
 *
 * These are SQL fragments rather than six hand-written ORDER BY clauses because
 * the failure mode of this particular duplication is silent and severe: the
 * append path computes and stores a `merkle_root` over one order, and the proof
 * and verify paths recompute over another. If those two orders ever disagree —
 * by a typo, or by someone updating five call sites out of six — the endpoints
 * report TAMPERED over data nobody touched. There is no test that naturally
 * catches "these two string literals drifted apart"; there is one that catches
 * "this constant changed".
 *
 * WHY THE COMPOUND EXPRESSION. `chain_seq` (migration 0017) is allocated by
 * nextval() at INSERT, while pg_advisory_xact_lock(420001) is held, so for rows
 * written since that migration it IS append order. Rows written before it are
 * NULL, because the information needed to reconstruct their true order was
 * never recorded — `created_at` is transaction-START time and provably wrong
 * (the existing data contains a child sorting before its own parent), and the
 * hash links form a forest rather than a chain, so they cannot be walked into a
 * total order either.
 *
 * So NULL rows sort FIRST, among themselves by (created_at, id) — which is not
 * a guess at their true order but a deliberate preservation of the order their
 * stored merkle_root was already computed under. Reordering them would have
 * broken every historical attestation, causing exactly the false TAMPERED
 * verdict 0017 exists to remove.
 *
 * NULLS placement is explicit in both directions and must stay that way.
 * PostgreSQL defaults ASC to NULLS LAST and DESC to NULLS FIRST, so the naive
 * `ORDER BY chain_seq DESC LIMIT 1` silently returns a pre-0017 row as the
 * chain head — verified, and precisely the class of bug this module exists to
 * prevent. The index in 0017 is declared with matching NULLS placement, so both
 * directions are served by a forward or backward scan rather than a sort.
 */

/**
 * Canonical ascending chain order: genesis first, newest last.
 *
 * Use for anything that walks or hashes the chain in order — Merkle leaves,
 * `verifyChain`, `recomputeHead`, the daily anchor. Leaf position IS the leaf
 * index, so this is what makes a proof reproducible.
 */
export const CHAIN_ORDER_ASC = "chain_seq ASC NULLS FIRST, created_at ASC, id ASC";

/**
 * Canonical descending chain order: newest first.
 *
 * Use with `LIMIT 1` to read the chain head — the row whose `hash_curr` the
 * next append chains onto. Note the NULLS LAST: without it a historical row
 * outranks every real append and the chain forks on the very next write.
 */
export const CHAIN_ORDER_DESC = "chain_seq DESC NULLS LAST, created_at DESC, id DESC";
