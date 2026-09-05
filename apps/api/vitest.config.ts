import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Refuses to run against a live database — see vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
    // Without this, the default include globs also match the compiled copies in
    // dist/, so every suite runs twice and a stale build can report passing
    // tests for source that no longer exists.
    exclude: ["**/node_modules/**", "**/dist/**"],
    // One test file at a time. The suite shares one database and several
    // routes count GLOBAL rows — stats.test.ts asserts dogsTracked grew by
    // exactly 2, which is only true if no other file inserted a dog in the
    // same instant. In parallel Vitest workers on GitHub's runners it did
    // ("expected 25 to be 28", Deploy Gate 2026-09-05); it never overlapped
    // on the dev box. Same reasoning as apps/worker/vitest.config.ts.
    fileParallelism: false,
  },
});
