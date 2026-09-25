/**
 * The only form of a feeder's name any other person ever sees (design v5).
 *
 * Feeder identity is otherwise never public (INVARIANT 3's reasoning: a name
 * plus the dogs someone feeds is a map of where they go). Where v5 does show a
 * person to someone else (the Alerts list, tag history, "Last fed by", a
 * memorial page), it shows this: the first name and the initial of the last
 * word, "Priya Sharma" -> "Priya S.". A single word is shown as is. A title
 * ("Dr Anil Mehta") keeps the title and the surname, "Dr Mehta", which is how a
 * vet is publicly known anyway.
 *
 * An anonymised account (DELETE /feeders/me) has no public name: callers get
 * null and render "a feeder" or leave it out.
 */
export const FORMER_FEEDER_NAME = "Former feeder";

const TITLES = new Set(["dr", "dr."]);

export function publicName(displayName: string | null | undefined, deletedAt?: Date | string | null): string | null {
  if (deletedAt) return null;
  const words = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length >= 2 && TITLES.has(words[0].toLowerCase())) {
    return `Dr ${words[words.length - 1]}`;
  }
  const first = words[0];
  if (words.length === 1) return first;
  const last = words[words.length - 1];
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

/**
 * Design v6: the form PUBLIC copy uses ("Priya fed her", "Rani has 2
 * feeders"): the first word of the display name and nothing else, and only
 * for a feeder who has not switched off "Show my first name on dogs' pages"
 * (feeders.show_first_name, default on). An opted-out or anonymised feeder
 * gives null: callers count them and never name them. Titles are dropped
 * with the rest ("Dr Anil Mehta" is "Dr" alone otherwise), so a titled name
 * gives its surname: "Dr Mehta".
 */
export function firstName(
  displayName: string | null | undefined,
  showFirstName: boolean | null | undefined,
  deletedAt?: Date | string | null,
): string | null {
  if (deletedAt || showFirstName === false) return null;
  const words = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length >= 2 && TITLES.has(words[0].toLowerCase())) return `Dr ${words[words.length - 1]}`;
  return words[0];
}
