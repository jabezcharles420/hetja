/**
 * Words for the design v6 SOS case page (P9, P10, P11, L4, L5, L6, V21,
 * V22): the timeline, distance, outcomes and each state's headline. Plain,
 * no jokes: this is the SOS path. Pure functions, so every line is tested.
 */

import { wardDisplay } from "@hetja/contracts";
import type {
  SosCaseV6,
  SosOutcome,
  SosResponderChecklist,
  SosSeverity,
  SosTimelineEntry,
} from "./api";
import { pronouns, type Pronouns } from "./care-copy";

/** "K/W Andheri West", or the code alone, or null. */
export function wardLabel(wardId: string | null | undefined, wardName?: string | null): string | null {
  if (!wardId) return null;
  const d = wardDisplay(wardId);
  const name = wardName ?? d.name;
  return name ? `${d.code} ${name}` : d.code;
}

export function wardCode(wardId: string | null | undefined): string | null {
  return wardId ? wardDisplay(wardId).code : null;
}

/** The v4 severity words, used as the P9 / L4 / L5 subtitle. */
export function severityLine(s: SosSeverity): string {
  return s === "critical" ? "Can't get up, or bleeding" : s === "serious" ? "Hurt, or needs checking" : "Minor";
}

/** "4:02 pm" (withMeridiem) or "4:02", Asia/Kolkata. */
export function clock(iso: string, withMeridiem = true): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "";
  const ap = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase();
  return withMeridiem && ap ? `${h}:${m} ${ap}` : `${h}:${m}`;
}

