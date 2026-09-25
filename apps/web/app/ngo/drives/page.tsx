import type { Metadata } from "next";
import DrivesScreen from "@/components/ngo/DrivesScreen";

export const metadata: Metadata = {
  title: "Drives · Hetja",
  description: "Your collar and sterilisation drives.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page(): React.JSX.Element {
  return <DrivesScreen />;
}
