import type { Metadata } from "next";
import VetHome from "@/components/vet/VetHome";

export const metadata: Metadata = {
  title: "Vet · Hetja",
  description: "SOS near you, feeders asking you to sign, and boosters due in your wards.",
  robots: { index: false, follow: false },
};

/** /vet: V2, the Vet tab (design v7). A tab root for verified vets. */
export default function VetPage(): React.JSX.Element {
  return <VetHome />;
}
