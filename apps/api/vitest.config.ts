import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without this, the default include globs also match the compiled copies in
    // dist/, so every suite runs twice and a stale build can report passing
    // tests for source that no longer exists.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
