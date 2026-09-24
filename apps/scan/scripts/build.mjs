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
// Inter subset for non-Apple devices (see the font note in index.html). Built
// from apps/web/public/fonts/Inter-latin-var.woff2 with fonttools:
//   fonttools varLib.instancer Inter-latin-var.woff2 wght=400:700 -o inst.ttf
//   pyftsubset inst.ttf --unicodes="U+0020-007E,U+00A0,U+00B7,U+00D7,U+2019,U+2026,U+2039,U+203A" //     --layout-features=kern --flavor=woff2 --no-hinting --desubroutinize //     --name-IDs=0,1,2,3,4,5,6,13,14 --drop-tables+=DSIG,STAT --output-file=inter-scan.woff2
// Licence: assets/Inter-OFL.txt (the copyright and licence URL also stay in
// the font's own name table).
copyFileSync(join(ROOT, "assets", "inter-scan.woff2"), join(DIST, "inter-scan.woff2"));

console.log("built dist/ (index.html + font + " + entries.length + " bundles)");
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
