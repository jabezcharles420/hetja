import type { Metadata } from "next";
import PrintClient from "./PrintClient";

export const metadata: Metadata = {
  title: "Print tag · Hetja",
  description: "Collar tags, a collar band or a wall notice as a PDF: A4 or Letter, black and white, at 100% scale.",
};

export default function PrintPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <PrintClient slug={params.slug} />;
}
