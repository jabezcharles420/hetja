import type { Metadata } from "next";
import NgoRegisterScreen from "@/components/ngo/NgoRegisterScreen";

export const metadata: Metadata = {
  title: "Bring your NGO to Hetja · Hetja",
  description: "Register your NGO. We check your registration and call you before switching it on.",
  robots: { index: false, follow: false },
};

/** Design v7 NGO portal. Client-rendered: the session lives in localStorage. */
export default function Page(): React.JSX.Element {
  return <NgoRegisterScreen />;
}
