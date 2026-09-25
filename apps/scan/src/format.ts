/**
 * Pure display helpers for the collar page (design v4, screens 03 to 05).
 *
 * No DOM and no imports, so every rule that turns API data into words a
 * stranger reads is unit-tested in format.test.ts rather than only eyeballed
 * in a screenshot. Copy comes verbatim from the design handoff
 * (docs/design/v4-handoff/COPY_DECK.txt); where the mock's copy assumes data
 * the API does not send (a pronoun, a notified count), the neutral wording
 * below is used instead of inventing it.
 */

/* ---------------------------------------------------------------------------
 * Collar code: shown uppercase in three groups of three ("DDR 017 XK2"),
 * stored lowercase. Same arithmetic as apps/web/components/ds/collar.ts.
 * ------------------------------------------------------------------------- */

/** "ddr017xk2" -> ["DDR", "017", "XK2"]. Works on partial codes too. */
export function collarGroups(code: string): string[] {
  const upper = code.replace(/\s+/g, "").toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < upper.length; i += 3) groups.push(upper.slice(i, i + 3));
  return groups;
}

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * Spoken form for reading a code over a bad phone line: letters spelled,
 * digits as words, one group per triple.
 * "ddr017xk2" -> "D D R · zero one seven · X K two".
 */
export function sayCollarCode(code: string): string {
  return collarGroups(code)
    .map((g) => [...g].map((ch) => (/[0-9]/.test(ch) ? DIGIT_WORDS[Number(ch)] : ch)).join(" "))
    .join(" · ");
}

/* ---------------------------------------------------------------------------
 * Ward: ward level only, never a street (hard rule 5).
 * ------------------------------------------------------------------------- */

/**
 * The 24 BMC ward codes, mirrored from packages/contracts (BMC_WARD_CODES).
 * Copied rather than imported: the contracts package pulls zod, which would
 * cost this page more than its whole stylesheet.
 */
const BMC_WARDS = new Set(
  "A B C D E F-North F-South G-North G-South H-East H-West K-East K-West L M-East M-West N P-North P-South R-Central R-North R-South S T".split(
    " ",
  ),
);

/**
 * Short slash form as BMC signage writes it: "K-West" -> "K/W", "A" -> "A".
 * A non-canonical id (rows written before the enum existed) comes back
 * unchanged, same rule as contracts' wardDisplay(): never a guessed code.
 */
export function wardShort(wardId: string): string {
  if (!BMC_WARDS.has(wardId)) return wardId;
  const [letter, half] = wardId.split("-");
  return half ? `${letter}/${half.charAt(0)}` : letter!;
}

/** "K/W ward · Andheri West", or "K/W ward" without a name, or "" with no ward. */
export function wardLine(wardId: string, wardName?: string): string {
  const short = wardId ? `${wardShort(wardId)} ward` : "";
  return [short, wardName ?? ""].filter(Boolean).join(" · ");
}

/* ---------------------------------------------------------------------------
 * Words about the dog.
 * ------------------------------------------------------------------------- */

/**
 * "his" / "her" only when the record carries a sex; otherwise the dog's own
 * name ("Bruno's"). The mock says "his", but GET /api/v1/dogs/:slug sends no
 * sex, and guessing one is a claim the system cannot back.
 */
export function possessive(name: string, sex?: string): string {
  const s = sex?.toLowerCase();
  if (s === "male" || s === "m") return "his";
  if (s === "female" || s === "f") return "her";
  return `${name}'s`;
}

/**
 * "Last fed 2 hours ago". Coarse on purpose: a stranger needs "recently" or
 * "not for a while", not a timestamp. Returns undefined for an unparseable
 * date so the caller can drop the pill rather than print "NaN".
 */
export function lastFedText(iso: string, now: number = Date.now()): string | undefined {
  const a = ago(iso, now);
  return a && `Last fed ${a}`;
}

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "5 days ago". */
export function ago(iso: string, now: number = Date.now()): string | undefined {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  return mins < 1
    ? "just now"
    : mins < 60
      ? `${plural(mins, "minute")} ago`
      : hours < 24
        ? `${plural(hours, "hour")} ago`
        : days === 1
          ? "yesterday"
          : `${days} days ago`;
}

/** "1 feeder", "3 feeders". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Story attribution. Stories are feeder-written only (apps/api stories.ts),
 * so "feeders" is always true; the count is shown only when the API sends it.
 */
