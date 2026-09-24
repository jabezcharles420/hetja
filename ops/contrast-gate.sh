#!/bin/bash
# Contrast gate: every text/background pair in packages/design/tokens.css
# must meet WCAG-AA 4.5:1 (enhancement stack §M.10/§M.11, Phase 0 #5).
# Zero-dependency WCAG relative-luminance formula; no chroma.js needed.
set -u
cd "$(dirname "$0")/.."
exec node - <<'EOF'
const fs = require("fs");
const css = fs.readFileSync("packages/design/tokens.css", "utf8");
const tokens = {};
for (const m of css.matchAll(/--h-([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)) tokens[m[1]] = m[2];

const need = ["white", "mist", "ink", "secondary", "text-mid", "blue", "link", "blue-tint", "blue-tint-ink", "sos", "ok", "ok-bg", "warn", "warn-bg", "neutral", "neutral-bg", "danger", "danger-bg", "band", "band-ink", "band-sub", "band-link", "memorial-bg", "aurora-base"];
for (const t of need) {
  if (!tokens[t]) {
    console.error(`FAIL: token --h-${t} missing from packages/design/tokens.css`);
    process.exit(1);
  }
}

function lum(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Every text/background pair the v4 design uses. --h-tertiary is
// placeholders/chevrons only and deliberately absent.
const pairs = [
  // body and supporting text
  ["--h-ink", "--h-white"],
  ["--h-ink", "--h-mist"],
  ["--h-ink", "--h-aurora-base"],
  ["--h-ink", "--h-memorial-bg"],
  ["--h-secondary", "--h-white"],
  ["--h-secondary", "--h-mist"],
  ["--h-secondary", "--h-aurora-base"],
  ["--h-secondary", "--h-memorial-bg"],
  ["--h-text-mid", "--h-white"],
  ["--h-link", "--h-white"],
  ["--h-link", "--h-mist"],
  // button labels
  ["--h-white", "--h-blue"],
  ["--h-white", "--h-sos"],
  ["--h-blue-tint-ink", "--h-blue-tint"],
  // status pills (icon + words; text still has to pass)
  ["--h-ok", "--h-ok-bg"],
  ["--h-warn", "--h-warn-bg"],
  ["--h-neutral", "--h-neutral-bg"],
  ["--h-danger", "--h-danger-bg"],
  // black privacy band
  ["--h-band-ink", "--h-band"],
  ["--h-band-sub", "--h-band"],
  ["--h-band-link", "--h-band"],
];

let fail = 0;
for (const [fg, bg] of pairs) {
  const c = contrast(tokens[fg.replace("--h-", "")], tokens[bg.replace("--h-", "")]);
  const ok = c >= 4.5;
  console.log(`${ok ? "PASS" : "FAIL"}: ${fg} on ${bg} = ${c.toFixed(2)}:1 (need >= 4.5)`);
  if (!ok) fail = 1;
}
process.exit(fail);
EOF
