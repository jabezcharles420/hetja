import type { ElementType, ReactNode } from "react";
import styles from "./Label.module.css";

/**
 * The section / field label: 13, 600, uppercase, +0.06em, secondary.
 * Used for "Collar code", "Input", "Today in Mumbai", "My dogs", "Call now".
 * Pass `as="label"` + `htmlFor` when it names a form control.
 */

export interface LabelProps {
  children: ReactNode;
  as?: ElementType;
  htmlFor?: string;
  id?: string;
  /** `band` = the grey label on the black privacy band. */
  tone?: "default" | "band";
  className?: string;
}

export function Label({
  children,
  as: Tag = "div",
  tone = "default",
  className,
  ...rest
}: LabelProps): React.JSX.Element {
  return (
    <Tag
      className={[styles.label, tone === "band" ? styles.band : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
}
