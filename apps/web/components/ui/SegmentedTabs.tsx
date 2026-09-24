"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./SegmentedTabs.module.css";

/**
 * iOS segmented control (UISegmentedControl) exposed as an ARIA tablist.
 *
 * Why tabs and not a radio group: every Hetja use (/me "Dogs · Feeds ·
 * Badges", dashboard filters) swaps a panel of content, which is the tabs
 * pattern. Keyboard follows WAI-ARIA APG "tabs with automatic activation":
 * one tab stop (roving tabindex), ←/→ move AND select, Home/End jump.
 *
 * The white thumb is one element translated by index (not a background on
 * the selected button), so it slides with a spring like the real control
 * instead of blinking between segments.
 *
 * Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`). Pass
 * `panels` to have it render the tabpanels too; otherwise it renders only
 * the tablist and the caller owns the content (no dangling aria-controls).
 */

export interface SegmentedItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedTabsProps {
  items: SegmentedItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** Required: a tablist needs a name ("Your activity"). */
  "aria-label": string;
  /** Optional panels keyed by item id; enables aria-controls. */
  panels?: Record<string, ReactNode>;
  /** Stretch to container width (default) or hug the labels. */
  fit?: "fill" | "content";
  className?: string;
}

export function SegmentedTabs({
  items,
  value,
  defaultValue,
  onChange,
  "aria-label": ariaLabel,
  panels,
  fit = "fill",
  className,
}: SegmentedTabsProps): React.JSX.Element {
  const base = useId().replace(/:/g, "");
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? "");
  const selected = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(
    0,
    items.findIndex((i) => i.id === selected),
  );

  const select = useCallback(
    (id: string) => {
      if (value === undefined) setInner(id);
      if (id !== selected) onChange?.(id);
    },
    [value, selected, onChange],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const enabled = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.disabled);
    if (enabled.length === 0) return;
    const pos = enabled.findIndex(({ i }) => i === index);
    let next: number | undefined;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = enabled[(pos + 1) % enabled.length]!.i;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = enabled[(pos - 1 + enabled.length) % enabled.length]!.i;
        break;
      case "Home":
        next = enabled[0]!.i;
        break;
      case "End":
        next = enabled[enabled.length - 1]!.i;
        break;
      default:
        return;
    }
    e.preventDefault();
    select(items[next]!.id);
    refs.current[next]?.focus();
  };

  const tabId = (id: string): string => `${base}-tab-${id}`;
  const panelId = (id: string): string => `${base}-panel-${id}`;

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={`${styles.control} ${fit === "content" ? styles.hug : ""}`}
        style={{ "--n": items.length, "--i": index } as React.CSSProperties}
        onKeyDown={onKeyDown}
      >
        <span className={styles.thumb} aria-hidden="true" />
        {items.map((it, i) => {
          const isSel = i === index;
          return (
            <button
              key={it.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(it.id)}
              aria-selected={isSel}
              aria-controls={panels ? panelId(it.id) : undefined}
              tabIndex={isSel ? 0 : -1}
              disabled={it.disabled}
              className={styles.segment}
              onClick={() => select(it.id)}
            >
              {/* Bold copy reserves width so the label doesn't shift on select. */}
              <span className={styles.label} data-text={typeof it.label === "string" ? it.label : undefined}>
                {it.label}
              </span>
            </button>
          );
        })}
      </div>
      {panels
        ? items.map((it) => (
            <div
              key={it.id}
              role="tabpanel"
              id={panelId(it.id)}
              aria-labelledby={tabId(it.id)}
              hidden={it.id !== selected}
              tabIndex={0}
              className={styles.panel}
            >
              {panels[it.id]}
            </div>
          ))
        : null}
    </div>
  );
}
