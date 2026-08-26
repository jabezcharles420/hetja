import type { Metadata } from "next";
import ActivateClient from "./ActivateClient";

export const metadata: Metadata = {
  title: "Registration — Hetja",
  description: "What to do next — print the sheet, attach the collar, and scan to activate.",
};

export default function RegisterSlugPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <ActivateClient slug={params.slug} />;
}
