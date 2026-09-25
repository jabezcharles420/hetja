import type { Metadata } from "next";
import RegistrationsClient from "./RegistrationsClient";

export const metadata: Metadata = {
  title: "Register · Hetja",
  description:
    "The dogs you put on Hetja: which collars still need putting on, which tags need printing, and which dogs are live.",
};

export default function RegisterPage(): React.JSX.Element {
  return <RegistrationsClient />;
}
