import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const esbuild = await findEsbuild();
const entries = [
  [join(ROOT, "src/main.ts"), join(DIST, "main.js")],
  [join(ROOT, "src/service-worker.ts"), join(DIST, "service-worker.js")],
  // Telemetry is its own entry so it stays out of main.js and off the critical
  // path -- see the header of src/telemetry-entry.ts. It has to be an entry
  // rather than a dynamic import() because these are IIFE bundles, and esbuild
  // cannot code-split IIFE output: it inlines the import back into main.js
  // instead, which silently undoes the split.
  [join(ROOT, "src/telemetry-entry.ts"), join(DIST, "telemetry.js")],
];

for (const [inFile, outFile] of entries) {
  await esbuild.build({
    entryPoints: [inFile],
    outfile: outFile,
    bundle: true,
    minify: true,
    target: "es2020",
    format: "iife",
    sourcemap: false,
  });
}

copyFileSync(join(ROOT, "index.html"), join(DIST, "index.html"));

console.log("built dist/ (index.html + " + entries.length + " bundles)");
execFileSync(process.execPath, [join(ROOT, "scripts", "size-gate.mjs")], { stdio: "inherit" });

async function findEsbuild() {
  const candidates = [
    () => import("esbuild"),
    () => import(pathToFileURL(join(ROOT, "..", "..", "node_modules", ".pnpm", "node_modules", "esbuild", "lib", "main.js")).href),
  ];
  for (const load of candidates) {
    try {
      return await load();
    } catch {
      /* try next */
    }
  }
  throw new Error("esbuild not found. Add esbuild as a devDependency or build via tsc.");
}
