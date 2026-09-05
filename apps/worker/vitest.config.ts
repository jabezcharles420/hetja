import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Refuses to run against a live database — see vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
    // Without this, the default include globs also match the compiled copies in
    // dist/, so every suite runs twice and a stale build can report passing
    // tests for source that no longer exists. Same reason as apps/api.
    exclude: ["**/node_modules/**", "**/dist/**"],
    // One test file at a time. queue.test.ts and expiry.test.ts both drive the
    // REAL job queue through processOneJob(), which claims whatever row in
    // `jobs` is ready — there is no per-test queue. Run in parallel workers,
    // the queue suite consumed the job the expiry suite had just enqueued
    // ("done" where it expected "idle", "idle" where expiry expected "done").
    // That is the pair of failures CI reported on 2026-09-05 after the
    // cross-package race was already serialised; it hid locally because the
    // two files happened never to overlap on this box.
    fileParallelism: false,
  },
});
