import type { Metadata } from "next";
import HealthScreen from "@/components/vet/HealthScreen";

export const metadata: Metadata = {
  title: "Health · Hetja",
  robots: { index: false, follow: false },
};

/** /vet/dogs/<slug>/health: V4 as a full screen, from V2b's "Health notes". */
export default function VetHealthPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <HealthScreen slug={String(params.slug ?? "")} />;
}
