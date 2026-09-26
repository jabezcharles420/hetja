/**
 * Admin copy, written from facts. The mock's strings (docs/design/v7-portals,
 * A1 to A7) come out verbatim from the board's example data; tests pin them.
 * Times are Asia/Kolkata: Hetja is Mumbai only.
 */
import type {
  AdminReportRow,
  AdminRole,
  AdminToday,
  AvatarTile,
  NeedsYouItem,
  NgoRegType,
  SosHours,
  SosSeverity,
  VetStatus,
} from "@/lib/api";

const TZ = "Asia/Kolkata";
const MIN = 60_000;
const DAY = 86_400_000;

function parts(d: Date): { y: number; m: number; day: number; h: number; min: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, day: +o.day, h: +o.hour % 24, min: +o.minute };
}

/** Whole calendar days between two instants, in Mumbai. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.day) - Date.UTC(a.y, a.m - 1, a.day)) / DAY);
}

/** "40 min", "2 h", "3 days" from a count of minutes. Never "0 min". */
export function minutesLabel(totalMin: number): string {
  const m = Math.max(1, Math.floor(totalMin));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
}

/** "40 min", "2 h", "3 days" since an instant. */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  return minutesLabel(Math.max(0, now.getTime() - new Date(iso).getTime()) / MIN);
}

/** A2's "Applied" column: "Today", "1 day", "3 days" (calendar days). */
export function daysLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = calendarDaysBetween(new Date(iso), now);
  if (d <= 0) return "Today";
  return d === 1 ? "1 day" : `${d} days`;
}

/** Waiting past the "Usually within 2 days" promise (V1). */
export function isOverdue(iso: string | null, now: Date = new Date()): boolean {
  return !!iso && calendarDaysBetween(new Date(iso), now) >= 3;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));

/** "Thursday 25 September". */
export function longDate(now: Date = new Date()): string {
  const p = parts(now);
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.day)).getUTCDay();
  return `${WEEKDAYS[wd]} ${p.day} ${MONTHS[p.m - 1]}`;
}

/** "25 Sep". */
export function shortDate(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.day} ${MON[p.m - 1]}`;
}

/** "14 Mar 2026". */
export function fullDate(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.day} ${MON[p.m - 1]} ${p.y}`;
}

/** "2029-03" -> "Mar 2029"; a full date keeps its day. */
export function monthLabel(ym: string | null | undefined): string {
  if (!ym) return "";
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(ym);
  if (!m) return ym;
  const label = `${MON[+m[2] - 1]} ${m[1]}`;
  return m[3] ? `${+m[3]} ${label}` : label;
}

