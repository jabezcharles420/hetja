/**
 * Words and dates for the vet portal (design v7 V1 to V5). Pure functions,
 * so the screens and the certificate PDF say things the same way.
 */
import { careLabel } from "@/lib/care-label";
import { dogName } from "@/lib/streak";
import type { HealthRecord, HealthSigner, RecordKind, SignRequestSummary, VetProfile } from "./vet-api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(ymd: string | null | undefined): [number, number, number | null] | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(ymd);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
}

/** "12 Sep 2026"; a month alone is "Apr 2025". */
export function longDate(ymd: string | null | undefined): string {
  const p = parts(ymd);
  if (!p) return "";
  const [y, mo, d] = p;
  return d ? `${d} ${MONTHS[mo - 1]} ${y}` : `${MONTHS[mo - 1]} ${y}`;
}

/** "12 Sep" (no year). */
export function shortDate(ymd: string | null | undefined): string {
  const p = parts(ymd);
  if (!p) return "";
  const [, mo, d] = p;
  return d ? `${d} ${MONTHS[mo - 1]}` : MONTHS[mo - 1]!;
}

/** Today, as YYYY-MM-DD in local time. */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The same day a year later ("12 Sep 2026" to "12 Sep 2027"); 29 Feb becomes 28 Feb. */
export function aYearAfter(ymd: string): string {
  const p = parts(ymd);
  if (!p || !p[2]) return "";
  const [y, mo, d] = p;
  const day = mo === 2 && d === 29 ? 28 : d!;
  return `${y + 1}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "MSVC 5190". */
export function regLine(v: Pick<VetProfile, "council" | "regNo"> | Pick<HealthSigner, "council" | "regNo">): string {
  return [v.council, v.regNo].filter(Boolean).join(" ");
}

/** "09:00" -> "9am", "21:30" -> "9:30pm", "00:00" -> "midnight". */
export function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2]!;
  if (h === 0 && min === "00") return "midnight";
  if (h === 12 && min === "00") return "noon";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === "00" ? "" : `:${min}`}${h < 12 ? "am" : "pm"}`;
}

/** "9am to 9pm" (A2's "Yes, 9am to 9pm"). */
export function hoursLabel(h: { from: string; to: string } | null | undefined): string {
  return h ? `${clock(h.from)} to ${clock(h.to)}` : "";
}

/** "Government vet · free", only for government vets (owner decision). */
export function governmentLabel(isGovernment: boolean): string | null {
  return isGovernment ? careLabel({ isGovernment: true, isPerson: true }) : null;
}

/**
 * V4's signer line: "Dr. Farhan Qureshi · MSVC 5190 · Raksharab RB2409". A
 * government vet says so: "Dr. A. Kale · Government vet · free · MSVC 3301".
 */
export function signerLine(r: Pick<HealthRecord, "vet" | "brand" | "batch">): string {
  if (!r.vet) return "";
  const product = [r.brand, r.batch].filter(Boolean).join(" ");
  return [r.vet.name, governmentLabel(r.vet.isGovernment), regLine(r.vet), product].filter(Boolean).join(" · ");
}

/**
 * V4's second line. Vaccinations: "12 Sep 2026 · due again 12 Sep 2027".
 * Others: the date and the note ("Apr 2025 · ear notched"). Feeder-noted:
 * "3 Aug 2026 · added by Priya".
 */
export function recordLine(r: Pick<HealthRecord, "status" | "date" | "dueOn" | "note" | "addedBy">): string {
  const date = longDate(r.date);
  if (r.status === "feeder_noted") return [date, r.addedBy ? `added by ${r.addedBy}` : ""].filter(Boolean).join(" · ");
  if (r.dueOn) return [date, `due again ${longDate(r.dueOn)}`].filter(Boolean).join(" · ");
  return [date, r.note].filter(Boolean).join(" · ");
}

/** V2's sign request title: "Rani · anti-rabies". */
export function requestTitle(r: Pick<SignRequestSummary, "dog" | "title">): string {
  return `${dogName(r.dog.name)} · ${r.title}`;
}

