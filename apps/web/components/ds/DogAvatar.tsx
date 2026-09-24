import styles from "./DogAvatar.module.css";

/**
 * Dog avatar: a pastel circle, one colour per dog forever. The pair comes
 * from a stable hash of the dog's id (or slug), so the same dog looks the same
 * on every screen and every device. A photo wins; otherwise the initial in the
 * matching dark colour, weight 700 at about 40% of the diameter.
 */

export const AVATAR_PALETTES = ["apricot", "lilac", "mint", "rose", "sky"] as const;
export type AvatarPalette = (typeof AVATAR_PALETTES)[number];
export type DogAvatarSize = 36 | 44 | 52 | 56 | 104 | 120;

/** FNV-1a 32-bit: tiny, stable across runtimes, good spread on short ids. */
export function avatarPalette(seed: string): AvatarPalette {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return AVATAR_PALETTES[(h >>> 0) % AVATAR_PALETTES.length];
}

export interface DogAvatarProps {
  /** Dog id or slug: drives the colour. */
  id: string;
  /** Dog name: its first letter is the fallback. */
  name: string;
  photoUrl?: string | null;
  size?: DogAvatarSize;
  /** Force a palette (design-system swatches). */
  palette?: AvatarPalette;
  /** 3px ring in this colour, for overlapping avatar rows (home hero). */
  ring?: string;
  /** Announce the avatar (off by default: the name is almost always beside it). */
  labelled?: boolean;
  className?: string;
}

const FONT: Record<DogAvatarSize, number> = { 36: 15, 44: 18, 52: 20, 56: 22, 104: 42, 120: 48 };

export function DogAvatar({
  id,
  name,
  photoUrl,
  size = 56,
  palette,
  ring,
  labelled = false,
  className,
}: DogAvatarProps): React.JSX.Element {
  const p = palette ?? avatarPalette(id);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className={[styles.avatar, styles[p], className ?? ""].filter(Boolean).join(" ")}
      data-palette={p}
      style={{
        width: size,
        height: size,
        fontSize: FONT[size],
        letterSpacing: size >= 104 ? "-0.03em" : undefined,
        boxShadow: ring ? `0 0 0 3px ${ring}` : undefined,
      }}
      {...(labelled ? { role: "img", "aria-label": name } : { "aria-hidden": true })}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.photo} src={photoUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        initial
      )}
    </span>
  );
}
