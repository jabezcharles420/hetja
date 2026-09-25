"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { COLLAR_LENGTH, collarGroups, foldConfusables, sanitizeCollarCode } from "./collar";
import { Label } from "./Label";
import styles from "./CollarCodeInput.module.css";

/**
 * Collar code entry (Scan sheet, "Input" in the design system).
 *
 * The <input> holds the display form ("DDR 017 XK2": uppercase, a space every
 * 3) while `onChange` reports the stored form ("ddr017xk2"). Anything outside
 * the collar alphabet is dropped as it is typed or pasted. A ghost layer
 * behind the text draws "___" for the characters still to come, matching the
 * mock. Spaces are tightened with word-spacing so the group gap is the mock's
 * 14px, not a full monospace space.
 */

export interface CollarCodeInputProps {
  /** Controlled stored value (lowercase). Omit for uncontrolled use. */
  value?: string;
  defaultValue?: string;
  /** Called with the stored (lowercase, sanitised) value. */
  onChange?: (code: string) => void;
  /** Fires once the 9th character lands. */
  onComplete?: (code: string) => void;
  /** Visible label above the field, e.g. "Input" or "Collar code". */
  label?: string;
  /** Accessible name when no visible label is shown. */
  "aria-label"?: string;
  /** Helper line under the field, e.g. "Auto-spaces as you type. Accepts any case." */
  helper?: string;
  /** Error line under the field; also sets aria-invalid and the red ring. */
  error?: string;
  /** Prompt line above the field, e.g. "No camera, or the QR is muddy?" */
  prompt?: string;
  name?: string;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  /** Read 0 as O and 1 / l as I instead of dropping them (v6 V2). Default false. */
  fold?: boolean;
  /** Draw the "___" slots for characters still to come. Default true. */
  ghost?: boolean;
  /** Amber ring with no error line (v6 V3, "No dog has this code."). */
  warn?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

function display(code: string): string {
  return collarGroups(code).join(" ");
}

/** Remaining-slots ghost: typed characters as-is (painted transparent), then "_". */
function ghostParts(code: string): { typed: string; rest: string } {
  const mask = (code + "_".repeat(COLLAR_LENGTH - code.length)).toUpperCase();
  const full = collarGroups(mask).join(" ");
  const typedLen = display(code).length;
  return { typed: full.slice(0, typedLen), rest: full.slice(typedLen) };
}

export function CollarCodeInput({
  value,
  defaultValue = "",
  onChange,
  onComplete,
  label,
  helper,
  error,
  prompt,
  name,
  id,
  autoFocus,
  disabled,
  className,
  fold = false,
  ghost: showGhost = true,
  warn = false,
  inputRef,
  "aria-label": ariaLabel,
}: CollarCodeInputProps): React.JSX.Element {
  const clean = (raw: string): string => sanitizeCollarCode(fold ? foldConfusables(raw) : raw);
  const autoId = useId();
  const inputId = id ?? `collar-${autoId}`;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;

  const [inner, setInner] = useState(() => clean(defaultValue));
  const code = value !== undefined ? clean(value) : inner;
  const ref = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);

  // Put the caret back where the user was after we reformat the text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) {
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    const raw = e.target.value;
    const pos = e.target.selectionStart ?? raw.length;
    const next = clean(raw);
    // Caret = number of valid chars before it, mapped back into display form.
    const before = clean(raw.slice(0, pos)).length;
    caret.current = before + Math.max(0, Math.floor((before - 1) / 3));
    if (before > 0 && before % 3 === 0 && before < next.length) caret.current += 1;

    if (value === undefined) setInner(next);
    onChange?.(next);
    if (next.length === COLLAR_LENGTH && code.length !== COLLAR_LENGTH) onComplete?.(next);
  }

  const ghost = ghostParts(code);
  const describedBy = [helper ? helperId : "", error ? errorId : ""].filter(Boolean).join(" ");

  return (
    <div className={[styles.wrap, className ?? ""].filter(Boolean).join(" ")}>
      {prompt && <div className={styles.prompt}>{prompt}</div>}
      {label && (
        <Label as="label" htmlFor={inputId}>
          {label}
        </Label>
      )}
      <div
        className={[styles.field, error ? styles.invalid : warn ? styles.warn : ""].filter(Boolean).join(" ")}
      >
        {showGhost && (
          <span className={styles.ghost} aria-hidden="true">
            <span className={styles.ghostTyped}>{ghost.typed}</span>
            {ghost.rest}
          </span>
        )}
        <input
          ref={(el) => {
            ref.current = el;
            if (typeof inputRef === "function") inputRef(el);
            else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
          }}
          id={inputId}
          name={name}
          className={styles.input}
          type="text"
          value={display(code)}
          onChange={handleChange}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-label={label ? undefined : (ariaLabel ?? "Collar code")}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
      </div>
      {error && (
        <div id={errorId} className={styles.error} role="alert">
          {error}
        </div>
      )}
      {helper && (
        <div id={helperId} className={styles.helper}>
          {helper}
        </div>
      )}
    </div>
  );
}
