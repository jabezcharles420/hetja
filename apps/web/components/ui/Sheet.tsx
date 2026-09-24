"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import styles from "./Sheet.module.css";

/**
 * iOS bottom sheet (UISheetPresentationController): the log-feed flow and
 * the SOS modal on phones. ≥768px it becomes a centred card modal, because a
 * 1280px-wide sheet glued to the bottom of a monitor reads as a bug.
 *
 * Why an aria-modal <div> in a portal and not <dialog>.showModal(): jsdom has
 * no showModal, and we need the exit animation (a closed <dialog> vanishes
 * instantly). What <dialog> would have given us is rebuilt here explicitly:
 * focus moves in, Tab is trapped, Escape and the scrim close it, focus
 * returns to the opener, and the page behind stops scrolling.
 *
 * Drag-to-dismiss uses pointer events on the grabber/header only (so inner
 * scroll areas and form fields behave normally): past 120px, or a fast
 * downward flick, calls `onClose`; otherwise it springs back.
 */

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Visible title; also the dialog's accessible name. */
  title?: ReactNode;
  /** Name when there is no visible title. */
  "aria-label"?: string;
  /** Optional subtitle under the title (becomes aria-describedby). */
  description?: ReactNode;
  children?: ReactNode;
  /** Element to focus on open; defaults to the first focusable in the sheet. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Show the "Done"-style close button in the header. Default true. */
  closeButton?: boolean;
  className?: string;
}

const EXIT_MS = 280;
const DISMISS_PX = 120;

export function Sheet({
  open,
  onClose,
  title,
  "aria-label": ariaLabel,
  description,
  children,
  initialFocusRef,
  closeButton = true,
  className,
}: SheetProps): React.JSX.Element | null {
  const { mounted, closing } = useExitTransition(open, EXIT_MS);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const drag = useRef<{ y: number; t: number; id: number } | null>(null);
  const [dy, setDy] = useState(0);

  useFocusTrap(panelRef, mounted && !closing, onClose, initialFocusRef);
  useScrollLock(mounted);

  useEffect(() => {
    if (open) setDy(0);
  }, [open]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    drag.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const delta = e.clientY - drag.current.y;
    // Rubber-band upward drags (iOS resists pulling a sheet past its detent).
    setDy(delta > 0 ? delta : delta / 6);
  }, []);

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      const delta = e.clientY - d.y;
      const velocity = delta / Math.max(1, e.timeStamp - d.t); // px/ms
      if (delta > DISMISS_PX || (delta > 20 && velocity > 0.6)) {
        // Keep the dragged offset: the exit animation continues from it.
        onClose();
      } else {
        setDy(0);
      }
    },
    [onClose],
  );

  if (!mounted || typeof document === "undefined") return null;

  const dragging = dy !== 0;

  return createPortal(
    <div className={styles.root} data-state={closing ? "closed" : "open"}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`${styles.panel} ${className ?? ""}`}
        data-dragging={dragging ? "" : undefined}
        style={dragging ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div
          className={styles.handleArea}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className={styles.grabber} aria-hidden="true" />
          {title || closeButton ? (
            <div className={styles.head}>
              {title ? (
                <h2 id={titleId} className={styles.title}>
                  {title}
                </h2>
              ) : (
                <span />
              )}
              {closeButton ? (
                <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                    <path
                      d="M2 2l8 8M10 2l-8 8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          ) : null}
          {description ? (
            <p id={descId} className={styles.description}>
              {description}
            </p>
          ) : null}
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------------------------
 * Shared modal plumbing (also used by IOSAlert / ActionSheet in modal mode).
 * ------------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Keeps a component mounted for `ms` after `open` goes false so CSS can play
 * an exit animation (skipped entirely under reduced motion).
 */
export function useExitTransition(open: boolean, ms: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    setClosing(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to `open`
  }, [open]);

  return { mounted: mounted || open, closing: closing && !open };
}

/**
 * Focus trap for aria-modal surfaces: focuses `initial` (or the first
 * focusable, or the container) on activation, cycles Tab/Shift+Tab inside,
 * calls `onEscape` on Escape, and restores focus to the opener afterwards.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const opener = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
      );

    const first = initialFocusRef?.current ?? focusables()[0] ?? container;
    first.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (escRef.current) {
          e.stopPropagation();
          escRef.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const firstEl = list[0]!;
      const lastEl = list[list.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey && (current === firstEl || !container.contains(current))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (current === lastEl || !container.contains(current))) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}

/** Stops the page behind a modal from scrolling (restores the old value). */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
