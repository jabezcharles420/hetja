import type { Metadata } from "next";
import PrintableSheet from "../../_sheet/PrintableSheet";

export const metadata: Metadata = {
  title: "Printable batch sheet · Hetja",
  description: "Up to eight dogs, two tags each, as a printable page at 100% scale.",
};

export default function BatchSheetPage(): React.JSX.Element {
  return <PrintableSheet backHref="/register/batch" />;
}
