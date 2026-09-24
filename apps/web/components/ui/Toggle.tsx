import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./Toggle.module.css";

/**
 * iOS switch (UISwitch, 51×31) drawn directly on a real
 * <input type="checkbox" role="switch">.
 *
 * Why the native input and not a div: forms, `name`/`value`, label clicks,
 * Space to toggle, and "switch, on/off" announcements all come for free, and
 * it works before hydration. `appearance: none` plus a ::before thumb gives
 * the Apple look without a second DOM node to keep in sync.
 *
 * With `label`, the whole row (label + optional description + switch) is one
 * <label>, i.e. a ≥44px tap target like a Settings row. Without `label`, pass
 * `aria-label` / `aria-labelledby` yourself (e.g. inside a <ListRow>).
 *
 * No "use client": it has no state of its own. Controlled use (`checked` +
 * `onChange`) naturally lives in a client parent.
 */

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> {
  label?: ReactNode;
  description?: ReactNode;
  /** Wrapper class when `label` is set, input class otherwise. */
  className?: string;
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  { label, description, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = description ? `${inputId}-desc` : undefined;
  // The <label> wraps the description too (whole row is the target), so name
  // the switch from the label text alone; the description is the description.
  const labelId = label ? `${inputId}-label` : undefined;

  const input = (
    <input
      ref={ref}
      id={inputId}
      type="checkbox"
      role="switch"
      aria-describedby={descId}
      aria-labelledby={labelId}
      className={`${styles.switch} ${label ? "" : className ?? ""}`}
      {...rest}
    />
  );

  if (!label) return input;

  return (
    <label className={`${styles.row} ${className ?? ""}`} htmlFor={inputId}>
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {description ? (
          <span id={descId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>
      {input}
    </label>
  );
});
