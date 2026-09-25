import type { Metadata } from "next";
import StartClient from "./StartClient";

export const metadata: Metadata = {
  title: "Register a dog · Hetja",
  description:
    "Know a street dog well? Give them a code so anyone can scan it and help. A photo, the ward, and one printed A4 page.",
};

export default function RegisterPage(): React.JSX.Element {
  return <StartClient />;
}
