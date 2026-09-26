import type { Metadata } from "next";
import VetDogScreen from "@/components/vet/VetDogScreen";

export const metadata: Metadata = {
  title: "Dog, for a vet · Hetja",
  robots: { index: false, follow: false },
};

/** /vet/dogs/<slug>: V2b, a dog's page for a vet (design v7). */
export default function VetDogPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <VetDogScreen slug={String(params.slug ?? "")} />;
}
