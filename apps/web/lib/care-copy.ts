/**
 * Words shared by the design v5 care screens (docs/design/v5-handoff, N2, N3,
 * N4, N7, N9, F6): pronouns, "how long ago", feed lines and tag words.
 *
 * Pronouns follow the dog's sex when the payload carries it (`sex` on the
 * dog profile, MyDog, DogCard and the SOS case's dog) and fall back to
 * they/them when it is null or absent. `sexOf` reads it from any object.
 */

import type { AttentionKind, MyDogV5, TagEvent, TagProblemKind } from "./api";

export type DogSex = "male" | "female" | "unknown";

export interface Pronouns {
  /** she / he / they */
  subject: string;
  /** her / him / them */
  object: string;
  /** her / his / their */
  possessive: string;
}

export function pronouns(sex: DogSex | null | undefined): Pronouns {
  if (sex === "female") return { subject: "she", object: "her", possessive: "her" };
  if (sex === "male") return { subject: "he", object: "him", possessive: "his" };
  return { subject: "they", object: "them", possessive: "their" };
}

/** The dog's sex from any payload that happens to carry one, else undefined. */
export function sexOf(value: unknown): DogSex | undefined {
  const s = (value as { sex?: unknown } | null | undefined)?.sex;
  return s === "male" || s === "female" || s === "unknown" ? s : undefined;
}

/** "12 min ago", "3 h ago", "just now", "yesterday", "4 days ago". */
export function agoWords(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** The compact form for list sub lines: "12 min", "3 h", "2 days". */
export function agoShort(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
}

/** Whole days since a moment (0 today). */
export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** Asia/Kolkata calendar day, "YYYY-MM-DD". */
function kolkataDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

function kolkataHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(d),
  );
}

/**
 * The feed sub line in My dogs: "Fed 2 h ago by Anil", "Fed this morning",
 * "Fed yesterday", "Fed 4 days ago".
 */
export function fedWords(lastFedAt: string, byName: string | null | undefined, now: number = Date.now()): string {
  const at = new Date(lastFedAt);
  const min = Math.max(0, Math.floor((now - at.getTime()) / 60_000));
  let when: string;
  if (min < 1) when = "just now";
  else if (min < 60) when = `${min} min ago`;
  else if (min < 4 * 60) when = `${Math.floor(min / 60)} h ago`;
  else {
    const today = kolkataDay(new Date(now));
    const yesterday = kolkataDay(new Date(now - 86_400_000));
    const day = kolkataDay(at);
    if (day === today) {
      const h = kolkataHour(at);
      when = h < 12 ? "this morning" : h < 17 ? "this afternoon" : "this evening";
    } else if (day === yesterday) when = "yesterday";
    else when = `${Math.max(2, daysSince(lastFedAt, now))} days ago`;
  }
  return `Fed ${when}${byName ? ` by ${byName}` : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" -> "Oct" in the current year, "Oct 2027" otherwise; null if not a month. */
export function monthWords(ym: string | null | undefined, now: number = Date.now()): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(ym ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  const year = Number(m[1]);
  return year === new Date(now).getFullYear() ? month : `${month} ${year}`;
}

/** "Today", "Yesterday", "12 Aug", or "12 Aug 2025" (Asia/Kolkata). */
export function dayWords(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const day = kolkataDay(d);
  if (day === kolkataDay(new Date(now))) return "Today";
  if (day === kolkataDay(new Date(now - 86_400_000))) return "Yesterday";
  const [y, mo, da] = day.split("-").map(Number) as [number, number, number];
  const short = `${da} ${MONTHS[mo - 1]}`;
  return y === Number(kolkataDay(new Date(now)).slice(0, 4)) ? short : `${short} ${y}`;
}

// ---------------------------------------------------------------------------
// Tags (F6)

/** "Reported off", "Reported damaged", ... for the tag history. */
export function tagReportedWords(kind: string | null | undefined): string {
  switch (kind) {
    case "found_on_ground":
      return "Reported off";
    case "damaged":
      return "Reported damaged";
    case "wrong_dog":
      return "Reported on the wrong dog";
    case "too_tight":
      return "Reported too tight";
    default:
      return "Reported";
  }
}

/** The F6 card title: "Rani's tag came off". */
export function tagCardTitle(kind: TagProblemKind, name: string): string {
  switch (kind) {
    case "found_on_ground":
      return `${name}'s tag came off`;
    case "damaged":
      return `${name}'s tag is damaged`;
    case "too_tight":
      return `${name}'s collar is too tight`;
    case "wrong_dog":
    default:
      return `${name}'s tag may be on the wrong dog`;
  }
}

