/**
 * Dogmoji: the cast of Memoji-style dogs that stands in for Hetja's users'
 * faces the way Sidehoe's `PEOPLE` table stands in for its roster.
 *
 * Why not Apple Memoji: Memoji/Animoji art is Apple IP and cannot ship on the
 * web. Microsoft's Fluent Emoji 3D has the same glossy, soft-lit look under the
 * MIT licence (see public/dogmoji/LICENSE-fluentui-emoji.txt), so the assets in
 * public/dogmoji/<key>-{128,256}.webp come from there.
 *
 * Why a fixed cast: marketing surfaces (landing hero, bento tiles, the orbit)
 * need specific dogs with specific facts ("Biscuit's rabies shot is due
 * Friday"), never "Dog 1". Real dogs in the app get a *stable* look from the
 * same cast via `castFor(slug)`, so a dog without a photo looks the same on
 * every screen and every visit, and nobody has to pick an avatar.
 *
 * The gradient pairs are Sidehoe's pastel pairs verbatim. They are character
 * data (like a dog's name), not UI chrome, so they live here rather than in
 * tokens.css.
 */

/** Every 3D sticker shipped in public/dogmoji. */
export const DOGMOJI_ASSETS = [
  "dog-face",
  "dog",
  "poodle",
  "guide-dog",
  "service-dog",
  "wolf",
  "paw-prints",
  "bone",
  "syringe",
  "pill",
  "ambulance",
  "hospital",
  "house",
  "round-pushpin",
  "sparkles",
  "red-heart",
  "trophy",
  "fire",
  "shield",
  "locked",
  "camera",
  "bowl-with-spoon",
  "stethoscope",
  "bell",
  "party-popper",
  "sun",
  "crescent-moon",
  "camera-with-flash",
  "adhesive-bandage",
  "drop-of-blood",
] as const;

export type DogmojiAsset = (typeof DOGMOJI_ASSETS)[number];

/** The subset of assets that are a dog's face/body (usable as an avatar base). */
export type DogBase = "dog-face" | "dog" | "poodle" | "guide-dog" | "service-dog" | "wolf";

export const DOG_BASES: readonly DogBase[] = [
  "dog-face",
  "dog",
  "poodle",
  "guide-dog",
  "service-dog",
  "wolf",
];

/** A [top, bottom] linear-gradient pair for the avatar circle. */
export type GradientPair = readonly [string, string];

/** Sidehoe's ten pastel pairs, in its order. */
export const GRADIENTS: readonly GradientPair[] = [
  ["#ffd9e4", "#ffb3c8"], // pink
  ["#fff0b8", "#ffd966"], // butter
  ["#d6e9ff", "#a9d0ff"], // blue
  ["#e6dcff", "#c7b3ff"], // lilac
  ["#d3f5df", "#a3e6bc"], // mint
  ["#ffe2cc", "#ffc199"], // peach
  ["#ffe9b8", "#ffc766"], // amber
  ["#ffd6d6", "#ffa8a8"], // rose
  ["#d9f2ff", "#a6dcff"], // sky
  ["#eadcff", "#cdb3ff"], // violet
];

/**
 * Optional accessory so cast members sharing a base asset still read as
 * different dogs: a collar-coloured ring, or a ✚ medical dot for a dog with an
 * open health item.
 */
export type DogAccessory = { kind: "collar"; color: string } | { kind: "medical" };

export interface CastDog {
  /** Stable id, lowercase name. */
  key: string;
  name: string;
  base: DogBase;
  bg: GradientPair;
  /** Short orbit/roster tag: "Fed 2h ago". */
  tag: string;
  /** True when the tag is overdue/urgent (rendered red). */
  late?: boolean;
  /** Mumbai neighbourhood, never finer (INVARIANT: ward-level location only). */
  ward: string;
  accessory?: DogAccessory;
}

/** The ten named Mumbai dogs used on every marketing surface. */
export const CAST: readonly CastDog[] = [
  { key: "bruno", name: "Bruno", base: "dog-face", bg: GRADIENTS[0], tag: "Fed 2h ago", ward: "Dadar West", accessory: { kind: "collar", color: "#ff3b30" } },
  { key: "biscuit", name: "Biscuit", base: "poodle", bg: GRADIENTS[1], tag: "Rabies due Fri", late: true, ward: "Bandra West", accessory: { kind: "medical" } },
  { key: "kaalu", name: "Kaalu", base: "dog", bg: GRADIENTS[2], tag: "Night-shift regular", ward: "Worli" },
  { key: "moti", name: "Moti", base: "guide-dog", bg: GRADIENTS[3], tag: "Fed twice today", ward: "Matunga", accessory: { kind: "collar", color: "#0a84ff" } },
  { key: "sheru", name: "Sheru", base: "wolf", bg: GRADIENTS[4], tag: "Limping · vet Tue", late: true, ward: "Sion", accessory: { kind: "medical" } },
  { key: "rani", name: "Rani", base: "service-dog", bg: GRADIENTS[5], tag: "Sterilised", ward: "Colaba" },
  { key: "tommy", name: "Tommy", base: "dog-face", bg: GRADIENTS[6], tag: "Will sell you out for Parle-G", ward: "Andheri East", accessory: { kind: "collar", color: "#34c759" } },
  { key: "laddoo", name: "Laddoo", base: "poodle", bg: GRADIENTS[7], tag: "3 feeders today", ward: "Chembur" },
  { key: "chikki", name: "Chikki", base: "dog", bg: GRADIENTS[8], tag: "New in the lane", ward: "Powai" },
  { key: "bholu", name: "Bholu", base: "guide-dog", bg: GRADIENTS[9], tag: "Not fed since 9 AM", late: true, ward: "Kurla", accessory: { kind: "collar", color: "#ff9f0a" } },
];

/** Public URL of a sticker at one of the two exported sizes. */
export function dogmojiSrc(asset: DogmojiAsset, size: 128 | 256 = 128): string {
  return `/dogmoji/${asset}-${size}.webp`;
}

/** `srcSet` string covering both exported sizes (pair with `sizes`). */
export function dogmojiSrcSet(asset: DogmojiAsset): string {
  return `${dogmojiSrc(asset, 128)} 128w, ${dogmojiSrc(asset, 256)} 256w`;
}

/** CSS `background` value for a gradient pair (Sidehoe's top-to-bottom). */
export function gradientCss(bg: GradientPair): string {
  return `linear-gradient(${bg[0]}, ${bg[1]})`;
}

/**
 * 32-bit FNV-1a. Tiny, dependency-free and (the only property that matters
 * here) identical on the server and in every browser, so the SSR markup and
 * the hydrated markup pick the same dog.
 */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The cast member that represents any dog, deterministically.
 *
 * A cast name ("Bruno", "bruno") returns that cast dog, so marketing copy and
 * avatars can never disagree. Anything else (a real dog's slug) hashes to a
 * stable pick. Normalised (trimmed, lower-cased) so "Bruno " and "bruno" match.
 */
export function castFor(slugOrName: string): CastDog {
  const norm = slugOrName.trim().toLowerCase();
  const named = CAST.find((d) => d.key === norm);
  if (named) return named;
  return CAST[hashString(norm) % CAST.length]!;
}
