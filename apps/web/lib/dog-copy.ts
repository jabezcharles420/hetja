/**
 * Words about one dog, for the register and print screens (design v5, R4 to
 * R8 and the A4 sheets).
 *
 * The mocks are written for Rani, a female dog ("About her", "She lives on
 * this street."). Pronouns follow the dog's sex when it is known and fall
 * back to they/them when it is not, or when the registrator chose "Not sure".
 * Verbs agree ("she sleeps", "they sleep"), so each line is written out in
 * full rather than assembled from a pronoun.
 *
 * GET /registrations/:slug and GET /dogs/:slug/collar do not return the sex,
 * so the flow remembers what the registrator picked, per slug, on this phone.
 * Every storage access is try/catch: no storage just means they/them.
 */

export type DogSex = "female" | "male" | "unknown";

type Pr = { subj: string; Subj: string; obj: string; poss: string; plural: boolean };

function pr(sex: DogSex | null | undefined): Pr {
  if (sex === "female") return { subj: "she", Subj: "She", obj: "her", poss: "her", plural: false };
  if (sex === "male") return { subj: "he", Subj: "He", obj: "him", poss: "his", plural: false };
  return { subj: "they", Subj: "They", obj: "them", poss: "their", plural: true };
}

export const dogCopy = {
  /** R4 title: "About her". */
  aboutTitle: (s?: DogSex | null) => `About ${pr(s).obj}`,
  /** R4 name label: "Name people call her". */
  nameLabel: (s?: DogSex | null) => `Name people call ${pr(s).obj}`,
  /** R4 chips label: "How to spot her". */
  spotLabel: (s?: DogSex | null) => `How to spot ${pr(s).obj}`,
  /** R5 first checkbox. */
  seeWeekly: (s?: DogSex | null) => `I see ${pr(s).obj} at least once a week.`,
  /** R5 second checkbox. */
  noPosting: (s?: DogSex | null) => {
    const p = pr(s);
    return p.plural
      ? "I won't post where they sleep or eat."
      : `I won't post where ${p.subj} sleeps or eats.`;
  },
  /** R6 lead. */
  readyLead: (s?: DogSex | null) =>
    `Print ${pr(s).poss} tag and tie it to a soft collar. Anyone who scans it can log a feed or send an SOS.`,
  /** R6 primary button. */
  printTag: (s?: DogSex | null) => `Print ${pr(s).poss} tag`,
  /** A4 page 02 lead. */
  noticeLead: (s?: DogSex | null) => {
    const p = pr(s);
    return p.plural
      ? "They live on this street. Neighbours feed them and a vet checks on them."
      : `${p.Subj} lives on this street. Neighbours feed ${p.obj} and a vet checks on ${p.obj}.`;
  },
  /** A4 page 02 right card title. */
  justFed: (s?: DogSex | null) => `Just fed ${pr(s).obj}?`,
  /** A4 page 02 right card body. */
  justFedBody: (s?: DogSex | null) => {
    const p = pr(s);
    return p.plural
      ? "Scan and log it, so they aren't fed three times today."
      : `Scan and log it, so ${p.subj} isn't fed three times today.`;
  },
  /** R6 share message for a vet. */
  vetMessage: (name: string | null | undefined, code: string, s?: DogSex | null) => {
    const p = pr(s);
    const who = name?.trim() || "this street dog";
    return (
      `Could you check ${who} and confirm ${p.obj} on Hetja? ` +
      `${p.plural ? "Their" : p.poss[0]!.toUpperCase() + p.poss.slice(1)} collar code is ${code}.`
    );
  },
};

/** "Female" / "Male" / "Not sure" for the summary card. */
export function sexLabel(s: DogSex | null | undefined): string {
  if (s === "female") return "Female";
  if (s === "male") return "Male";
  return "Not sure";
}

const SEX_PREFIX = "hetja.dogSex.";

export function rememberDogSex(slug: string, sex: DogSex | null | undefined): void {
  try {
    if (sex === "female" || sex === "male") localStorage.setItem(SEX_PREFIX + slug, sex);
  } catch {
    /* no storage: they/them */
  }
}

export function recallDogSex(slug: string): DogSex | null {
  try {
    const v = localStorage.getItem(SEX_PREFIX + slug);
    return v === "female" || v === "male" ? v : null;
  } catch {
    return null;
  }
}

/** "rni482pq7" -> "RNI 482 PQ7". */
export function prettyCode(slug: string): string {
  return (slug.toUpperCase().match(/.{1,3}/g) ?? []).join(" ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 Sep 2026", as the sheet header prints it (not the locale's "Sept"). */
export function printDate(d: Date = new Date()): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Markings as one phrase: ["Brown", "White chest"] -> "Brown, white chest". */
export function markingsPhrase(markings: readonly string[]): string {
  return markings
    .map((m, i) => (i === 0 ? m : m.charAt(0).toLowerCase() + m.slice(1)))
    .join(", ");
}

/** "today", "yesterday", "4 days ago", "2 weeks ago", "3 months ago". */
export function sinceLabel(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
