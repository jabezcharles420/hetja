/**
 * Guard: refuse to run the worker suite against a non-test database.
 *
 * A copy of apps/api/vitest.setup.ts's guard, deliberately duplicated rather
 * than imported: apps/worker does not depend on @hetja/api, and the alternative
 * (a shared package for eleven lines) would put the guard behind a build step
 * that has to succeed before the guard can refuse anything.
 *
 * These tests INSERT dogs and medical_records, and medical_records is
 * append-only (INVARIANT 8) so that cleanup is impossible by construction.
 * Running the suite on a box configured for production pointed the API suite
 * straight at the live database once already — 64 "GeoTest" dogs and 45
 * unreachable medical records in real data — and this suite writes to the same
 * tables.
 *
 * Set ALLOW_TESTS_ON_REAL_DB=1 to override deliberately.
 */
const db = process.env.PGDATABASE ?? "hetja";
const allowed = /(^|_)test$|^test_/.test(db);

if (!allowed && process.env.ALLOW_TESTS_ON_REAL_DB !== "1") {
  throw new Error(
    [
      "",
      `Refusing to run worker tests against PGDATABASE="${db}".`,
      "",
      'Use a disposable database whose name ends in "_test" — see AGENTS.md §f',
      "for the full bootstrap:",
      "",
      "  PGDATABASE=hetja_test pnpm --filter @hetja/worker test",
      "",
      "Override with ALLOW_TESTS_ON_REAL_DB=1 only if you mean it.",
      "",
    ].join("\n"),
  );
}
