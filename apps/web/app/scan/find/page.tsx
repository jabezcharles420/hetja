import type { Metadata } from "next";
import FindScreen from "@/components/scan/FindScreen";

export const metadata: Metadata = {
  title: "Find a dog · Hetja",
  description: "No code at all? Find the dog by ward, coat colour and photo.",
};

export default function ScanFindPage(): React.JSX.Element {
  return <FindScreen />;
}
