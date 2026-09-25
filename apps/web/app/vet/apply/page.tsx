import type { Metadata } from "next";
import ApplyScreen from "@/components/vet/ApplyScreen";

export const metadata: Metadata = {
  title: "Sign records as a vet · Hetja",
  description: "Apply once with your council registration, and sign dogs' records as a vet.",
  robots: { index: false, follow: false },
};

/** /vet/apply: V1, and where an application stands (design v7). */
export default function VetApplyPage(): React.JSX.Element {
  return <ApplyScreen />;
}