export function writtenByLine(name: string, sex: string | undefined, authors?: number): string {
  const who = possessive(name, sex);
  if (authors === 1) return `Written by ${who} feeder`;
  if (authors !== undefined && authors > 1) return `Written by ${who} ${authors} feeders`;
  return `Written by ${who} feeders`;
}

/** Pastel pairs from the handoff (DogAvatar), background then initial colour. */
export const PASTELS: ReadonlyArray<readonly [string, string]> = [
  ["#ffe3c2", "#7a4a12"], // apricot
  ["#e4defa", "#4b3a8f"], // lilac
  ["#d7efe3", "#1f5c3d"], // mint
  ["#ffd9e6", "#8a2f52"], // rose
  ["#dbe9fb", "#1f4a80"], // sky
];

/**
 * Stable pastel index for a dog. The page only knows the slug (the payload
 * carries no dog id), and the slug never changes, so it is the hash input.
 */
export function pastelIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h % PASTELS.length;
}

/* ---------------------------------------------------------------------------
 * SOS severity. The design's three plain-language choices map onto the
 * API's severity_t enum. "critical" is the only value that pages responders
 * at report time (apps/api sos.ts), so only "Can't get up, or bleeding" uses it.
 * ------------------------------------------------------------------------- */

export type Choice = "moving" | "urgent" | "other";
export type ApiSeverity = "minor" | "serious" | "critical";

export const CHOICES: ReadonlyArray<{ key: Choice; title: string; sub: string; pill: string }> = [
  { key: "moving", title: "Hurt, but moving", sub: "Limping, a wound, not eating", pill: "Hurt, but moving" },
  { key: "urgent", title: "Can't get up, or bleeding", sub: "Needs a vet now", pill: "Needs a vet now" },
  { key: "other", title: "Something else", sub: "Missing, scared, or being harmed", pill: "Needs checking" },
];

export function apiSeverity(choice: Choice): ApiSeverity {
  return choice === "urgent" ? "critical" : "serious";
}

/* ---------------------------------------------------------------------------
 * Case status pill on "SOS sent" (GET /api/v1/reports/:caseId/status).
 * ------------------------------------------------------------------------- */

export type CaseState = "open" | "acked" | "escalated" | "resolved" | "false_alarm";

export interface CasePill {
  tone: "ok" | "warn" | "neutral";
  icon: "check" | "clock";
  text: string;
  /** No further change is expected, so polling can stop. */
  final: boolean;
}

export function casePill(state?: CaseState): CasePill {
  if (state === "acked") return { tone: "ok", icon: "check", text: "On the way", final: true };
  if (state === "resolved") return { tone: "ok", icon: "check", text: "Resolved", final: true };
  if (state === "false_alarm") return { tone: "neutral", icon: "check", text: "Closed", final: true };
  return { tone: "warn", icon: "clock", text: "Waiting for reply", final: false };
}

/* ---------------------------------------------------------------------------
 * Care rows: "type · ward · note" (e.g. "Vet · Andheri West · open 24 hours").
 * ------------------------------------------------------------------------- */

const KIND_LABEL: Record<string, string> = {
  private_clinic: "Vet",
  charity_hospital: "Charity hospital",
  govt: "Govt vet",
  ngo: "NGO",
};

export interface CareMetaInput {
  kind?: string;
  locality?: string;
  hoursNote?: string;
  is24x7: boolean;
  hasAmbulance: boolean;
  phone?: string;
  phoneVerified: boolean;
}

export function careMeta(p: CareMetaInput): string {
  const note = p.hoursNote ?? (p.is24x7 ? "open 24 hours" : p.hasAmbulance ? "ambulance" : undefined);
  const bits = [p.kind ? KIND_LABEL[p.kind] ?? p.kind : undefined, p.locality, note];
  if (!p.phone) bits.push("no phone listed");
  else if (!p.phoneVerified) bits.push("number not confirmed");
  return bits.filter(Boolean).join(" · ");
}

/**
 * V19 care row: "Vet · open now, 24 hours · 900 m". A place loses its Call
 * button only when the API knows its hours and says it is closed now
 * ("Closed now · opens 10 am"); 24 x 7 is always callable, and "open now" is
 * only claimed from 24 x 7 or the API's own openNow, never guessed from a
 * note. Government places and free ones say so, because the owner wants
 * people told they cost nothing: "Government vet · free".
 *
 * An unconfirmed number is never hidden (a stranger at an SOS may have
 * nobody else to call): it keeps its Call button with `note`.
 */
