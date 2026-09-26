import type { Metadata } from "next";
import { VetProfileScreen } from "@/components/vet/VetProfileScreen";

export const metadata: Metadata = {
  title: "Vet profile · Hetja",
  robots: { index: false, follow: false },
};

/** /vet/profile: wards, SOS hours, public phone, clinic (designed, design v7). */
export default function VetProfilePage(): React.JSX.Element {
  return <VetProfileScreen />;
}