/** V2's sign request sub-line: "Priya says you gave it on 12 Sep" / "Imran uploaded the clinic slip". */
export function requestSub(r: Pick<SignRequestSummary, "requestedBy" | "givenOn" | "hasEvidence">): string {
  const who = r.requestedBy ?? "A feeder";
  if (r.hasEvidence) return `${who} uploaded the clinic slip`;
  if (r.givenOn) return `${who} says you gave it on ${shortDate(r.givenOn)}`;
  return `${who} asked you to sign`;
}

/** "SOS NEAR YOU · 1.2 KM" (the label is uppercased in CSS; this is the words). */
export function sosLabel(distanceM: number | null): string {
  if (distanceM == null) return "SOS near you";
  const km = distanceM / 1000;
  return `SOS near you · ${km < 1 ? `${Math.max(100, Math.round(distanceM / 100) * 100)} m` : `${km.toFixed(1)} km`}`;
}

/** "Lokhandwala · Sneha is with him". */
export function sosSub(place: string | null, withName: string | null, pronoun: "him" | "her" | "the dog" = "the dog"): string {
  return [place, withName ? `${withName} is with ${pronoun}` : ""].filter(Boolean).join(" · ");
}

/** "11 dogs need a booster by 9 Oct". */
export function dueLine(count: number, by: string | null): string {
  if (count === 0) return "No boosters due in the next two weeks";
  const who = count === 1 ? "1 dog needs" : `${count} dogs need`;
  return by ? `${who} a booster by ${shortDate(by)}` : `${who} a booster soon`;
}

/** "Collar HJ-0412 · female · ~3 yrs". */
export function dogFacts(collar: string, sex: "male" | "female" | null, ageYears: number | null): string {
  const age = ageYears == null ? "" : ageYears < 1 ? "under a year" : `~${Math.round(ageYears)} ${Math.round(ageYears) === 1 ? "yr" : "yrs"}`;
  return [`Collar ${collar}`, sex ?? "", age].filter(Boolean).join(" · ");
}

/** "2h ago", "40 min ago", "yesterday", "3 days ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Words for a record kind in titles: "anti-rabies", "sterilisation", "treatment". */
export function recordNoun(kind: RecordKind, title: string): string {
  if (kind === "vaccination") return title.toLowerCase();
  if (kind === "sterilisation") return "sterilisation";
  return "treatment";
}

/** V5's withdraw sentence. */
export function withdrawSentence(kind: RecordKind, name: string, told: string | null): string {
  const verb = kind === "vaccination" ? "vaccinated" : kind === "sterilisation" ? "sterilised" : "treated";
  const who = told ? `${told} is told` : `${name}'s feeders are told`;
  return `If this dog wasn't ${verb} by you. The badge comes off ${name}'s page and ${who}.`;
}

/** The admin's decision, as the vet reads it. */
export const STATUS_TITLE: Record<"waiting" | "more_info" | "declined" | "suspended" | "removed" | "invited", string> = {
  invited: "Sign records as a vet",
  waiting: "We're checking your registration.",
  more_info: "We need a little more.",
  declined: "Your application wasn't accepted.",
  suspended: "Signing is paused.",
  removed: "Your vet account was closed.",
};

/**
 * Whether this vet may sign now. Only a verified vet signs: a suspended vet
 * (or one whose application is not decided) sees no sign actions. The API's
 * `canSign` also needs a passkey, which V3 sets up inline, so a verified vet
 * without one still sees the buttons; `canSign` decides only when the vet's
 * status could not be read.
 */
export function maySign(status: string | null | undefined, canSign: boolean | null | undefined): boolean {
  if (status) return status === "verified";
  return canSign === true;
}

/** The calm line where the sign actions would be. */
export function noSignLine(status: string | null | undefined): string {
  return status === "suspended"
    ? "Your vet account is paused, so signing is off for now. Records you already signed keep their badge."
    : "Signing opens once Hetja has verified your vet account.";
}
