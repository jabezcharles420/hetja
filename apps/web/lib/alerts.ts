/**
 * N5 Alerts: turn the structured Alert rows (GET /feeders/me/alerts) into the
 * mock's words, and group them by day.
 *
 *   sos       "SOS · Rani is hurt"          "K/W · Anil is going"
 *   tag       "Rani's tag came off"          "Reported by a passer-by"
 *   verified  "Dr Mehta verified Tiger"      "Vaccinated · sterilised"
 *   fed       "Kalu was fed"                 "Rice and egg · Anil"
 *   not_seen  "Moti not seen in 9 days"      "Tap to update"
 */
import type { Alert, AlertKind } from "@/lib/api";

export type AlertDot = "sos" | "attention" | "ok" | "off";

export interface AlertView {
  id: string;
  title: string;
  detail: string | null;
  dot: AlertDot;
  href: string;
  at: string;
}

const DAY_MS = 86_400_000;

function dogName(a: Alert): string | null {
  const n = a.dog?.name?.trim();
  return n ? n : null;
}

function possessive(name: string | null, thing: string): string {
  return name ? `${name}'s ${thing}` : `A dog's ${thing}`;
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "vaccinated,sterilised" -> "Vaccinated · sterilised". */
function listDetail(detail: string | null): string | null {
  if (!detail) return null;
  const parts = detail
    .split(",")
    .map((p) => p.trim().replace(/_/g, " "))
    .filter(Boolean);
  return parts.length ? capitalise(parts.join(" · ")) : null;
}

const TAG_TITLES: Record<string, string> = {
  found_on_ground: "tag came off",
  damaged: "tag is damaged",
  wrong_dog: "tag may be on the wrong dog",
  too_tight: "collar is too tight",
};

const STATUS_TITLES: Record<string, (name: string) => string> = {
  lost: (n) => `${n} is missing`,
  adopted: (n) => `${n} was adopted`,
  passed_away: (n) => `${n} has passed away`,
  deceased: (n) => `${n} has passed away`,
  active: (n) => `${n} was seen again`,
};

export const DOT_FOR: Record<AlertKind, AlertDot> = {
  sos: "sos",
  tag: "attention",
  not_seen: "attention",
  verified: "ok",
  fed: "off",
  status: "off",
};

export function describeAlert(a: Alert): AlertView {
  const name = dogName(a);
  const dogOrA = name ?? "A dog";
  const base = { id: a.id, href: a.href, at: a.at, dot: DOT_FOR[a.kind] ?? "off" };

  switch (a.kind) {
    case "sos": {
      const going = a.actorName ? `${a.actorName} is going` : "Nobody is going yet";
      return {
        ...base,
        title: `SOS · ${dogOrA} is hurt`,
        detail: a.wardCode ? `${a.wardCode} · ${going}` : going,
      };
    }
    case "tag":
      return {
        ...base,
        title: possessive(name, TAG_TITLES[a.detail ?? ""] ?? "tag needs a look"),
        detail: a.actorName ? `Reported by ${a.actorName}` : "Reported by a passer-by",
      };
    case "verified":
      return {
        ...base,
        title: a.actorName ? `${a.actorName} verified ${dogOrA}` : `${dogOrA} was verified`,
        detail: listDetail(a.detail),
      };
    case "fed": {
      const bits = [a.detail?.trim() || null, a.actorName].filter(Boolean);
      return { ...base, title: `${dogOrA} was fed`, detail: bits.length ? bits.join(" · ") : null };
    }
    case "not_seen": {
      const days = a.detail && /^\d+$/.test(a.detail.trim()) ? Number(a.detail.trim()) : null;
      return {
        ...base,
        title:
          days !== null
            ? `${dogOrA} not seen in ${days} ${days === 1 ? "day" : "days"}`
            : `${dogOrA} not seen lately`,
        detail: "Tap to update",
      };
    }
    case "status": {
      const t = STATUS_TITLES[a.detail ?? ""];
      return {
        ...base,
        dot: a.detail === "lost" ? "attention" : "off",
        title: t ? t(dogOrA) : `${possessive(name, "status")} changed`,
        detail: a.wardCode,
      };
    }
    default:
      return { ...base, title: dogOrA, detail: a.detail };
  }
}

/** "4m", "2h", "3d"; under a minute is "now". */
export function relativeTime(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Calendar day in Mumbai, as YYYY-MM-DD, so "Today" means today in IST. */
function istDay(ms: number): string {
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** "Today", "Yesterday", then "Monday 21 September". */
export function dayLabel(iso: string, now: Date): string {
  const t = Date.parse(iso);
  const day = istDay(t);
  if (day === istDay(now.getTime())) return "Today";
  if (day === istDay(now.getTime() - DAY_MS)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  })
    .format(new Date(t))
    .replace(",", "");
}

export interface AlertSection {
  label: string;
  items: AlertView[];
}

/** Newest first, grouped by Mumbai calendar day. */
export function groupAlerts(items: readonly Alert[], now: Date): AlertSection[] {
  const sorted = [...items]
    .filter((a) => !Number.isNaN(Date.parse(a.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const sections: AlertSection[] = [];
  for (const a of sorted) {
    const label = dayLabel(a.at, now);
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.items.push(describeAlert(a));
    else sections.push({ label, items: [describeAlert(a)] });
  }
  return sections;
}
