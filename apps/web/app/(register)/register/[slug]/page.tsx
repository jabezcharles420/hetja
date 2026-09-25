import type { Metadata } from "next";
import RegistrationClient from "./RegistrationClient";

export const metadata: Metadata = {
  title: "Registration · Hetja",
  description: "Put the collar on and scan it once to switch the dog's page on; then reprint, edit and invite feeders.",
};

export default function RegisterSlugPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <RegistrationClient slug={params.slug} />;
}
