import type { Metadata } from "next";
import NgoHomeScreen from "@/components/ngo/NgoHomeScreen";

export const metadata: Metadata = {
  title: "NGO · Hetja",
  description: "Your NGO on Hetja: SOS in your wards, the ambulance, beds, team and drives.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page(): React.JSX.Element {
  return <NgoHomeScreen />;
}
