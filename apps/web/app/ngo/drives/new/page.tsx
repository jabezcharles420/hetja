import type { Metadata } from "next";
import NewDriveScreen from "@/components/ngo/NewDriveScreen";

export const metadata: Metadata = {
  title: "New drive · Hetja",
  description: "Plan a collar and sterilisation drive.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page(): React.JSX.Element {
  return <NewDriveScreen />;
}
