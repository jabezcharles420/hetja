/**
 * First-aid holding-instructions card.
 *
 * *** DO NOT SET FIRST_AID_ENABLED TO true ***
 *
 * Wrong first-aid advice given to a stranger standing over an injured animal
 * causes real harm. The copy below is a structural placeholder only — it has
 * NOT been reviewed or signed off by a practising vet. Per the plan
 * (docs/PLAN-v2.md §3.4 and §7 open items), this flag must stay `false`
 * until that sign-off exists and is recorded. Do not flip it as part of a
 * routine change; it needs an explicit, separate decision.
 */
export const FIRST_AID_ENABLED = false;

export type Severity = "minor" | "serious" | "critical";

import { escapeHtml } from "./ui";

const COPY: Record<Severity, { title: string; steps: string[] }> = {
  minor: {
    title: "While you wait",
    steps: ["Keep the dog calm and in shade.", "Don't force it to move or stand.", "Keep traffic and other animals away."],
  },
  serious: {
    title: "While you wait",
    steps: [
      "Don't move the dog unless it's in immediate danger, e.g. traffic.",
      "Keep it as still and warm as you safely can.",
    ],
  },
  critical: {
    title: "While you wait",
    steps: [
      "Keep your distance if the dog is thrashing or seems aggressive from pain.",
      "Don't try to move it alone.",
    ],
  },
};

/** Returns "" when the flag is off — callers must treat that as no-render. */
export function renderFirstAid(severity: Severity): string {
  if (!FIRST_AID_ENABLED) return "";
  const c = COPY[severity];
  return `<section class="firstaid"><h3>${escapeHtml(c.title)}</h3><ol>${c.steps
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("")}</ol></section>`;
}
