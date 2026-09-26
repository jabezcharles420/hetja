import { redirect } from "next/navigation";

/**
 * /vet/<slug>: design v5's N3 checkup, folded into design v7's V2b and V3.
 * Old links (and the collar page of that era) land on the vet's view of the
 * dog, where Sign vaccination and Mark sterilised replace the checkup form.
 */
export default function VetSlugRedirect({ params }: { params: { slug: string } }): never {
  redirect(`/vet/dogs/${encodeURIComponent(String(params.slug ?? ""))}`);
}
