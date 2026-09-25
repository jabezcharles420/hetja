import type { Metadata } from "next";
import CodeScreen from "@/components/scan/CodeScreen";

export const metadata: Metadata = {
  title: "Type the code · Hetja",
  description:
    "Type the part of a collar code you can read. Hetja shows the dogs it could be, so you can check the photo.",
};

export default function ScanCodePage(): React.JSX.Element {
  return <CodeScreen />;
}
