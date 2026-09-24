import type { Metadata } from "next";
import ReadyClient from "./ReadyClient";

export const metadata: Metadata = {
  title: "Collar ready · Hetja",
  description: "Print the collar tag for the dog you just registered.",
};

export default function CollarReadyPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <ReadyClient slug={params.slug} />;
}
