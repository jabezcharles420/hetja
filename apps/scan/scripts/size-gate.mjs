#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILES = ["dist/index.html", "dist/main.js", "dist/service-worker.js"];
const MAX_BYTES = 40 * 1024;

let total = 0;
for (const rel of FILES) {
  let raw;
  try {
    raw = readFileSync(join(ROOT, rel));
  } catch (err) {
    if (err?.code === "ENOENT") {
      // dist/ is gitignored, so a clean checkout has nothing to measure. Say so
      // instead of surfacing a bare ENOENT that reads like a broken gate.
      console.error(
        `size:gate cannot find ${rel} -- apps/scan has not been built.\n` +
          "Run `pnpm --filter @hetja/scan build` first (CI does this in the Gate job).",
      );
      process.exit(2);
    }
    throw err;
  }
  const gz = gzipSync(raw).byteLength;
  total += gz;
  console.log(`${String(gz).padStart(6)} B gz   ${String(raw.length).padStart(7)} B raw   ${rel}`);
}

console.log(`total gzipped: ${total} B  (budget ${MAX_BYTES} B)`);
if (total > MAX_BYTES) {
  console.error(`FAIL: bundle exceeds ${MAX_BYTES} B (40KB) gzipped`);
  process.exit(1);
}
console.log("PASS: within 40KB gzipped");
