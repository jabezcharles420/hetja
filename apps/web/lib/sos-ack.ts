/**
 * Words for "I can go and help", shared by the case page (/sos/[caseId]) and
 * the map's ward sheet, so the two never disagree about why a responder was
 * turned away.
 *
 * The server decides who may take a case (hardening T1, POST
 * /api/v1/sos/cases/:id/ack). This module only turns its answer into plain
 * words. SOS screens are plain: no jokes here.
 */

import type { SosCaseState, SosSeverity } from "./api";

export type AckRefusal =
  | "forbidden"
  | "tooMany"
  | "rateLimited"
  | "taken"
  | "closed"
  | "signIn"
  | "notFound"
  | "unreachable";

export interface AckMessage {
  kind: AckRefusal;
  /** The bold first sentence. */
  title: string;
  /** What to do about it, or null when the title says it all. */
  body: string | null;
  /** A next step, when there is a useful one. */
  action: { label: string; href: string } | null;
}

/** "a minute", "5 minutes", "2 hours": the wait from a retry-after, rounded up. */
export function waitWords(retryAfterSec: number | undefined): string {
  if (retryAfterSec === undefined || !Number.isFinite(retryAfterSec) || retryAfterSec <= 90) return "a minute";
  const min = Math.ceil(retryAfterSec / 60);
  if (min < 60) return `${min} minutes`;
  const h = Math.ceil(min / 60);
  return h === 1 ? "an hour" : `${h} hours`;
}

export const ACK_FORBIDDEN_TITLE = "Only trusted responders can take a case.";
export const ACK_FORBIDDEN_BODY =
  "Responders are feeders who turn on SOS alerts in Me and keep a steady feeding record. Trust grows as you keep feeding, one dog a day at a time.";
export const ACK_TOO_MANY = "You already have two open cases. Finish one first.";

/**
 * Classify an ack failure by the API's code and HTTP status. Codes win over
 * statuses (409 means two different things here).
 */
export function ackRefusal(err: { status?: number; code?: string; retryAfterSec?: number } | unknown): AckMessage {
  const e = (typeof err === "object" && err !== null ? err : {}) as {
    status?: number;
    code?: string;
    retryAfterSec?: number;
  };
  const code = e.code;
  const status = e.status ?? 0;

  if (code === "SOS_ACK_FORBIDDEN" || (status === 403 && !code)) {
    return {
      kind: "forbidden",
      title: ACK_FORBIDDEN_TITLE,
      body: ACK_FORBIDDEN_BODY,
      action: { label: "Open Me", href: "/me" },
    };
  }
  if (code === "SOS_TOO_MANY_OPEN_ACKS") {
    return { kind: "tooMany", title: ACK_TOO_MANY, body: null, action: null };
  }
  if (code === "SOS_ALREADY_ACKED") {
    return { kind: "taken", title: "Someone else just took this one.", body: "Thank you for offering.", action: null };
  }
  if (code === "SOS_CASE_CLOSED") {
    return { kind: "closed", title: "This case is already closed.", body: null, action: null };
  }
  if (status === 429 || code === "RATE_LIMITED") {
    return {
      kind: "rateLimited",
      title: "That's a lot of cases in a short time.",
      body: `Try again in ${waitWords(e.retryAfterSec)}.`,
      action: null,
    };
  }
  if (status === 401) {
    return { kind: "signIn", title: "Sign in first.", body: null, action: null };
  }
  if (status === 404) {
    return { kind: "notFound", title: "This case isn't there any more.", body: null, action: null };
  }
  return {
    kind: "unreachable",
    title: "Hetja could not be reached.",
    body: "Try again in a minute.",
    action: null,
  };
}

// ---------------------------------------------------------------------------
// Case words, for the case page

export type PillVariant = "ok" | "warn" | "neutral" | "danger";
export type PillIcon = "check" | "clock" | "cross" | "alert";

/** The case state as a StatusPill: words, tone and icon. */
export function casePill(
  state: SosCaseState,
  mine: boolean,
): { variant: PillVariant; icon: PillIcon; text: string } {
  switch (state) {
    case "open":
      return { variant: "danger", icon: "alert", text: "Needs help" };
    case "acked":
      return mine
        ? { variant: "ok", icon: "check", text: "You took this" }
        : { variant: "warn", icon: "clock", text: "Someone is on the way" };
    case "escalated":
      return { variant: "danger", icon: "alert", text: "Escalated to vets" };
    case "resolved":
      return { variant: "ok", icon: "check", text: "Resolved" };
    case "false_alarm":
    default:
      return { variant: "neutral", icon: "cross", text: "Closed" };
  }
}

/** Severity in the reporter's own words (screen 04's cards). */
export function severityWords(s: SosSeverity): string {
  switch (s) {
    case "critical":
      return "Can't get up, or bleeding";
    case "serious":
      return "Hurt, or needs checking";
    case "minor":
    default:
      return "Minor";
  }
}

/** Is this state one a responder can still take? */
export function isTakeable(state: SosCaseState): boolean {
  return state === "open" || state === "escalated";
}

/** Is this state finished? */
export function isClosed(state: SosCaseState): boolean {
  return state === "resolved" || state === "false_alarm";
}
