/**
 * N10 "While you wait": what a stranger does with their hands until the
 * responder arrives.
 *
 * This replaces a placeholder that sat behind FIRST_AID_ENABLED = false
 * because its copy had no vet sign-off. The design v6 owner decision
 * (docs/design/v6-handoff/CONTRACT.md, "N10 first-aid lines ship as
 * designed", 2026-09-25) is that explicit, separate decision: these three
 * lines are the mock's, verbatim, with the dog's pronoun swapped in. The
 * mock's own note still asks for a vet's review before launch; change the
 * words here only with one.
 */
import type { Pronouns } from "./format";

export function firstAid(p: Pronouns): string[] {
  return [
    `Keep traffic and people back. Stand between ${p.obj} and the road if it's safe.`,
    "Don't lift a dog that can't stand. Don't give food or water.",
    `Talk low and keep your hands away from ${p.poss} face. Hurt dogs can snap.`,
  ];
}
