import type { Metadata } from "next";
import RegisterFlow from "./RegisterFlow";

export const metadata: Metadata = {
  title: "Register a dog · Hetja",
  description: "A face photo, the ward, a few details: then the signed collar code to print.",
};

export default function NewRegisterPage(): React.JSX.Element {
  return <RegisterFlow />;
}
