"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Sheet.module.css";

/**
 * Bottom sheet for a small editor (N6 "Name shown ›", "My wards ›").
 * A modal dialog: focus moves in on open and back to the opener on close,
 * Escape and the scrim close it, Tab stays inside. Rendered only while open.
 */

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** The sheet's one action, pinned under the content. */
  footer?: ReactNode;
  /** The close control's words (default "Cancel"). */
  closeLabel?: string;
  className?: string;
}

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = "Cancel",
  className,
}: SheetProps): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>("input, select, textarea") ?? el;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.root}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[styles.panel, className ?? ""].filter(Boolean).join(" ")}
      >
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.foot}>{footer}</div> : null}
      </div>
    </div>
  );
}
