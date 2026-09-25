/**
 * The smallest QR encoder this page can justify, for D2 only (a dog's link
 * opened on a desktop shows a QR of the current URL so the visitor can move
 * to their phone). The collar QRs themselves are made by apps/web/lib/qr.ts
 * with qrcode-generator; that library is ~20 KB and would break the 40 KB
 * budget, so this file does only what D2 needs:
 *
 * - byte mode, UTF-8, error correction level L;
 * - versions 1 to 6 (up to 134 bytes; a signed collar URL is 74), so there
 *   are no version-information blocks and at most one alignment pattern;
 * - all eight masks scored with the four standard penalty rules, the lowest
 *   one kept (the spec's own selection; any mask decodes).
 *
 * Longer text returns null and D2 shows no code rather than a wrong one.
 * qr.test.ts checks every mask of this output against qrcode-generator.
 */

/** Per version 1..6 at level L: data codewords per block, EC codewords per block, blocks. */
const DATA = [19, 34, 55, 80, 108, 68];
const EC = [7, 10, 15, 20, 26, 18];
const BLOCKS = [1, 1, 1, 1, 1, 2];

const EXP: number[] = [];
const LOG: number[] = [];
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 256) x ^= 0x11d;
}
const mul = (a: number, b: number): number => (a && b ? EXP[(LOG[a]! + LOG[b]!) % 255]! : 0);

/** Reed-Solomon remainder of `data` for `n` EC codewords. */
function rs(data: number[], n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = Array<number>(g.length + 1).fill(0);
    g.forEach((c, j) => {
      ng[j]! ^= c;
      ng[j + 1]! ^= mul(c, EXP[i]!);
    });
    g = ng;
  }
  const res = Array<number>(n).fill(0);
  for (const b of data) {
    const f = b ^ res.shift()!;
    res.push(0);
    for (let j = 0; j < n; j++) res[j]! ^= mul(g[j + 1]!, f);
  }
  return res;
}

const MASKS: Array<(x: number, y: number) => number> = [
  (x, y) => (x + y) % 2,
  (_x, y) => y % 2,
  (x) => x % 3,
  (x, y) => (x + y) % 3,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
  (x, y) => ((x * y) % 2) + ((x * y) % 3),
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2,
];

/** Rows of 0 (light) and 1 (dark), without the quiet zone. */
export function qrMatrix(text: string, forceMask?: number): number[][] | null {
  const bytes = new TextEncoder().encode(text);
  let v = 0;
  while (v < 6 && bytes.length > DATA[v]! * BLOCKS[v]! - 2) v++;
  if (v === 6) return null;
  const size = 21 + 4 * v;
  const d = DATA[v]!;
  const e = EC[v]!;
  const total = d * BLOCKS[v]!;

  const bits: number[] = [];
  const put = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, 8);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, total * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let p = 0xec; data.length < total; p ^= 0xec ^ 0x11) data.push(p);

  const blocks: number[][] = [];
  for (let b = 0; b < BLOCKS[v]!; b++) blocks.push(data.slice(b * d, b * d + d));
  const ecs = blocks.map((b) => rs(b, e));
  const cw: number[] = [];
  for (let i = 0; i < d; i++) for (const b of blocks) cw.push(b[i]!);
  for (let i = 0; i < e; i++) for (const c of ecs) cw.push(c[i]!);

  const m = [...Array(size)].map(() => Array<number>(size).fill(0));
  const fn = [...Array(size)].map(() => Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean): void => {
    m[y]![x] = dark ? 1 : 0;
    fn[y]![x] = true;
  };
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const r = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, r !== 2 && r !== 4);
      }
  }
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  if (v > 0) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mask: number): void => {
    let r = 8 | mask; // level L is 01
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >> 9) * 0x537);
    const b = (((8 | mask) << 10) | r) ^ 0x5412;
    const bit = (i: number): boolean => ((b >> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);

  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y]![x] && k < cw.length * 8) {
          m[y]![x] = (cw[k >>> 3]! >>> (7 - (k & 7))) & 1;
          k++;
        }
      }
  }

  const apply = (mask: number): void => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y]![x] && MASKS[mask]!(x, y) === 0) m[y]![x]! ^= 1;
  };
  let best = forceMask ?? 0;
  if (forceMask === undefined) {
    let low = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      apply(mask);
      format(mask);
      const s = penalty(m);
      if (s < low) {
        low = s;
        best = mask;
      }
      apply(mask);
    }
  }
  apply(best);
  format(best);
  return m;
}

/** The four penalty rules of ISO/IEC 18004 section 8.8.2. */
function penalty(m: number[][]): number {
  const n = m.length;
  let s = 0;
  let dark = 0;
  for (const l of [...m, ...m.map((_, x) => m.map((r) => r[x]!))]) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && l[i] === l[i - 1]) run++;
      else {
        if (run >= 5) s += run - 2;
        run = 1;
      }
    }
    const str = l.join("");
    for (const p of ["10111010000", "00001011101"]) for (let i = str.indexOf(p); i >= 0; i = str.indexOf(p, i + 1)) s += 40;
  }
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const c = m[y]![x];
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) s += 3;
    }
  m.forEach((r) => r.forEach((c) => (dark += c)));
  return s + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
}

/** An SVG QR (with its 4-module quiet zone), or "" when the text is too long. */
export function qrSvg(text: string): string {
  const m = qrMatrix(text);
  if (!m) return "";
  let d = "";
  m.forEach((r, y) => r.forEach((c, x) => c && (d += `M${x} ${y}h1v1h-1z`)));
  const n = m.length + 8;
  return `<svg class="qr" viewBox="-4 -4 ${n} ${n}" width="132" height="132" role="img" aria-label="QR code for this page" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${n}" height="${n}" fill="#fff"/><path d="${d}"/></svg>`;
}
