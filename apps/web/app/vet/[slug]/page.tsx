import type { Metadata } from "next";
import VetCheckupScreen from "./VetCheckupScreen";

export const metadata: Metadata = {
  title: "Checkup record · Hetja",
  description: "Vet accounts record a checkup and verify a dog.",
  robots: { index: false, follow: false },
};

/** /vet/<slug>: N3. Client-rendered: the session lives in localStorage. */
export default function VetCheckupPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <VetCheckupScreen slug={String(params.slug ?? "")} />;
}
