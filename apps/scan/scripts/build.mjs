import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// index.html ships minified: comments dropped (they are for this repo, not
// for a stranger's phone), the inline stylesheet and script minified by the
// same esbuild, and line indentation removed. Nothing else changes, so the
// source file stays the readable one. Measured on design v6: 6,324 B gzipped
// copied verbatim, 5,084 B minified.
writeFileSync(join(DIST, "index.html"), await minifyHtml(readFileSync(join(ROOT, "index.html"), "utf8")));
// Inter subset for non-Apple devices (see the font note in index.html). Built
// from apps/web/public/fonts/Inter-latin-var.woff2 with fonttools:
//   fonttools varLib.instancer Inter-latin-var.woff2 wght=400:700 -o inst.ttf
//   pyftsubset inst.ttf --unicodes="U+0020-0022,U+0026-0029,U+002B-003B,U+003F,U+0041-005A,U+0061-007A,U+00A0,U+00B7,U+00D7,U+2019,U+2026,U+2039,U+203A" //     --layout-features=kern --flavor=woff2 --no-hinting --desubroutinize //     --name-IDs=0,1,2,3,4,5,6,13,14 --drop-tables+=DSIG,STAT --output-file=inter-scan.woff2
// Licence: assets/Inter-OFL.txt (the copyright and licence URL also stay in
// the font's own name table).
copyFileSync(join(ROOT, "assets", "inter-scan.woff2"), join(DIST, "inter-scan.woff2"));

console.log("built dist/ (index.html + font + " + entries.length + " bundles)");
execFileSync(process.execPath, [join(ROOT, "scripts", "size-gate.mjs")], { stdio: "inherit" });

async function minifyHtml(html) {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const [tag, loader] of [
    ["style", "css"],
    ["script", "js"],
  ]) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
    const parts = [...out.matchAll(re)].map((m) => [m[0], m[1]]);
    for (const [whole, inner] of parts) {
      const { code } = await esbuild.transform(inner, { loader, minify: true, target: "es2020" });
      out = out.replace(whole, () => `<${tag}>${code.trim()}</${tag}>`);
    }
  }
  return out.replace(/\n\s+/g, "\n").replace(/\n+/g, "\n");
}

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
