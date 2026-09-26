import type { Metadata } from "next";
import TeamScreen from "@/components/ngo/TeamScreen";

export const metadata: Metadata = {
  title: "Team · Hetja",
  description: "Your NGO's vets and volunteers.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page(): React.JSX.Element {
  return <TeamScreen />;
}