/** "09:42". */
export function clock(iso: string): string {
  const p = parts(new Date(iso));
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

/** The audit log's left column: "09:42" today, "Yesterday", then "23 Sep". */
export function auditWhen(iso: string, now: Date = new Date()): string {
  const d = calendarDaysBetween(new Date(iso), now);
  if (d <= 0) return clock(iso);
  if (d === 1) return "Yesterday";
  return shortDate(iso);
}

/** "Good morning, Aarti." */
export function greeting(firstName: string, now: Date = new Date()): string {
  const h = parts(now).h;
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  return `Good ${part}, ${firstName}.`;
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const dogName = (name: string | null | undefined): string => name?.trim() || "A dog with no name";

/** "09:00" -> "9am", "21:30" -> "9:30pm". */
function hourLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

/** A2 "Yes, 9am to 9pm". */
export function sosHoursLabel(hours: SosHours | null | undefined): string {
  if (!hours) return "any time";
  if (hours.from === hours.to) return "any time";
  return `${hourLabel(hours.from)} to ${hourLabel(hours.to)}`;
}

/** Canonical ward id to the short form: "K-West" -> "K/W". The /wards list wins when loaded. */
export function wardCode(id: string | null | undefined, known?: Map<string, string>): string {
  if (!id) return "";
  const hit = known?.get(id);
  if (hit) return hit;
  return id
    .replace(/-West$/i, "/W")
    .replace(/-East$/i, "/E")
    .replace(/-North$/i, "/N")
    .replace(/-South$/i, "/S")
    .replace(/-Central$/i, "/C");
}

// ---------------------------------------------------------------------------
// A1 cards and rows
// ---------------------------------------------------------------------------

export type Tone = "urgent" | "waiting" | "info";

export interface NeedsYouRow {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  action: string;
  href: string;
  /** The one dark button on the list: the urgent row's. */
  loud: boolean;
}

const SEVERITY_WORD: Record<SosSeverity, string> = { minor: "minor injury", serious: "hurt", critical: "badly hurt" };

/** "Similar names, same ward, different feeders" (adapted A1: no photo match). */
function duplicateDetail(item: Extract<NeedsYouItem, { kind: "duplicate" }>): string {
  const bits = [
    item.reason === "report" ? "Reported by a feeder" : "Similar names",
    item.sameWard ? "same ward" : "different wards",
    item.differentFeeders ? "different feeders" : "same feeder",
  ];
  return bits.join(", ");
}

export function needsYouRow(item: NeedsYouItem, now: Date = new Date()): NeedsYouRow {
  switch (item.kind) {
    case "sos": {
      const what = item.note?.trim() || SEVERITY_WORD[item.severity];
      const where = item.wardName ? `, ${item.wardName}` : "";
      return {
        key: `sos:${item.caseId}`,
        tone: "urgent",
        title: `SOS · ${dogName(item.dogName)}, ${what}${where}`,
        detail: `Raised by ${item.raisedBy ?? "a passer-by"} ${ago(item.openedAt, now)} ago. No vet has accepted.`,
        action: "Assign a vet",
        href: `/admin/sos?id=${encodeURIComponent(item.caseId)}`,
        loud: true,
      };
    }
    case "vet": {
      const council = item.regLabel.split(" ")[0] || "Council";
      const what = item.documents > 0 ? "reg. no. and certificate" : "reg. no.";
      return {
        key: `vet:${item.vetId}`,
        tone: "waiting",
        title: `${item.name} applied to sign records`,
        detail: `${council} ${what} uploaded ${ago(item.appliedAt, now)} ago${item.vouched ? " · vouched for by their NGO" : ""}`,
        action: "Review",
        href: `/admin/vets?id=${encodeURIComponent(item.vetId)}`,
        loud: false,
      };
    }
    case "duplicate": {
      const q = new URLSearchParams({ a: item.a.slug, b: item.b.slug });
      if (item.reportId) q.set("report", item.reportId);
      return {
        key: `dup:${item.a.slug}:${item.b.slug}`,
        tone: "waiting",
        title: `${dogName(item.a.name)} and ${dogName(item.b.name)} may be the same dog`,
        detail: duplicateDetail(item),
        action: "Compare",
        href: `/admin/merge?${q.toString()}`,
        loud: false,
      };
    }
    case "avatars":
      return {
        key: `batch:${item.batchId}`,
        tone: "info",
        title: `${item.files} avatars ready from batch #${item.batchNumber}`,
        detail: item.needMatch > 0 ? `${item.matched} matched to a dog, ${item.needMatch} need a match` : `All ${item.matched} matched to a dog`,
        action: "Review",
        href: `/admin/avatars/${encodeURIComponent(item.batchId)}`,
        loud: false,
      };
    case "ngo":
      return {
        key: `ngo:${item.ngoId}`,
        tone: "waiting",
        title: `${item.name} applied to join Hetja`,
        detail: `Registration certificate uploaded ${ago(item.appliedAt, now)} ago`,
        action: "Review",
        href: `/admin/ngos?tab=waiting&id=${encodeURIComponent(item.ngoId)}`,
        loud: false,
      };
    case "report":
      return {
        key: `report:${item.reportId}`,
        tone: "waiting",
        title: item.reportKind === "photo" ? `A photo of ${dogName(item.dog.name)} was reported` : `${dogName(item.dog.name)} was reported`,
        detail: `Reported ${ago(item.createdAt, now)} ago`,
        action: "Review",
        href: `/admin/reports?id=${encodeURIComponent(item.reportId)}`,
        loud: false,
      };
  }
}

const TONE_ORDER: Record<Tone, number> = { urgent: 0, waiting: 1, info: 2 };

/** Sorted by what's waiting on you: urgent first, the server's order within a tone. */
export function needsYouRows(items: NeedsYouItem[], now: Date = new Date()): NeedsYouRow[] {
  return items
    .map((it, i) => ({ row: needsYouRow(it, now), i }))
    .sort((x, y) => TONE_ORDER[x.row.tone] - TONE_ORDER[y.row.tone] || x.i - y.i)
    .map((x) => x.row);
}

export interface TodayCard {
  key: "vets" | "avatars" | "sos" | "reports";
  label: string;
  value: string;
  sub: string;
  subTone: "plain" | "warn" | "danger";
  href: string;
}

export function reportsBreakdown(r: AdminToday["cards"]["reports"]): string {
  const bits: string[] = [];
  if (r.duplicates) bits.push(plural(r.duplicates, "duplicate dog"));
  if (r.photos) bits.push(plural(r.photos, "photo"));
  if (r.other) bits.push(`${r.other} other`);
  return bits.length ? bits.join(", ") : "Nothing reported";
}

export function todayCards(t: AdminToday): TodayCard[] {
  const { vetsToVerify: v, avatarsToReview: a, openSos: s, reports } = t.cards;
  const waited = v.oldestWaitingDays;
  return [
    {
      key: "vets",
      label: "Vets to verify",
      value: String(v.count),
      sub: !v.count ? "Nobody waiting" : waited === null || waited <= 0 ? "Oldest waiting since today" : `Oldest waiting ${plural(waited, "day")}`,
      subTone: v.count ? "warn" : "plain",
      href: "/admin/vets",
    },
    {
      key: "avatars",
      label: "Avatars to review",
      value: String(a.count),
      sub: a.count ? (a.batchNumber ? `From batch #${a.batchNumber}` : "Waiting to publish") : "Nothing to review",
      subTone: "plain",
      href: a.batchId ? `/admin/avatars/${encodeURIComponent(a.batchId)}` : "/admin/avatars",
    },
    {
      key: "sos",
      label: "Open SOS cases",
      value: String(s.count),
      sub: s.unassigned
        ? `${s.unassigned} unassigned for ${minutesLabel(s.oldestUnassignedMin ?? 1)}`
        : s.count
          ? "Every case has someone"
          : "None open",
      subTone: s.unassigned ? "danger" : "plain",
      href: "/admin/sos",
    },
    {
      key: "reports",
      label: "Reports",
      value: String(reports.count),
      sub: reportsBreakdown(reports),
      subTone: "plain",
      href: "/admin/reports",
    },
  ];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const ROLE_LABEL: Record<AdminRole, string> = {
  owner: "Owner",
  moderator: "Moderator",
  avatar_editor: "Avatar editor",
  ward_lead: "Ward lead",
};

/** A6: "Ward lead · K/W". */
export function roleLabel(role: AdminRole, wards: string[] = [], known?: Map<string, string>): string {
  return role === "ward_lead" && wards.length ? `${ROLE_LABEL[role]} · ${wards.map((w) => wardCode(w, known)).join(", ")}` : ROLE_LABEL[role];
}

export const ROLE_TEXT: Record<AdminRole, string> = {
  owner: "everything, including removing vets and team members.",
  moderator: "verify vets, merge dogs, handle reports and SOS.",
  avatar_editor: "upload and publish avatars only.",
  ward_lead: "issue collars and handle SOS in their wards.",
};

export const VET_STATUS_LABEL: Record<VetStatus, string> = {
  invited: "Invited",
  waiting: "Waiting",
  more_info: "Asked for more",
  verified: "Verified",
  suspended: "Suspended",
  declined: "Declined",
  removed: "Removed",
};

/** A7 "Reg. trust · 80G · since 2014". */
export const REG_TYPE_LABEL: Record<NgoRegType, string> = {
  trust: "Reg. trust",
  society: "Reg. society",
  section8: "Section 8 company",
  other: "Registered",
};

/** A3's tile line under the dog's name (adapted: no "By photo"). */
export function matchLine(tile: AvatarTile): { text: string; tone: "plain" | "warn" | "link" } {
  if (!tile.dog || tile.match === "none") return { text: "No match · pick dog", tone: "warn" };
  if (tile.replacesExisting) return { text: "Replaces existing", tone: "link" };
  if (tile.match === "id") return { text: `ID · ${tile.dog.slug}`, tone: "plain" };
  if (tile.match === "collar") return { text: `Collar · ${tile.dog.collarBatchNo ?? tile.dog.slug}`, tone: "plain" };
  return { text: "Picked by hand", tone: "plain" };
}

/** The collar's printed number (adapted list): batch_no where set, else the 3-3-3 code. */
export function collarNumber(batchNo: string | null | undefined, code: string): string {
  if (batchNo) return batchNo;
  const s = code.replace(/-/g, "").toUpperCase();
  return s.length === 9 ? `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}` : code.toUpperCase();
}

export const REPORT_KIND_LABEL: Record<AdminReportRow["kind"], string> = {
  duplicate_dog: "Possible duplicate",
  photo: "Photo",
  other: "Other",
  damaged: "Tag damaged",
  found_on_ground: "Tag found on the ground",
  wrong_dog: "Tag on the wrong dog",
  too_tight: "Collar too tight",
};

/** Reports tabs (designed): duplicates, photos, tag reports, fake tags. */
export type ReportTab = "duplicates" | "photos" | "tags" | "fake";

export function reportTab(r: Pick<AdminReportRow, "kind">): ReportTab | "other" {
  switch (r.kind) {
    case "duplicate_dog":
      return "duplicates";
    case "photo":
      return "photos";
    case "wrong_dog":
      return "fake";
    case "damaged":
    case "found_on_ground":
    case "too_tight":
      return "tags";
    default:
      return "other";
  }
}

/** The 24 BMC wards, for pickers when GET /wards is unreachable. */
export const MUMBAI_WARDS = [
  "A", "B", "C", "D", "E", "F/N", "F/S", "G/N", "G/S", "H/E", "H/W", "K/E",
  "K/W", "L", "M/E", "M/W", "N", "P/N", "P/S", "R/C", "R/N", "R/S", "S", "T",
];

/** "25 Sep" this year, "13 May 2025" before it. */
export function dateLabel(iso: string, now: Date = new Date()): string {
  return new Date(iso).getUTCFullYear() === now.getUTCFullYear() ? shortDate(iso) : fullDate(iso);
}

/** "+919812344410" -> "+91 98123 44410". A masked or odd number is shown as given. */
export function phoneLabel(p: string | null | undefined): string {
  if (!p) return "";
  const m = /^\+91(\d{5})(\d{5})$/.exec(p.replace(/\s+/g, ""));
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}

/**
 * The street app's origin. On admin.hetja.in, "/" redirects back to /admin
 * (Caddy), so every way out of the portal is an absolute link.
 * NEXT_PUBLIC_SITE_URL overrides it (inlined at build time), for local runs.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hetja.in").replace(/\/+$/, "");
