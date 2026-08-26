import type { Metadata } from "next";
import NewRegistrationForm from "./NewRegistrationForm";

export const metadata: Metadata = {
  title: "Register a dog — Hetja",
  description: "File a registration for a street or community dog you look after; get the signed QR to print and attach.",
};

export default function NewRegisterPage(): React.JSX.Element {
  return <NewRegistrationForm />;
}
