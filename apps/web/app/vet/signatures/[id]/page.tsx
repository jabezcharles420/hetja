import type { Metadata } from "next";
import CorrectScreen from "@/components/vet/CorrectScreen";

export const metadata: Metadata = {
  title: "Correct a signed record · Hetja",
  robots: { index: false, follow: false },
};

/** /vet/signatures/<id>: V5, correct or withdraw a signed record (design v7). */
export default function CorrectPage({ params }: { params: { id: string } }): React.JSX.Element {
  return <CorrectScreen id={String(params.id ?? "")} />;
}
