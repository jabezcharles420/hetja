import type { Metadata } from "next";
import { SignaturesScreen } from "@/components/vet/VetLists";

export const metadata: Metadata = {
  title: "My signatures · Hetja",
  robots: { index: false, follow: false },
};

/** /vet/signatures: every record this vet signed (designed, design v7). */
export default function SignaturesPage(): React.JSX.Element {
  return <SignaturesScreen />;
}
