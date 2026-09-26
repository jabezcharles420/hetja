import type { Metadata } from "next";
import { PasskeyScreen } from "@/components/vet/VetProfileScreen";

export const metadata: Metadata = {
  title: "Sign with your phone · Hetja",
  robots: { index: false, follow: false },
};

/** /vet/passkey: set up signing on this phone (designed, design v7). */
export default function PasskeyPage(): React.JSX.Element {
  return <PasskeyScreen />;
}
