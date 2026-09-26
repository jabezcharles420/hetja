import type { Metadata } from "next";
import { DueSoonScreen } from "@/components/vet/VetLists";

export const metadata: Metadata = {
  title: "Due soon · Hetja",
  robots: { index: false, follow: false },
};

/** /vet/due: boosters due in the vet's wards (designed, design v7). */
export default function DuePage(): React.JSX.Element {
  return <DueSoonScreen />;
}
