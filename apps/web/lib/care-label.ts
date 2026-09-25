/**
 * How a care provider is named wherever the web app lists one (design v7
 * owner decision: "Government vets are free, and Hetja says so").
 *
 *   government vet (a person)      "Government vet · free"
 *   government hospital / clinic   "Government hospital · free"
 *   anything with cost tier free   "<kind word> · free"   e.g. "NGO · free"
 *   everything else                "<kind word>"          e.g. "Vet"
 *
 * One helper so the map, the SOS-anyway list and the vet and NGO portals all
 * say it the same way. Inputs are the care directory's fields, all optional,
 * so any payload that carries some of them works.
 */

export interface CareLabelInput {
  /** Directory kind: "govt", "ngo", "private_clinic", "charity_hospital". */
  careKind?: string | null;
  /** The map's pin kind; used for the word when careKind says nothing more. */
  kind?: "vet" | "ngo" | string | null;
  /** "free" | "subsidised" | "paid". */
  costTier?: string | null;
  /** v7 care lookups: a government provider. */
  isGovernment?: boolean | null;
  /** v7 care lookups: a vet listed as a person (a government vet), not a hospital. */
  isPerson?: boolean | null;
}

export function isGovernmentCare(p: CareLabelInput): boolean {
  return p.isGovernment === true || p.careKind === "govt";
}

/** The kind word alone: "Vet", "NGO", "Government vet", "Government hospital". */
export function careKindWord(p: CareLabelInput): string {
  if (isGovernmentCare(p)) return p.isPerson ? "Government vet" : "Government hospital";
  if (p.careKind === "ngo" || p.kind === "ngo") return "NGO";
  return "Vet";
}

/** The full label, with "· free" when it is free (government care always is). */
export function careLabel(p: CareLabelInput): string {
  const word = careKindWord(p);
  const free = isGovernmentCare(p) || p.costTier === "free";
  return free ? `${word} · free` : word;
}
