import type { Metadata } from "next";
import DogWeekScreen from "./DogWeekScreen";

export const metadata: Metadata = {
  title: "This week · Hetja",
  description: "Which days a dog you feed has eaten, and when the next vaccine is due.",
  robots: { index: false, follow: false },
};

/** /me/dogs/<slug>: N15. Client-rendered: the session lives in localStorage. */
export default function DogWeekPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <DogWeekScreen slug={String(params.slug ?? "")} />;
}
