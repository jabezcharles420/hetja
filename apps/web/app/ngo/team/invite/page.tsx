import type { Metadata } from "next";
import InviteScreen from "@/components/ngo/InviteScreen";

export const metadata: Metadata = {
  title: "Invite to the team · Hetja",
  description: "Invite a volunteer or a vet to your NGO on Hetja.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page(): React.JSX.Element {
  return <InviteScreen />;
}
