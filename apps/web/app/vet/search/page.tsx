import type { Metadata } from "next";
import SearchScreen from "@/components/vet/SearchScreen";

export const metadata: Metadata = {
  title: "Find a dog · Hetja",
  robots: { index: false, follow: false },
};

/** /vet/search: "Or search by name or ID" from the Vet tab (designed, design v7). */
export default function VetSearchPage(): React.JSX.Element {
  return <SearchScreen />;
}