/** The F6 card pill. */
export function tagCardPill(kind: TagProblemKind): string {
  switch (kind) {
    case "found_on_ground":
    case "damaged":
      return "Needs a new tag";
    case "too_tight":
      return "Needs a looser collar";
    case "wrong_dog":
    default:
      return "Tag under review";
  }
}

/** One tag history row, left side: "Printed · 6 tags · Priya S." */
export function tagEventWords(e: TagEvent): string {
  const by = e.byName ?? null;
  switch (e.kind) {
    case "reported":
      return `${tagReportedWords(e.detail)} by ${by ?? "a passer-by"}`;
    case "printed": {
      const n = e.detail && /^\d+$/.test(e.detail) ? Number(e.detail) : null;
      const count = n !== null ? `${n} ${n === 1 ? "tag" : "tags"}` : e.detail;
      return ["Printed", count, by].filter(Boolean).join(" · ");
    }
    case "registered":
      return ["Registered", by].filter(Boolean).join(" · ");
    case "resolved": {
      const what =
        e.detail === "reprinted"
          ? "Reprinted"
          : e.detail === "spare"
            ? "Spare tag fitted"
            : e.detail === "checked_ok"
              ? "Checked, tag is right"
              : "Resolved";
      return [what, by].filter(Boolean).join(" · ");
    }
    default:
      return "Tag update";
  }
}

// ---------------------------------------------------------------------------
// My dogs (N4)

export type RowTag = "SOS" | "Tag" | "Missing?" | "Fed" | "Vet" | "New";

export interface MyDogRow {
  tag: RowTag | null;
  variant: "ok" | "warn" | "neutral" | "danger";
  icon: "check" | "clock" | "cross" | "alert";
  sub: string;
  /** Counted in "Needs you". */
  needsYou: boolean;
  href: string;
}

/** Kinds that count as "needs you today". Vet due and New do not. */
export const NEEDS_YOU: readonly AttentionKind[] = ["sos", "tag", "missing"];

function tagSub(detail: string | null): string {
  switch (detail) {
    case "damaged":
      return "Tag reported damaged";
    case "wrong_dog":
      return "Tag reported on the wrong dog";
    case "too_tight":
      return "Tag reported too tight";
    case "found_on_ground":
    default:
      return "Tag reported off";
  }
}

/** Everything a My dogs row shows, derived from the v5 payload. */
export function myDogRow(d: MyDogV5, now: number = Date.now()): MyDogRow {
  const a = d.attention ?? null;
  // v6: a feeder's own dog opens N15 (the private week view), not the public page.
  const profile = `/me/dogs/${d.slug}`;
  if (a?.kind === "sos") {
    return {
      tag: "SOS",
      variant: "danger",
      icon: "alert",
      sub: `SOS raised · ${agoShort(a.since, now)}`,
      needsYou: true,
      href: profile,
    };
  }
  if (a?.kind === "tag") {
    return {
      tag: "Tag",
      variant: "warn",
      icon: "alert",
      sub: `${tagSub(a.detail)} · ${agoShort(a.since, now)}`,
      needsYou: true,
      href: `/me/dogs/${d.slug}/tag`,
    };
  }
  if (a?.kind === "missing") {
    const from = d.lastFedAt ?? a.since;
    const days = daysSince(from, now);
    return {
      tag: "Missing?",
      variant: "warn",
      icon: "clock",
      sub: d.lastFedAt ? `Not logged in ${days} ${days === 1 ? "day" : "days"}` : "Not logged yet",
      needsYou: true,
      href: `/me/dogs/${d.slug}/status`,
    };
  }
  if (a?.kind === "vet") {
    const month = monthWords(a.detail, now);
    return {
      tag: "Vet",
      variant: "neutral",
      icon: "clock",
      sub: month ? `Vaccine due ${month}` : "Vaccine due",
      needsYou: false,
      href: profile,
    };
  }
  if (a?.kind === "new" || d.verified === false) {
    return { tag: "New", variant: "neutral", icon: "clock", sub: "Unverified", needsYou: false, href: profile };
  }
  if (d.lastFedAt) {
    const byOther = d.lastFedByName && d.myLastFedAt !== d.lastFedAt ? d.lastFedByName : null;
    return {
      tag: "Fed",
      variant: "ok",
      icon: "check",
      sub: fedWords(d.lastFedAt, byOther, now),
      needsYou: false,
      href: profile,
    };
  }
  return { tag: null, variant: "neutral", icon: "clock", sub: "No feeds yet", needsYou: false, href: profile };
}

/** "7 dogs · 2 need you today". */
export function myDogsSummary(total: number, needing: number): string {
  const dogs = `${total} ${total === 1 ? "dog" : "dogs"}`;
  if (needing === 0) return `${dogs} · nothing needs you today`;
  return `${dogs} · ${needing} ${needing === 1 ? "needs" : "need"} you today`;
}
