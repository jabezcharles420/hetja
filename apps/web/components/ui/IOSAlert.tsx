"use client";

import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitTransition, useFocusTrap, useScrollLock } from "./Sheet";
import styles from "./IOSAlert.module.css";

/**
 * iOS alert (UIAlertController .alert) and action sheet (.actionSheet).
 *
 * Three ways to render, because the same visual does three jobs:
 *   static            A picture of an alert for marketing tiles (Sidehoe's
 *                     `.alert`). role="img" + a full-sentence aria-label; the
 *                     "buttons" are spans, so nothing fake is focusable.
 *   inline (default)  A real role="alertdialog" with buttons, placed in the
 *                     flow (e.g. inside a PhoneFrame demo).
 *   modal             The same, portalled over a scrim with focus trap,
 *                     Escape → the cancel action, and focus restore.
 *
 * iOS rules kept: 270pt wide, 14pt radius; two actions sit side by side,
 * three or more stack; the `preferred` action is semibold; destructive is
 * red; `cancel` is what Escape triggers. Button text uses --h-link rather
 * than systemBlue, which fails AA on the alert grey.
 */

export type AlertActionStyle = "default" | "cancel" | "destructive";

export interface AlertAction {
  label: string;
  style?: AlertActionStyle;
  /** Bold: Apple's `preferredAction`. */
  preferred?: boolean;
  onPress?: () => void;
}

interface ModalModeProps {
  /** Render visual-only (role="img"). */
  static?: boolean;
  /** Portal over a scrim with focus trap. */
  modal?: boolean;
  /** Modal mode only: whether it is shown. Default true. */
  open?: boolean;
  /** Escape / scrim. Falls back to the `cancel` action's onPress. */
  onDismiss?: () => void;
  className?: string;
}

export interface IOSAlertProps extends ModalModeProps {
  title: string;
  message?: ReactNode;
  /** Plain-text message for the static aria-label when `message` is not a string. */
  messageText?: string;
  actions: AlertAction[];
}

