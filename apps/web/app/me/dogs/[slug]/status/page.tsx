import type { Metadata } from "next";
import StatusScreen from "./StatusScreen";

export const metadata: Metadata = {
  title: "Update on a dog · Hetja",
  description: "Tell the other feeders a dog has not been seen, has a home, or has passed away.",
  robots: { index: false, follow: false },
};

/** /me/dogs/<slug>/status: N9. Client-rendered: the session lives in localStorage. */
export default function DogStatusPage({ params }: { params: { slug: string } }): React.JSX.Element {
  return <StatusScreen slug={String(params.slug ?? "")} />;
}
