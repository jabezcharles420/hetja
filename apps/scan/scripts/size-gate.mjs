#!/usr/bin/env node
/**
 * INVARIANT 13: everything apps/scan ships must fit in 40 KB gzipped.
 *
 * The file list used to be hardcoded:
 *
 *   const FILES = ["dist/index.html", "dist/main.js", "dist/service-worker.js"];
 *
 * which measured the bundle only as long as the bundle had exactly those three
 * files. The moment anything is code-split — and `import()` is the correct fix
 * for keeping non-critical work off this page's critical path — esbuild emits an
 * extra chunk that the gate silently stopped counting. So the gate became MORE
 * permissive precisely when splitting started, and a chunk could grow without
 * limit while CI reported the budget intact.
 *
 * Walking dist/ instead means new artifacts are counted by default. A gate
 * should fail closed on things it has not been told about, not ignore them.
 */
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const MAX_BYTES = 40 * 1024;

/**
 * Artifacts that are not part of what a visitor downloads for a page view.
 * Deliberately a short, explicit list — anything not named here counts.
 */
const EXCLUDE = [
  /\.map$/, // source maps: never requested by a browser unless devtools is open
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(DIST).sort();
} catch (err) {
  if (err?.code === "ENOENT") {
    // dist/ is gitignored, so a clean checkout has nothing to measure. Say so
    // instead of surfacing a bare ENOENT that reads like a broken gate.
    console.error(
      "size:gate cannot find dist/ -- apps/scan has not been built.\n" +
        "Run `pnpm --filter @hetja/scan build` first (CI does this in the Gate job).",
    );
    process.exit(2);
  }
  throw err;
}

const counted = files.filter((f) => !EXCLUDE.some((re) => re.test(f)));
if (counted.length === 0) {
  console.error("size:gate found no files in dist/ -- the build produced nothing.");
  process.exit(2);
}

// An empty or missing entry point is a broken build, not a small one. Without
// this a gate walking a directory happily reports "0 B, PASS".
const REQUIRED = ["dist/index.html", "dist/main.js"];
for (const rel of REQUIRED) {
  if (!counted.some((f) => relative(ROOT, f).split(sep).join("/") === rel)) {
    console.error(`size:gate expected ${rel} in the build output and did not find it.`);
    process.exit(2);
  }
}

let total = 0;
for (const full of counted) {
  const rel = relative(ROOT, full).split(sep).join("/");
  const raw = readFileSync(full);
  const gz = gzipSync(raw).byteLength;
  total += gz;
  console.log(`${String(gz).padStart(6)} B gz   ${String(raw.length).padStart(7)} B raw   ${rel}`);
}

console.log(`total gzipped: ${total} B  (budget ${MAX_BYTES} B)  across ${counted.length} file(s)`);
if (total > MAX_BYTES) {
  console.error(`FAIL: bundle exceeds ${MAX_BYTES} B (40KB) gzipped`);
  process.exit(1);
}
console.log("PASS: within 40KB gzipped");
