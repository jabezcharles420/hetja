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
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 1) return "Last fed just now";
  if (mins < 60) return `Last fed ${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last fed ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Last fed yesterday";
  return `Last fed ${days} days ago`;
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
