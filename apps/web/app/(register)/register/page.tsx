import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "Register — Hetja",
  description:
    "Your dog registrations — status, days left, and printable collar sheets. Attaching the tag is what activates it.",
};

export default function RegisterPage(): React.JSX.Element {
  return <Dashboard />;
}