/** "16 min ago", "3 h ago", "just now". */
export function since(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** L5's pill: "1 hour", "40 min", "3 hours". */
export function duration(fromIso: string, now = Date.now()): string {
  const min = Math.max(1, Math.round((now - Date.parse(fromIso)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h === 1 ? "1 hour" : `${h} hours`;
}

/** "About 1.4 km from you" / "About 900 m from you". */
export function distanceWords(m: number): string {
  if (m < 1000) return `About ${Math.max(100, Math.round(m / 100) * 100)} m from you`;
  return `About ${(Math.round(m / 100) / 10).toFixed(1).replace(/\.0$/, "")} km from you`;
}

/** Autos in Mumbai traffic: about 15 km/h door to door. "Around 6 minutes by auto". */
export function autoMinutes(m: number): string {
  const min = Math.max(1, Math.round(m / 250));
  return `Around ${min} ${min === 1 ? "minute" : "minutes"} by auto`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 feeders and 1 vet", "4 vets and 2 NGOs", "3 feeders". */
export function toldWords(parts: { feeders?: number; vets?: number; ngos?: number }): string | null {
  const bits: string[] = [];
  if (parts.feeders) bits.push(plural(parts.feeders, "feeder", "feeders"));
  if (parts.vets) bits.push(plural(parts.vets, "vet", "vets"));
  if (parts.ngos) bits.push(plural(parts.ngos, "NGO", "NGOs"));
  if (bits.length === 0) return null;
  if (bits.length === 1) return bits[0]!;
  return `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`;
}

/** The P11 choices and the words the timeline uses for each. */
export const OUTCOMES: { value: Extract<SosOutcome, "taken_to_vet" | "treated_on_spot" | "not_found" | "died">; label: (p: Pronouns) => string }[] = [
  { value: "taken_to_vet", label: () => "Taken to a vet" },
  { value: "treated_on_spot", label: () => "Treated on the spot" },
  { value: "not_found", label: () => "Couldn't find the dog" },
  { value: "died", label: (p) => `${cap(p.subject)} didn't make it` },
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function outcomeWords(o: SosOutcome | null | undefined): string {
  switch (o) {
    case "taken_to_vet":
      return "Taken to a vet";
    case "treated_on_spot":
      return "Treated on the spot";
    case "not_found":
      return "Couldn't find the dog";
    case "died":
      return "Didn't make it";
    case "false_alarm":
      return "Closed without a rescue";
    default:
      return "Resolved";
  }
}

export interface TimelineRow {
  at: string;
  text: string;
  /** solid ink, hollow (future), red (escalated), green (good end). */
  dot: "ink" | "hollow" | "red" | "green";
  muted: boolean;
}

/**
 * The case timeline. The API's `timeline` when it sends one; otherwise the
 * same rows rebuilt from the case's own timestamps, so a v5 server still
 * gets a timeline and never an invented one.
 */
export function timelineRows(c: SosCaseV6, dogName: string | null, opts: { mine: boolean; now?: number } = { mine: false }): TimelineRow[] {
  const now = opts.now ?? Date.now();
  const reporter = c.reporterAnonymous ? "a passer-by" : c.reporterAnonymous === false ? "a feeder" : "someone nearby";
  const entries: SosTimelineEntry[] =
    c.timeline && c.timeline.length > 0
      ? c.timeline
      : [
          { at: c.openedAt, kind: "raised", detail: null },
          ...(c.feedersTold || c.vetsTold ? [{ at: c.openedAt, kind: "told" as const, detail: null }] : []),
          ...(c.escalatedAt ? [{ at: c.escalatedAt, kind: "escalated" as const, detail: null }] : []),
          ...(c.ackedAt ? [{ at: c.ackedAt, kind: "taken" as const, detail: c.respondingName ?? null }] : []),
          ...(c.arrivedAt ? [{ at: c.arrivedAt, kind: "arrived" as const, detail: null }] : []),
          ...(c.resolvedAt ? [{ at: c.resolvedAt, kind: "resolved" as const, detail: c.outcome ?? null }] : []),
          ...(!c.escalatedAt && !c.ackedAt && !c.resolvedAt && c.escalatesAt
            ? [{ at: c.escalatesAt, kind: "escalation_due" as const, detail: null }]
            : []),
        ];
  const noReply = !c.ackedAt && (c.state === "escalated" || !!c.escalatedAt);
  const rows: TimelineRow[] = [];
  for (const e of entries) {
    const future = Date.parse(e.at) > now;
    switch (e.kind) {
      case "raised":
        rows.push({ at: e.at, text: `Raised by ${reporter}`, dot: "ink", muted: false });
        break;
      case "told": {
        const who = e.detail ?? toldWords({ feeders: c.feedersTold, vets: c.escalatedAt ? 0 : c.vetsTold });
        if (who) rows.push({ at: e.at, text: `${who} told${noReply ? " · no reply" : ""}`, dot: "ink", muted: false });
        break;
      }
      case "escalation_due":
        if (future) rows.push({ at: e.at, text: "All ward vets told if nobody takes it", dot: "hollow", muted: true });
        break;
      case "escalated": {
        const who = e.detail ?? toldWords({ vets: c.vetsTold, ngos: c.ngosTold }) ?? "Vets";
        rows.push({ at: e.at, text: `${who} told`, dot: "red", muted: false });
        break;
      }
      case "taken":
        rows.push({
          at: e.at,
          text: opts.mine && !e.detail ? "You took it" : `${e.detail ?? "Someone"} took it`,
          dot: "ink",
          muted: false,
        });
        break;
      case "close_by":
        rows.push({ at: e.at, text: "Close by", dot: "ink", muted: false });
        break;
      case "arrived":
        rows.push({ at: e.at, text: `With ${dogName ?? "the dog"}`, dot: "ink", muted: false });
        break;
      case "reporter_update":
        rows.push({ at: e.at, text: e.detail ? `Reporter: "${e.detail}"` : "Reporter sent an update", dot: "ink", muted: false });
        break;
      case "reporter_left":
        rows.push({ at: e.at, text: "The reporter had to leave", dot: "ink", muted: false });
        break;
      case "released":
        rows.push({ at: e.at, text: "Handed back to other responders", dot: "ink", muted: false });
        break;
      case "resolved": {
        const o = (e.detail as SosOutcome | null) ?? c.outcome ?? null;
        rows.push({
          at: e.at,
          text: outcomeWords(o),
          dot: o === "taken_to_vet" || o === "treated_on_spot" || o === "resolved" ? "green" : "ink",
          muted: false,
        });
        break;
      }
    }
  }
  return rows;
}

/** V21 headline, by outcome. */
export function closedTitle(c: SosCaseV6, name: string | null): string {
  const who = name ?? "The dog";
  switch (c.outcome) {
    case "taken_to_vet": {
      if (c.resolvedAt) {
        const min = Math.max(1, Math.round((Date.parse(c.resolvedAt) - Date.parse(c.openedAt)) / 60_000));
        const took = min < 90 ? `${min} minutes` : `${Math.round(min / 60)} hours`;
        return `${who} got to a vet in ${took}.`;
      }
      return `${who} got to a vet.`;
    }
    case "treated_on_spot":
      return `${who} was treated on the spot.`;
    case "not_found":
      return `Nobody could find ${name ?? "the dog"}.`;
    case "died":
      return `${who} didn't make it.`;
    case "false_alarm":
      return "This case was closed without a rescue.";
    default:
      return c.state === "false_alarm" ? "This case was closed without a rescue." : `${who}'s case is closed.`;
  }
}

/** V21 lead: who did what, and that the reporter knows. */
export function closedLead(c: SosCaseV6, p: Pronouns, mine: boolean): string {
  const who = mine ? "You" : c.respondingName ?? "A responder";
  const told = c.reporterAnonymous
    ? "The passer-by who raised it has been told."
    : "The person who raised it has been told.";
  switch (c.outcome) {
    case "taken_to_vet":
      return `${who} took ${p.object} to ${c.vetName ?? "a vet"}. ${told}`;
    case "treated_on_spot":
      return `${who} looked after ${p.object} where ${p.subject} ${p.subject === "they" ? "were" : "was"}. ${told}`;
    case "not_found":
      return `${who} went but couldn't find ${p.object}. ${told}`;
    case "died":
      return `${who} was there. ${told} ${cap(p.possessive)} page keeps the names of everyone who fed ${p.object}.`;
    default:
      return told;
  }
}

/** V22 checklist rows from the caller's real standing (lib/sos-eligibility.ts). */
export function checklistRows(
  k: SosResponderChecklist,
  code: string | null,
): { text: string; done: boolean }[] {
  const floorFeeds = Math.max(0, k.trustFloor - 30);
  const have = Math.max(0, floorFeeds - k.feedsToGo);
  const alertsOn = k.sosOptIn && !k.paused && k.inMyWards !== false;
  return [
    { text: "Signed in", done: true },
    {
      text: k.paused ? "Alerts not paused" : code ? `Alerts on for ${code}` : "SOS alerts on",
      done: alertsOn,
    },
    {
      text: `${floorFeeds} feeds logged (you have ${Math.min(have, floorFeeds)})`,
      done: k.feedsToGo <= 0,
    },
  ];
}

export { pronouns };
