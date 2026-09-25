import type { Metadata } from "next";
import PrintableSheet from "../../../_sheet/PrintableSheet";

export const metadata: Metadata = {
  title: "Printable collar sheet · Hetja",
  description: "The collar sheet as a printable page, at 100% scale.",
};

export default function PrintSheetPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <PrintableSheet slug={params.slug} backHref={`/register/${params.slug}/print`} />;
}
