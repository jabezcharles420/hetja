import type { Metadata } from "next";
import QrScanner from "@/components/QrScanner";

export const metadata: Metadata = {
  title: "Scan a collar · Hetja",
  description:
    "Point your camera at the QR on a dog's collar, or type the 9-character code printed under it, to meet the dog behind it.",
};

export default function ScanPage(): React.JSX.Element {
  return <QrScanner />;
}
