/**
 * L1 alerts pause (design v6): the resume times offered, and the words.
 * Times are Asia/Kolkata, where every feeder is.
 */

const IST_MS = 5.5 * 3600_000;

/** 8 am IST on the Mumbai calendar day `days` after `now`. */
export function eightAmIst(now: Date, days: number): Date {
  const ist = new Date(now.getTime() + IST_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate() + days;
  // 08:00 IST is 02:30 UTC.
  return new Date(Date.UTC(y, m, d, 2, 30));
}

function clock(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    .format(d)
    .replace(/:00/, "")
    .replace(/\s?([ap])\.?m\.?/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
}

function dayMonth(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(d);
}

export function pauseOptions(now: Date): {
  tomorrow: { at: Date; label: string };
  week: { at: Date; label: string };
} {
  const tomorrow = eightAmIst(now, 1);
  const week = eightAmIst(now, 7);
  return { tomorrow: { at: tomorrow, label: clock(tomorrow) }, week: { at: week, label: dayMonth(week) } };
}

/** "8 am" when it is within the next day, otherwise "2 Oct". */
export function resumeLabel(untilIso: string, now: Date = new Date()): string {
  const until = new Date(untilIso);
  return until.getTime() - now.getTime() <= 36 * 3600_000 ? clock(until) : dayMonth(until);
}

/** A pause still in the future. */
export function isPaused(untilIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!untilIso) return false;
  const t = Date.parse(untilIso);
  return Number.isFinite(t) && t > now.getTime();
}

function orList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * "If Rani or Kalu is hurt, other feeders and the vets in K/W will still
 * hear. You won't." Hetja does not name co-feeders here: it only knows the
 * feeder's own dogs and wards.
 */
export function pauseSentence(dogNames: string[], wardCodes: string[]): string {
  const dogs = dogNames.filter(Boolean).slice(0, 2);
  const who = dogs.length ? orList(dogs) : "a dog you feed";
  const where = wardCodes.length ? ` in ${wardCodes.slice(0, 2).join(" and ")}` : " nearby";
  return `If ${who} is hurt, other feeders and the vets${where} will still hear. You won't.`;
}
