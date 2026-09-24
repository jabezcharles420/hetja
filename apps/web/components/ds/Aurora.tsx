import type { ElementType, ReactNode } from "react";
import styles from "./Aurora.module.css";

/**
 * Aurora: static layered radial gradients over the aurora base, copied
 * recipe for recipe from the mocks. Marketing and reading pages only; never
 * Scan, Dog profile, SOS or /hetja (hard rule 6/7).
 *
 * `drift` adds a very slow movement, and only under
 * prefers-reduced-motion: no-preference (the CSS gates it, not JS).
 */

export type AuroraVariant = "home" | "light" | "desktop" | "about" | "faq" | "contact";

export interface AuroraProps {
  children?: ReactNode;
  /** home = mobile home (Pages 01); light = Login (App 07/08); desktop = Landing 18;
   * about / faq / contact = the reading-page headers (Pages 12 / 14 / 16). */
  variant?: AuroraVariant;
  drift?: boolean;
  as?: ElementType;
  className?: string;
}

export function Aurora({
  children,
  variant = "home",
  drift = false,
  as: Tag = "div",
  className,
}: AuroraProps): React.JSX.Element {
  return (
    <Tag
      className={[styles.aurora, styles[variant], drift ? styles.drift : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      data-aurora={variant}
    >
      {children}
    </Tag>
  );
}
