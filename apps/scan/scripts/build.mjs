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

console.log("built dist/ (main.js, service-worker.js, index.html)");
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
