/**
 * Guard: refuse to run the API suite against a non-test database.
 *
 * These tests INSERT real rows (dogs, feeders, vets, medical_records) and clean
 * up with DELETE. That cleanup is incomplete by construction — medical_records
 * is append-only (INVARIANT 9), so test medical rows can never be removed, and
 * a dog with dependent rows survives its own DELETE.
 *
 * Because the suite reads PGDATABASE/PGHOST from the environment, running it on
 * a machine configured for production pointed it straight at the live database.
 * That is how the VPS ended up with 64 "GeoTest" dogs, 17 "SosTest" dogs, 18
 * "Test Clinic" vets and 45 unreachable medical records mixed into real data.
 *
 * Set ALLOW_TESTS_ON_REAL_DB=1 to override deliberately.
 */
const db = process.env.PGDATABASE ?? "straynet";
const allowed = /(^|_)test$|^test_/.test(db);

if (!allowed && process.env.ALLOW_TESTS_ON_REAL_DB !== "1") {
  throw new Error(
    [
      "",
      `Refusing to run tests against PGDATABASE="${db}".`,
      "",
      "This suite writes rows it cannot fully clean up, so it must not touch a",
      'live database. Use a disposable one whose name ends in "_test":',
      "",
      "  createdb straynet_test",
      '  psql -d straynet_test -c "CREATE EXTENSION postgis; CREATE EXTENSION vector; CREATE EXTENSION pgcrypto;"',
      "  PGDATABASE=straynet_test pnpm --filter @hetja/db migrate",
      "  PGDATABASE=straynet_test pnpm --filter @hetja/api test",
      "",
      "Override with ALLOW_TESTS_ON_REAL_DB=1 only if you mean it.",
      "",
    ].join("\n"),
  );
}
