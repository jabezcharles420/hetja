import type { Metadata } from "next";
import NgoProfileScreen from "@/components/ngo/NgoProfileScreen";

export const metadata: Metadata = {
  title: "NGO profile · Hetja",
  description: "Your NGO's public phone, wards, hours and what you offer.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page(): React.JSX.Element {
  return <NgoProfileScreen />;
}
