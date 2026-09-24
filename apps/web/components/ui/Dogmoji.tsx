"use client";
/* eslint-disable @next/next/no-img-element -- next/image would route 1–10 KB
   pre-sized WebPs through the image optimiser for no gain, and can't express
   the photo → sticker → glyph fallback chain. */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CAST,
  castFor,
  dogmojiSrc,
  dogmojiSrcSet,
  gradientCss,
  type CastDog,
  type DogAccessory,
  type DogBase,
  type DogmojiAsset,
  type GradientPair,
} from "@/lib/dogmoji";
import styles from "./Dogmoji.module.css";

/**
 * <Dogmoji>: Hetja's port of Sidehoe's `.avatar[data-who]` pattern: a pastel
 * gradient circle with a glossy 3D dog inside.
 *
 * Resolution order (first wins):
 *   1. `photoUrl`: a real photo of a real dog, object-fit: cover. A real dog
 *      always beats a cartoon of one.
 *   2. the Fluent 3D WebP for the dog's base (`dog` → `seed` → Bruno).
 *   3. the 🐶 glyph, if the image fails (offline, blocked, 404). Only then:
 *      the stickers are transparent, so a glyph underneath would show through.
 *
 * Decorative by default (aria-hidden, alt=""): the dog's name is always next
 * to it in text. Pass `label` when the avatar stands alone.
 *
 * Client component only because of the onError fallback.
 */

export interface DogmojiProps {
  /** A cast dog (or any object with base/bg). */
  dog?: Pick<CastDog, "base" | "bg"> & Partial<Pick<CastDog, "accessory" | "name">>;
  /** A real dog's slug or name → stable look via castFor(). Ignored if `dog` set. */
  seed?: string;
  /** Overrides. */
  base?: DogBase;
  bg?: GradientPair;
  /** Accessory badge; `false` suppresses the dog's default one. */
  accessory?: DogAccessory | false;
  /** Diameter in px. Default 48. */
  size?: number;
  /** Real photo URL; wins over the sticker when present. */
  photoUrl?: string | null;
  /** Accessible name; when set the avatar is role="img" instead of hidden. */
  label?: string;
  /** Eager-load (above the fold, e.g. the hero). Default lazy. */
  priority?: boolean;
  className?: string;
}

export function Dogmoji({
  dog,
  seed,
  base,
  bg,
  accessory,
  size = 48,
  photoUrl,
  label,
  priority = false,
  className,
}: DogmojiProps): React.JSX.Element {
  const look = dog ?? (seed ? castFor(seed) : CAST[0]!);
  const asset = base ?? look.base;
  const gradient = bg ?? look.bg;
  const badge = accessory === false ? undefined : (accessory ?? look.accessory);

  // Which layer is showing: photo → sticker → glyph, as each one fails.
  // Failures are remembered per source, so a new photoUrl/base gets a fresh try.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [failedSticker, setFailedSticker] = useState<DogBase | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const usePhoto = Boolean(photoUrl) && failedPhoto !== photoUrl;
  const useSticker = !usePhoto && failedSticker !== asset;

  // An <img> that errors BEFORE hydration never fires React's onError. Catch
  // that case on mount / source change: complete with zero natural width = broken.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete || img.naturalWidth !== 0 || !img.getAttribute("src")) return;
    if (usePhoto) setFailedPhoto(photoUrl ?? null);
    else setFailedSticker(asset);
  }, [usePhoto, photoUrl, asset]);

  const style = {
    "--s": `${size}px`,
    "--bg": gradientCss(gradient),
    "--ring": badge?.kind === "collar" ? badge.color : undefined,
  } as CSSProperties;

  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true } as const);

  return (
    <span
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={style}
      data-dogmoji={asset}
      data-collar={badge?.kind === "collar" ? "" : undefined}
      {...a11y}
    >
      <span className={`h-avatar ${styles.circle}`}>
        {usePhoto ? (
          <img
            ref={imgRef}
            key={`photo:${photoUrl}`}
            className={styles.photo}
            src={photoUrl!}
            alt=""
            width={size}
            height={size}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            onError={() => setFailedPhoto(photoUrl ?? null)}
          />
        ) : useSticker ? (
          <img
            ref={imgRef}
            key={`sticker:${asset}`}
            src={dogmojiSrc(asset, size > 64 ? 256 : 128)}
            srcSet={dogmojiSrcSet(asset)}
            sizes={`${Math.round(size * 0.84)}px`}
            alt=""
            width={Math.round(size * 0.84)}
            height={Math.round(size * 0.84)}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            onError={() => setFailedSticker(asset)}
          />
        ) : (
          <span className={styles.glyph} data-dogmoji-glyph="">
            🐶
          </span>
        )}
      </span>
      {badge?.kind === "medical" ? (
        <span className={styles.medical} data-dogmoji-medical="">
          ✚
        </span>
      ) : null}
    </span>
  );
}

export interface StickerProps {
  name: DogmojiAsset;
  /** Rendered px (square). Default 32. */
  size?: number;
  className?: string;
  priority?: boolean;
  /** Accessible name; decorative (alt="") when omitted. */
  alt?: string;
}

/** A plain 3D emoji image (bone, syringe, trophy…) with no circle. */
export function Sticker({
  name,
  size = 32,
  className,
  priority = false,
  alt = "",
}: StickerProps): React.JSX.Element {
  return (
    <img
      className={[styles.sticker, className].filter(Boolean).join(" ")}
      src={dogmojiSrc(name, size > 64 ? 256 : 128)}
      srcSet={dogmojiSrcSet(name)}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      data-sticker={name}
    />
  );
}
