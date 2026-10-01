/**
 * The people and groups thanked on /credits (design v8, the design system's
 * ui_kits/credits). Add a person or group under the right heading as
 * { name, did }; a heading with nobody under it is not shown, so the page
 * never prints a placeholder. Names as the person asked to be credited
 * (first names are fine), never a phone number or an address.
 */
export interface Credit {
  name: string;
  /** What they did, one line: "Fed the first dogs with collars, every evening". */
  did: string;
}

export const CREDIT_GROUPS: ReadonlyArray<{ heading: string; people: Credit[] }> = [
  { heading: "On the street", people: [] },
  { heading: "Checked the details", people: [] },
  { heading: "Lent a hand", people: [] },
];

/** The groups that have someone in them. */
export function shownGroups(groups = CREDIT_GROUPS): ReadonlyArray<{ heading: string; people: Credit[] }> {
  return groups.filter((g) => g.people.length > 0);
}