export function careRow(
  p: CareMetaInput & { name?: string; costTier?: string; openNow?: boolean; opensNote?: string; distanceKm?: number },
): { meta: string; closed: boolean; note?: string } {
  const note = p.phoneVerified ? undefined : "Number not confirmed yet";
  const free = p.kind === "govt" || p.costTier === "free";
  const kind =
    p.kind === "govt"
      ? `Government ${/hospital/i.test(p.name ?? "") ? "hospital" : "vet"} · free`
      : [p.kind ? KIND_LABEL[p.kind] ?? p.kind : "", free ? "free" : ""].filter(Boolean).join(" · ");
  if (p.openNow === false && !p.is24x7)
    return { meta: [kind, "Closed now", p.opensNote].filter(Boolean).join(" · "), closed: true, note };
  const hours = p.is24x7 ? "open now, 24 hours" : p.openNow ? ["open now", p.hoursNote].filter(Boolean).join(", ") : p.hoursNote;
  const km = p.distanceKm;
  const dist = km == null ? "" : km < 1 ? `${Math.max(100, Math.round(km * 10) * 100)} m` : `${km.toFixed(1)} km`;
  return { meta: [kind, hours, dist].filter(Boolean).join(" · "), closed: false, note };
}

/* ---------------------------------------------------------------------------
 * Design v5: pronouns, tag problems (F4, F5) and the memorial line.
 * ------------------------------------------------------------------------- */

export interface Pronouns {
  /** she / he / they */
  subj: string;
  /** her / him / them */
  obj: string;
  /** her / his / their */
  poss: string;
}

/**
 * The mocks say "her". The record may carry a sex; without one the words are
 * they/them, never a guess.
 */