export function IOSAlert({
  title,
  message,
  messageText,
  actions,
  static: isStatic,
  modal,
  open = true,
  onDismiss,
  className,
}: IOSAlertProps): React.JSX.Element | null {
  const titleId = useId();
  const msgId = useId();
  const stacked = actions.length > 2;
  const cancel = actions.find((a) => a.style === "cancel");
  const dismiss = onDismiss ?? cancel?.onPress;

  // UIKit: the preferred action is semibold; with none, the cancel action is.
  const anyPreferred = actions.some((a) => a.preferred);
  const actionClass = (a: AlertAction): string =>
    [
      styles.action,
      a.style === "destructive" && styles.destructive,
      (a.preferred || (!anyPreferred && a.style === "cancel")) && styles.preferred,
    ]
      .filter(Boolean)
      .join(" ");

  if (isStatic) {
    const text = typeof message === "string" ? message : messageText;
    const label = `Alert: ${title}.${text ? ` ${text}` : ""} Buttons: ${actions
      .map((a) => a.label)
      .join(", ")}.`;
    return (
      <div role="img" aria-label={label} className={`${styles.alert} ${className ?? ""}`}>
        <div className={styles.body}>
          <b className={styles.title}>{title}</b>
          {message ? <span className={styles.message}>{message}</span> : null}
        </div>
        <div className={`${styles.actions} ${stacked ? styles.stacked : ""}`} data-count={actions.length}>
          {actions.map((a) => (
            <span key={a.label} className={actionClass(a)}>
              {a.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const box = (
    <AlertBox
      className={`${styles.alert} ${className ?? ""}`}
      labelledBy={titleId}
      describedBy={message ? msgId : undefined}
      trap={Boolean(modal) && open}
      onEscape={dismiss}
    >
      <div className={styles.body}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {message ? (
          <p id={msgId} className={styles.message}>
            {message}
          </p>
        ) : null}
      </div>
      <div className={`${styles.actions} ${stacked ? styles.stacked : ""}`} data-count={actions.length}>
        {actions.map((a) => (
          <button key={a.label} type="button" className={actionClass(a)} onClick={a.onPress}>
            {a.label}
          </button>
        ))}
      </div>
    </AlertBox>
  );

  if (!modal) return box;
  return (
    <ModalLayer open={open} onDismiss={dismiss} placement="center">
      {box}
    </ModalLayer>
  );
}

/* --- Action sheet --------------------------------------------------------- */

export interface ActionSheetOption {
  label: string;
  destructive?: boolean;
  onPress?: () => void;
}

export interface ActionSheetProps extends ModalModeProps {
  title?: string;
  message?: string;
  options: ActionSheetOption[];
  cancelLabel?: string;
  onCancel?: () => void;
  /** Accessible name when there is no title. */
  "aria-label"?: string;
}

export function ActionSheet({
  title,
  message,
  options,
  cancelLabel = "Cancel",
  onCancel,
  static: isStatic,
  modal,
  open = true,
  onDismiss,
  className,
  "aria-label": ariaLabel,
}: ActionSheetProps): React.JSX.Element | null {
  const titleId = useId();
  const dismiss = onDismiss ?? onCancel;

  if (isStatic) {
    const label = `Action sheet${title ? `: ${title}` : ""}.${message ? ` ${message}` : ""} Options: ${options
      .map((o) => o.label)
      .concat(cancelLabel)
      .join(", ")}.`;
    return (
      <div role="img" aria-label={label} className={`${styles.sheet} ${className ?? ""}`}>
        <div className={styles.group}>
          {title || message ? (
            <div className={styles.sheetHead}>
              {title ? <b className={styles.sheetTitle}>{title}</b> : null}
              {message ? <span className={styles.sheetMessage}>{message}</span> : null}
            </div>
          ) : null}
          {options.map((o) => (
            <span key={o.label} className={`${styles.option} ${o.destructive ? styles.destructive : ""}`}>
              {o.label}
            </span>
          ))}
        </div>
        <span className={`${styles.group} ${styles.option} ${styles.cancel}`}>{cancelLabel}</span>
      </div>
    );
  }

  const inner = (
    <AlertBox
      className={`${styles.sheet} ${className ?? ""}`}
      labelledBy={title ? titleId : undefined}
      label={title ? undefined : ariaLabel ?? "Options"}
      trap={Boolean(modal) && open}
      onEscape={dismiss}
      role="dialog"
    >
      <div className={styles.group}>
        {title || message ? (
          <div className={styles.sheetHead}>
            {title ? (
              <h2 id={titleId} className={styles.sheetTitle}>
                {title}
              </h2>
            ) : null}
            {message ? <p className={styles.sheetMessage}>{message}</p> : null}
          </div>
        ) : null}
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            className={`${styles.option} ${o.destructive ? styles.destructive : ""}`}
            onClick={o.onPress}
          >
            {o.label}
          </button>
        ))}
      </div>
      <button type="button" className={`${styles.group} ${styles.option} ${styles.cancel}`} onClick={onCancel}>
        {cancelLabel}
      </button>
    </AlertBox>
  );

  if (!modal) return inner;
  return (
    <ModalLayer open={open} onDismiss={dismiss} placement="bottom">
      {inner}
    </ModalLayer>
  );
}

/* --- Internals ------------------------------------------------------------ */

function AlertBox({
  className,
  labelledBy,
  describedBy,
  label,
  trap,
  onEscape,
  role = "alertdialog",
  children,
}: {
  className: string;
  labelledBy?: string;
  describedBy?: string;
  label?: string;
  trap: boolean;
  onEscape?: () => void;
  role?: "alertdialog" | "dialog";
  children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, trap, onEscape);
  return (
    <div
      ref={ref}
      role={role}
      aria-modal={trap ? "true" : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={label}
      tabIndex={-1}
      className={className}
    >
      {children}
    </div>
  );
}

function ModalLayer({
  open,
  onDismiss,
  placement,
  children,
}: {
  open: boolean;
  onDismiss?: () => void;
  placement: "center" | "bottom";
  children: ReactNode;
}): React.JSX.Element | null {
  const { mounted, closing } = useExitTransition(open, 200);
  useScrollLock(mounted);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`${styles.layer} ${placement === "bottom" ? styles.layerBottom : ""}`}
      data-state={closing ? "closed" : "open"}
    >
      <div className={styles.scrim} onClick={onDismiss} aria-hidden="true" />
      <div className={styles.layerInner}>{children}</div>
    </div>,
    document.body,
  );
}
