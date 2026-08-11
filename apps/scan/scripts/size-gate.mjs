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
  const raw = readFileSync(join(ROOT, rel));
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