export function pronouns(sex?: string): Pronouns {
  const s = sex?.toLowerCase();
  if (s === "female" || s === "f") return { subj: "she", obj: "her", poss: "her" };
  if (s === "male" || s === "m") return { subj: "he", obj: "him", poss: "his" };
  return { subj: "they", obj: "them", poss: "their" };
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type TagKind = "damaged" | "found_on_ground" | "wrong_dog" | "too_tight";

/** F4 rows, verbatim from the mock with the pronoun swapped in. */
export function tagChoices(p: Pronouns): ReadonlyArray<{ kind: TagKind; title: string; sub: string }> {
  return [
    { kind: "damaged", title: "Damaged or faded", sub: `Still on ${p.obj}, hard to scan` },
    { kind: "found_on_ground", title: "Found it on the ground", sub: "The dog isn't with me" },
    { kind: "wrong_dog", title: "This isn't the dog in the photo", sub: "Tag is on a different dog" },
    { kind: "too_tight", title: "Collar is too tight", sub: "Or cutting into the neck" },
  ];
}

/** F4 footnote. With no feeders there is nobody to tell, so it says only what is true. */
export function tagFootnote(p: Pronouns, feederCount?: number): string {
  return feederCount === 0 ? "No sign-in needed." : `No sign-in needed. ${cap(p.poss)} feeders are told within a minute.`;
}

export type TagOutcome =
  /** feedersNotified null: the API did not say how many. */
  | { kind: "sent"; feedersNotified: number | null; wardCode: string | null }
  | { kind: "queued" }
  | { kind: "rate_limited" };

/**
 * F5 heading and message. The count and ward come from the API's answer; a
 * report that reached nobody says so rather than "her feeders know".
 */
export function tagSentCopy(
  kind: TagKind,
  name: string | undefined,
  p: Pronouns,
  o: TagOutcome,
): { title: string; msg: string; ok: boolean } {
  const dog = name ?? "this dog";
  if (o.kind === "queued") {
    return {
      title: "Your report is saved.",
      msg: `It goes to Hetja when you're back online. ${cap(p.poss)} feeders won't hear until then.`,
      ok: true,
    };
  }
  if (o.kind === "rate_limited") {
    return {
      title: "Not sent this time.",
      msg: "This phone has sent a lot of reports today, so Hetja is holding this one back. If the dog is hurt, the red button still works.",
      ok: false,
    };
  }
  const review = kind === "wrong_dog" ? " Until a feeder checks, this tag shows as under review. SOS still works." : "";
  const n = o.feedersNotified;
  if (n === 0) {
    return {
      title: "Report saved.",
      msg: `Nobody feeds ${dog} on Hetja yet, so no one got an alert. Your report is saved for whoever does.${review}`,
      ok: true,
    };
  }
  const where = o.wardCode ? ` in ${o.wardCode}` : "";
  const who = n === null ? `Feeders${where} got an alert` : `${n} feeder${n === 1 ? "" : "s"}${where} got an alert`;
  const what =
    kind === "found_on_ground"
      ? ` that ${p.poss} tag came off. Someone will put a new one on ${p.obj}.`
      : kind === "damaged"
        ? ` that ${p.poss} tag is damaged. Someone will put a new one on ${p.obj}.`
        : kind === "too_tight"
          ? ` that ${p.poss} collar is too tight. Someone will loosen or change it.`
          : `.${review}`;
  return { title: `${name ? `${name}'s` : "This dog's"} feeders know.`, msg: who + what, ok: true };
}

/** Profile line once there are three tag reports in a week. */
export function sturdierLine(name: string, p: Pronouns): string {
  return `${name}'s tag keeps coming off. A sturdier collar would help ${p.obj}.`;
}

/** Memorial lead for a dog who has passed (N9: the page stays). */
export function memorialLine(name: string, p: Pronouns): string {
  return `${name} has passed away. ${cap(p.poss)} page stays, with the names of everyone who fed ${p.obj}.`;
}

/* ---------------------------------------------------------------------------
 * Design v6: every dog by name (V15 to V19, P12, P13, N10, N11, L7).
 * Feeders are named by first name only, and only those who have not opted
 * out; the rest are counted, never named.
 * ------------------------------------------------------------------------- */

/** "Priya", "Priya and Arjun", "Priya, Arjun and a vet". */
export function nameList(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface Feeders {
  sex?: string;
  /** First names of feeders who show them (opt-outs are absent). */
  feederNames?: string[];
  feederCount?: number;
}

/**
 * Who an SOS reaches besides a vet: up to three first names, then the rest
 * counted ("Priya, Arjun, 2 other feeders"), or "her 2 feeders" when nobody
 * is named. Empty when the dog has no feeders.
 */
export function feederWho(p: Feeders): string[] {
  const n = p.feederCount;
  if (n === 0) return [];
  const names = (p.feederNames ?? []).slice(0, 3);
  const poss = pronouns(p.sex).poss;
  if (!names.length) return [n ? `${poss} ${plural(n, "feeder")}` : `${poss} feeders`];
  const others = n === undefined ? 0 : n - names.length;
  return others > 0 ? [...names, `${plural(others, "other feeder")}`] : names;
}

/** Under the red button (V15, V16): "Tells Priya, Arjun and a vet nearby." */
export function helpCap(p: Feeders): string {
  return `Tells ${nameList([...feederWho(p), "a vet nearby"])}.`;
}

/** Above "Send SOS" (V18): "Priya, Arjun and a vet will see K/W ward. Never your exact spot." */
export function sosSeeCap(p: Feeders, wardId?: string): string {
  return `${cap(nameList([...feederWho(p), "a vet"]))} will see ${wardId ? `${wardShort(wardId)} ward` : "the ward"}. Never your exact spot.`;
}

/**
 * V15 feeder line: "Priya fed her 2 hours ago. Rani has 2 feeders."
 * undefined when there is nothing true to say.
 */
export function feederLine(
  name: string,
  p: Feeders & { lastFedAt?: string | null; lastFedBy?: string | null },
  now: number = Date.now(),
): string | undefined {
  const a = p.lastFedAt ? ago(p.lastFedAt, now) : undefined;
  const fed = a ? (p.lastFedBy ? `${p.lastFedBy} fed ${pronouns(p.sex).obj} ${a}.` : `Last fed ${a}.`) : "";
  const n = p.feederCount;
  const has = n ? `${name} has ${plural(n, "feeder")}.` : "";
  return [fed, has].filter(Boolean).join(" ") || undefined;
}

/** "4:02 pm" (or "4:02" short), Asia/Kolkata wall time as the phone shows it. */
export function clock(iso: string | undefined, short = false): string {
  const t = iso ? new Date(iso) : undefined;
  if (!t || !Number.isFinite(t.getTime())) return "";
  const h = t.getHours();
  const hm = `${h % 12 || 12}:${String(t.getMinutes()).padStart(2, "0")}`;
  return short ? hm : `${hm} ${h < 12 ? "am" : "pm"}`;
}

/** "today", "yesterday", "3 Sep": for "Saved yesterday, 8:14 pm". */
export function dayWord(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const day = (x: Date): number => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86400000);
  const diff = day(new Date(now)) - day(d);
  return diff <= 0 ? "today" : diff === 1 ? "yesterday" : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/**
 * V4 dates as the mock writes them: "12 Sep 2026", or "Apr 2025" for a
 * month-precision record ("2025-04"). Read as a calendar date, never shifted
 * by the phone's time zone. "" for anything unparseable.
 */
export function recordDate(iso?: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso ?? "");
  const mon = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !mon) return "";
  return m[3] ? `${Number(m[3])} ${mon} ${m[1]}` : `${mon} ${m[1]}`;
}

/**
 * The SOS as text a person can pass on (P12 "Copy details", P13 SMS):
 * "SOS for Rani (collar R4N 7KW 2AB), K/W ward. Can't get up, or bleeding. <note>"
 */
export function sosText(
  sms: boolean,
  d: { name?: string; slug?: string; wardId?: string; wardName?: string },
  choiceTitle: string,
  note?: string,
): string {
  const who = d.name ? `${d.name}${d.slug ? ` (collar ${collarGroups(d.slug).join(" ")})` : ""}` : "a dog";
  const ward = d.wardId ? `, ${wardShort(d.wardId)} ward${sms && d.wardName ? `, ${d.wardName}` : ""}` : "";
  return `${sms ? "Hetja SOS:" : "SOS for"} ${who}${ward}. ${choiceTitle}.${note ? ` ${note}` : ""}`;
}

/** The dog as the SOS screens name it. */
export interface SosDog {
  name?: string;
  sex?: string;
  dogless?: boolean;
  feederCount?: number;
  feederNames?: string[];
}

/**
 * V19 headline and lead. Names come from the reporter's case status
 * (`feedersNotifiedNames`, opt-outs respected); until they arrive, or when
 * nobody is named, the words claim only what is known.
 */
export function sentCopy(d: SosDog, names?: string[], vets?: number, told?: number): { title: string; lead: string } {
  const tail = " This page updates when someone's on the way.";
  const withVet = vets === 0 ? "" : ", along with a vet nearby";
  if (d.dogless) return { title: "Your SOS is out.", lead: `Feeders and vets in your ward got it just now.${tail}` };
  const dog = d.name ?? "this dog";
  if (names?.length) {
    return {
      title: `${nameList(names)} know${names.length === 1 ? "s" : ""}.`,
      lead: `${names.length === 1 ? `${names[0]} feeds` : "They feed"} ${dog} and got your message just now${withVet}.${tail}`,
    };
  }
  if (told) {
    return { title: `${plural(told, "feeder")} ${told === 1 ? "knows" : "know"}.`, lead: `They got your message just now${withVet}.${tail}` };
  }
  if (d.feederCount === 0 || told === 0) {
    return vets === 0
      ? { title: "Nobody nearby was reached.", lead: "Please call someone below." }
      : { title: "A vet nearby knows.", lead: `They got your message just now.${tail}` };
  }
  return { title: `${d.name ? `${d.name}'s` : "This dog's"} feeders know.`, lead: `They got your message just now${withVet}.${tail}` };
}

export type Outcome = "taken_to_vet" | "treated_on_spot" | "not_found" | "died";

/** N11 "What happened": the outcome the responder closed the case with. */
export function doneCopy(
  outcome: string | undefined,
  d: SosDog,
  first: string | undefined,
  vetName: string | undefined,
  at: string,
): { title: string; lead: string; pill: string; ok: boolean } {
  const p = pronouns(d.sex);
  const dog = d.name ?? "The dog";
  const who = first ?? "A feeder";
  const thanks = " You stopped when most people walk past. Thank you.";
  if (outcome === "taken_to_vet")
    return {
      title: `${dog} is with a vet.`,
      lead: `${who} took ${p.obj} to ${vetName ?? "a vet"}${at ? ` at ${at}` : ""}.${thanks}`,
      pill: "Taken to a vet",
      ok: true,
    };
  if (outcome === "treated_on_spot")
    return { title: `${dog} was looked after.`, lead: `${who} treated ${p.obj} where you found ${p.obj}.${thanks}`, pill: "Treated on the spot", ok: true };
  if (outcome === "not_found")
    return {
      title: `${dog} wasn't found.`,
      lead: `${who} looked but couldn't find ${p.obj}. ${cap(p.poss)} feeders will keep watching. Thank you for stopping.`,
      pill: "Not found",
      ok: false,
    };
  if (outcome === "died")
    return { title: `${dog} didn't make it.`, lead: `${who} was with ${p.obj}. Thank you for stopping for ${p.obj}.`, pill: "Passed away", ok: false };
  return { title: "This SOS is closed.", lead: "Thank you for stopping.", pill: "Closed", ok: false };
}
