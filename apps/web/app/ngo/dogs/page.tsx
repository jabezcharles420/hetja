import type { Metadata } from "next";
import WardDogsScreen from "@/components/ngo/WardDogsScreen";

export const metadata: Metadata = {
  title: "Dogs in your wards · Hetja",
  description: "Every dog on Hetja in your NGO's wards.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page(): React.JSX.Element {
  return <WardDogsScreen />;
}
