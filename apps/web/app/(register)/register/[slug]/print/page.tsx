import type { Metadata } from "next";
import PrintSheet from "./PrintSheet";

export const metadata: Metadata = {
  title: "Print collar — Hetja",
  description: "Printable collar sheet — 40×40 mm QR, cut lines, and the 9-character fallback.",
};

export default function PrintPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <PrintSheet slug={params.slug} />;
}
