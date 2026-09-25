"use client";

import styles from "./Segmented.module.css";

/**
 * Segmented control (N3 "Given today / Up to date / Due", N6 alerts mode):
 * a #e8e8ed track, 40px segments, the selected one white with a soft shadow.
 * A radiogroup, so arrow keys move the choice.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedProps<T>): React.JSX.Element {
  const move = (from: number, step: number) => {
    const next = options[(from + step + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[styles.track, className ?? ""].filter(Boolean).join(" ")}
      style={{ ["--seg-count" as string]: options.length }}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value === null && i === 0) ? 0 : -1}
            className={[styles.seg, on ? styles.on : ""].filter(Boolean).join(" ")}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
